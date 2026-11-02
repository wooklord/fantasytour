-- ============================================================
-- FANTASY EGGY — STAGE Z: the daily setlist check (decision (2))
-- ============================================================
-- Run ONCE in the Supabase SQL Editor, BEFORE edge deploy A: the function
-- writes columns this file creates. Deployed first, the update that sets
-- status = 'final' would fail and the show would not go final. The live
-- function reads none of what this file creates, so applying it early is safe.
-- Record: docs/decisions/setlist-check.md (LOCKED 2026-10-31). Plan:
-- docs/setlist_check_plan.md, section 1. Pasting the WHOLE file runs only
-- begin…commit; the footer is one block comment.
--
-- WHAT:
--   1. league_shows gains setlist_hash_scoring, setlist_hash_full,
--      setlist_projection_scoring and setlist_projection_full: nullable text,
--      no default, NO backfill. Null is "never baselined"; the daily job's
--      null-hash branch fills it. get_league_shows names its columns
--      explicitly (sql/stage_c2a_rpcs.sql), so none of the four reaches a
--      client.
--   2. setlist_flags: one row per distinct Carton state per kind, whether or
--      not an earlier flag for that state was cleared. RLS on, no policies, so
--      only the two RPCs below and the service-role edge function reach it.
--      cleared_by holds a player UUID: never export it into a tracked file.
--   3. The daily job's gate row, sync_state 'daily_setlist_check', seeded
--      unstamped (its own row, the Stage Y form).
--   4. _setlist_check_targets(): every final (league, show) with a scores row
--      in that league's brackets. Service role only. A helper because that
--      join is one PostgREST cannot express, and reading scores in code would
--      hit its 1,000-row default cap.
--   5. admin_list_setlist_flags: the uncleared flags of a league, newest
--      first, for that league's admins and Global. A read, so no must-change-
--      PIN gate (stage_n leaves reads ungated).
--   6. admin_clear_setlist_flag: stamps cleared_at and cleared_by. No note
--      parameter (note is SQL-editor-only in v1) and no separate log table.
--      Clearing never touches the baseline.
--   7. _account_has_played gains setlist_flags.cleared_by: clearing a flag is
--      account history, the same as sync_flag_clears (decision (f)).
-- ============================================================

begin;

-- 1. the four columns --------------------------------------------
alter table league_shows
  add column if not exists setlist_hash_scoring text,
  add column if not exists setlist_hash_full text,
  add column if not exists setlist_projection_scoring text,
  add column if not exists setlist_projection_full text;

comment on column league_shows.setlist_hash_scoring is
  'SHA-256 hex of setlist_projection_scoring. Written from the fetched Carton rows after mapping, never from setlist_songs. Null: never baselined.';
comment on column league_shows.setlist_hash_full is
  'SHA-256 hex of setlist_projection_full. Written from the fetched Carton rows after mapping, never from setlist_songs. Null: never baselined.';
comment on column league_shows.setlist_projection_scoring is
  'The canonical text the scoring hash is taken over: position, setnumber, is_encore, norm(songname), is_cover, has_debut per row. setlistCheck.js projectSetlist.';
comment on column league_shows.setlist_projection_full is
  'The canonical text the full hash is taken over: the scoring row plus raw songname, segue, footnote. setlistCheck.js projectSetlist.';

-- 2. setlist_flags -----------------------------------------------
create table setlist_flags (
  id          bigint generated always as identity primary key,
  league_id   bigint not null references leagues(id) on delete cascade,
  show_id     bigint not null references shows(id) on delete cascade,
  kind        text not null check (kind in ('scoring', 'drift')),
  carton_hash text not null,   -- kind 'scoring': the scoring hash of what was fetched;
                               -- kind 'drift': the full hash; the literal 'absent' when
                               -- the stored date returned no rows at all
  detail      jsonb not null default '{}'::jsonb,
  found_at    timestamptz not null default now(),
  cleared_at  timestamptz,
  cleared_by  uuid references players(id) on delete set null,
  note        text,            -- SQL-editor-only in v1 (decision (e))
  unique (league_id, show_id, kind, carton_hash)
);

comment on column setlist_flags.carton_hash is
  'Kind scoring: the scoring hash of what was fetched. Kind drift: the full hash of what was fetched. The literal ''absent'' when the stored date returned no rows at all; the column is part of the unique key, so it cannot be null.';

alter table setlist_flags enable row level security;
revoke all on table setlist_flags from anon, authenticated;

-- 3. the gate row ------------------------------------------------
insert into sync_state (key) values ('daily_setlist_check') on conflict (key) do nothing;

-- 4. _setlist_check_targets --------------------------------------
create function _setlist_check_targets()
returns table(league_id bigint, show_id bigint, showdate date, format text,
              setlist_hash_scoring text, setlist_hash_full text,
              setlist_projection_scoring text, setlist_projection_full text)
language sql stable security definer set search_path = public, extensions as $$
  select ls.league_id, ls.show_id, s.showdate, ls.format,
         ls.setlist_hash_scoring, ls.setlist_hash_full,
         ls.setlist_projection_scoring, ls.setlist_projection_full
  from league_shows ls
  join shows s on s.id = ls.show_id
  where ls.status = 'final'
    and exists (select 1 from scores sc join brackets b on b.id = sc.bracket_id
                where b.league_id = ls.league_id and sc.show_id = ls.show_id)
  order by s.showdate, ls.league_id;
$$;
revoke execute on function _setlist_check_targets() from public, anon, authenticated;
grant execute on function _setlist_check_targets() to service_role;

-- 5. admin_list_setlist_flags ------------------------------------
create function admin_list_setlist_flags(p_name text, p_pin text, p_league_id bigint)
returns table(id bigint, show_id bigint, showdate date, venue text, kind text,
              found_at timestamptz, detail jsonb)
language plpgsql security definer set search_path = public, extensions as $$
declare pl players;
begin
  pl := _auth_player(p_name, p_pin);
  if not _is_league_admin_or_global(pl.id, p_league_id) then raise exception 'League admins only'; end if;
  return query
    select f.id, f.show_id, s.showdate, s.venue, f.kind, f.found_at, f.detail
    from setlist_flags f
    join shows s on s.id = f.show_id
    where f.league_id = p_league_id and f.cleared_at is null
    order by f.found_at desc, f.id desc;
end $$;
revoke execute on function admin_list_setlist_flags(text,text,bigint) from public;
grant execute on function admin_list_setlist_flags(text,text,bigint) to anon, authenticated;

-- 6. admin_clear_setlist_flag ------------------------------------
create function admin_clear_setlist_flag(p_name text, p_pin text, p_flag_id bigint)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare pl players; fl setlist_flags;
begin
  pl := _auth_player(p_name, p_pin);
  perform _reject_if_must_change_pin(pl);
  select * into fl from setlist_flags where id = p_flag_id;
  if not found then raise exception 'Flag not found'; end if;
  if not _is_league_admin_or_global(pl.id, fl.league_id) then raise exception 'League admins only'; end if;
  -- Nothing to clear → nothing to stamp. The first clear's stamps stand.
  if fl.cleared_at is not null then return json_build_object('ok', true, 'cleared', false); end if;
  update setlist_flags set cleared_at = now(), cleared_by = pl.id where id = fl.id;
  return json_build_object('ok', true, 'cleared', true);
end $$;
revoke execute on function admin_clear_setlist_flag(text,text,bigint) from public;
grant execute on function admin_clear_setlist_flag(text,text,bigint) to anon, authenticated;

-- 7. _account_has_played -----------------------------------------
create or replace function _account_has_played(p_player_id uuid)
returns boolean language sql stable security definer set search_path = public, extensions as $$
  select exists (select 1 from picks where player_id = p_player_id)
      or exists (select 1 from scores where player_id = p_player_id)
      or exists (select 1 from season_rosters where player_id = p_player_id)
      or exists (select 1 from sync_flag_clears where cleared_by = p_player_id)
      or exists (select 1 from setlist_flags where cleared_by = p_player_id);
$$;
revoke execute on function _account_has_played(uuid) from public, anon, authenticated;
grant execute on function _account_has_played(uuid) to service_role;

commit;

/* ============================================================
   FOOTER: steps 0, 2A, 2B and R. Everything below is inside this block
   comment, so running the whole file never runs it. Copy one step at a
   time: the text between its BEGIN and END marker lines. STEP 0 and STEP 2A
   are each ONE query: read its rows, and every row's "ok" must be true.
   Every "char" catalog column is cast ::text where it meets || (text ||
   "char" is ERROR 42725, the Stage X lesson). test/stageZ.test.mjs recomputes
   every md5, return type and count quoted here from the files.

-- STEP 0 BEGIN
-- Read-only. Run BEFORE Stage Z. Four rows, every "ok" true:
--   Z0.1 the live _account_has_played is Stage X's (one definition, its
--        whitespace-collapsed body md5). A mismatch means the live body is not
--        Stage X's: look first, with
--        select pg_get_functiondef('_account_has_played(uuid)'::regprocedure);
--   Z0.2 league_shows has none of the four columns (a half-applied earlier
--        try would show here).
--   Z0.3 none of Stage Z's objects exist yet.
--   Z0.4 sync_state holds exactly daily_discord_check and daily_show_sync.
with
hlp as (
  select count(*) as n, max(md5(regexp_replace(p.prosrc, '\s+', ' ', 'g'))) as md5
  from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
  where ns.nspname = 'public' and p.proname = '_account_has_played'
),
cols as (
  select string_agg(column_name, ', ' order by column_name collate "C") as v
  from information_schema.columns
  where table_schema = 'public' and table_name = 'league_shows'
    and column_name in ('setlist_hash_scoring', 'setlist_hash_full', 'setlist_projection_scoring', 'setlist_projection_full')
),
newobj as (
  select string_agg(x, ', ') as v from (
    select 'table setlist_flags' as x where to_regclass('public.setlist_flags') is not null
    union all
    select 'function ' || p.proname from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
    where ns.nspname = 'public' and p.proname in ('_setlist_check_targets', 'admin_list_setlist_flags', 'admin_clear_setlist_flag')
  ) q
),
gate as (select string_agg(key, ', ' order by key collate "C") as v from sync_state)
select 'Z0.1 live _account_has_played is Stage X''s' as check_name,
       coalesce(hlp.n = 1 and hlp.md5 = 'dd4868d09fe6c79abdf09a7bde8d8717', false) as ok,
       hlp.n || ' definition(s) | ' || coalesce(hlp.md5, '-') as actual from hlp
union all
select 'Z0.2 league_shows has none of the four columns', cols.v is null, coalesce(cols.v, '(none)') from cols
union all
select 'Z0.3 none of Stage Z''s objects exist yet', newobj.v is null, coalesce(newobj.v, '(none)') from newobj
union all
select 'Z0.4 sync_state holds exactly daily_discord_check and daily_show_sync',
       coalesce(gate.v = 'daily_discord_check, daily_show_sync', false), coalesce(gate.v, '(none)') from gate;
-- STEP 0 END

-- STEP 2A BEGIN
-- Read-only. Run AFTER Stage Z, BEFORE deploy A: did it deploy? Eleven rows,
-- every "ok" true. A false row shows what it found in "actual". Z2.11 is only
-- true until deploy A or the first flag.
with
f as (
  select p.proname, count(*) over (partition by p.proname) as n, pg_get_function_result(p.oid) as ret,
         md5(regexp_replace(p.prosrc, '\s+', ' ', 'g')) as md5
  from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
  where ns.nspname = 'public'
    and p.proname in ('_setlist_check_targets', 'admin_list_setlist_flags', 'admin_clear_setlist_flag', '_account_has_played')
),
act as (select string_agg(proname || ' ' || n || ' ' || md5, '; ' order by proname collate "C") as v from f),
cols as (
  select string_agg(column_name || ':' || data_type || ':' || is_nullable || ':' || coalesce(column_default, '-'), ', ' order by ordinal_position) as v
  from information_schema.columns
  where table_schema = 'public' and table_name = 'league_shows' and column_name like 'setlist%'
),
con as (
  select string_agg(pg_get_constraintdef(c.oid), ' | ' order by c.conname collate "C") as v
  from pg_constraint c
  where c.conrelid = to_regclass('public.setlist_flags') and c.contype::text in ('u', 'c')
),
gate as (
  select count(*) as n, bool_and(ran_at is null and attempted_at is null and note is null) as blank
  from sync_state where key = 'daily_setlist_check'
),
rls as (
  select (select relrowsecurity from pg_class where oid = to_regclass('public.setlist_flags')) as rls,
         (select count(*) from pg_policy where polrelid = to_regclass('public.setlist_flags')) as policies
),
nul as (
  select (select count(*) from league_shows
          where setlist_hash_scoring is not null or setlist_hash_full is not null
             or setlist_projection_scoring is not null or setlist_projection_full is not null) as rows_with_value,
         (select count(*) from setlist_flags) as flags
)
select 'Z2.1 _setlist_check_targets deployed' as check_name,
       exists (select 1 from f where proname = '_setlist_check_targets' and n = 1 and md5 = 'fff84b2a2546f95852b73b8ac7b7af80') as ok,
       (select v from act) as actual
union all
select 'Z2.2 admin_list_setlist_flags: Stage Z body, its return type',
       exists (select 1 from f where proname = 'admin_list_setlist_flags' and n = 1 and md5 = 'bf020545af283fce2bf8d523d2f05ebe'
               and ret = 'TABLE(id bigint, show_id bigint, showdate date, venue text, kind text, found_at timestamp with time zone, detail jsonb)'),
       (select v from act)
union all
select 'Z2.3 admin_clear_setlist_flag deployed',
       exists (select 1 from f where proname = 'admin_clear_setlist_flag' and n = 1 and md5 = 'c70ab88a0e154256d28c816459047257'),
       (select v from act)
union all
select 'Z2.4 _account_has_played: Stage Z body (the old md5 here means it did not change)',
       exists (select 1 from f where proname = '_account_has_played' and n = 1 and md5 = '9b341334dc10b5122c52ccbec8271a2b'),
       (select v from act)
union all
select 'Z2.5 the four columns: text, nullable, no default',
       coalesce(cols.v = 'setlist_hash_scoring:text:YES:-, setlist_hash_full:text:YES:-, setlist_projection_scoring:text:YES:-, setlist_projection_full:text:YES:-', false),
       coalesce(cols.v, '(none)') from cols
union all
select 'Z2.6 setlist_flags has its unique key and its kind check',
       coalesce(con.v like '%UNIQUE (league_id, show_id, kind, carton_hash)%' and con.v like '%''scoring''%' and con.v like '%''drift''%', false),
       coalesce(con.v, '(none)') from con
union all
select 'Z2.7 setlist_flags: RLS on, no policy, anon and authenticated hold no privilege',
       coalesce(rls.rls and rls.policies = 0, false)
       and not has_table_privilege('anon', 'public.setlist_flags', 'SELECT, INSERT, UPDATE, DELETE')
       and not has_table_privilege('authenticated', 'public.setlist_flags', 'SELECT, INSERT, UPDATE, DELETE'),
       'rls=' || coalesce(rls.rls::text, '-') || ' policies=' || rls.policies from rls
union all
select 'Z2.8 gate row daily_setlist_check seeded, unstamped',
       coalesce(gate.n = 1 and gate.blank, false), gate.n || ' row(s), blank=' || coalesce(gate.blank::text, '-') from gate
union all
select 'Z2.9 both helpers: NOT executable by anon or authenticated, executable by service_role',
       not has_function_privilege('anon', 'public._setlist_check_targets()', 'EXECUTE')
       and not has_function_privilege('authenticated', 'public._setlist_check_targets()', 'EXECUTE')
       and has_function_privilege('service_role', 'public._setlist_check_targets()', 'EXECUTE')
       and not has_function_privilege('anon', 'public._account_has_played(uuid)', 'EXECUTE')
       and not has_function_privilege('authenticated', 'public._account_has_played(uuid)', 'EXECUTE')
       and has_function_privilege('service_role', 'public._account_has_played(uuid)', 'EXECUTE'),
       'targets anon=' || has_function_privilege('anon', 'public._setlist_check_targets()', 'EXECUTE')
       || ' service_role=' || has_function_privilege('service_role', 'public._setlist_check_targets()', 'EXECUTE')
       || ' | helper anon=' || has_function_privilege('anon', 'public._account_has_played(uuid)', 'EXECUTE')
       || ' service_role=' || has_function_privilege('service_role', 'public._account_has_played(uuid)', 'EXECUTE')
union all
select 'Z2.10 the two RPCs ARE executable by anon',
       has_function_privilege('anon', 'public.admin_list_setlist_flags(text,text,bigint)', 'EXECUTE')
       and has_function_privilege('anon', 'public.admin_clear_setlist_flag(text,text,bigint)', 'EXECUTE'),
       'list=' || has_function_privilege('anon', 'public.admin_list_setlist_flags(text,text,bigint)', 'EXECUTE')
       || ' clear=' || has_function_privilege('anon', 'public.admin_clear_setlist_flag(text,text,bigint)', 'EXECUTE')
union all
select 'Z2.11 no backfill: every league_shows row null in all four, setlist_flags empty',
       nul.rows_with_value = 0 and nul.flags = 0,
       nul.rows_with_value || ' row(s) hold a value, ' || nul.flags || ' flag(s)' from nul;
-- STEP 2A END

-- STEP 2B BEGIN
-- The smoke test. Self-contained: throwaway players, two throwaway leagues,
-- brackets and flags, hung on three EXISTING shows inside the block only. It
-- calls the real functions and ENDS IN raise exception carrying PASS/FAIL, so
-- everything it wrote is rolled back, every time. No real PIN is typed and no
-- real row is touched. The one trace: identity sequences are not transactional,
-- so the next real league, bracket and flag ids skip a few numbers (harmless).
-- Read the result in the ERROR panel: "STAGE Z SMOKE: 0 of 18 FAILED | PASS …".
-- Any other error text means setup failed before the checks ran; that is
-- rolled back too.
do $smoke$
declare
  v_tag text := 'zzz' || txid_current()::text;
  v_pin text := '4242';
  v_shows bigint[];
  la bigint; lb bigint; la_cas bigint; lb_cas bigint;
  adm uuid; adm2 uuid; admb uuid; glob uuid; mem uuid; mustc uuid; fresh uuid;
  fl_a bigint; fl_b bigint; fl_done bigint; fl_clear bigint; fl_refused bigint;
  r record; j json; err text; n int; kinds text[]; v_at timestamptz;
  lbl text[] := '{}'; ok boolean[] := '{}'; res text := ''; fails int := 0;
begin
  -- ---------- setup ----------
  select array_agg(id order by id) into v_shows
  from (select id from shows where venue is not null order by id limit 3) q;
  if coalesce(array_length(v_shows, 1), 0) < 3 then raise exception 'STAGE Z SMOKE SETUP: fewer than 3 shows with a venue'; end if;
  insert into players (name, pin_hash) values (v_tag || 'adm', extensions.crypt(v_pin, extensions.gen_salt('bf'))) returning id into adm;
  insert into players (name, pin_hash) values (v_tag || 'adm2', extensions.crypt(v_pin, extensions.gen_salt('bf'))) returning id into adm2;
  insert into players (name, pin_hash) values (v_tag || 'admb', extensions.crypt(v_pin, extensions.gen_salt('bf'))) returning id into admb;
  insert into players (name, pin_hash, is_global_admin) values (v_tag || 'glob', extensions.crypt(v_pin, extensions.gen_salt('bf')), true) returning id into glob;
  insert into players (name, pin_hash) values (v_tag || 'mem', extensions.crypt(v_pin, extensions.gen_salt('bf'))) returning id into mem;
  insert into players (name, pin_hash, must_change_pin) values (v_tag || 'mustc', extensions.crypt(v_pin, extensions.gen_salt('bf')), true) returning id into mustc;
  insert into players (name, pin_hash) values (v_tag || 'fresh', extensions.crypt(v_pin, extensions.gen_salt('bf'))) returning id into fresh;
  insert into leagues (name) values (v_tag || ' A') returning id into la;
  insert into leagues (name) values (v_tag || ' B') returning id into lb;
  insert into brackets (league_id, name, kind, config) values (la, 'Casual', 'casual', '{}') returning id into la_cas;
  insert into brackets (league_id, name, kind, config) values (lb, 'Casual', 'casual', '{}') returning id into lb_cas;
  insert into league_members (league_id, player_id, is_league_admin)
    values (la, adm, true), (la, adm2, true), (la, mem, false), (la, mustc, true), (lb, admb, true);

  -- ---------- _setlist_check_targets ----------
  -- League A: final with a score (show 1), final with none (show 2), live with
  -- a score (show 3). League B: final on show 1 with no score of its own, the
  -- shape a league-blind join would wrongly list.
  insert into league_shows (league_id, show_id, status, format) values
    (la, v_shows[1], 'final', 'one_set'), (la, v_shows[2], 'final', 'standard'), (la, v_shows[3], 'live', 'standard'),
    (lb, v_shows[1], 'final', 'standard');
  insert into scores (bracket_id, player_id, show_id, points) values (la_cas, mem, v_shows[1], 1), (la_cas, mem, v_shows[3], 1);

  select * into r from _setlist_check_targets() t where t.league_id = la and t.show_id = v_shows[1];
  lbl := lbl || 'T1 a final row with a scores row is listed, with its date, its format and a null baseline'::text;
  ok := ok || coalesce(r.showdate = (select showdate from shows where id = v_shows[1]) and r.format = 'one_set'
                   and r.setlist_hash_scoring is null and r.setlist_hash_full is null
                   and r.setlist_projection_scoring is null and r.setlist_projection_full is null, false);
  lbl := lbl || 'T2 a final row with no scores row is not listed, nor is a final row whose show has scores only in another league'::text;
  ok := ok || (not exists (select 1 from _setlist_check_targets() t where t.league_id = la and t.show_id = v_shows[2])
           and not exists (select 1 from _setlist_check_targets() t where t.league_id = lb));
  lbl := lbl || 'T3 a non-final row with a scores row is not listed'::text;
  ok := ok || not exists (select 1 from _setlist_check_targets() t where t.league_id = la and t.show_id = v_shows[3]);

  -- ---------- admin_list_setlist_flags ----------
  insert into setlist_flags (league_id, show_id, kind, carton_hash, found_at) values (la, v_shows[1], 'scoring', 'hash-a', now() - interval '2 days') returning id into fl_a;
  insert into setlist_flags (league_id, show_id, kind, carton_hash, found_at) values (la, v_shows[2], 'drift', 'hash-b', now() - interval '1 day') returning id into fl_b;
  insert into setlist_flags (league_id, show_id, kind, carton_hash, cleared_at, cleared_by) values (la, v_shows[3], 'scoring', 'hash-done', now(), adm2) returning id into fl_done;

  select array_agg(t.kind order by t.ord) into kinds
  from admin_list_setlist_flags(v_tag || 'adm', v_pin, la) with ordinality as t(id, show_id, showdate, venue, kind, found_at, detail, ord);
  select count(*) into n from admin_list_setlist_flags(v_tag || 'adm', v_pin, la) t
  join shows s on s.id = t.show_id
  where t.id in (fl_a, fl_b) and t.showdate = s.showdate and t.venue = s.venue;
  lbl := lbl || 'L1 the league admin sees both planted flags, newest first, with date and venue; Global sees them too'::text;
  ok := ok || coalesce(kinds = array['drift', 'scoring'] and n = 2
                   and (select count(*) from admin_list_setlist_flags(v_tag || 'glob', v_pin, la) t where t.id in (fl_a, fl_b)) = 2, false);
  lbl := lbl || 'L2 a cleared flag is not listed'::text;
  ok := ok || not exists (select 1 from admin_list_setlist_flags(v_tag || 'adm', v_pin, la) t where t.id = fl_done);
  begin perform admin_list_setlist_flags(v_tag || 'admb', v_pin, la); err := 'no error';
  exception when others then err := sqlerrm; end;
  lbl := lbl || ('L3 the other league''s admin is refused (got: ' || err || ')')::text;
  ok := ok || (err = 'League admins only');
  begin perform admin_list_setlist_flags(v_tag || 'mem', v_pin, la); err := 'no error';
  exception when others then err := sqlerrm; end;
  lbl := lbl || ('L4 a non-admin member is refused (got: ' || err || ')')::text;
  ok := ok || (err = 'League admins only');

  -- ---------- admin_clear_setlist_flag ----------
  insert into setlist_flags (league_id, show_id, kind, carton_hash) values (la, v_shows[1], 'scoring', 'hash-clear') returning id into fl_clear;
  insert into setlist_flags (league_id, show_id, kind, carton_hash) values (la, v_shows[1], 'scoring', 'hash-refused') returning id into fl_refused;

  j := admin_clear_setlist_flag(v_tag || 'adm', v_pin, fl_clear);
  lbl := lbl || 'C1 the admin clears: cleared true, cleared_at = now(), cleared_by = the admin'::text;
  ok := ok || coalesce((j->>'cleared')::boolean
                   and (select cleared_at = now() and cleared_by = adm from setlist_flags where id = fl_clear), false);

  -- now() does not move inside this block, so back-date the stamp: a second
  -- clear that re-stamped would show here, and a second admin would show in
  -- cleared_by.
  v_at := now() - interval '1 hour';
  update setlist_flags set cleared_at = v_at where id = fl_clear;
  j := admin_clear_setlist_flag(v_tag || 'adm2', v_pin, fl_clear);
  lbl := lbl || 'C2 the second clear, by another admin: cleared false, and the first stamps stand'::text;
  ok := ok || coalesce(not (j->>'cleared')::boolean
                   and (select cleared_at = v_at and cleared_by = adm from setlist_flags where id = fl_clear), false);

  begin perform admin_clear_setlist_flag(v_tag || 'admb', v_pin, fl_refused); err := 'no error';
  exception when others then err := sqlerrm; end;
  lbl := lbl || ('C3 the other league''s admin is refused, the row untouched (got: ' || err || ')')::text;
  ok := ok || (err = 'League admins only' and (select cleared_at is null and cleared_by is null from setlist_flags where id = fl_refused));
  begin perform admin_clear_setlist_flag(v_tag || 'mem', v_pin, fl_refused); err := 'no error';
  exception when others then err := sqlerrm; end;
  lbl := lbl || ('C4 a non-admin member is refused (got: ' || err || ')')::text;
  ok := ok || (err = 'League admins only' and (select cleared_at is null from setlist_flags where id = fl_refused));
  begin perform admin_clear_setlist_flag(v_tag || 'adm', '0000', fl_refused); err := 'no error';
  exception when others then err := sqlerrm; end;
  lbl := lbl || ('C5 a wrong PIN is refused (got: ' || err || ')')::text;
  ok := ok || (err = 'Wrong name or PIN' and (select cleared_at is null from setlist_flags where id = fl_refused));
  begin perform admin_clear_setlist_flag(v_tag || 'mustc', v_pin, fl_refused); err := 'no error';
  exception when others then err := sqlerrm; end;
  lbl := lbl || ('C6 an admin with a pending PIN change is refused (got: ' || err || ')')::text;
  ok := ok || (err = 'PIN change required before this action' and (select cleared_at is null from setlist_flags where id = fl_refused));
  begin perform admin_clear_setlist_flag(v_tag || 'adm', v_pin, -1); err := 'no error';
  exception when others then err := sqlerrm; end;
  lbl := lbl || ('C7 an unknown id is refused (got: ' || err || ')')::text;
  ok := ok || (err = 'Flag not found');

  -- ---------- the dedup key ----------
  begin
    insert into setlist_flags (league_id, show_id, kind, carton_hash) values (la, v_shows[1], 'scoring', 'hash-a'); err := 'no error';
  exception when unique_violation then err := 'unique_violation'; when others then err := sqlerrm; end;
  n := 0;
  begin
    insert into setlist_flags (league_id, show_id, kind, carton_hash) values (la, v_shows[1], 'drift', 'hash-a'); n := 1;
  exception when others then n := 0; end;
  lbl := lbl || ('D1 the same league, show, kind and hash is refused (got: ' || err || '); the other kind with the same hash inserts')::text;
  ok := ok || (err = 'unique_violation' and n = 1);

  -- ---------- account history ----------
  lbl := lbl || 'H1 _account_has_played is true for the admin whose only history is clearing a flag'::text;
  ok := ok || coalesce(_account_has_played(adm), false);
  lbl := lbl || 'H2 _account_has_played is false for a fresh account'::text;
  ok := ok || coalesce(not _account_has_played(fresh), false);

  -- ---------- the kind vocabulary ----------
  begin
    insert into setlist_flags (league_id, show_id, kind, carton_hash) values (la, v_shows[1], 'other', 'hash-k'); err := 'no error';
  exception when check_violation then err := 'check_violation'; when others then err := sqlerrm; end;
  lbl := lbl || ('K1 a third kind is refused (got: ' || err || ')')::text;
  ok := ok || (err = 'check_violation');

  -- ---------- report, and roll everything back ----------
  for i in 1 .. array_length(lbl, 1) loop
    res := res || case when coalesce(ok[i], false) then ' | PASS ' else ' | FAIL ' end || lbl[i];
    if not coalesce(ok[i], false) then fails := fails + 1; end if;
  end loop;
  raise exception 'STAGE Z SMOKE: % of % FAILED%  [rolled back: this block always raises]', fails, array_length(lbl, 1), res;
end $smoke$;
-- STEP 2B END

-- STEP R BEGIN
-- ROLLBACK of Stage Z. ONLY while the deployed edge function is b9f3ee6's or
-- earlier, that is, before deploy A. Deploy A writes the four columns inside
-- the same update that sets status = 'final', so with the columns gone that
-- update fails and the show does not go final. After deploy A, roll the
-- function back first (docs/setlist_check_plan.md, section 8, step 3). Puts
-- _account_has_played back to Stage X's body verbatim (test/stageZ.test.mjs
-- checks the md5), then drops everything else Stage Z created. Run as ONE
-- statement block.
begin;
drop function if exists admin_clear_setlist_flag(text,text,bigint);
drop function if exists admin_list_setlist_flags(text,text,bigint);
drop function if exists _setlist_check_targets();
create or replace function _account_has_played(p_player_id uuid)
returns boolean language sql stable security definer set search_path = public, extensions as $$
  select exists (select 1 from picks where player_id = p_player_id)
      or exists (select 1 from scores where player_id = p_player_id)
      or exists (select 1 from season_rosters where player_id = p_player_id)
      or exists (select 1 from sync_flag_clears where cleared_by = p_player_id);
$$;
revoke execute on function _account_has_played(uuid) from public, anon, authenticated;
grant execute on function _account_has_played(uuid) to service_role;
drop table if exists setlist_flags;
alter table league_shows
  drop column if exists setlist_hash_scoring,
  drop column if exists setlist_hash_full,
  drop column if exists setlist_projection_scoring,
  drop column if exists setlist_projection_full;
delete from sync_state where key = 'daily_setlist_check';
commit;
-- STEP R END

============================================================ */
