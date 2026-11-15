-- ============================================================
-- FANTASY EGGY — STAGE AA: admin_audit_log gains the action 'adjust_verdict'
-- ============================================================
-- Run ONCE in the Supabase SQL Editor, BEFORE the first targeted score
-- correction. That correction is a hand-run, untracked transaction (it names
-- a player, so it is never committed); it inserts one admin_audit_log row
-- with this action and refuses to start while the check below does not
-- allow it. Nothing deployed reads or writes the new value: the edge
-- function and the client are untouched, and admin_remove_unplayed_account
-- keeps writing 'remove_account'.
-- Record: docs/decisions/score-corrections.md. The destination (this table,
-- a new action value, an ALTER on this check) was named on 2026-10-31 in
-- docs/decisions/setlist-check.md, item 7.
--
-- WHAT: one thing. The check Stage X created on admin_audit_log.action,
-- (action in ('remove_account')), becomes
-- (action in ('remove_account', 'adjust_verdict')). No table, column,
-- function, grant, policy or row changes, and there is no backfill.
--
-- NOT HERE: admin_adjust_verdict, the RPC. Its build trigger (the first real
-- use of the correction template, same item 7) fired on 2026-11-15; it is
-- deliberately not built in this stage.
--
-- Three steps in the SQL Editor, in this order; the footer holds 0, 2 and R:
--   STEP 0  read-only, BEFORE this file: is the live check Stage X's?
--   STEP 1  this file. Pasting the WHOLE file runs only begin…commit; the
--           footer is one block comment.
--   STEP 2  read-only, AFTER: the verification query.
-- ============================================================

begin;

alter table admin_audit_log
  drop constraint admin_audit_log_action_check,
  add constraint admin_audit_log_action_check
    check (action in ('remove_account', 'adjust_verdict'));

commit;

/* ============================================================
   FOOTER: steps 0, 2 and R. Everything below is inside this block comment,
   so running the whole file never runs it. Copy one step at a time: the
   text between its BEGIN and END marker lines. STEP 0 and STEP 2 are each
   ONE read-only query: every row's "ok" must be true, and a false row shows
   what it found in "actual". The allowed values are read out of the
   constraint's own definition (every quoted literal in it), so the checks do
   not depend on whether Postgres prints a one-value list as "=" and a longer
   one as "= ANY (ARRAY[...])". Every "char" catalog column is cast ::text
   where it is read (the Stage X lesson). test/stageAA.test.mjs recomputes
   every list quoted here from this file and from Stage X's.

-- STEP 0 BEGIN
-- Read-only. Run BEFORE Stage AA. Three rows, every "ok" true:
--   AA0.1 admin_audit_log has exactly one check constraint, validated, under
--         the name Stage X's inline column check received.
--   AA0.2 it is on action and allows exactly Stage X's list: remove_account.
--         "adjust_verdict, remove_account" here means Stage AA is already in.
--   AA0.3 the table is Stage X's otherwise: its ten columns, RLS on, nothing
--         granted to anon or authenticated, no foreign key.
with
con as (
  select count(*) as n, max(conname) as name, bool_and(convalidated) as valid,
         max(pg_get_constraintdef(oid)) as def
  from pg_constraint
  where conrelid = 'public.admin_audit_log'::regclass and contype::text = 'c'
),
vals as (
  select coalesce(string_agg(m[1], ', ' order by m[1] collate "C"), '(none)') as v
  from con, regexp_matches(con.def, '''([^'']+)''::text', 'g') m
),
shp as (
  select (select string_agg(column_name, ', ' order by ordinal_position) from information_schema.columns
          where table_schema = 'public' and table_name = 'admin_audit_log') as cols,
         (select relrowsecurity from pg_class where oid = 'public.admin_audit_log'::regclass) as rls,
         (has_table_privilege('anon', 'public.admin_audit_log', 'SELECT, INSERT, UPDATE, DELETE')
          or has_table_privilege('authenticated', 'public.admin_audit_log', 'SELECT, INSERT, UPDATE, DELETE')) as granted,
         (select count(*) from pg_constraint
          where conrelid = 'public.admin_audit_log'::regclass and contype::text = 'f') as fks
)
select 'AA0.1 one check constraint, admin_audit_log_action_check, validated' as check_name,
       coalesce(con.n = 1 and con.name = 'admin_audit_log_action_check' and con.valid, false) as ok,
       con.n || ' check constraint(s) | ' || coalesce(con.name, '-') || ' | ' || coalesce(con.def, '-') as actual from con
union all
select 'AA0.2 it is on action and allows exactly: remove_account',
       coalesce(con.def like 'CHECK ((action = %' and vals.v = 'remove_account', false), vals.v from con, vals
union all
select 'AA0.3 the table is otherwise Stage X''s',
       coalesce(shp.cols = 'id, logged_at, action, actor_id, actor_name, league_id, target_id, target_name, target_created_at, detail'
                and shp.rls and not shp.granted and shp.fks = 0, false),
       coalesce(shp.cols, '(none)') || ' | rls=' || coalesce(shp.rls::text, '-') || ' | granted=' || shp.granted::text || ' | ' || shp.fks || ' foreign key(s)' from shp;
-- STEP 0 END

-- STEP 2 BEGIN
-- Read-only. Run AFTER Stage AA: the verification query. Four rows, every
-- "ok" true:
--   AA2.1 still exactly one check constraint, same name, validated.
--   AA2.2 it is on action and allows exactly: adjust_verdict, remove_account.
--         "remove_account" alone means the file did not apply.
--   AA2.3 the table is otherwise unchanged (the same test as AA0.3).
--   AA2.4 no row carries adjust_verdict yet. True right after Stage AA; it
--         turns false, correctly, once the first correction is logged. The
--         rows per action are in "actual" either way.
with
con as (
  select count(*) as n, max(conname) as name, bool_and(convalidated) as valid,
         max(pg_get_constraintdef(oid)) as def
  from pg_constraint
  where conrelid = 'public.admin_audit_log'::regclass and contype::text = 'c'
),
vals as (
  select coalesce(string_agg(m[1], ', ' order by m[1] collate "C"), '(none)') as v
  from con, regexp_matches(con.def, '''([^'']+)''::text', 'g') m
),
shp as (
  select (select string_agg(column_name, ', ' order by ordinal_position) from information_schema.columns
          where table_schema = 'public' and table_name = 'admin_audit_log') as cols,
         (select relrowsecurity from pg_class where oid = 'public.admin_audit_log'::regclass) as rls,
         (has_table_privilege('anon', 'public.admin_audit_log', 'SELECT, INSERT, UPDATE, DELETE')
          or has_table_privilege('authenticated', 'public.admin_audit_log', 'SELECT, INSERT, UPDATE, DELETE')) as granted,
         (select count(*) from pg_constraint
          where conrelid = 'public.admin_audit_log'::regclass and contype::text = 'f') as fks
),
rws as (
  select count(*) filter (where action = 'adjust_verdict') as adjusted,
         coalesce(string_agg(action || ' x' || n, ', ' order by action collate "C"), '(no rows)') as v
  from (select action, count(*) as n from admin_audit_log group by action) x
)
select 'AA2.1 one check constraint, admin_audit_log_action_check, validated' as check_name,
       coalesce(con.n = 1 and con.name = 'admin_audit_log_action_check' and con.valid, false) as ok,
       con.n || ' check constraint(s) | ' || coalesce(con.name, '-') || ' | ' || coalesce(con.def, '-') as actual from con
union all
select 'AA2.2 it is on action and allows exactly: adjust_verdict, remove_account',
       coalesce(con.def like 'CHECK ((action = %' and vals.v = 'adjust_verdict, remove_account', false), vals.v from con, vals
union all
select 'AA2.3 the table is otherwise unchanged',
       coalesce(shp.cols = 'id, logged_at, action, actor_id, actor_name, league_id, target_id, target_name, target_created_at, detail'
                and shp.rls and not shp.granted and shp.fks = 0, false),
       coalesce(shp.cols, '(none)') || ' | rls=' || coalesce(shp.rls::text, '-') || ' | granted=' || shp.granted::text || ' | ' || shp.fks || ' foreign key(s)' from shp
union all
select 'AA2.4 no row carries adjust_verdict yet (true right after Stage AA)', rws.adjusted = 0, rws.v from rws;
-- STEP 2 END

-- STEP R BEGIN
-- ROLLBACK of Stage AA: Stage X's list, verbatim. One statement, so it either
-- lands whole or not at all. It can only land while no row carries
-- 'adjust_verdict': after a correction has been logged, the new check fails
-- on that row (ERROR 23514) and the constraint stays as Stage AA left it,
-- which is the right outcome, since the log row must stay valid.
alter table admin_audit_log
  drop constraint admin_audit_log_action_check,
  add constraint admin_audit_log_action_check
    check (action in ('remove_account'));
-- STEP R END
============================================================ */
