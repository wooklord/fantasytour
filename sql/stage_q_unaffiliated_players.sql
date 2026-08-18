-- ============================================================
-- FANTASY EGGY — STAGE Q: list registered players who are in no league
-- ============================================================
-- Run ONCE in the Supabase SQL Editor.
--
-- WHY: there was NO admin-facing signal that someone had registered and was
-- waiting to be added. Verified before building: the complete set of
-- list/find RPCs is admin_find_players (name-prefix, min 2 chars, capped at
-- 8, excludes members of ONE league), admin_list_members (members only),
-- admin_list_bans, admin_list_season_roster and global_find_players
-- (global-only). None lists or counts unaffiliated players. `players` has
-- RLS with no public select policy, and players_public is a
-- security_invoker view over it, so it inherits the block — a live anon read
-- returns [] against 15 real rows. There was no client-side workaround.
--
-- The consequence at ~50 recruits: every registration needed an out-of-band
-- message, and the admin had to know the opening characters of a nickname to
-- find it at all.
--
-- PREDICATE IS DELIBERATELY UNSCOPED — "in NO league", not "not in THIS
-- league". Those are the same thing at one league and diverge at two:
-- admin_find_players excludes members of the current league, so an
-- Ambassadors member counts as findable for Green Eggs. That is correct for
-- a search (you may well want to add them) and wrong for a waiting count
-- (they are not waiting for anything).
--
-- PRIVACY, stated because it is a change of posture rather than a pure
-- convenience: admin_find_players already exposes registered non-members one
-- prefix at a time, which was an accepted tradeoff. This exposes the whole
-- set to any league admin at once. Small pool, low stakes, but it lands just
-- as the first non-dev league admins are appointed — so it is a deliberate
-- decision, not a side effect.
-- ============================================================

begin;

create or replace function admin_list_unaffiliated_players(p_name text, p_pin text, p_league_id bigint)
returns table(player_id uuid, name text)
language plpgsql security definer set search_path = public, extensions as $$
declare pl players;
begin
  pl := _auth_player(p_name, p_pin);
  -- No _reject_if_must_change_pin: this is a READ, and stage_n deliberately
  -- leaves reads ungated. p_league_id is used only to prove the caller
  -- administers SOMETHING — the result set itself is league-independent.
  if not _is_league_admin_or_global(pl.id, p_league_id) then raise exception 'League admins only'; end if;
  return query
    select p.id, p.name
    from players p
    where not exists (select 1 from league_members lm where lm.player_id = p.id)
    order by p.name
    limit 50;
end $$;

grant execute on function admin_list_unaffiliated_players(text,text,bigint) to anon, authenticated;

commit;

-- ============================================================
-- VERIFICATION (run separately) — IN THIS ORDER
-- ============================================================
-- 1. DID IT DEPLOY? Run this FIRST. Nothing else here answers the question.
--
--   select p.oid::regprocedure::text
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public' and p.proname = 'admin_list_unaffiliated_players';
--
--   Expect exactly one row:
--     admin_list_unaffiliated_players(text,text,bigint)
--   NO ROWS means the function does not exist and the file did not apply,
--   whatever else looked fine.
--
-- 2. Is it callable, and does auth work? Unauthenticated must fail:
--   curl -s -X POST '.../rest/v1/rpc/admin_list_unaffiliated_players' \
--     -H "apikey: $ANON" -H "Authorization: Bearer $ANON" \
--     -H 'Content-Type: application/json' \
--     -d '{"p_name":"__nope__","p_pin":"0000","p_league_id":1}'
--   Expect P0001 "Wrong name or PIN". A PGRST202 here means NOT DEPLOYED —
--   PostgREST could not find a function with that argument set.
--
-- 3. ⚠️ PREDICATE CROSS-CHECK ONLY — THIS PROVES NOTHING ABOUT DEPLOYMENT.
--    It is a raw table query. It never touches the RPC, and returns exactly
--    the same answer whether or not the function exists:
--
--   select count(*) from players p
--   where not exists (select 1 from league_members lm where lm.player_id = p.id);
--
--    This check ran on 2026-08-17, returned 1, was reported as confirmation,
--    and the function had NOT been created — the panel failed with PGRST202
--    on first use. Its only legitimate use is comparing this number against
--    what the panel DISPLAYS, after steps 1 and 2 have already established
--    that the panel can call anything at all.
--
-- 4. A NON-admin member must be refused ('League admins only'). Note the dev
--    cannot test this personally — global admins short-circuit
--    _is_league_admin_or_global in every league. Needs the throwaway
--    non-global-admin account tracked in docs/session5_plan.md.
