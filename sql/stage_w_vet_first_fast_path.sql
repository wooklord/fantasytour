-- ============================================================
-- FANTASY EGGY — STAGE W: vet-first fast path
-- ============================================================
-- Record: docs/decisions/onboarding.md, decision 7, "vet-first fast path"
-- (plan APPROVED 2026-10-27). Three steps in the Supabase SQL Editor, in
-- this order; the footer holds steps 0 and 2:
--   STEP 0  read-only, BEFORE this file: are the two live function bodies
--           the ones in stage_n / stage_q? create or replace discards
--           anything that exists only live.
--   STEP 1  this file. Pasting the WHOLE file runs only begin…commit; the
--           footer is one block comment.
--   STEP 2  after: (a) did it deploy, (b) the self-contained smoke test,
--           which always raises and so always rolls itself back.
--
-- WHAT
--   1. admin_list_unaffiliated_players returns created_at and lists NEWEST
--      FIRST (then name). The cap stays 50 but now drops the OLDEST rows
--      instead of the alphabetically last, which is what makes the Admin-tab
--      badge ("registered in the last NEW_SIGNUP_DAYS days", counted client
--      side) exact below 50 and "50+" at the cap. Same predicate (in NO
--      league), same auth, same comments. The return type changes, so the
--      function is dropped and recreated and its grant re-issued. A plain
--      drop, no "if exists": a missing Stage Q fails loudly here.
--   2. admin_add_league_member, same signature, so create or replace keeps
--      its grant. Body = stage_n_reject_pending_pin_change_writes.sql:39-55
--      verbatim, plus: when THIS call created the membership, the new row
--      is opted in, and a season of the league's Official bracket has taken
--      its snapshot (roster_locked_at is not null) and has not ended
--      (end_date >= Eastern today, the day activateSeasons() uses), the
--      player goes on that season's roster in the same transaction,
--      added_at = now(). A season not yet snapshotted is left alone: its
--      snapshot picks the player up by itself. Set-valued: overlapping
--      seasons each get a row.
--      Returns rostered_seasons, [{id, name}] oldest start first: the active
--      seasons that have the player on their roster AFTER the call, read
--      from the roster rather than from what this call inserted. A player
--      booted and re-added keeps the old roster row (boot leaves it: the
--      boot-removed-at bug, observed and not changed), so the insert
--      conflicts, the old added_at stays, and the toast is still right.
--
-- NOT CHANGED: global_appoint_league_admin (decision 4: no roster add),
-- admin_set_season_roster, activateSeasons(), the opt-in lock.
--
-- DEPLOY ORDER: this file, verified, THEN push the client. The new return
-- fields are additive, so the live client ignores them; the new client
-- against the OLD functions shows no badge and no roster line.
-- ============================================================

begin;

drop function admin_list_unaffiliated_players(text,text,bigint);
create function admin_list_unaffiliated_players(p_name text, p_pin text, p_league_id bigint)
returns table(player_id uuid, name text, created_at timestamptz)
language plpgsql security definer set search_path = public, extensions as $$
declare pl players;
begin
  pl := _auth_player(p_name, p_pin);
  -- No _reject_if_must_change_pin: this is a READ, and stage_n deliberately
  -- leaves reads ungated. p_league_id is used only to prove the caller
  -- administers SOMETHING — the result set itself is league-independent.
  if not _is_league_admin_or_global(pl.id, p_league_id) then raise exception 'League admins only'; end if;
  -- Stage W: newest first, so the cap of 50 drops the oldest rows.
  return query
    select p.id, p.name, p.created_at
    from players p
    where not exists (select 1 from league_members lm where lm.player_id = p.id)
    order by p.created_at desc, p.name
    limit 50;
end $$;
grant execute on function admin_list_unaffiliated_players(text,text,bigint) to anon, authenticated;

create or replace function admin_add_league_member(p_name text, p_pin text, p_league_id bigint, p_player_id uuid)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare pl players; tgt players; v_opt_in boolean; v_created boolean; v_today date; v_seasons json;
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
    on conflict (league_id, player_id) do nothing
    returning official_opt_in into v_opt_in;
  -- Stage W. FOUND is true only when the insert above created the row (a
  -- conflict returns nothing), so it is read at once, before anything else.
  v_created := found;
  v_today := (now() at time zone 'America/New_York')::date;
  if v_created and v_opt_in then
    insert into season_rosters (season_id, player_id, added_at)
      select s.id, p_player_id, now()
      from seasons s join brackets b on b.id = s.bracket_id
      where b.league_id = p_league_id and b.kind = 'official'
        and s.roster_locked_at is not null and s.end_date >= v_today
      on conflict (season_id, player_id) do nothing;
  end if;
  select coalesce(json_agg(json_build_object('id', s.id, 'name', s.name) order by s.start_date, s.id), '[]'::json)
    into v_seasons
    from seasons s
    join brackets b on b.id = s.bracket_id
    join season_rosters sr on sr.season_id = s.id and sr.player_id = p_player_id
    where b.league_id = p_league_id and b.kind = 'official'
      and s.roster_locked_at is not null and s.end_date >= v_today;
  return json_build_object('ok', true, 'rostered_seasons', v_seasons);
end $$;

commit;

/* ============================================================
   FOOTER: steps 0 and 2. Everything below is inside this block comment,
   so running the whole file never runs it. Copy one step at a time: the
   text between its BEGIN and END marker lines (the reply that shipped this
   file has a PowerShell line for each).

-- STEP 0 BEGIN
-- Read-only. Run BEFORE Stage W. Compares the two LIVE function bodies with
-- the files they were created from, whitespace-collapsed (the SQL editor
-- can change line endings on paste, and that alone must not read as a
-- mismatch). Expect exactly two rows:
--   admin_add_league_member         | p_name text, p_pin text, p_league_id bigint, p_player_id uuid
--     | json | true | {"search_path=public, extensions"}
--     | body_md5_ws = 413550a8f1eb9f05d44133c54283354c   (stage_n:39-55)
--   admin_list_unaffiliated_players | p_name text, p_pin text, p_league_id bigint
--     | TABLE(player_id uuid, name text) | true | {"search_path=public, extensions"}
--     | body_md5_ws = fd6f6ddc90047ab89c523bbde7558303   (stage_q)
-- MISMATCH means the live body is not the file's. Do NOT apply Stage W until
-- you have looked at the difference:
--   select pg_get_functiondef('admin_add_league_member(text,text,bigint,uuid)'::regprocedure);
--   select pg_get_functiondef('admin_list_unaffiliated_players(text,text,bigint)'::regprocedure);
-- and compared it with stage_n:39-55 / stage_q. More than one row for a name
-- means an overload exists (Stage W replaces only the signatures above);
-- no row for the list function means Stage Q was never applied, and Stage
-- W's drop will fail.
select p.proname,
       pg_get_function_identity_arguments(p.oid) as args,
       pg_get_function_result(p.oid) as returns,
       p.prosecdef as security_definer,
       p.proconfig as config,
       md5(regexp_replace(p.prosrc, '\s+', ' ', 'g')) as body_md5_ws
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('admin_add_league_member', 'admin_list_unaffiliated_players')
order by p.proname;
-- STEP 0 END

-- STEP 2A BEGIN
-- Read-only. Run AFTER Stage W: did it deploy? The STEP 0 query again.
-- Expect two rows, now with:
--   admin_add_league_member         | ... | json | true | ... | body_md5_ws = dc1d60e16ebf22241aa77436bb975f3b
--   admin_list_unaffiliated_players | ... | TABLE(player_id uuid, name text, created_at timestamp with time zone)
--     | true | ... | body_md5_ws = 8b91635ad7bda442e5ac580c457dbfb6
-- The old md5 on either row means that function did not change.
select p.proname,
       pg_get_function_identity_arguments(p.oid) as args,
       pg_get_function_result(p.oid) as returns,
       p.prosecdef as security_definer,
       p.proconfig as config,
       md5(regexp_replace(p.prosrc, '\s+', ' ', 'g')) as body_md5_ws
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('admin_add_league_member', 'admin_list_unaffiliated_players')
order by p.proname;
-- STEP 2A END

-- STEP 2B BEGIN
-- The smoke test. Self-contained: it creates its own throwaway admin,
-- players, three leagues, their brackets and seasons, calls the real
-- functions, and ENDS IN raise exception carrying PASS/FAIL. An exception
-- aborts the block, so everything it wrote is rolled back, every time. No
-- real PIN is typed and no real row is touched. The one trace it leaves:
-- identity sequences are not transactional, so the next real league,
-- bracket and season ids skip a few numbers (harmless).
-- Read the result in the ERROR panel: "STAGE W SMOKE: 0 of 14 FAILED | PASS
-- …". Any other error text means setup failed before the checks ran; that
-- is rolled back too.
do $smoke$
declare
  v_tag text := 'zzw' || txid_current()::text;
  v_pin text := '4242';
  v_today date := (now() at time zone 'America/New_York')::date;
  la bigint; lb bigint; lc bigint; la_off bigint; la_cas bigint; lb_off bigint; lc_off bigint;
  s_active bigint; s_today bigint; s_ended bigint; s_pending bigint; s_casual bigint; s_other bigint; s_c_ended bigint;
  adm uuid; nonadm uuid; t1 uuid; t2 uuid; t3 uuid; t4 uuid; u_new uuid;
  j json; err text;
  lbl text[] := '{}'; ok boolean[] := '{}'; res text := ''; fails int := 0;
begin
  -- ---------- setup ----------
  insert into players (name, pin_hash, created_at) values (v_tag || 'adm', extensions.crypt(v_pin, extensions.gen_salt('bf')), now() - interval '400 days') returning id into adm;
  insert into players (name, pin_hash) values (v_tag || 'nonadm', extensions.crypt(v_pin, extensions.gen_salt('bf'))) returning id into nonadm;
  insert into players (name, pin_hash) values (v_tag || 't1', extensions.crypt(v_pin, extensions.gen_salt('bf'))) returning id into t1;
  insert into players (name, pin_hash) values (v_tag || 't2', extensions.crypt(v_pin, extensions.gen_salt('bf'))) returning id into t2;
  insert into players (name, pin_hash) values (v_tag || 't3', extensions.crypt(v_pin, extensions.gen_salt('bf'))) returning id into t3;
  insert into players (name, pin_hash) values (v_tag || 't4', extensions.crypt(v_pin, extensions.gen_salt('bf'))) returning id into t4;
  insert into players (name, pin_hash, created_at) values (v_tag || 'unew', extensions.crypt(v_pin, extensions.gen_salt('bf')), now() - interval '1 day') returning id into u_new;
  insert into leagues (name) values (v_tag || ' A') returning id into la;
  insert into leagues (name) values (v_tag || ' B') returning id into lb;
  insert into leagues (name) values (v_tag || ' C') returning id into lc;
  insert into brackets (league_id, name, kind, config) values (la, 'Official', 'official', '{}') returning id into la_off;
  insert into brackets (league_id, name, kind, config) values (la, 'Casual', 'casual', '{}') returning id into la_cas;
  insert into brackets (league_id, name, kind, config) values (lb, 'Official', 'official', '{}') returning id into lb_off;
  insert into brackets (league_id, name, kind, config) values (lc, 'Official', 'official', '{}') returning id into lc_off;
  insert into league_members (league_id, player_id, is_league_admin)
    values (la, adm, true), (lb, adm, true), (lc, adm, true), (la, nonadm, false);
  -- League A, Official: two ACTIVE seasons (one ends today), one ended
  -- yesterday, one started but not yet snapshotted. Casual: a locked season
  -- that must be ignored. League B: an active season of its own. League C:
  -- no active season at all.
  insert into seasons (bracket_id, name, start_date, end_date, roster_locked_at) values (la_off, 'W active', v_today - 10, v_today + 10, now() - interval '10 days') returning id into s_active;
  insert into seasons (bracket_id, name, start_date, end_date, roster_locked_at) values (la_off, 'W ends today', v_today - 5, v_today, now() - interval '5 days') returning id into s_today;
  insert into seasons (bracket_id, name, start_date, end_date, roster_locked_at) values (la_off, 'W ended', v_today - 60, v_today - 1, now() - interval '60 days') returning id into s_ended;
  insert into seasons (bracket_id, name, start_date, end_date, roster_locked_at) values (la_off, 'W pending', v_today - 1, v_today + 30, null) returning id into s_pending;
  insert into seasons (bracket_id, name, start_date, end_date, roster_locked_at) values (la_cas, 'W casual', v_today - 10, v_today + 10, now() - interval '10 days') returning id into s_casual;
  insert into seasons (bracket_id, name, start_date, end_date, roster_locked_at) values (lb_off, 'W other league', v_today - 10, v_today + 10, now() - interval '10 days') returning id into s_other;
  insert into seasons (bracket_id, name, start_date, end_date, roster_locked_at) values (lc_off, 'W C ended', v_today - 60, v_today - 1, now() - interval '60 days') returning id into s_c_ended;

  -- ---------- admin_add_league_member ----------
  j := admin_add_league_member(v_tag || 'adm', v_pin, la, t1);
  lbl := lbl || 'W1 mid-season add: roster rows in exactly the two active seasons of league A Official (not ended, pending, casual or another league), added_at = now()'::text;
  ok := ok || coalesce((select array_agg(season_id order by season_id) from season_rosters where player_id = t1) = (select array_agg(x order by x) from unnest(array[s_active, s_today]) x)
                   and (select bool_and(added_at = now()) from season_rosters where player_id = t1), false);
  lbl := lbl || 'W2 the return names the same two seasons, oldest start first'::text;
  ok := ok || coalesce((select array_agg((e->>'id')::bigint order by o) from json_array_elements(j->'rostered_seasons') with ordinality x(e, o)) = array[s_active, s_today], false);
  lbl := lbl || 'W3 the membership itself was created, opted in'::text;
  ok := ok || exists (select 1 from league_members where league_id = la and player_id = t1 and official_opt_in);

  j := admin_add_league_member(v_tag || 'adm', v_pin, la, t1);
  lbl := lbl || 'W4 re-adding an existing member: no new rows, same two seasons reported'::text;
  ok := ok || coalesce((select count(*) from season_rosters where player_id = t1) = 2
                   and json_array_length(j->'rostered_seasons') = 2, false);

  update season_rosters set added_at = now() - interval '5 days' where player_id = t1 and season_id = s_active;
  perform admin_league_boot(v_tag || 'adm', v_pin, la, t1, false);
  j := admin_add_league_member(v_tag || 'adm', v_pin, la, t1);
  lbl := lbl || 'W5 booted then re-added (observed, not changed): the old roster row and its added_at survive, and the return still names both seasons'::text;
  ok := ok || coalesce((select added_at from season_rosters where player_id = t1 and season_id = s_active) = now() - interval '5 days'
                   and exists (select 1 from league_members where league_id = la and player_id = t1)
                   and (select array_agg((e->>'id')::bigint order by o) from json_array_elements(j->'rostered_seasons') with ordinality x(e, o)) = array[s_active, s_today], false);

  j := admin_add_league_member(v_tag || 'adm', v_pin, lc, t2);
  lbl := lbl || 'W6 no active season (league C: only an ended one): no roster row, empty rostered_seasons'::text;
  ok := ok || coalesce(not exists (select 1 from season_rosters where player_id = t2) and json_array_length(j->'rostered_seasons') = 0
                   and exists (select 1 from league_members where league_id = lc and player_id = t2), false);

  j := admin_add_league_member(v_tag || 'adm', v_pin, lb, t3);
  lbl := lbl || 'W7 league B: only league B''s own active season'::text;
  ok := ok || coalesce((select array_agg(season_id) from season_rosters where player_id = t3) = array[s_other]
                   and (select array_agg((e->>'id')::bigint) from json_array_elements(j->'rostered_seasons') e) = array[s_other], false);

  begin perform admin_add_league_member(v_tag || 'nonadm', v_pin, la, t4); err := 'no error';
  exception when others then err := sqlerrm; end;
  lbl := lbl || ('W8 a non-admin is refused (got: ' || err || '), nothing written')::text;
  ok := ok || (err = 'League admins only' and not exists (select 1 from league_members where player_id = t4) and not exists (select 1 from season_rosters where player_id = t4));

  begin perform admin_add_league_member(v_tag || 'adm', '0000', la, t4); err := 'no error';
  exception when others then err := sqlerrm; end;
  lbl := lbl || ('W9 a wrong PIN is refused (got: ' || err || ')')::text;
  ok := ok || (err = 'Wrong name or PIN');

  insert into banned_names (league_id, name) values (la, lower(v_tag || 't4'));
  begin perform admin_add_league_member(v_tag || 'adm', v_pin, la, t4); err := 'no error';
  exception when others then err := sqlerrm; end;
  lbl := lbl || ('W10 a league-banned name is refused (got: ' || err || '), nothing written')::text;
  ok := ok || (err = 'This name is banned from this league' and not exists (select 1 from league_members where player_id = t4) and not exists (select 1 from season_rosters where player_id = t4));

  -- ---------- admin_list_unaffiliated_players ----------
  lbl := lbl || 'L1 newest first: created_at never increases down the list'::text;
  ok := ok || coalesce((select bool_and(prev is null or prev >= c) from (
                  select r.created_at as c, lag(r.created_at) over (order by o) as prev
                  from admin_list_unaffiliated_players(v_tag || 'adm', v_pin, la) with ordinality r(player_id, name, created_at, o)) q), false);
  lbl := lbl || 'L2 a player registered a day ago is listed with that exact created_at'::text;
  ok := ok || exists (select 1 from admin_list_unaffiliated_players(v_tag || 'adm', v_pin, la) r
                      where r.player_id = u_new and r.created_at = now() - interval '1 day');
  lbl := lbl || 'L3 capped at 50, and members (the throwaway t1) are not listed'::text;
  ok := ok || coalesce((select count(*) from admin_list_unaffiliated_players(v_tag || 'adm', v_pin, la)) <= 50
                   and not exists (select 1 from admin_list_unaffiliated_players(v_tag || 'adm', v_pin, la) r where r.player_id = t1), false);
  begin perform admin_list_unaffiliated_players(v_tag || 'nonadm', v_pin, la); err := 'no error';
  exception when others then err := sqlerrm; end;
  lbl := lbl || ('L4 a non-admin is refused the list (got: ' || err || ')')::text;
  ok := ok || (err = 'League admins only');

  -- ---------- report, and roll everything back ----------
  for i in 1 .. array_length(lbl, 1) loop
    res := res || case when coalesce(ok[i], false) then ' | PASS ' else ' | FAIL ' end || lbl[i];
    if not coalesce(ok[i], false) then fails := fails + 1; end if;
  end loop;
  raise exception 'STAGE W SMOKE: % of % FAILED%  [rolled back: this block always raises]', fails, array_length(lbl, 1), res;
end $smoke$;
-- STEP 2B END

============================================================ */
