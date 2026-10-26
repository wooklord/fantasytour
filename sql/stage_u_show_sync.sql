-- ============================================================
-- FANTASY EGGY — STAGE U: daily in-tick show sync — schema + RPCs
-- ============================================================
-- Run ONCE in the Supabase SQL Editor, BEFORE deploying the carton-sync
-- edge function (build order: docs/show_sync_plan.md — Stage U → edge
-- deploy → client push). The function writes the columns and tables this
-- file creates; deployed first, its overlay inserts fail on the new column
-- and its sync_state stamps fail, both visible only in the function logs.
-- Record: docs/decisions/cron-secret-edge-auth.md → "LOCKED 2026-10-25 —
-- daily in-tick show sync".
--
-- WHAT:
--   1. league_shows.cutoff_set_by_admin boolean — nullable, NO default, NO
--      backfill. null = "predates the flag"; the sync then decides derived
--      vs admin-set by comparing the stored cutoff to the OLD date's
--      default (showSync.js cutoffPlan). admin_set_cutoff writes true; the
--      sync's own inserts, refills and recomputes write false.
--   2. admin_set_cutoff: same signature, same body plus the flag.
--   3. shows.sync_flag text — nullable. Readable through the existing
--      public `shows` select; it carries venue/date facts and league NAMES
--      only — never a nickname, never a pick.
--   4. sync_state — the daily gate's one row (key 'daily_show_sync'). RLS
--      on, NO policies, anon/authenticated revoked: only the service-role
--      edge function reads or writes it.
--   5. sync_flag_clears — the allow-plus-log record of who cleared a flag
--      and what it said. Same lockdown. Holds a player UUID; never export
--      it into a tracked file (CLAUDE.md → Conventions).
--   6. admin_clear_sync_flag(p_name, p_pin, p_show_id): any league admin
--      or global (shows are global, so any league's admin may clear); logs
--      the cleared text, then nulls it.
--
-- WHY NO BACKFILL on cutoff_set_by_admin: nothing records which existing
-- cutoffs were set by hand. false everywhere would let the sync move a
-- cutoff an admin chose; true everywhere would freeze every derived one.
-- null routes to the old-default comparison, the only honest
-- classification available for pre-flag rows.
--
-- Stage R (sql/stage_r_seed_league_shows_on_create.sql, still unapplied)
-- seeds cutoff_set_by_admin = false on the rows it creates; it therefore
-- requires this file first. Its own header says so.
-- ============================================================

begin;

-- 1. the flag -------------------------------------------------
alter table league_shows add column if not exists cutoff_set_by_admin boolean;

-- 2. admin_set_cutoff: the live body (stage_n_reject_pending_pin_change_
--    writes.sql:254) plus `cutoff_set_by_admin = true`. Signature
--    unchanged, so the existing anon/authenticated grants survive.
create or replace function admin_set_cutoff(p_name text, p_pin text, p_league_id bigint, p_show_id bigint, p_cutoff timestamptz)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare pl players;
begin
  pl := _auth_player(p_name, p_pin);
  perform _reject_if_must_change_pin(pl);
  if not _is_league_admin_or_global(pl.id, p_league_id) then raise exception 'League admins only'; end if;
  update league_shows set cutoff_at = p_cutoff, cutoff_set_by_admin = true
    where league_id = p_league_id and show_id = p_show_id;
  if not found then raise exception 'Show not found for this league'; end if;
  return json_build_object('ok', true);
end $$;

-- 3. the flag text --------------------------------------------
alter table shows add column if not exists sync_flag text;

-- 4. sync_state -----------------------------------------------
create table if not exists sync_state (
  key          text primary key,
  ran_at       timestamptz,
  attempted_at timestamptz,
  note         text
);
alter table sync_state enable row level security;
revoke all on table sync_state from anon, authenticated;
-- Seed the gate row unstamped. An absent row would also work (the
-- function's upsert creates it), but a present one makes verification
-- step 5 unambiguous.
insert into sync_state (key) values ('daily_show_sync') on conflict (key) do nothing;

-- 5. sync_flag_clears -----------------------------------------
create table if not exists sync_flag_clears (
  id         bigint generated always as identity primary key,
  show_id    bigint not null references shows(id) on delete cascade,
  -- set null, not restrict: global_boot_player deletes players rows, and
  -- an audit row must never be what blocks a boot.
  cleared_by uuid references players(id) on delete set null,
  cleared_at timestamptz not null default now(),
  note       text
);
alter table sync_flag_clears enable row level security;
revoke all on table sync_flag_clears from anon, authenticated;

-- 6. admin_clear_sync_flag ------------------------------------
create or replace function admin_clear_sync_flag(p_name text, p_pin text, p_show_id bigint)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare pl players; cur text;
begin
  pl := _auth_player(p_name, p_pin);
  perform _reject_if_must_change_pin(pl);
  -- Any league's admin, or global. Not _is_league_admin_or_global: that
  -- takes a league id, and a show belongs to no league.
  if not (pl.is_global_admin
          or exists (select 1 from league_members where player_id = pl.id and is_league_admin = true)) then
    raise exception 'League admins only';
  end if;
  select sync_flag into cur from shows where id = p_show_id;
  if not found then raise exception 'Show not found'; end if;
  -- Nothing to clear → nothing to log. The log records what was cleared.
  if cur is null then return json_build_object('ok', true, 'cleared', false); end if;
  insert into sync_flag_clears (show_id, cleared_by, note) values (p_show_id, pl.id, cur);
  update shows set sync_flag = null where id = p_show_id;
  return json_build_object('ok', true, 'cleared', true);
end $$;
revoke execute on function admin_clear_sync_flag(text,text,bigint) from public;
grant execute on function admin_clear_sync_flag(text,text,bigint) to anon, authenticated;

commit;

-- ============================================================
-- VERIFICATION (run separately, AFTER the block above) — deploy check
-- FIRST, per the Stage Q lesson (docs/decisions/testing-harness.md): every
-- later step can pass against a database where this file silently did
-- nothing.
-- ============================================================
-- 1. DID IT DEPLOY? Both functions present, AND admin_set_cutoff's BODY
--    carries the flag — its signature did not change, so existence alone
--    proves nothing about it. Expect: two rows, then `t`.
--   select p.oid::regprocedure::text
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public' and p.proname in ('admin_set_cutoff','admin_clear_sync_flag');
--   select pg_get_functiondef('admin_set_cutoff(text,text,bigint,bigint,timestamptz)'::regprocedure)
--          ilike '%cutoff_set_by_admin = true%';
--
-- 2. Columns. Expect two rows, both with a null column_default:
--    league_shows | cutoff_set_by_admin | boolean   and   shows | sync_flag | text
--   select table_name, column_name, data_type, column_default
--   from information_schema.columns
--   where (table_name, column_name) in (('league_shows','cutoff_set_by_admin'), ('shows','sync_flag'));
--
-- 3. No backfill happened. Expect: count_set = 0, total = the row count
--    you had before (53 as of 2026-10-11: 37 + 16).
--   select count(*) filter (where cutoff_set_by_admin is not null) as count_set, count(*) as total
--   from league_shows;
--
-- 4. The two locked tables: RLS on, zero policies, zero grants to anon or
--    authenticated. Expect: two rows with relrowsecurity = t; then 0; then
--    NO rows.
--   select relname, relrowsecurity from pg_class where relname in ('sync_state','sync_flag_clears');
--   select count(*) from pg_policy where polrelid in ('sync_state'::regclass, 'sync_flag_clears'::regclass);
--   select table_name, grantee, privilege_type from information_schema.role_table_grants
--   where table_name in ('sync_state','sync_flag_clears') and grantee in ('anon','authenticated');
--
-- 5. Gate row seeded, unstamped. Expect exactly one row:
--    daily_show_sync | null | null | null
--   select * from sync_state;
--
-- 6. admin_clear_sync_flag grants. Expect anon and authenticated listed
--    and PUBLIC absent.
--   select grantee from information_schema.routine_privileges where routine_name = 'admin_clear_sync_flag';
--
-- 7. BEHAVIOUR, in a rolled-back transaction — nothing persists. Needs a
--    league admin's own name/PIN (yours) plus one real show id and the
--    league id you administer. Success = the block completes with no
--    error; any failure raises "FAIL: ...". (RAISE NOTICE output may not
--    show in the SQL editor; the absence of an error is the result.)
--   begin;
--   do $$
--   declare r json; n int; v_show bigint := <show id>; v_league bigint := <league id>; v_cut timestamptz;
--   begin
--     -- (a) admin_set_cutoff now stamps the flag. Re-save the CURRENT
--     --     cutoff so the value itself does not move.
--     select cutoff_at into v_cut from league_shows where league_id = v_league and show_id = v_show;
--     if v_cut is null then raise exception 'FAIL: pick a show with a cutoff'; end if;
--     r := admin_set_cutoff('<your name>', '<your pin>', v_league, v_show, v_cut);
--     if not exists (select 1 from league_shows
--                    where league_id = v_league and show_id = v_show and cutoff_set_by_admin = true) then
--       raise exception 'FAIL: admin_set_cutoff did not set cutoff_set_by_admin';
--     end if;
--     -- (b) clear: plant a flag, clear it, check the log row and the null.
--     update shows set sync_flag = 'ZZtest stage u' where id = v_show;
--     r := admin_clear_sync_flag('<your name>', '<your pin>', v_show);
--     if (r->>'cleared') <> 'true' then raise exception 'FAIL: clear returned %', r; end if;
--     if (select sync_flag from shows where id = v_show) is not null then
--       raise exception 'FAIL: sync_flag not cleared';
--     end if;
--     select count(*) into n from sync_flag_clears where show_id = v_show and note = 'ZZtest stage u';
--     if n <> 1 then raise exception 'FAIL: expected 1 log row, found %', n; end if;
--     -- (c) clearing an already-null flag logs nothing.
--     r := admin_clear_sync_flag('<your name>', '<your pin>', v_show);
--     if (r->>'cleared') <> 'false' then raise exception 'FAIL: second clear returned %', r; end if;
--     select count(*) into n from sync_flag_clears where show_id = v_show and note = 'ZZtest stage u';
--     if n <> 1 then raise exception 'FAIL: a no-op clear wrote a log row'; end if;
--     -- (d) a wrong PIN is refused before anything is read.
--     begin
--       perform admin_clear_sync_flag('<your name>', '0000', v_show);
--       raise exception 'FAIL: wrong PIN was accepted';
--     exception when others then
--       if sqlerrm <> 'Wrong name or PIN' then
--         raise exception 'FAIL: wrong PIN raised the wrong error: %', sqlerrm;
--       end if;
--     end;
--   end $$;
--   rollback;
--
-- 8. Confirm nothing persisted. Expect: 0 (until a real clear happens),
--    0, and 0 again (the flag column is still all null).
--   select count(*) from sync_flag_clears;
--   select count(*) from shows where sync_flag = 'ZZtest stage u';
--   select count(*) filter (where cutoff_set_by_admin is not null) from league_shows;
--
-- 9. Optional — the admin gate itself. It cannot be exercised from the
--    dev's own account (same as Stage P, gate #7); it needs a registered
--    account that is NOT a league admin anywhere. Expect P0001
--    'League admins only':
--   select admin_clear_sync_flag('<non-admin name>', '<its pin>', <show id>);
--
-- 10. From the frontend after the client push: a PGRST202 on
--     admin_clear_sync_flag means step 1 did not pass — not a client bug.
