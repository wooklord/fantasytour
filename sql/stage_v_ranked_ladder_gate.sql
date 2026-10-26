-- ============================================================
-- FANTASY EGGY — STAGE V: ranked mode needs a ladder (admin_update_config gate)
-- ============================================================
-- Run ONCE in the Supabase SQL Editor. Record: docs/decisions/admin-panel.md
-- → "EMPTY RANKED LADDER — LOCKED 2026-10-26" (decision 1); incident:
-- docs/history/2026-10-26-casual-empty-ladder.md.
--
-- WHAT: admin_update_config refuses a config whose mode is 'ranked_choice'
-- while ranked.ladder is missing, not an array, or empty. Same signature
-- as the live Stage N definition (stage_n_reject_pending_pin_change_
-- writes.sql:168), so no drop and no grant change; the body below is that
-- body plus the one check.
--
-- WHY HERE: brackets.config has exactly one writer, this RPC, and the
-- client has two save paths feeding it. The 2026-10-26 incident reached
-- "ranked mode, empty ladder" through the panel's normal flow with no
-- error from either path. The client now writes mode and ladder together
-- (decision 2) and warns (decision 3), but those are courtesies; this is
-- the gate. Slots mode with an empty ladder stays legal — a slots-mode
-- Save rules materialises `ranked: { ladder: [] }` on purpose and that is
-- harmless there.
--
-- APPLY ORDER: this first, then the client push. Either order is safe (an
-- old client against the new gate sees this message in its error box; a
-- new client never sends an empty ladder), but the gate is what makes the
-- bad state unreachable, so it goes first.
-- ============================================================

begin;

create or replace function admin_update_config(p_name text, p_pin text, p_bracket_id bigint, p_data jsonb)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare pl players; v_league_id bigint;
begin
  pl := _auth_player(p_name, p_pin);
  perform _reject_if_must_change_pin(pl);
  select league_id into v_league_id from brackets where id = p_bracket_id;
  if v_league_id is null then raise exception 'Bracket not found'; end if;
  if not _is_league_admin_or_global(pl.id, v_league_id) then raise exception 'League admins only'; end if;
  -- Stage V: ranked mode without a ladder renders a pick sheet with no
  -- rows. jsonb_typeof guards jsonb_array_length, which raises on a
  -- non-array; a missing key, a null, an object or [] all count as empty.
  if (p_data->>'mode') = 'ranked_choice'
     and coalesce(case when jsonb_typeof(p_data->'ranked'->'ladder') = 'array'
                       then jsonb_array_length(p_data->'ranked'->'ladder') end, 0) = 0 then
    raise exception 'A ranked-choice bracket needs at least one rank';
  end if;
  update brackets set config = p_data where id = p_bracket_id;
  return json_build_object('ok', true);
end $$;

commit;

-- ============================================================
-- VERIFICATION (run separately, AFTER the block above) — deploy check
-- FIRST, per the Stage Q lesson (docs/decisions/testing-harness.md).
-- ============================================================
-- 1. DID IT DEPLOY? The signature did not change, so existence proves
--    nothing — the BODY must carry the gate. Expect: t.
--   select pg_get_functiondef('admin_update_config(text,text,bigint,jsonb)'::regprocedure)
--          ilike '%needs at least one rank%';
--
-- 2. BEHAVIOUR, in a rolled-back transaction — nothing persists. Needs a
--    league admin's own name/PIN (yours) and one real bracket id you
--    administer (any; its config is read, altered in memory, and every
--    write is rolled back). Success = the block completes with no error;
--    any failure raises "FAIL: ...".
--   begin;
--   do $$
--   declare r json; cfg jsonb; v_bracket bigint := <bracket id>;
--   begin
--     select config into cfg from brackets where id = v_bracket;
--     if cfg is null then raise exception 'FAIL: bracket % not found', v_bracket; end if;
--     -- (a) ranked mode with an EMPTY ladder is refused
--     begin
--       perform admin_update_config('<your name>', '<your pin>', v_bracket,
--         cfg || '{"mode":"ranked_choice","ranked":{"ladder":[]}}'::jsonb);
--       raise exception 'FAIL: ranked mode with an empty ladder was accepted';
--     exception when others then
--       if sqlerrm <> 'A ranked-choice bracket needs at least one rank' then
--         raise exception 'FAIL: wrong error for the empty ladder: %', sqlerrm;
--       end if;
--     end;
--     -- (b) ranked mode with NO ranked key is refused too
--     begin
--       perform admin_update_config('<your name>', '<your pin>', v_bracket,
--         (cfg - 'ranked') || '{"mode":"ranked_choice"}'::jsonb);
--       raise exception 'FAIL: ranked mode with no ranked key was accepted';
--     exception when others then
--       if sqlerrm <> 'A ranked-choice bracket needs at least one rank' then
--         raise exception 'FAIL: wrong error for the missing key: %', sqlerrm;
--       end if;
--     end;
--     -- (c) ranked mode WITH a ladder is accepted
--     r := admin_update_config('<your name>', '<your pin>', v_bracket,
--         cfg || '{"mode":"ranked_choice","ranked":{"ladder":[5,4,3,2,1]}}'::jsonb);
--     if (r->>'ok') <> 'true' then raise exception 'FAIL: a valid ranked config was refused: %', r; end if;
--     -- (d) slots mode with an empty ladder is still accepted (gate is ranked-only)
--     r := admin_update_config('<your name>', '<your pin>', v_bracket,
--         cfg || '{"mode":"slots","ranked":{"ladder":[]}}'::jsonb);
--     if (r->>'ok') <> 'true' then raise exception 'FAIL: slots mode with an empty ladder was refused: %', r; end if;
--   end $$;
--   rollback;
--
-- 3. Confirm nothing persisted: the bracket's mode and ladder read as they
--    did before step 2.
--   select id, config->>'mode' as mode, config->'ranked'->'ladder' as ladder
--   from brackets where id = <bracket id>;
--
-- 4. The state the gate exists to prevent. Expect: no rows (the 2026-10-26
--    repair cleared the one offender; from now on the gate refuses it).
--   select id, name, config->'ranked'->'ladder' as ladder from brackets
--   where config->>'mode' = 'ranked_choice'
--     and coalesce(case when jsonb_typeof(config->'ranked'->'ladder') = 'array'
--                       then jsonb_array_length(config->'ranked'->'ladder') end, 0) = 0;
--
-- 5. A PGRST202 from the admin panel after this is applied is NOT "the
--    function is missing" — the signature is unchanged; reload the schema
--    cache or wait.
