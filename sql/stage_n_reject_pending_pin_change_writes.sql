-- ============================================================
-- FANTASY EGGY — STAGE N: reject writes while a PIN change is pending
-- ============================================================
-- Run ONCE in the Supabase SQL Editor, AFTER stage_l_admin_pin_reset.sql
-- (needs _reject_if_must_change_pin, defined there). Session 4 follow-up:
-- must_change_pin was, until this file, enforced only client-side
-- (session.js's boot() gate) — a relayed PIN was a fully valid credential
-- to every RPC the instant it was set, including submit_picks, so nothing
-- stopped it being used to write/impersonate before the forced change ever
-- happened. This closes that server-side.
--
-- Body-only re-touch of 14 already-deployed write RPCs — same idiom this
-- codebase already uses for this exact situation (stage_d re-touching
-- stage_c1's admin_set_season_roster, stage_c2a re-touching submit_picks):
-- no signature changes, so no drops needed, and every re-touch below is
-- verified (mechanically, via diff — not by eye) to differ from its live
-- body by EXACTLY one added line: `perform _reject_if_must_change_pin(pl);`
-- immediately after `pl := _auth_player(p_name, p_pin);`, nothing else
-- touched. The two functions here that themselves have a later live body
-- than stage_c1_rpcs.sql (admin_set_season_roster -> stage_d_tiebreakers.sql,
-- submit_picks -> stage_c2a_rpcs.sql's _official_gate rewrite) are re-touched
-- from THEIR latest version, not stage_c1's superseded one.
--
-- Deliberately NOT touched — these stay ungated on purpose:
--   - Every READ rpc (get_bracket_scores, get_league_shows,
--     get_bracket_seasons, my_leagues, get_my_picks, get_show_picks,
--     admin_pick_status, admin_list_members, admin_find_players,
--     admin_list_season_roster, get_season_roster, get_my_pick_counts,
--     admin_list_bans, can_submit_picks, global_find_players) — a player in
--     the pending state can still see the app; they just can't write.
--   - login, change_own_pin — the only two ways OUT of the pending state.
--     Gating either would be a lockout, not a security fix.
--   - register_player — doesn't authenticate via _auth_player at all (new
--     account), not applicable.
-- ============================================================

begin;

create or replace function admin_add_league_member(p_name text, p_pin text, p_league_id bigint, p_player_id uuid)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare pl players; tgt players;
begin
  pl := _auth_player(p_name, p_pin);
  perform _reject_if_must_change_pin(pl);
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
  perform _reject_if_must_change_pin(pl);
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

create or replace function admin_unban(p_name text, p_pin text, p_league_id bigint, p_banned text)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare pl players;
begin
  pl := _auth_player(p_name, p_pin);
  perform _reject_if_must_change_pin(pl);
  if not _is_league_admin_or_global(pl.id, p_league_id) then raise exception 'League admins only'; end if;
  delete from banned_names where league_id = p_league_id and name = lower(p_banned);
  return json_build_object('ok', true);
end $$;

create or replace function global_boot_player(p_name text, p_pin text, p_player_id uuid, p_ban_name boolean default false)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare pl players; tgt players;
begin
  pl := _auth_player(p_name, p_pin);
  perform _reject_if_must_change_pin(pl);
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
  perform _reject_if_must_change_pin(pl);
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
  perform _reject_if_must_change_pin(pl);
  if not pl.is_global_admin then raise exception 'Global admins only'; end if;
  select * into tgt from players where id = p_player_id;
  if tgt.id is null then raise exception 'Player not found'; end if;
  insert into league_members (league_id, player_id, is_league_admin)
    values (p_league_id, p_player_id, true)
    on conflict (league_id, player_id) do update set is_league_admin = true;
  return json_build_object('ok', true);
end $$;

create or replace function admin_update_config(p_name text, p_pin text, p_bracket_id bigint, p_data jsonb)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare pl players; v_league_id bigint;
begin
  pl := _auth_player(p_name, p_pin);
  perform _reject_if_must_change_pin(pl);
  select league_id into v_league_id from brackets where id = p_bracket_id;
  if v_league_id is null then raise exception 'Bracket not found'; end if;
  if not _is_league_admin_or_global(pl.id, v_league_id) then raise exception 'League admins only'; end if;
  update brackets set config = p_data where id = p_bracket_id;
  return json_build_object('ok', true);
end $$;

create or replace function admin_save_season(p_name text, p_pin text, p_bracket_id bigint, p_id bigint, p_sname text, p_start date, p_end date)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare pl players; v_league_id bigint; v_kind text;
begin
  pl := _auth_player(p_name, p_pin);
  perform _reject_if_must_change_pin(pl);
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

create or replace function admin_delete_season(p_name text, p_pin text, p_id bigint)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare pl players; v_league_id bigint;
begin
  pl := _auth_player(p_name, p_pin);
  perform _reject_if_must_change_pin(pl);
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
  perform _reject_if_must_change_pin(pl);
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

create or replace function admin_set_season_roster(p_name text, p_pin text, p_season_id bigint, p_player_id uuid, p_add boolean)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare pl players; v_league_id bigint;
begin
  pl := _auth_player(p_name, p_pin);
  perform _reject_if_must_change_pin(pl);
  select b.league_id into v_league_id from seasons s join brackets b on b.id = s.bracket_id where s.id = p_season_id;
  if v_league_id is null then raise exception 'Season not found'; end if;
  if not _is_league_admin_or_global(pl.id, v_league_id) then raise exception 'League admins only'; end if;
  if p_add then
    insert into season_rosters (season_id, player_id, added_at) values (p_season_id, p_player_id, now())
      on conflict do nothing;
  else
    delete from season_rosters where season_id = p_season_id and player_id = p_player_id;
  end if;
  return json_build_object('ok', true);
end $$;

create or replace function admin_set_cutoff(p_name text, p_pin text, p_league_id bigint, p_show_id bigint, p_cutoff timestamptz)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare pl players;
begin
  pl := _auth_player(p_name, p_pin);
  perform _reject_if_must_change_pin(pl);
  if not _is_league_admin_or_global(pl.id, p_league_id) then raise exception 'League admins only'; end if;
  update league_shows set cutoff_at = p_cutoff where league_id = p_league_id and show_id = p_show_id;
  if not found then raise exception 'Show not found for this league'; end if;
  return json_build_object('ok', true);
end $$;

create or replace function admin_set_show_format(p_name text, p_pin text, p_league_id bigint, p_show_id bigint, p_format text)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare pl players;
begin
  pl := _auth_player(p_name, p_pin);
  perform _reject_if_must_change_pin(pl);
  if not _is_league_admin_or_global(pl.id, p_league_id) then raise exception 'League admins only'; end if;
  if p_format not in ('standard','one_set') then raise exception 'Invalid format'; end if;
  update league_shows set format = p_format where league_id = p_league_id and show_id = p_show_id;
  if not found then raise exception 'Show not found for this league'; end if;
  return json_build_object('ok', true);
end $$;

create or replace function submit_picks(p_name text, p_pin text, p_bracket_id bigint, p_show_id bigint, p_picks jsonb)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare
  pl players; brk brackets; ls league_shows; sh shows;
  cfg jsonb; sect jsonb; item jsonb; gate record;
  valid_slots text[]; songs text[]; n_flat int;
begin
  pl := _auth_player(p_name, p_pin);
  perform _reject_if_must_change_pin(pl);

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

commit;

-- Verification:
-- 1) select proname from pg_proc where proname = '_reject_if_must_change_pin'; -- expect 1 row (defined in stage_l)
-- 2) As a test account, run admin_reset_player_pin against yourself (or any
--    account you control), note the returned new_pin, then attempt
--    submit_picks with that account's new_pin -- expect the error 'PIN change
--    required before this action'. Then call change_own_pin, and retry
--    submit_picks with the chosen PIN -- expect success.
-- 3) Confirm reads still work in the pending state: call my_leagues or
--    get_bracket_scores with the same pending account's credentials before
--    calling change_own_pin -- expect normal data back, not an error.
