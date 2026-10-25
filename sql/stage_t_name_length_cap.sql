-- ============================================================
-- FANTASY EGGY — STAGE T: nickname length cap (new registrations only)
-- ============================================================
-- Run ONCE in the Supabase SQL Editor. Record: docs/decisions/standings-ux.md
-- (decision 4, LOCKED 2026-10-25).
--
-- WHAT: register_player rejects a name longer than 20 characters AFTER
-- trim. Same signature as the live stage_c1 definition, so no drop and
-- no grant change; the body below is stage_c1_rpcs.sql:60-78 plus the one
-- new check.
--
-- WHY NOT A CHECK CONSTRAINT: existing names are untouched by decision
-- (nicknames are logins; a rename is a credential change). The live
-- maximum is 27 and three names exceed 20, so a column constraint would
-- fail to validate, and a NOT VALID one would only move the problem to
-- the next row rewrite. Nothing re-validates a name after creation —
-- _auth_player matches lower(name) = lower(trim(p_name)), the PIN RPCs
-- resolve by _auth_player or by uuid — so the three keep logging in.
--
-- The client mirrors this on the New player button only (features/auth.js,
-- NAME_MAX_LEN in core/config.js), NOT as a maxlength on the input, which
-- Log in shares. The server is the gate; the client is the courtesy.
-- ============================================================

begin;

create or replace function register_player(p_name text, p_pin text)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare pl players;
begin
  if length(trim(p_name)) < 2 then raise exception 'Name too short'; end if;
  -- Stage T: cap new names at 20 characters (after trim). Existing rows
  -- are not re-validated anywhere — see the header.
  if length(trim(p_name)) > 20 then raise exception 'Name must be 20 characters or fewer'; end if;
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

commit;

-- ============================================================
-- VERIFICATION (run separately, AFTER the block above) — no throwaway
-- accounts in production: everything below runs inside begin…rollback.
-- A 21-character name must raise the Stage T message; a 20-character name
-- must succeed; then the whole thing is rolled back, so the 20-character
-- row never persists. Success = the block completes with no error. Any
-- failure raises with a message starting "FAIL:". (RAISE NOTICE output
-- may not show in the SQL editor; the absence of an error is the result.)
-- ============================================================
-- 1. Deploy check FIRST (the Stage Q lesson):
--   select p.oid::regprocedure::text from pg_proc p
--   join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public' and p.proname = 'register_player';
--   Expect exactly one row: register_player(text,text).
--
-- 2. Behaviour, in a rolled-back transaction:
--   begin;
--   do $$
--   declare r json;
--   begin
--     begin
--       perform register_player('ZZtest_stage_t_21chrs', '1234');  -- 21 characters
--       raise exception 'FAIL: a 21-character name was accepted';
--     exception when others then
--       if sqlerrm <> 'Name must be 20 characters or fewer' then
--         raise exception 'FAIL: 21-character name raised the wrong error: %', sqlerrm;
--       end if;
--     end;
--     r := register_player('ZZtest_stage_t_20chr', '1234');        -- 20 characters
--     if r->>'name' <> 'ZZtest_stage_t_20chr' then
--       raise exception 'FAIL: 20-character name came back as %', r->>'name';
--     end if;
--   end $$;
--   rollback;
--
-- 3. Confirm nothing persisted:
--   select count(*) from players where name like 'ZZtest_stage_t_%';
--   Expect: 0
