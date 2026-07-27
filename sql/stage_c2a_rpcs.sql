-- ============================================================
-- FANTASY EGGY — STAGE C2a: standings/schedule reads + shared Official gate
-- ============================================================
-- Run ONCE in the Supabase SQL Editor, after sql/stage_c1_rpcs.sql (already
-- run and never touched again). This file is layered on top, same idiom as
-- stage_a_fix_seasons.sql / stage_a_fix_closer_label.sql: new functions plus
-- a body-only re-touch of one already-shipped C1 function (submit_picks —
-- same signature, so a plain create or replace, no drop needed).
--
-- What this solves:
--   - The frontend read scores/seasons/season_rosters/league_shows directly
--     via RLS; Stage A left no public select policy on any of them, so they
--     return nothing today. The fix here is small RPCs, not new RLS
--     policies — CLAUDE.md already locked "scoped reads via RPCs, not RLS"
--     for anything that isn't truly global, and seasons/rosters/schedule
--     are per-league/per-bracket, not on the global list (shows,
--     songs_cache, setlist_songs, league names, bracket config).
--   - Official-eligibility gating gets ONE implementation
--     (_official_gate), called by both the new can_submit_picks (what the
--     frontend calls before rendering a pick sheet) and by submit_picks
--     itself (re-touched below) — no client-side duplication of the
--     three-branch check to drift out of sync.
--   - A hygiene gap found while writing this: Postgres grants EXECUTE on
--     every new function to PUBLIC by default, and nothing in this
--     codebase's history ever explicitly revoked it. _auth_player (returns
--     the full players row, including pin_hash) has therefore been directly
--     callable via /rpc/_auth_player by anyone holding the anon key this
--     whole time. Impact is limited — it requires the correct name AND PIN
--     to return anything, so this can only leak an account's own hash back
--     to someone who already fully controls it — but it's not what the
--     service_role-only grant was supposed to mean. Revoked below, along
--     with the same gap on _is_league_admin_or_global and the new
--     _official_gate.
-- ============================================================

begin;

-- ============================================================
-- SECTION 1 — STANDINGS / SCHEDULE READS
-- ============================================================

-- Authenticated and membership-gated, not public: cross-league visibility
-- is Global-admin-only, same as everything else in this app. A plain member
-- of the bracket's league, or a Global admin, can read it; anyone else is
-- rejected.
create or replace function get_bracket_scores(p_name text, p_pin text, p_bracket_id bigint, p_show_id bigint default null)
returns table(player_id uuid, player_name text, show_id bigint, points int, breakdown jsonb, updated_at timestamptz)
language plpgsql security definer set search_path = public, extensions as $$
declare pl players; v_league_id bigint;
begin
  pl := _auth_player(p_name, p_pin);
  select league_id into v_league_id from brackets where id = p_bracket_id;
  if v_league_id is null then raise exception 'Bracket not found'; end if;
  if not pl.is_global_admin and not exists (
    select 1 from league_members where league_id = v_league_id and player_id = pl.id
  ) then
    raise exception 'Not a member of this league';
  end if;
  -- Names join players directly (not through league_members), same pattern
  -- as get_show_picks/admin_pick_status — survives a league boot.
  return query
    select s.player_id, p.name, s.show_id, s.points, s.breakdown, s.updated_at
    from scores s
    join players p on p.id = s.player_id
    where s.bracket_id = p_bracket_id
      and (p_show_id is null or s.show_id = p_show_id);
end $$;

-- No auth: schedule/cutoff timing has to be visible to every player before
-- they've done anything, same as shows/brackets today — nothing in it is
-- per-player.
create or replace function get_league_shows(p_league_id bigint)
returns table(show_id bigint, cutoff_at timestamptz, format text, status text,
              remind_sent timestamptz, lock_sent timestamptz, winner_sent timestamptz)
language sql security definer set search_path = public, extensions as $$
  select show_id, cutoff_at, format, status, remind_sent, lock_sent, winner_sent
  from league_shows where league_id = p_league_id;
$$;

-- No auth: season date ranges only, nothing per-player.
create or replace function get_bracket_seasons(p_bracket_id bigint)
returns table(id bigint, name text, start_date date, end_date date, roster_locked_at timestamptz)
language sql security definer set search_path = public, extensions as $$
  select id, name, start_date, end_date, roster_locked_at
  from seasons where bracket_id = p_bracket_id
  order by start_date;
$$;

-- Return-shape change (adds official_opt_in), not just a body fix — a bare
-- create or replace doesn't cover a changed returns table(...), so this
-- needs the explicit drop, same idempotency rule C1 established for
-- signature changes.
drop function if exists my_leagues(text,text);
create or replace function my_leagues(p_name text, p_pin text)
returns table(league_id bigint, league_name text, is_league_admin boolean,
              bracket_id bigint, bracket_kind text, bracket_name text, official_opt_in boolean)
language plpgsql security definer set search_path = public, extensions as $$
declare pl players;
begin
  pl := _auth_player(p_name, p_pin);
  return query
    select l.id, l.name, lm.is_league_admin, b.id, b.kind, b.name, lm.official_opt_in
    from league_members lm
    join leagues l on l.id = lm.league_id
    join brackets b on b.league_id = l.id
    where lm.player_id = pl.id
    order by l.name, b.kind;
end $$;

-- ============================================================
-- SECTION 2 — SHARED OFFICIAL-ELIGIBILITY GATE
-- ============================================================

-- Internal-only helper: one source of truth for Official eligibility,
-- called by both can_submit_picks (below) and submit_picks (re-touched
-- below) — nothing left to keep manually in sync between a client-side
-- copy and the server-side check.
create or replace function _official_gate(p_bracket_id bigint, p_show_id bigint, p_player_id uuid)
returns table(ok boolean, reason text)
language plpgsql security definer set search_path = public, extensions as $$
declare
  brk brackets; sh shows; season_row seasons;
begin
  select * into brk from brackets where id = p_bracket_id;
  if brk.id is null or brk.kind <> 'official' then
    return query select true, null::text; return;
  end if;

  select * into sh from shows where id = p_show_id;

  -- Checked against the SHOW's date, not today's — a future show inside a
  -- future season's range is legitimately votable now.
  select * into season_row from seasons
    where bracket_id = p_bracket_id and sh.showdate between start_date and end_date;

  if season_row.id is null then
    return query select false, 'No Official season covers this show yet'; return;
  end if;

  if season_row.roster_locked_at is not null then
    if not exists (select 1 from season_rosters where season_id = season_row.id and player_id = p_player_id) then
      return query select false, 'You are not on this season''s roster'; return;
    end if;
  else
    -- Season hasn't activated yet — no snapshot exists — fall back to the
    -- live opt-in flag as the proxy.
    if not exists (select 1 from league_members
                   where league_id = brk.league_id and player_id = p_player_id and official_opt_in = true) then
      return query select false, 'You are not on this season''s roster'; return;
    end if;
  end if;

  return query select true, null::text;
end $$;

create or replace function can_submit_picks(p_name text, p_pin text, p_bracket_id bigint, p_show_id bigint)
returns table(ok boolean, reason text)
language plpgsql security definer set search_path = public, extensions as $$
declare pl players;
begin
  pl := _auth_player(p_name, p_pin);
  return query select * from _official_gate(p_bracket_id, p_show_id, pl.id);
end $$;

-- ============================================================
-- SECTION 3 — RE-TOUCH submit_picks (body only, same signature)
-- ============================================================
-- Signature unchanged from Stage C1, so this is a plain create or replace,
-- no drop needed. Only change from the C1 body: the inline three-branch
-- Official check is replaced with a call to _official_gate, so submit_picks
-- and can_submit_picks share one implementation instead of two copies.

create or replace function submit_picks(p_name text, p_pin text, p_bracket_id bigint, p_show_id bigint, p_picks jsonb)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare
  pl players; brk brackets; ls league_shows; sh shows;
  cfg jsonb; sect jsonb; item jsonb; gate record;
  valid_slots text[]; songs text[]; n_flat int;
begin
  pl := _auth_player(p_name, p_pin);

  select * into brk from brackets where id = p_bracket_id;
  if brk.id is null then raise exception 'Bracket not found'; end if;

  if not exists (select 1 from league_members where league_id = brk.league_id and player_id = pl.id) then
    raise exception 'You are not a member of this league';
  end if;

  select * into sh from shows where id = p_show_id;
  if sh.id is null then raise exception 'Show not found'; end if;

  select * into ls from league_shows where league_id = brk.league_id and show_id = p_show_id;
  if ls.league_id is null then raise exception 'This show is not on this league''s schedule'; end if;

  cfg := brk.config;
  if coalesce(cfg->>'voting_override','auto') = 'locked' then
    raise exception 'Voting is locked by the admin';
  end if;
  if coalesce(cfg->>'voting_override','auto') = 'open' then
    if sh.showdate < current_date then raise exception 'That show already happened'; end if;
  else
    if ls.cutoff_at is null then raise exception 'Picks are not open for this show yet'; end if;
    if now() >= ls.cutoff_at then raise exception 'Picks are locked for this show'; end if;
  end if;

  select * into gate from _official_gate(p_bracket_id, p_show_id, pl.id);
  if not gate.ok then raise exception '%', gate.reason; end if;

  sect := case when ls.format = 'one_set' and cfg ? 'oneset' then cfg->'oneset' else cfg end;
  n_flat := coalesce((sect->>'flat_picks')::int, 0);
  select array_agg(s->>'key') into valid_slots from jsonb_array_elements(sect->'slots') s;
  for i in 1..n_flat loop valid_slots := valid_slots || ('flat' || i); end loop;

  songs := array[]::text[];
  for item in select * from jsonb_array_elements(p_picks) loop
    if not (item->>'slot' = any(valid_slots)) then
      raise exception 'Invalid slot: %', item->>'slot';
    end if;
    if coalesce(trim(item->>'songname'), '') = '' then
      -- Explicitly submitted blank: clear any existing pick in this slot
      -- (the catch-all delete below only removes slots absent from
      -- p_picks entirely, so a resubmitted-blank slot needs its own delete
      -- or a previously-saved pick here would never actually clear).
      delete from picks where player_id = pl.id and bracket_id = p_bracket_id
        and show_id = p_show_id and slot = item->>'slot';
      continue;
    end if;
    if not coalesce((cfg->>'allow_duplicates')::bool, false)
       and lower(item->>'songname') = any(songs) then
      raise exception 'Duplicate pick: %', item->>'songname';
    end if;
    songs := songs || lower(item->>'songname');
    insert into picks (player_id, bracket_id, show_id, slot, songname, updated_at)
      values (pl.id, p_bracket_id, p_show_id, item->>'slot', trim(item->>'songname'), now())
      on conflict (player_id, bracket_id, show_id, slot)
      do update set songname = excluded.songname, updated_at = now();
  end loop;
  delete from picks where player_id = pl.id and bracket_id = p_bracket_id and show_id = p_show_id
    and not (slot = any(select jsonb_array_elements(p_picks)->>'slot'));
  return json_build_object('ok', true, 'saved', coalesce(array_length(songs,1),0));
end $$;

-- ============================================================
-- SECTION 4 — GRANTS + the PUBLIC-execute hygiene fix
-- ============================================================

-- Internal-only helpers: revoke the default PUBLIC execute grant Postgres
-- applies to every new function, then grant only where actually needed.
-- _auth_player and _is_league_admin_or_global predate this file (defined in
-- schema.sql / stage_c1_rpcs.sql respectively) and were never explicitly
-- revoked from PUBLIC until now — closing that gap here rather than leaving
-- it live.
revoke execute on function _auth_player(text,text) from public;
revoke execute on function _is_league_admin_or_global(uuid,bigint) from public;
revoke execute on function _official_gate(bigint,bigint,uuid) from public;
grant execute on function _auth_player(text,text) to service_role;
grant execute on function _is_league_admin_or_global(uuid,bigint) to service_role;

grant execute on function get_bracket_scores(text,text,bigint,bigint) to anon, authenticated;
grant execute on function get_league_shows(bigint) to anon, authenticated;
grant execute on function get_bracket_seasons(bigint) to anon, authenticated;
grant execute on function my_leagues(text,text) to anon, authenticated;
grant execute on function can_submit_picks(text,text,bigint,bigint) to anon, authenticated;
grant execute on function submit_picks(text,text,bigint,bigint,jsonb) to anon, authenticated;

commit;

-- ============================================================
-- SECTION 5 — VERIFICATION: function existence (proves the file applied)
-- ============================================================
-- select proname, pg_get_function_identity_arguments(oid) as args
-- from pg_proc
-- where pronamespace = 'public'::regnamespace
--   and proname in (
--     'get_bracket_scores','get_league_shows','get_bracket_seasons',
--     'my_leagues','_official_gate','can_submit_picks','submit_picks'
--   )
-- order by proname;
-- Expect: 7 rows. my_leagues should show the new official_opt_in column in
-- its return type; submit_picks should still be the single (text,text,
-- bigint,bigint,jsonb) signature (no new overload).
--
-- Also worth a one-off manual check that the PUBLIC revoke actually landed:
-- select p.proname, r.rolname, has_function_privilege(r.oid, p.oid, 'EXECUTE') as can_exec
-- from pg_proc p, pg_roles r
-- where p.proname in ('_auth_player','_is_league_admin_or_global','_official_gate')
--   and r.rolname in ('anon','authenticated','service_role')
-- order by p.proname, r.rolname;
-- Expect: only service_role's rows are true for _auth_player/_is_league_admin_or_global;
-- _official_gate is false for all three (nothing needs to call it directly).

-- The paired smoke test lives in sql/stage_c2a_smoke_test.sql — run it next.
