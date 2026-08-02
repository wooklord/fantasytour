-- ============================================================
-- FANTASY EGGY — STAGE E: case-insensitive player names
-- ============================================================
-- Root cause of a real incident: a player ended up with duplicate accounts
-- (Carmanjesse / CARMANJESSE) and couldn't reliably log into either.
--
-- This was NOT a case-sensitive login bug — _auth_player has compared on
-- lower(name) since the original schema.sql, and both ban-list checks
-- (banned_names, global_banned_names) already insert AND check in
-- lower(...) too. The actual defect is narrower: players.name has only a
-- plain (case-sensitive) `unique` constraint, so register_player's
-- duplicate check — which relies entirely on that constraint's
-- unique_violation — let a case-variant of an existing name insert as a
-- second row instead of failing. Once two rows share a lowered name,
-- _auth_player's `select ... into` doesn't error on the extra match
-- (PL/pgSQL keeps the first row returned and silently discards the rest,
-- no STRICT) — so login became nondeterministic against whichever row's
-- PIN got checked, not literally case-sensitive.
--
-- Fix is a single constraint swap: replace the case-sensitive unique
-- constraint with a case-insensitive unique index on lower(name). That
-- alone makes register_player's existing `exception when unique_violation
-- ... raise exception 'That name is taken'` fire correctly for a
-- case-variant duplicate, and makes _auth_player's existing lower(name)
-- comparison unambiguous — no PL/pgSQL body changes needed anywhere.
--
-- Collision report (run before this file) came back with ZERO existing
-- case-variant duplicates, so there is no manual per-account cleanup
-- section here. If that's changed by the time you run this (a new
-- registration landed in the interim), `create unique index` below fails
-- loudly and this whole transaction rolls back — it will NOT silently
-- proceed over unresolved duplicates. Re-run the collision report
-- immediately before this file as a final check:
--
--   with dupes as (
--     select lower(name) as lname from players group by lower(name) having count(*) > 1
--   )
--   select p.id, p.name, p.created_at, p.is_global_admin,
--     exists(select 1 from league_members lm where lm.player_id = p.id) as has_league_membership,
--     (select count(*) from picks pk where pk.player_id = p.id) as picks_count,
--     (select count(*) from scores sc where sc.player_id = p.id) as scores_count
--   from players p join dupes d on lower(p.name) = d.lname
--   order by d.lname, p.created_at;
--
-- If that turns up rows, STOP — don't run this file yet. Decide which
-- account to keep per collision and get a cleanup section written first.
-- ============================================================

begin;

-- Dynamically finds and drops whatever unique constraint currently exists
-- on players(name), rather than hardcoding a constraint name never
-- directly verified against the live database. Naturally idempotent — if
-- already dropped (e.g. a prior partial run), the loop just finds nothing.
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.players'::regclass and contype = 'u'
  loop
    execute format('alter table players drop constraint %I', c.conname);
  end loop;
end $$;

create unique index if not exists players_name_lower_idx on players (lower(name));

commit;

-- ============================================================
-- SMOKE TEST — run separately from the migration above, in its own
-- transaction, rolled back at the end so no test data survives. Safe to
-- re-run anytime. Exercises the NEW index (this section runs after the
-- migration's commit above, in the same file/batch) plus the two ban
-- checks, which were already correct — this locks that in as a regression
-- test now that duplicates are structurally impossible.
-- ============================================================

begin;

do $$
declare r json;
begin
  perform register_player('ZzSmoketestUser', '1234');

  -- 1. Login succeeds with a wrong-case name, preserving stored capitalization.
  r := login('ZZSMOKETESTUSER', '1234');
  if (r->>'name') <> 'ZzSmoketestUser' then
    raise exception 'SMOKE TEST FAILED: wrong-case login did not return the stored capitalization (got %)', r;
  end if;
  raise notice 'PASS: wrong-case login succeeded and preserved capitalization (%).', r->>'name';

  -- 2. register_player refuses a case-variant of an existing name.
  begin
    perform register_player('zzsmoketestuser', '5678');
    raise exception 'SMOKE TEST FAILED: case-variant registration was NOT rejected';
  exception when others then
    if sqlerrm = 'That name is taken' then
      raise notice 'PASS: case-variant registration correctly rejected (%).', sqlerrm;
    else
      raise;
    end if;
  end;
end $$;

-- 3. Both ban checks catch case variants.
do $$
declare
  test_league_id bigint;
  test_target players;
begin
  select id into test_league_id from leagues order by id limit 1;
  if test_league_id is null then
    raise notice 'SKIP: no league exists to test the per-league ban check against.';
  else
    insert into players (name, pin_hash, is_global_admin)
      values ('ZzSmoketestAdmin', extensions.crypt('1234', extensions.gen_salt('bf')), true);
    insert into players (name, pin_hash)
      values ('ZzSmoketestTarget', extensions.crypt('1234', extensions.gen_salt('bf')))
      returning * into test_target;
    insert into banned_names (league_id, name) values (test_league_id, lower('ZzSmoketestTarget'));

    begin
      perform admin_add_league_member('ZzSmoketestAdmin', '1234', test_league_id, test_target.id);
      raise exception 'SMOKE TEST FAILED: banned_names did not catch a case-variant name';
    exception when others then
      if sqlerrm = 'This name is banned from this league' then
        raise notice 'PASS: banned_names (per-league) caught the case-variant name.';
      else
        raise;
      end if;
    end;
  end if;

  insert into global_banned_names (name) values (lower('ZzSmoketestBanned')) on conflict do nothing;
  begin
    perform register_player('ZZSMOKETESTBANNED', '1234');
    raise exception 'SMOKE TEST FAILED: global_banned_names did not catch a case-variant name';
  exception when others then
    if sqlerrm = 'That name is not available' then
      raise notice 'PASS: global_banned_names caught the case-variant name.';
    else
      raise;
    end if;
  end;
end $$;

rollback; -- nothing in this smoke-test section persists

-- ============================================================
-- VERIFICATION (run after the migration, before/instead of the smoke test
-- if you just want to confirm the schema change landed)
-- ============================================================
-- select conname from pg_constraint where conrelid = 'public.players'::regclass and contype = 'u';
--   Expect: no rows (the old case-sensitive constraint is gone).
-- select indexname from pg_indexes where tablename = 'players' and indexname = 'players_name_lower_idx';
--   Expect: one row.
