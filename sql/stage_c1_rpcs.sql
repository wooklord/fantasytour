-- ============================================================
-- FANTASY EGGY — STAGE C1: RPC layer rewrite (Global -> League -> Bracket)
-- ============================================================
-- Run ONCE in the Supabase SQL Editor, against the already-migrated (Stage A)
-- database. Stage A created tables and RLS but zero functions — every RPC
-- still live today is the pre-2.0 version, written against the flat schema
-- Stage A partly dismantled. This file replaces all of them.
--
-- Idempotency: every function whose parameter list changes gets an explicit
-- `drop function if exists <old signature>` immediately before its
-- `create or replace` — Postgres treats a different signature as a new
-- overload, not a replacement, and would leave the broken old one
-- (still targeting dropped columns/tables) live and callable otherwise.
-- Functions whose signature is unchanged (only body logic changes) don't
-- need a drop.
--
-- Shared guard: spec §3's `is_league_admin(league) OR is_global_admin` is
-- implemented ONCE as `_is_league_admin_or_global` and called by every
-- league-scoped admin_* function below, so Global automatically passes every
-- league gate without a parallel function set.
--
-- League boot is a HARD DELETE of the league_members row, not a flag
-- (league_members.banned is left vestigial — nothing here sets or reads it).
-- Picks/scores in that league are left untouched: the frozen-roster rule
-- means a booted player's season line must persist, they just stop
-- accruing. Ban is separate (banned_names), enforced by
-- admin_add_league_member refusing blocked names.
--
-- reopen/cutoff_changed/finalize are NOT SQL RPCs — they're authenticated
-- actions on the already-deployed carton-sync edge function (verifies
-- name/PIN via _auth_player + _is_league_admin_or_global, same guard as
-- here). This file grants those two helpers to service_role for that.
-- ============================================================

create extension if not exists pgcrypto;

-- Explicit transaction around every drop/create/grant below (Sections 1-8):
-- guarantees all-or-nothing. If any statement in here errors, Postgres rolls
-- back the entire batch — every drop and every create/replace together — so
-- a partial "old function dropped, new one never created" state cannot
-- persist. Either this commits in full, or the database is left exactly as
-- it was before you ran this file.
begin;

-- ============================================================
-- SECTION 1 — SHARED GUARD
-- ============================================================

create or replace function _is_league_admin_or_global(p_player_id uuid, p_league_id bigint)
returns boolean language sql security definer set search_path = public, extensions as $$
  select exists(select 1 from players where id = p_player_id and is_global_admin = true)
      or exists(select 1 from league_members
                where player_id = p_player_id and league_id = p_league_id and is_league_admin = true);
$$;

-- ============================================================
-- SECTION 2 — AUTH (signatures unchanged, body fixed)
-- ============================================================

create or replace function register_player(p_name text, p_pin text)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare pl players;
begin
  if length(trim(p_name)) < 2 then raise exception 'Name too short'; end if;
  if p_pin !~ '^\d{4,8}$' then raise exception 'PIN must be 4-8 digits'; end if;
  -- Registration is global (happens before any league membership exists), so
  -- the relevant blocklist is the app-wide one, not any single league's
  -- banned_names.
  if exists (select 1 from global_banned_names where name = lower(trim(p_name))) then
    raise exception 'That name is not available';
  end if;
  insert into players (name, pin_hash)
    values (trim(p_name), crypt(p_pin, gen_salt('bf')))
    returning * into pl;
  return json_build_object('id', pl.id, 'name', pl.name, 'is_global_admin', pl.is_global_admin);
exception when unique_violation then
  raise exception 'That name is taken';
end $$;

create or replace function login(p_name text, p_pin text)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare pl players;
begin
  pl := _auth_player(p_name, p_pin);
  return json_build_object('id', pl.id, 'name', pl.name, 'is_global_admin', pl.is_global_admin);
end $$;

-- ============================================================
-- SECTION 3 — LEAGUE / MEMBERSHIP MANAGEMENT
-- ============================================================

create or replace function my_leagues(p_name text, p_pin text)
returns table(league_id bigint, league_name text, is_league_admin boolean,
              bracket_id bigint, bracket_kind text, bracket_name text)
language plpgsql security definer set search_path = public, extensions as $$
declare pl players;
begin
  pl := _auth_player(p_name, p_pin);
  return query
    select l.id, l.name, lm.is_league_admin, b.id, b.kind, b.name
    from league_members lm
    join leagues l on l.id = lm.league_id
    join brackets b on b.league_id = l.id
    where lm.player_id = pl.id
    order by l.name, b.kind;
end $$;

create or replace function admin_add_league_member(p_name text, p_pin text, p_league_id bigint, p_player_id uuid)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare pl players; tgt players;
begin
  pl := _auth_player(p_name, p_pin);
  if not _is_league_admin_or_global(pl.id, p_league_id) then raise exception 'League admins only'; end if;
  select * into tgt from players where id = p_player_id;
  if tgt.id is null then raise exception 'Player not found'; end if;
  if exists (select 1 from banned_names where league_id = p_league_id and name = lower(tgt.name)) then
    raise exception 'This name is banned from this league';
  end if;
  insert into league_members (league_id, player_id)
    values (p_league_id, p_player_id)
    on conflict (league_id, player_id) do nothing;
  return json_build_object('ok', true);
end $$;

create or replace function admin_league_boot(p_name text, p_pin text, p_league_id bigint, p_player_id uuid, p_ban boolean default true)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare pl players; tgt players;
begin
  pl := _auth_player(p_name, p_pin);
  if not _is_league_admin_or_global(pl.id, p_league_id) then raise exception 'League admins only'; end if;
  if p_player_id = pl.id then raise exception 'You cannot boot yourself'; end if;
  select * into tgt from players where id = p_player_id;
  if tgt.id is null then raise exception 'Player not found'; end if;
  if tgt.is_global_admin and not pl.is_global_admin then
    raise exception 'Only Global can remove a Global admin';
  end if;
  -- Hard delete of membership ONLY — picks/scores in this league are left
  -- untouched (frozen-roster rule: a booted player's season line persists,
  -- they just stop accruing). league_members.banned is not used here or
  -- anywhere else in this file.
  delete from league_members where league_id = p_league_id and player_id = p_player_id;
  if p_ban then
    insert into banned_names (league_id, name) values (p_league_id, lower(tgt.name)) on conflict do nothing;
  end if;
  return json_build_object('ok', true, 'booted', tgt.name);
end $$;

drop function if exists admin_list_bans(text,text);
create or replace function admin_list_bans(p_name text, p_pin text, p_league_id bigint)
returns table(name text, banned_at timestamptz)
language plpgsql security definer set search_path = public, extensions as $$
declare pl players;
begin
  pl := _auth_player(p_name, p_pin);
  if not _is_league_admin_or_global(pl.id, p_league_id) then raise exception 'League admins only'; end if;
  return query select b.name, b.banned_at from banned_names b where b.league_id = p_league_id order by b.banned_at desc;
end $$;

drop function if exists admin_unban(text,text,text);
create or replace function admin_unban(p_name text, p_pin text, p_league_id bigint, p_banned text)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare pl players;
begin
  pl := _auth_player(p_name, p_pin);
  if not _is_league_admin_or_global(pl.id, p_league_id) then raise exception 'League admins only'; end if;
  delete from banned_names where league_id = p_league_id and name = lower(p_banned);
  return json_build_object('ok', true);
end $$;

-- The old admin_boot_player(text,text,uuid,boolean) did a hard account
-- delete gated only by the single old is_admin flag. That's now
-- global_boot_player (Global-exclusive, below); league-scoped removal is
-- admin_league_boot above. Retire the old one outright.
drop function if exists admin_boot_player(text,text,uuid,boolean);

create or replace function global_boot_player(p_name text, p_pin text, p_player_id uuid, p_ban_name boolean default false)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare pl players; tgt players;
begin
  pl := _auth_player(p_name, p_pin);
  if not pl.is_global_admin then raise exception 'Global admins only'; end if;
  select * into tgt from players where id = p_player_id;
  if tgt.id is null then raise exception 'Player not found'; end if;
  if tgt.id = pl.id then raise exception 'You cannot boot yourself'; end if;
  if tgt.is_global_admin then raise exception 'Cannot boot another global admin'; end if;
  if p_ban_name then
    insert into global_banned_names (name) values (lower(tgt.name)) on conflict do nothing;
  end if;
  delete from players where id = tgt.id; -- cascades league_members/picks/scores/season_rosters everywhere
  return json_build_object('ok', true, 'booted', tgt.name);
end $$;

create or replace function global_create_league(p_name text, p_pin text, p_league_name text)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare
  pl players; new_league_id bigint;
  -- Instance constant: default slot config seeded for new brackets (mirrors
  -- stage_a_schema.sql's def_cfg — keep the two in sync).
  def_cfg jsonb := '{
    "slots": [
      {"key":"opener","type":"opener","label":"Opener","points":2},
      {"key":"closer","type":"closer","label":"Set 2 Closer","points":2},
      {"key":"encore","type":"encore","label":"Encore","points":2}
    ],
    "flat_picks": 3, "flat_points": 1,
    "partial_credit": true, "partial_points": 1,
    "allow_duplicates": false,
    "wildcards": {"debut": true},
    "bonuses": {"cover":0,"debut":0,"perfect":0,"jamchart":0},
    "voting_override": "auto"
  }';
begin
  pl := _auth_player(p_name, p_pin);
  if not pl.is_global_admin then raise exception 'Global admins only'; end if;
  if coalesce(trim(p_league_name), '') = '' then raise exception 'League needs a name'; end if;
  insert into leagues (name) values (trim(p_league_name)) returning id into new_league_id;
  insert into brackets (league_id, name, kind, config) values (new_league_id, 'Official', 'official', def_cfg);
  insert into brackets (league_id, name, kind, config) values (new_league_id, 'Casual', 'casual', def_cfg);
  return json_build_object('ok', true, 'league_id', new_league_id);
end $$;

create or replace function global_appoint_league_admin(p_name text, p_pin text, p_league_id bigint, p_player_id uuid)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare pl players; tgt players;
begin
  pl := _auth_player(p_name, p_pin);
  if not pl.is_global_admin then raise exception 'Global admins only'; end if;
  select * into tgt from players where id = p_player_id;
  if tgt.id is null then raise exception 'Player not found'; end if;
  insert into league_members (league_id, player_id, is_league_admin)
    values (p_league_id, p_player_id, true)
    on conflict (league_id, player_id) do update set is_league_admin = true;
  return json_build_object('ok', true);
end $$;

-- ============================================================
-- SECTION 4 — CONFIG
-- ============================================================

drop function if exists admin_update_config(text,text,jsonb);
create or replace function admin_update_config(p_name text, p_pin text, p_bracket_id bigint, p_data jsonb)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare pl players; v_league_id bigint;
begin
  pl := _auth_player(p_name, p_pin);
  select league_id into v_league_id from brackets where id = p_bracket_id;
  if v_league_id is null then raise exception 'Bracket not found'; end if;
  if not _is_league_admin_or_global(pl.id, v_league_id) then raise exception 'League admins only'; end if;
  update brackets set config = p_data where id = p_bracket_id;
  return json_build_object('ok', true);
end $$;

-- ============================================================
-- SECTION 5 — SEASONS + ROSTER
-- ============================================================

drop function if exists admin_save_season(text,text,bigint,text,date,date);
create or replace function admin_save_season(p_name text, p_pin text, p_bracket_id bigint, p_id bigint, p_sname text, p_start date, p_end date)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare pl players; v_league_id bigint; v_kind text;
begin
  pl := _auth_player(p_name, p_pin);
  select league_id, kind into v_league_id, v_kind from brackets where id = p_bracket_id;
  if v_league_id is null then raise exception 'Bracket not found'; end if;
  if not _is_league_admin_or_global(pl.id, v_league_id) then raise exception 'League admins only'; end if;
  if v_kind <> 'official' then raise exception 'Only Official brackets have seasons'; end if;
  if coalesce(trim(p_sname),'') = '' then raise exception 'Season needs a name'; end if;
  if p_end < p_start then raise exception 'End date is before start date'; end if;
  if p_id is null then
    insert into seasons (bracket_id, name, start_date, end_date) values (p_bracket_id, trim(p_sname), p_start, p_end);
  else
    if not exists (select 1 from seasons where id = p_id and bracket_id = p_bracket_id) then
      raise exception 'Season not found for this bracket';
    end if;
    update seasons set name = trim(p_sname), start_date = p_start, end_date = p_end where id = p_id;
  end if;
  return json_build_object('ok', true);
end $$;

-- Signature unchanged — league derived from the season's own bracket, not a
-- separately-passed (and possibly inconsistent) league id.
create or replace function admin_delete_season(p_name text, p_pin text, p_id bigint)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare pl players; v_league_id bigint;
begin
  pl := _auth_player(p_name, p_pin);
  select b.league_id into v_league_id from seasons s join brackets b on b.id = s.bracket_id where s.id = p_id;
  if v_league_id is null then raise exception 'Season not found'; end if;
  if not _is_league_admin_or_global(pl.id, v_league_id) then raise exception 'League admins only'; end if;
  delete from seasons where id = p_id;
  return json_build_object('ok', true);
end $$;

create or replace function set_official_opt_in(p_name text, p_pin text, p_league_id bigint, p_opt_in boolean)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare pl players; v_bracket_id bigint;
begin
  pl := _auth_player(p_name, p_pin);
  if not exists (select 1 from league_members where league_id = p_league_id and player_id = pl.id) then
    raise exception 'Not a member of this league';
  end if;
  select id into v_bracket_id from brackets where league_id = p_league_id and kind = 'official';
  if v_bracket_id is not null and exists (
    select 1 from seasons where bracket_id = v_bracket_id and current_date between start_date and end_date
  ) then
    raise exception 'Opt-in is locked while a season is running — ask a league admin to override it';
  end if;
  update league_members set official_opt_in = p_opt_in where league_id = p_league_id and player_id = pl.id;
  return json_build_object('ok', true);
end $$;

-- Admin override: bypasses the lock above. Plain add/remove, no audit
-- column — matches "no tracking of when someone was added" (season line is
-- inherently handicapped by shows missed; players sort it out among
-- themselves).
create or replace function admin_set_season_roster(p_name text, p_pin text, p_season_id bigint, p_player_id uuid, p_add boolean)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare pl players; v_league_id bigint;
begin
  pl := _auth_player(p_name, p_pin);
  select b.league_id into v_league_id from seasons s join brackets b on b.id = s.bracket_id where s.id = p_season_id;
  if v_league_id is null then raise exception 'Season not found'; end if;
  if not _is_league_admin_or_global(pl.id, v_league_id) then raise exception 'League admins only'; end if;
  if p_add then
    insert into season_rosters (season_id, player_id) values (p_season_id, p_player_id) on conflict do nothing;
  else
    delete from season_rosters where season_id = p_season_id and player_id = p_player_id;
  end if;
  return json_build_object('ok', true);
end $$;

-- ============================================================
-- SECTION 6 — CUTOFFS / FORMAT
-- ============================================================
-- admin_set_show_status is DROPPED, not replaced: the live<->final
-- transition now goes through the edge function's authenticated
-- `finalize`/`reopen` actions, which score/clean up correctly. A raw status
-- setter would compete with both — it could push a show to final without
-- scoring, or back to live without reopen's score-wipe.

drop function if exists admin_set_show_status(text,text,bigint,text);

drop function if exists admin_set_cutoff(text,text,bigint,timestamptz);
create or replace function admin_set_cutoff(p_name text, p_pin text, p_league_id bigint, p_show_id bigint, p_cutoff timestamptz)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare pl players;
begin
  pl := _auth_player(p_name, p_pin);
  if not _is_league_admin_or_global(pl.id, p_league_id) then raise exception 'League admins only'; end if;
  update league_shows set cutoff_at = p_cutoff where league_id = p_league_id and show_id = p_show_id;
  if not found then raise exception 'Show not found for this league'; end if;
  return json_build_object('ok', true);
end $$;

drop function if exists admin_set_show_format(text,text,bigint,text);
create or replace function admin_set_show_format(p_name text, p_pin text, p_league_id bigint, p_show_id bigint, p_format text)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare pl players;
begin
  pl := _auth_player(p_name, p_pin);
  if not _is_league_admin_or_global(pl.id, p_league_id) then raise exception 'League admins only'; end if;
  if p_format not in ('standard','one_set') then raise exception 'Invalid format'; end if;
  update league_shows set format = p_format where league_id = p_league_id and show_id = p_show_id;
  if not found then raise exception 'Show not found for this league'; end if;
  return json_build_object('ok', true);
end $$;

-- ============================================================
-- SECTION 7 — PICKS
-- ============================================================

drop function if exists submit_picks(text,text,bigint,jsonb);
create or replace function submit_picks(p_name text, p_pin text, p_bracket_id bigint, p_show_id bigint, p_picks jsonb)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare
  pl players; brk brackets; ls league_shows; sh shows; season_row seasons;
  cfg jsonb; sect jsonb; item jsonb;
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

  -- Official gating: two distinct, player-facing cases. Checked against the
  -- SHOW's date, not today's — a future show inside a future season's range
  -- is legitimately votable now.
  if brk.kind = 'official' then
    select * into season_row from seasons
      where bracket_id = p_bracket_id and sh.showdate between start_date and end_date;
    if season_row.id is null then
      raise exception 'No Official season covers this show yet';
    end if;
    if season_row.roster_locked_at is not null then
      if not exists (select 1 from season_rosters where season_id = season_row.id and player_id = pl.id) then
        raise exception 'You are not on this season''s roster';
      end if;
    else
      -- Season hasn't activated yet — no snapshot exists — fall back to the
      -- live opt-in flag as the proxy.
      if not exists (select 1 from league_members
                     where league_id = brk.league_id and player_id = pl.id and official_opt_in = true) then
        raise exception 'You are not on this season''s roster';
      end if;
    end if;
  end if;

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

drop function if exists get_my_picks(text,text,bigint);
create or replace function get_my_picks(p_name text, p_pin text, p_bracket_id bigint, p_show_id bigint)
returns setof picks language plpgsql security definer set search_path = public, extensions as $$
declare pl players;
begin
  pl := _auth_player(p_name, p_pin);
  return query select * from picks where player_id = pl.id and bracket_id = p_bracket_id and show_id = p_show_id;
end $$;

drop function if exists get_show_picks(bigint);
create or replace function get_show_picks(p_bracket_id bigint, p_show_id bigint)
returns table(player_id uuid, player_name text, slot text, songname text)
language sql security definer set search_path = public, extensions as $$
  -- Names join `players` directly (not through league_members) so a booted
  -- player's historical picks still display correctly.
  select p.player_id, pl.name, p.slot, p.songname
  from picks p
  join players pl on pl.id = p.player_id
  join brackets b on b.id = p.bracket_id
  join league_shows ls on ls.league_id = b.league_id and ls.show_id = p.show_id
  where p.bracket_id = p_bracket_id and p.show_id = p_show_id
    and ls.cutoff_at is not null and now() >= ls.cutoff_at;
$$;

drop function if exists admin_pick_status(text,text,bigint);
create or replace function admin_pick_status(p_name text, p_pin text, p_bracket_id bigint, p_show_id bigint)
returns table(player_name text, picks_count int, last_saved timestamptz)
language plpgsql security definer set search_path = public, extensions as $$
declare pl players; v_league_id bigint;
begin
  pl := _auth_player(p_name, p_pin);
  select league_id into v_league_id from brackets where id = p_bracket_id;
  if v_league_id is null then raise exception 'Bracket not found'; end if;
  if not _is_league_admin_or_global(pl.id, v_league_id) then raise exception 'League admins only'; end if;
  -- Current league_members drives who's on the roster (correctly excludes
  -- anyone since booted); players supplies the name directly.
  return query
    select p.name, count(k.id)::int, max(k.updated_at)
    from league_members lm
    join players p on p.id = lm.player_id
    left join picks k on k.player_id = p.id and k.bracket_id = p_bracket_id and k.show_id = p_show_id
    where lm.league_id = v_league_id
    group by p.name
    order by count(k.id) desc, p.name;
end $$;

-- ============================================================
-- SECTION 8 — GRANTS
-- ============================================================
-- Internal-only helpers, service_role ONLY (never anon/authenticated):
-- _auth_player returns the full players row including pin_hash — broadening
-- its grant would leak password hashes to anyone calling it via the anon
-- key. Only the edge function (service-role client) needs these, to
-- authenticate its own reopen/cutoff_changed/finalize actions.
grant execute on function _auth_player(text,text) to service_role;
grant execute on function _is_league_admin_or_global(uuid,bigint) to service_role;

grant execute on function register_player(text,text) to anon, authenticated;
grant execute on function login(text,text) to anon, authenticated;
grant execute on function my_leagues(text,text) to anon, authenticated;
grant execute on function admin_add_league_member(text,text,bigint,uuid) to anon, authenticated;
grant execute on function admin_league_boot(text,text,bigint,uuid,boolean) to anon, authenticated;
grant execute on function admin_list_bans(text,text,bigint) to anon, authenticated;
grant execute on function admin_unban(text,text,bigint,text) to anon, authenticated;
grant execute on function global_boot_player(text,text,uuid,boolean) to anon, authenticated;
grant execute on function global_create_league(text,text,text) to anon, authenticated;
grant execute on function global_appoint_league_admin(text,text,bigint,uuid) to anon, authenticated;
grant execute on function admin_update_config(text,text,bigint,jsonb) to anon, authenticated;
grant execute on function admin_save_season(text,text,bigint,bigint,text,date,date) to anon, authenticated;
grant execute on function admin_delete_season(text,text,bigint) to anon, authenticated;
grant execute on function set_official_opt_in(text,text,bigint,boolean) to anon, authenticated;
grant execute on function admin_set_season_roster(text,text,bigint,uuid,boolean) to anon, authenticated;
grant execute on function admin_set_cutoff(text,text,bigint,bigint,timestamptz) to anon, authenticated;
grant execute on function admin_set_show_format(text,text,bigint,bigint,text) to anon, authenticated;
grant execute on function submit_picks(text,text,bigint,bigint,jsonb) to anon, authenticated;
grant execute on function get_my_picks(text,text,bigint,bigint) to anon, authenticated;
grant execute on function get_show_picks(bigint,bigint) to anon, authenticated;
grant execute on function admin_pick_status(text,text,bigint,bigint) to anon, authenticated;

commit;

-- ============================================================
-- SECTION 9 — VERIFICATION: function existence (proves the file applied)
-- ============================================================
-- select proname, pg_get_function_identity_arguments(oid) as args
-- from pg_proc
-- where pronamespace = 'public'::regnamespace
--   and proname in (
--     '_is_league_admin_or_global','register_player','login','my_leagues',
--     'admin_add_league_member','admin_league_boot','admin_list_bans','admin_unban',
--     'global_boot_player','global_create_league','global_appoint_league_admin',
--     'admin_update_config','admin_save_season','admin_delete_season',
--     'set_official_opt_in','admin_set_season_roster',
--     'admin_set_cutoff','admin_set_show_format',
--     'submit_picks','get_my_picks','get_show_picks','admin_pick_status'
--   )
-- order by proname;
-- Expect: 21 rows, one per name above. admin_boot_player / admin_set_show_status
-- should NOT appear (dropped, not replaced).

-- ============================================================
-- SECTION 10 — SMOKE TEST (real behavior, not just existence)
-- ============================================================
-- Fill in v_name/v_pin with your real Ambassadors admin name/PIN below, then
-- run this whole block. Everything else (league/bracket/show IDs) is
-- resolved automatically.
--
-- What this writes to production, and removes before it finishes:
--   - Test 2 inserts one real `picks` row (your player, Casual bracket, the
--     soonest upcoming Ambassadors show with an open cutoff, slot 'opener',
--     songname 'Test Song') — deleted in the cleanup step below.
--   - Test 4 temporarily bans YOUR OWN name in `banned_names` for Ambassadors
--     (self-contained: doesn't require any other player to exist) — removed
--     immediately after test 4's assertion, not deferred to the final
--     cleanup step, to keep the window it's live as small as possible.
--   - Test 5 may flip your own `official_opt_in` flag for Ambassadors true —
--     NOT reverted automatically (no active season exists yet post-Stage-A,
--     so the lock never engages and this call is expected to succeed; the
--     flag itself is low-stakes and easy to flip back if you don't want it
--     set). Nothing else in this block is left behind.
do $$
declare
  v_name text := 'NAME';   -- <-- fill in your real Ambassadors admin name
  v_pin  text := 'PIN';    -- <-- fill in your real PIN
  v_league_id    bigint;
  v_casual_id    bigint;
  v_official_id  bigint;
  v_show_id      bigint;
  v_player_id    uuid;
  v_rows         int;
begin
  select id into v_league_id from leagues where name = 'Ambassadors';
  select id into v_casual_id   from brackets where league_id = v_league_id and kind = 'casual';
  select id into v_official_id from brackets where league_id = v_league_id and kind = 'official';
  select id into v_player_id from players where lower(name) = lower(trim(v_name));
  select ls.show_id into v_show_id
    from league_shows ls
    where ls.league_id = v_league_id and ls.cutoff_at > now() and ls.status <> 'final'
    order by ls.cutoff_at asc limit 1;

  -- Abort here, before any test has written anything, if setup couldn't
  -- resolve real IDs — a clear message instead of a confusing failure deep
  -- inside a later insert.
  if v_league_id is null then raise exception 'Ambassadors league not found — aborting before any writes'; end if;
  if v_player_id is null then raise exception 'Player % not found — check the name — aborting before any writes', v_name; end if;
  if v_show_id is null then raise exception 'No upcoming Ambassadors show with an open cutoff found — aborting before any writes'; end if;

  -- 1. my_leagues returns both Ambassadors brackets
  select count(*) into v_rows from my_leagues(v_name, v_pin) where league_id = v_league_id;
  if v_rows = 2 then raise notice 'PASS: my_leagues returned both Ambassadors brackets';
  else raise notice 'FAIL: my_leagues returned % Ambassadors row(s) (expected 2)', v_rows; end if;

  -- 2. submit_picks to Casual succeeds
  begin
    perform submit_picks(v_name, v_pin, v_casual_id, v_show_id,
      '[{"slot":"opener","songname":"Test Song"}]'::jsonb);
    raise notice 'PASS: submit_picks to Casual succeeded';
  exception when others then
    raise notice 'FAIL: submit_picks to Casual raised: %', sqlerrm;
  end;

  -- 3. submit_picks to Official fails with the no-season error (expected failure)
  begin
    perform submit_picks(v_name, v_pin, v_official_id, v_show_id,
      '[{"slot":"opener","songname":"Test Song"}]'::jsonb);
    raise notice 'FAIL: submit_picks to Official succeeded (expected the no-season error)';
  exception when others then
    raise notice 'PASS (expected failure): %', sqlerrm;
  end;

  -- 4. admin_add_league_member refuses a banned name (expected failure) —
  --    bans the caller's own name temporarily, self-contained. Cleanup is
  --    inline, right after the assertion, not deferred to the end of the
  --    block — this is a real (if narrow) ban on your own name, and any
  --    failure between insert and delete would otherwise leave it in place
  --    silently until it surfaced as a baffling "can't add myself to another
  --    league" months later.
  insert into banned_names (league_id, name) values (v_league_id, lower(v_name)) on conflict do nothing;
  begin
    perform admin_add_league_member(v_name, v_pin, v_league_id, v_player_id);
    raise notice 'FAIL: admin_add_league_member succeeded for a banned name';
  exception when others then
    raise notice 'PASS (expected failure): %', sqlerrm;
  end;
  delete from banned_names where league_id = v_league_id and name = lower(v_name);

  -- 5. set_official_opt_in succeeds (no active season exists post-wipe)
  begin
    perform set_official_opt_in(v_name, v_pin, v_league_id, true);
    raise notice 'PASS: set_official_opt_in succeeded';
  exception when others then
    raise notice 'FAIL: set_official_opt_in raised: %', sqlerrm;
  end;

  -- ---- cleanup: remove everything else this block wrote ----
  -- Matches BOTH brackets, not just Casual: if test 3 unexpectedly succeeds
  -- (e.g. an Official season already covers v_show_id), submit_picks would
  -- write a real row under v_official_id instead of raising — this still
  -- removes it. (The banned_names row from test 4 is already removed above.)
  delete from picks where player_id = v_player_id and bracket_id in (v_casual_id, v_official_id)
    and show_id = v_show_id and slot = 'opener' and songname = 'Test Song';
  raise notice 'Cleanup done: removed the test pick row(s); the temporary self-ban was already removed after test 4.';
end $$;
