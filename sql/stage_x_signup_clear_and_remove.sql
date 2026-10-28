-- ============================================================
-- FANTASY EGGY — STAGE X: "Clear all" and "Remove" on the sign-up list
-- ============================================================
-- Record: docs/decisions/onboarding.md, decision 8 (LOCKED 2026-10-27, plan
-- APPROVED the same day, D1–D11). Three steps in the Supabase SQL Editor, in
-- this order; the footer holds steps 0 and 2:
--   STEP 0  read-only, BEFORE this file: is the live list function Stage
--           W's, are the foreign keys to players the five in sql/, and do
--           Stage X's objects not exist yet?
--   STEP 1  this file. Pasting the WHOLE file runs only begin…commit; the
--           footer is one block comment.
--   STEP 2  after: (a) did it deploy, (b) the self-contained smoke test,
--           which always raises and so always rolls itself back.
--
-- WHAT
--   1. admin_signup_clears (D1): one row per admin, cleared_at = when that
--      admin last pressed "Clear all". Deleted with the admin's account.
--   2. admin_audit_log (D4): the project's first GENERAL audit table (Stage
--      U's sync_flag_clears already logs its one action). Written only
--      by admin_remove_unplayed_account in this stage. The actor's and the
--      target's id and name, and league_id, are plain snapshot columns with
--      NO foreign key, so deleting either account (or the league) never
--      touches a log row. Readable from the SQL editor only.
--   3. _account_has_played(id): the ONE definition of "has history":
--      picks, scores, a season_rosters row, or a sync_flag_clears.cleared_by
--      row (D7: an admin action counts). The list's has_played and Remove's
--      refusal both call it, so the button and the server cannot disagree.
--      Internal: execute revoked from public, anon and authenticated.
--   4. admin_list_unaffiliated_players gains has_played and cleared_at (the
--      CALLER's last "Clear all", the same on every row). The client
--      computes "new" from created_at and cleared_at with NEW_SIGNUP_DAYS
--      and SIGNUP_SNOOZE_DAYS (D2), so the badge and the list still come
--      from one call. The return type changes, so it is dropped and
--      recreated and its grant re-issued.
--   5. admin_clear_new_signups: stores now() for the caller (D9: refuses a
--      pending PIN change).
--   6. admin_remove_unplayed_account (D5, D6, D9): deletes an account that
--      is in no league and has no history, logs it, and, for Global only,
--      can also ban the name app-wide. It locks the target's players row
--      FIRST and checks in later statements: an Add that got there first
--      is then seen and refused, and one that comes after fails its foreign
--      key (accepted, decision 8). A single "delete … where not exists"
--      could instead cascade away a membership added a moment earlier.
--
-- NOT CHANGED: global_boot_player, admin_league_boot, admin_reset_player_pin
-- (resets and boots stay unlogged), register_player, admin_add_league_member.
--
-- DEPLOY ORDER: this file, verified, THEN push the client. The new columns
-- are additive, so the live client ignores them; the new client against the
-- OLD list shows no Remove, no "has played" and no Clear all.
-- ============================================================

begin;

-- 1. admin_signup_clears --------------------------------------
create table admin_signup_clears (
  player_id  uuid primary key references players(id) on delete cascade,
  cleared_at timestamptz not null default now()
);
alter table admin_signup_clears enable row level security;
revoke all on table admin_signup_clears from anon, authenticated;

-- 2. admin_audit_log ------------------------------------------
create table admin_audit_log (
  id                bigint generated always as identity primary key,
  logged_at         timestamptz not null default now(),
  action            text not null check (action in ('remove_account')),
  actor_id          uuid not null,
  actor_name        text not null,
  league_id         bigint,
  target_id         uuid not null,
  target_name       text not null,
  target_created_at timestamptz,
  detail            jsonb not null default '{}'::jsonb
);
alter table admin_audit_log enable row level security;
revoke all on table admin_audit_log from anon, authenticated;

-- 3. _account_has_played --------------------------------------
create function _account_has_played(p_player_id uuid)
returns boolean language sql stable security definer set search_path = public, extensions as $$
  select exists (select 1 from picks where player_id = p_player_id)
      or exists (select 1 from scores where player_id = p_player_id)
      or exists (select 1 from season_rosters where player_id = p_player_id)
      or exists (select 1 from sync_flag_clears where cleared_by = p_player_id);
$$;
revoke execute on function _account_has_played(uuid) from public, anon, authenticated;
grant execute on function _account_has_played(uuid) to service_role;

-- 4. admin_list_unaffiliated_players --------------------------
drop function admin_list_unaffiliated_players(text,text,bigint);
create function admin_list_unaffiliated_players(p_name text, p_pin text, p_league_id bigint)
returns table(player_id uuid, name text, created_at timestamptz, has_played boolean, cleared_at timestamptz)
language plpgsql security definer set search_path = public, extensions as $$
declare pl players; v_cleared timestamptz;
begin
  pl := _auth_player(p_name, p_pin);
  -- No _reject_if_must_change_pin: this is a READ, and stage_n deliberately
  -- leaves reads ungated. p_league_id is used only to prove the caller
  -- administers SOMETHING — the result set itself is league-independent.
  if not _is_league_admin_or_global(pl.id, p_league_id) then raise exception 'League admins only'; end if;
  -- Stage X: the caller's own last "Clear all" (null if never), on every row.
  select c.cleared_at into v_cleared from admin_signup_clears c where c.player_id = pl.id;
  -- Stage W: newest first, so the cap of 50 drops the oldest rows.
  return query
    select p.id, p.name, p.created_at, _account_has_played(p.id), v_cleared
    from players p
    where not exists (select 1 from league_members lm where lm.player_id = p.id)
    order by p.created_at desc, p.name
    limit 50;
end $$;
grant execute on function admin_list_unaffiliated_players(text,text,bigint) to anon, authenticated;

-- 5. admin_clear_new_signups ----------------------------------
create function admin_clear_new_signups(p_name text, p_pin text, p_league_id bigint)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare pl players; v_at timestamptz;
begin
  pl := _auth_player(p_name, p_pin);
  perform _reject_if_must_change_pin(pl);
  if not _is_league_admin_or_global(pl.id, p_league_id) then raise exception 'League admins only'; end if;
  insert into admin_signup_clears (player_id, cleared_at) values (pl.id, now())
    on conflict (player_id) do update set cleared_at = excluded.cleared_at
    returning admin_signup_clears.cleared_at into v_at;
  return json_build_object('ok', true, 'cleared_at', v_at);
end $$;
revoke execute on function admin_clear_new_signups(text,text,bigint) from public;
grant execute on function admin_clear_new_signups(text,text,bigint) to anon, authenticated;

-- 6. admin_remove_unplayed_account ----------------------------
create function admin_remove_unplayed_account(p_name text, p_pin text, p_league_id bigint, p_player_id uuid, p_ban_name boolean default false)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare pl players; tgt players; v_ban boolean := coalesce(p_ban_name, false);
begin
  pl := _auth_player(p_name, p_pin);
  perform _reject_if_must_change_pin(pl);
  if not _is_league_admin_or_global(pl.id, p_league_id) then raise exception 'League admins only'; end if;
  if v_ban and not pl.is_global_admin then raise exception 'Only Global can ban a name'; end if;
  if p_player_id = pl.id then raise exception 'You cannot remove yourself'; end if;
  -- Lock FIRST, check AFTER, each check its own statement (each sees the
  -- latest committed rows): see the header, item 6.
  select * into tgt from players where id = p_player_id for update;
  if tgt.id is null then raise exception 'Player not found'; end if;
  if tgt.is_global_admin then raise exception 'Cannot remove a Global admin'; end if;
  if exists (select 1 from league_members lm where lm.player_id = tgt.id) then
    raise exception 'This player is in a league';
  end if;
  if _account_has_played(tgt.id) then
    raise exception 'This account has history (picks, scores, a season roster or an admin action). Only Global can remove it';
  end if;
  insert into admin_audit_log (action, actor_id, actor_name, league_id, target_id, target_name, target_created_at, detail)
    values ('remove_account', pl.id, pl.name, p_league_id, tgt.id, tgt.name, tgt.created_at, jsonb_build_object('name_banned', v_ban));
  if v_ban then
    insert into global_banned_names (name) values (lower(tgt.name)) on conflict do nothing;
  end if;
  delete from players where id = tgt.id;
  return json_build_object('ok', true, 'removed', tgt.name, 'name_banned', v_ban);
end $$;
revoke execute on function admin_remove_unplayed_account(text,text,bigint,uuid,boolean) from public;
grant execute on function admin_remove_unplayed_account(text,text,bigint,uuid,boolean) to anon, authenticated;

commit;

/* ============================================================
   FOOTER: steps 0 and 2. Everything below is inside this block comment,
   so running the whole file never runs it. Copy one step at a time: the
   text between its BEGIN and END marker lines (the reply that shipped this
   file has a PowerShell line for each). STEP 0 and STEP 2A are each ONE
   query: read its rows, and every row's "ok" must be true.

-- STEP 0 BEGIN
-- Read-only. Run BEFORE Stage X. Four rows, every "ok" true:
--   X0.1 the live list function is Stage W's (one definition, its return
--        type, its whitespace-collapsed body md5). A mismatch means the live
--        body is not Stage W's: look first, with
--        select pg_get_functiondef('admin_list_unaffiliated_players(text,text,bigint)'::regprocedure);
--   X0.2 every foreign key to players is one of the five in sql/ (table.column:
--        c = on delete cascade, n = set null). An extra one is a table the
--        "has history" helper does not cover: do NOT apply until it is.
--   X0.3 every uuid column in a public table is one of the six in sql/. An
--        extra one may hold player ids without a foreign key: same rule.
--   X0.4 none of Stage X's objects exist yet (a half-applied earlier try).
with
lst as (
  select count(*) as n, max(pg_get_function_result(p.oid)) as ret,
         max(md5(regexp_replace(p.prosrc, '\s+', ' ', 'g'))) as md5
  from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
  where ns.nspname = 'public' and p.proname = 'admin_list_unaffiliated_players'
),
fk as (
  select string_agg(case when ns.nspname = 'public' then cl.relname::text else ns.nspname || '.' || cl.relname end
                    || '.' || a.attname || ':' || c.confdeltype, ', '
                    order by ns.nspname collate "C", cl.relname collate "C", a.attname collate "C") as v
  from pg_constraint c
  join pg_class cl on cl.oid = c.conrelid
  join pg_namespace ns on ns.oid = cl.relnamespace
  join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
  where c.contype = 'f' and c.confrelid = 'public.players'::regclass
),
uu as (
  select string_agg(col.table_name || '.' || col.column_name, ', '
                    order by col.table_name collate "C", col.column_name collate "C") as v
  from information_schema.columns col
  join information_schema.tables t
    on t.table_schema = col.table_schema and t.table_name = col.table_name and t.table_type = 'BASE TABLE'
  where col.table_schema = 'public' and col.data_type = 'uuid'
    and not (col.table_name = 'players' and col.column_name = 'id')
),
newobj as (
  select string_agg(x, ', ') as v from (
    select 'table ' || r as x from unnest(array['admin_signup_clears', 'admin_audit_log']) r
    where to_regclass('public.' || r) is not null
    union all
    select 'function ' || p.proname from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
    where ns.nspname = 'public' and p.proname in ('_account_has_played', 'admin_clear_new_signups', 'admin_remove_unplayed_account')
  ) q
)
select 'X0.1 live list function is Stage W''s' as check_name,
       coalesce(lst.n = 1 and lst.md5 = '8b91635ad7bda442e5ac580c457dbfb6' and lst.ret = 'TABLE(player_id uuid, name text, created_at timestamp with time zone)', false) as ok,
       lst.n || ' definition(s) | ' || coalesce(lst.ret, '-') || ' | ' || coalesce(lst.md5, '-') as actual from lst
union all
select 'X0.2 foreign keys to players are the five in sql/',
       coalesce(fk.v = 'league_members.player_id:c, picks.player_id:c, scores.player_id:c, season_rosters.player_id:c, sync_flag_clears.cleared_by:n', false),
       coalesce(fk.v, '(none)') from fk
union all
select 'X0.3 uuid columns in public tables are the six in sql/',
       coalesce(uu.v = 'league_members.player_id, picks.id, picks.player_id, scores.player_id, season_rosters.player_id, sync_flag_clears.cleared_by', false),
       coalesce(uu.v, '(none)') from uu
union all
select 'X0.4 none of Stage X''s objects exist yet', newobj.v is null, coalesce(newobj.v, '(none)') from newobj;
-- STEP 0 END

-- STEP 2A BEGIN
-- Read-only. Run AFTER Stage X: did it deploy? Nine rows, every "ok" true.
-- A false row shows what it found in "actual"; an old md5 there means that
-- function did not change.
with
f as (
  select p.proname, count(*) over (partition by p.proname) as n, pg_get_function_result(p.oid) as ret,
         md5(regexp_replace(p.prosrc, '\s+', ' ', 'g')) as md5
  from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
  where ns.nspname = 'public'
    and p.proname in ('admin_list_unaffiliated_players', 'admin_clear_new_signups', 'admin_remove_unplayed_account', '_account_has_played')
),
fk as (
  select string_agg(case when ns.nspname = 'public' then cl.relname::text else ns.nspname || '.' || cl.relname end
                    || '.' || a.attname || ':' || c.confdeltype, ', '
                    order by ns.nspname collate "C", cl.relname collate "C", a.attname collate "C") as v
  from pg_constraint c
  join pg_class cl on cl.oid = c.conrelid
  join pg_namespace ns on ns.oid = cl.relnamespace
  join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
  where c.contype = 'f' and c.confrelid = 'public.players'::regclass
),
act as (select string_agg(proname || ' ' || n || ' ' || md5, '; ' order by proname collate "C") as v from f)
select 'X2.1 list function: Stage X body, new return type' as check_name,
       exists (select 1 from f where proname = 'admin_list_unaffiliated_players' and n = 1 and md5 = 'c06131f5c6380808ed191ac86902ffea' and ret = 'TABLE(player_id uuid, name text, created_at timestamp with time zone, has_played boolean, cleared_at timestamp with time zone)') as ok,
       (select v from act) as actual
union all
select 'X2.2 admin_clear_new_signups deployed',
       exists (select 1 from f where proname = 'admin_clear_new_signups' and n = 1 and md5 = '1714180dd9b6ec257b6e790565377a38'),
       (select v from act)
union all
select 'X2.3 admin_remove_unplayed_account deployed',
       exists (select 1 from f where proname = 'admin_remove_unplayed_account' and n = 1 and md5 = '3838c5ea0b52fc2540630cf1bb9fd38f'),
       (select v from act)
union all
select 'X2.4 _account_has_played deployed',
       exists (select 1 from f where proname = '_account_has_played' and n = 1 and md5 = 'dd4868d09fe6c79abdf09a7bde8d8717'),
       (select v from act)
union all
select 'X2.5 foreign keys to players: the five, plus admin_signup_clears (cascade)',
       coalesce((select v from fk) = 'admin_signup_clears.player_id:c, league_members.player_id:c, picks.player_id:c, scores.player_id:c, season_rosters.player_id:c, sync_flag_clears.cleared_by:n', false),
       coalesce((select v from fk), '(none)')
union all
select 'X2.6 admin_audit_log has no foreign key at all',
       not exists (select 1 from pg_constraint where contype = 'f' and conrelid = 'public.admin_audit_log'::regclass),
       (select count(*)::text || ' foreign key(s)' from pg_constraint where contype = 'f' and conrelid = 'public.admin_audit_log'::regclass)
union all
select 'X2.7 both tables: RLS on, and anon/authenticated hold no privilege',
       (select bool_and(relrowsecurity) from pg_class where oid in ('public.admin_signup_clears'::regclass, 'public.admin_audit_log'::regclass))
       and not has_table_privilege('anon', 'public.admin_signup_clears', 'SELECT, INSERT, UPDATE, DELETE')
       and not has_table_privilege('authenticated', 'public.admin_signup_clears', 'SELECT, INSERT, UPDATE, DELETE')
       and not has_table_privilege('anon', 'public.admin_audit_log', 'SELECT, INSERT, UPDATE, DELETE')
       and not has_table_privilege('authenticated', 'public.admin_audit_log', 'SELECT, INSERT, UPDATE, DELETE'),
       'rls ' || (select string_agg(relname || '=' || relrowsecurity, ', ' order by relname collate "C") from pg_class where oid in ('public.admin_signup_clears'::regclass, 'public.admin_audit_log'::regclass))
union all
select 'X2.8 the helper is NOT executable by anon or authenticated',
       not has_function_privilege('anon', 'public._account_has_played(uuid)', 'EXECUTE')
       and not has_function_privilege('authenticated', 'public._account_has_played(uuid)', 'EXECUTE'),
       'anon=' || has_function_privilege('anon', 'public._account_has_played(uuid)', 'EXECUTE')
       || ' authenticated=' || has_function_privilege('authenticated', 'public._account_has_played(uuid)', 'EXECUTE')
union all
select 'X2.9 the three RPCs ARE executable by anon',
       has_function_privilege('anon', 'public.admin_list_unaffiliated_players(text,text,bigint)', 'EXECUTE')
       and has_function_privilege('anon', 'public.admin_clear_new_signups(text,text,bigint)', 'EXECUTE')
       and has_function_privilege('anon', 'public.admin_remove_unplayed_account(text,text,bigint,uuid,boolean)', 'EXECUTE'),
       'list=' || has_function_privilege('anon', 'public.admin_list_unaffiliated_players(text,text,bigint)', 'EXECUTE')
       || ' clear=' || has_function_privilege('anon', 'public.admin_clear_new_signups(text,text,bigint)', 'EXECUTE')
       || ' remove=' || has_function_privilege('anon', 'public.admin_remove_unplayed_account(text,text,bigint,uuid,boolean)', 'EXECUTE');
-- STEP 2A END

-- STEP 2B BEGIN
-- The smoke test. Self-contained: it creates its own throwaway admins, a
-- throwaway Global admin, players, two leagues, brackets and a season,
-- hangs one pick, one score, one roster row and one sync-flag clear on an
-- EXISTING show (inside the block only), calls the real functions, and
-- ENDS IN raise exception carrying PASS/FAIL. An exception aborts the
-- block, so everything it wrote is rolled back, every time. No real PIN is
-- typed and no real row is touched. The one trace it leaves: identity
-- sequences are not transactional, so the next real league, bracket,
-- season, sync-flag-clear and audit-log ids skip a few numbers (harmless).
-- Read the result in the ERROR panel: "STAGE X SMOKE: 0 of 26 FAILED | PASS
-- …". Any other error text means setup failed before the checks ran; that
-- is rolled back too.
do $smoke$
declare
  v_tag text := 'zzx' || txid_current()::text;
  v_pin text := '4242';
  v_today date := (now() at time zone 'America/New_York')::date;
  v_played text := 'This account has history (picks, scores, a season roster or an admin action). Only Global can remove it';
  la bigint; lb bigint; la_off bigint; la_cas bigint; lb_off bigint; s_a bigint; v_show bigint;
  adm uuid; adm2 uuid; glob uuid; mem uuid; mustc uuid;
  f1 uuid; f2 uuid; f3 uuid; f_mem uuid; f_picks uuid; f_scores uuid; f_roster uuid; f_sync uuid;
  f1_name text; f1_created timestamptz;
  j json; err text;
  lbl text[] := '{}'; ok boolean[] := '{}'; res text := ''; fails int := 0;
begin
  -- ---------- setup ----------
  select id into v_show from shows order by id limit 1;
  if v_show is null then raise exception 'STAGE X SMOKE SETUP: no row in shows to hang a pick on'; end if;
  insert into players (name, pin_hash, created_at) values (v_tag || 'adm', extensions.crypt(v_pin, extensions.gen_salt('bf')), now() - interval '400 days') returning id into adm;
  insert into players (name, pin_hash, created_at) values (v_tag || 'adm2', extensions.crypt(v_pin, extensions.gen_salt('bf')), now() - interval '400 days') returning id into adm2;
  insert into players (name, pin_hash, is_global_admin) values (v_tag || 'glob', extensions.crypt(v_pin, extensions.gen_salt('bf')), true) returning id into glob;
  insert into players (name, pin_hash) values (v_tag || 'mem', extensions.crypt(v_pin, extensions.gen_salt('bf'))) returning id into mem;
  insert into players (name, pin_hash, must_change_pin) values (v_tag || 'mustc', extensions.crypt(v_pin, extensions.gen_salt('bf')), true) returning id into mustc;
  insert into players (name, pin_hash) values (v_tag || 'f1', extensions.crypt(v_pin, extensions.gen_salt('bf'))) returning id into f1;
  insert into players (name, pin_hash) values (v_tag || 'f2', extensions.crypt(v_pin, extensions.gen_salt('bf'))) returning id into f2;
  insert into players (name, pin_hash) values (v_tag || 'f3', extensions.crypt(v_pin, extensions.gen_salt('bf'))) returning id into f3;
  insert into players (name, pin_hash) values (v_tag || 'fmem', extensions.crypt(v_pin, extensions.gen_salt('bf'))) returning id into f_mem;
  insert into players (name, pin_hash) values (v_tag || 'fpicks', extensions.crypt(v_pin, extensions.gen_salt('bf'))) returning id into f_picks;
  insert into players (name, pin_hash) values (v_tag || 'fscores', extensions.crypt(v_pin, extensions.gen_salt('bf'))) returning id into f_scores;
  insert into players (name, pin_hash) values (v_tag || 'froster', extensions.crypt(v_pin, extensions.gen_salt('bf'))) returning id into f_roster;
  insert into players (name, pin_hash) values (v_tag || 'fsync', extensions.crypt(v_pin, extensions.gen_salt('bf'))) returning id into f_sync;
  insert into leagues (name) values (v_tag || ' A') returning id into la;
  insert into leagues (name) values (v_tag || ' B') returning id into lb;
  insert into brackets (league_id, name, kind, config) values (la, 'Official', 'official', '{}') returning id into la_off;
  insert into brackets (league_id, name, kind, config) values (la, 'Casual', 'casual', '{}') returning id into la_cas;
  insert into brackets (league_id, name, kind, config) values (lb, 'Official', 'official', '{}') returning id into lb_off;
  insert into league_members (league_id, player_id, is_league_admin)
    values (la, adm, true), (la, adm2, true), (la, mem, false), (la, mustc, true), (lb, f_mem, false);
  insert into seasons (bracket_id, name, start_date, end_date, roster_locked_at) values (la_off, 'X season', v_today - 10, v_today + 10, now() - interval '10 days') returning id into s_a;
  -- The four kinds of history, each on its own account, none in a league
  -- (the shape a boot leaves behind).
  insert into picks (bracket_id, player_id, show_id, slot, songname) values (la_cas, f_picks, v_show, 'opener', 'zz smoke');
  insert into scores (bracket_id, player_id, show_id, points) values (la_cas, f_scores, v_show, 0);
  insert into season_rosters (season_id, player_id, added_at) values (s_a, f_roster, now());
  insert into sync_flag_clears (show_id, cleared_by, note) values (v_show, f_sync, 'zz smoke');

  -- ---------- admin_list_unaffiliated_players ----------
  lbl := lbl || 'L1 has_played: true for the pick, score, roster and sync-flag-clear accounts, false for a fresh one'::text;
  ok := ok || coalesce((select bool_and(r.has_played) from admin_list_unaffiliated_players(v_tag || 'adm', v_pin, la) r where r.player_id in (f_picks, f_scores, f_roster, f_sync))
                   and (select count(*) from admin_list_unaffiliated_players(v_tag || 'adm', v_pin, la) r where r.player_id in (f_picks, f_scores, f_roster, f_sync)) = 4
                   and (select not r.has_played from admin_list_unaffiliated_players(v_tag || 'adm', v_pin, la) r where r.player_id = f2), false);
  lbl := lbl || 'L2 an account in a league is not listed, and the list is capped at 50'::text;
  ok := ok || coalesce(not exists (select 1 from admin_list_unaffiliated_players(v_tag || 'adm', v_pin, la) r where r.player_id = f_mem)
                   and (select count(*) from admin_list_unaffiliated_players(v_tag || 'adm', v_pin, la)) <= 50, false);
  begin perform admin_list_unaffiliated_players(v_tag || 'mem', v_pin, la); err := 'no error';
  exception when others then err := sqlerrm; end;
  lbl := lbl || ('L3 a non-admin is refused the list (got: ' || err || ')')::text;
  ok := ok || (err = 'League admins only');

  -- ---------- admin_clear_new_signups ----------
  j := admin_clear_new_signups(v_tag || 'adm', v_pin, la);
  lbl := lbl || 'C1 an admin clears: ok, cleared_at = now(), and exactly one row, for that admin'::text;
  ok := ok || coalesce((j->>'ok')::boolean and (j->>'cleared_at')::timestamptz = now()
                   and (select count(*) from admin_signup_clears where player_id = adm) = 1
                   and (select cleared_at from admin_signup_clears where player_id = adm) = now(), false);
  update admin_signup_clears set cleared_at = now() - interval '3 days' where player_id = adm;
  j := admin_clear_new_signups(v_tag || 'adm', v_pin, la);
  lbl := lbl || 'C2 a second clear moves that same row to now(), no second row'::text;
  ok := ok || coalesce((select count(*) from admin_signup_clears where player_id = adm) = 1
                   and (select cleared_at from admin_signup_clears where player_id = adm) = now(), false);
  lbl := lbl || 'C3 per admin: the clearing admin''s list carries cleared_at = now() on every row; another admin of the same league has no row and sees null'::text;
  ok := ok || coalesce((select bool_and(r.cleared_at = now()) from admin_list_unaffiliated_players(v_tag || 'adm', v_pin, la) r)
                   and not exists (select 1 from admin_signup_clears where player_id = adm2)
                   and (select bool_and(r.cleared_at is null) from admin_list_unaffiliated_players(v_tag || 'adm2', v_pin, la) r), false);
  begin perform admin_clear_new_signups(v_tag || 'mem', v_pin, la); err := 'no error';
  exception when others then err := sqlerrm; end;
  begin perform admin_clear_new_signups(v_tag || 'mustc', v_pin, la); err := err || ' / no error';
  exception when others then err := err || ' / ' || sqlerrm; end;
  lbl := lbl || ('C4 clear is refused for a non-admin and for a pending PIN change, nothing written (got: ' || err || ')')::text;
  ok := ok || (err = 'League admins only / PIN change required before this action'
               and not exists (select 1 from admin_signup_clears where player_id in (mem, mustc)));

  -- ---------- admin_remove_unplayed_account ----------
  select p.name, p.created_at into f1_name, f1_created from players p where p.id = f1;
  j := admin_remove_unplayed_account(v_tag || 'adm', v_pin, la, f1, false);
  lbl := lbl || 'R1 a league admin removes a fresh, never-played account: ok, the name returned, the players row gone'::text;
  ok := ok || coalesce((j->>'ok')::boolean and j->>'removed' = f1_name and not (j->>'name_banned')::boolean
                   and not exists (select 1 from players where id = f1), false);
  lbl := lbl || 'R2 exactly one log row for it: action, actor id and name, league, target id, name and created_at, name_banned false'::text;
  ok := ok || coalesce((select count(*) from admin_audit_log where target_id = f1) = 1
                   and exists (select 1 from admin_audit_log where target_id = f1 and action = 'remove_account'
                               and actor_id = adm and actor_name = v_tag || 'adm' and league_id = la
                               and target_name = f1_name and target_created_at = f1_created
                               and detail = jsonb_build_object('name_banned', false)), false);
  lbl := lbl || 'R3 the log row survives the removal it records: the account is gone, its log row is not'::text;
  ok := ok || coalesce(not exists (select 1 from players where id = f1)
                   and exists (select 1 from admin_audit_log where target_id = f1 and target_name = f1_name), false);
  j := register_player(f1_name, v_pin);
  lbl := lbl || 'R4 the freed name registers again, as a new account'::text;
  ok := ok || coalesce(j->>'name' = f1_name and (j->>'id')::uuid <> f1, false);

  begin perform admin_remove_unplayed_account(v_tag || 'adm', v_pin, la, f_mem, false); err := 'no error';
  exception when others then err := sqlerrm; end;
  lbl := lbl || ('R5 refused: in a league, even another league (got: ' || err || '), the account intact')::text;
  ok := ok || (err = 'This player is in a league' and exists (select 1 from players where id = f_mem));
  begin perform admin_remove_unplayed_account(v_tag || 'adm', v_pin, la, f_picks, false); err := 'no error';
  exception when others then err := sqlerrm; end;
  lbl := lbl || ('R6 refused: in no league but has a pick (got: ' || err || '), intact')::text;
  ok := ok || (err = v_played and exists (select 1 from players where id = f_picks));
  begin perform admin_remove_unplayed_account(v_tag || 'adm', v_pin, la, f_scores, false); err := 'no error';
  exception when others then err := sqlerrm; end;
  lbl := lbl || ('R7 refused: has a score (got: ' || err || '), intact')::text;
  ok := ok || (err = v_played and exists (select 1 from players where id = f_scores));
  begin perform admin_remove_unplayed_account(v_tag || 'adm', v_pin, la, f_roster, false); err := 'no error';
  exception when others then err := sqlerrm; end;
  lbl := lbl || ('R8 refused: has a season roster row (got: ' || err || '), intact')::text;
  ok := ok || (err = v_played and exists (select 1 from players where id = f_roster));
  begin perform admin_remove_unplayed_account(v_tag || 'adm', v_pin, la, f_sync, false); err := 'no error';
  exception when others then err := sqlerrm; end;
  lbl := lbl || ('R9 refused: cleared a sync flag, an admin action (got: ' || err || '), intact')::text;
  ok := ok || (err = v_played and exists (select 1 from players where id = f_sync));
  begin perform admin_remove_unplayed_account(v_tag || 'adm', v_pin, la, glob, false); err := 'no error';
  exception when others then err := sqlerrm; end;
  lbl := lbl || ('R10 refused: a Global admin (got: ' || err || '), intact')::text;
  ok := ok || (err = 'Cannot remove a Global admin' and exists (select 1 from players where id = glob));
  begin perform admin_remove_unplayed_account(v_tag || 'adm', v_pin, la, adm, false); err := 'no error';
  exception when others then err := sqlerrm; end;
  lbl := lbl || ('R11 refused: yourself (got: ' || err || ')')::text;
  ok := ok || (err = 'You cannot remove yourself' and exists (select 1 from players where id = adm));
  begin perform admin_remove_unplayed_account(v_tag || 'mem', v_pin, la, f2, false); err := 'no error';
  exception when others then err := sqlerrm; end;
  lbl := lbl || ('R12 refused: a caller who is not an admin of that league (got: ' || err || '), intact')::text;
  ok := ok || (err = 'League admins only' and exists (select 1 from players where id = f2));
  begin perform admin_remove_unplayed_account(v_tag || 'adm', '0000', la, f2, false); err := 'no error';
  exception when others then err := sqlerrm; end;
  lbl := lbl || ('R13 refused: a wrong PIN (got: ' || err || ')')::text;
  ok := ok || (err = 'Wrong name or PIN' and exists (select 1 from players where id = f2));
  begin perform admin_remove_unplayed_account(v_tag || 'adm', v_pin, la, f2, true); err := 'no error';
  exception when others then err := sqlerrm; end;
  lbl := lbl || ('R14 refused: a league admin asking to ban the name (got: ' || err || '), intact, no ban')::text;
  ok := ok || (err = 'Only Global can ban a name' and exists (select 1 from players where id = f2)
               and not exists (select 1 from global_banned_names where name = lower(v_tag || 'f2')));
  begin perform admin_remove_unplayed_account(v_tag || 'mustc', v_pin, la, f2, false); err := 'no error';
  exception when others then err := sqlerrm; end;
  lbl := lbl || ('R15 refused: a caller with a pending PIN change (got: ' || err || '), intact')::text;
  ok := ok || (err = 'PIN change required before this action' and exists (select 1 from players where id = f2));

  j := admin_remove_unplayed_account(v_tag || 'glob', v_pin, la, f3, true);
  lbl := lbl || 'R16 Global removes with the ban: gone, the name banned app-wide, logged with name_banned true and Global as the actor'::text;
  ok := ok || coalesce((j->>'name_banned')::boolean and not exists (select 1 from players where id = f3)
                   and exists (select 1 from global_banned_names where name = lower(v_tag || 'f3'))
                   and exists (select 1 from admin_audit_log where target_id = f3 and actor_id = glob
                               and detail = jsonb_build_object('name_banned', true)), false);
  begin perform register_player(v_tag || 'f3', v_pin); err := 'no error';
  exception when others then err := sqlerrm; end;
  lbl := lbl || ('R17 the banned name is refused at registration (got: ' || err || ')')::text;
  ok := ok || (err = 'That name is not available');
  lbl := lbl || 'R18 the refusals wrote no log rows: exactly two for this run, the two removals'::text;
  ok := ok || coalesce((select count(*) from admin_audit_log where target_name like v_tag || '%') = 2, false);

  delete from players where id = adm;
  lbl := lbl || 'R19 deleting the ACTOR''s account leaves the log row untouched: actor id and name still there'::text;
  ok := ok || coalesce(exists (select 1 from admin_audit_log where target_id = f1 and actor_id = adm and actor_name = v_tag || 'adm'), false);

  -- ---------- report, and roll everything back ----------
  for i in 1 .. array_length(lbl, 1) loop
    res := res || case when coalesce(ok[i], false) then ' | PASS ' else ' | FAIL ' end || lbl[i];
    if not coalesce(ok[i], false) then fails := fails + 1; end if;
  end loop;
  raise exception 'STAGE X SMOKE: % of % FAILED%  [rolled back: this block always raises]', fails, array_length(lbl, 1), res;
end $smoke$;
-- STEP 2B END

============================================================ */
