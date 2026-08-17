-- ============================================================
-- FANTASY EGGY — STAGE P1: gate get_show_picks on league membership
-- (P1 of two — see the "THIS IS P1 OF TWO" block below before running)
-- ============================================================
-- Run ONCE in the Supabase SQL Editor. With P2, closes Pre-Session-5 gate
-- item #7 —
-- which was recorded as an OPEN QUESTION rather than a task because the
-- original intent behind the anon grant was unknown. Decided 2026-08-16:
-- the grant was an oversight, not a design choice.
--
-- WHAT CHANGES: who can CALL this RPC. Nothing else.
--
-- WHAT DOES NOT CHANGE: reveal-after-cutoff. Players seeing each other's
-- sheets once picks lock is the game working as intended — the cutoff
-- condition is carried over verbatim below, deliberately untouched.
--
-- WHY: get_show_picks was granted to anon with no auth and no membership
-- check, while get_bracket_scores — which exposes strictly LESS — is both
-- authenticated and membership-gated. Verified live before this change: a
-- single past show returned 44 rows and 11 distinct player names to an
-- unauthenticated caller holding nothing but the publishable key that
-- ships in the deployed frontend. Nicknames are the login identifier
-- (half of the name+PIN pair), so that was one full credential factor for
-- every player, readable by anyone. The gate below mirrors
-- get_bracket_scores exactly: global admin, or a member of the bracket's
-- league.
--
-- player_id is REMOVED from the payload, replaced by is_mine. Now that the
-- function authenticates, the server knows who is asking — so the one real
-- frontend use (highlighting the caller's own picks in the setlist view,
-- picks.js's `mineHits`) no longer requires shipping raw UUIDs for every
-- OTHER player to the client. This is strictly less data than before, not
-- merely the same data behind a gate.
--
-- The anon GRANT is deliberately KEPT. The body rejects unauthenticated
-- callers on its own, every other RPC in this app carries the same grant,
-- and removing it would make this function the odd one out without adding
-- any gate that actually matters.
--
-- No _reject_if_must_change_pin call: stage_n deliberately leaves READ
-- rpcs ungated. A player with a pending forced PIN change can still look
-- at the app; they just cannot write.
--
-- ⚠️ OPERATIONAL CONSEQUENCE — THIS REMOVES A REAL DIAGNOSTIC, on purpose.
-- Reading picks after cutoff with nothing but the publishable key no
-- longer works. That path was genuinely used (2026-08-15, to check ranked
-- sheet shape on show 1765912122). Replacements: admin_pick_status
-- (name/PIN, league admin — returns picks_count + last_saved per player)
-- or the Supabase SQL editor. CLAUDE.md's passages describing the anon
-- path are corrected in this same commit rather than left to rot.
-- ============================================================

-- ============================================================
-- ⚠️ THIS IS P1 OF TWO — IT IS DELIBERATELY ADDITIVE.
-- ============================================================
-- It creates the new four-argument function and leaves the old
-- two-argument one IN PLACE. Run stage_p2 to drop the old one AFTER the
-- frontend is deployed and confirmed.
--
-- WHY SPLIT: this is a signature change, so there is no single ordering
-- that avoids breakage. Apply-then-push leaves already-loaded clients
-- calling a two-arg function that no longer exists; push-then-apply leaves
-- new clients calling a four-arg function that does not exist yet. Both
-- fail the same way (PostgREST PGRST202, argument-set mismatch).
--
-- The window is NOT bounded by how fast you push. Measured 2026-08-16
-- against the live site: app.js and index.html are both served with
-- Cache-Control: max-age=600, and index.html references the bundle as a
-- bare `app.js` with no content hash and no query string. So an active
-- browser can keep using the old bundle for ~10 minutes after deploy, and
-- an installed PWA left open never refetches at all until it is fully
-- closed and reopened. See the cache-busting entry in CLAUDE.md's deferred
-- list.
--
-- Keeping both overloads for the few minutes between P1 and P2 removes the
-- window entirely. They coexist unambiguously: different arity, and
-- PostgREST resolves an RPC by the exact set of argument names in the
-- request body, so a two-arg call and a four-arg call can never be
-- confused for one another.
--
-- COST, stated plainly: the anon-readable hole stays open between P1 and
-- P2. It has been open since Stage C1 — months — so extending it by
-- roughly fifteen minutes to avoid breaking the show-detail view for every
-- active player is a deliberate and favourable trade, not an oversight.
-- Do not leave P2 unrun; the whole point of this stage is that drop.
-- ============================================================

begin;

-- Only the long-dead pre-Stage-C1 single-argument form is dropped here —
-- it has had no callers since Stage C1 and cannot be in flight. The live
-- two-argument form is deliberately LEFT ALONE; stage_p2 drops it.
drop function if exists get_show_picks(bigint);

create or replace function get_show_picks(p_name text, p_pin text, p_bracket_id bigint, p_show_id bigint)
returns table(is_mine boolean, player_name text, slot text, songname text)
language plpgsql security definer set search_path = public, extensions as $$
declare pl players; v_league_id bigint;
begin
  pl := _auth_player(p_name, p_pin);
  select b.league_id into v_league_id from brackets b where b.id = p_bracket_id;
  if v_league_id is null then raise exception 'Bracket not found'; end if;
  -- lm alias is deliberate, not stylistic. This function was `language sql`
  -- until now; converting it to plpgsql means RETURNS TABLE output columns
  -- and DECLAREd variables are all in scope as identifiers, so an
  -- unqualified league_id/player_id here is genuinely ambiguous between the
  -- column and the variable. That exact bug already shipped once — see
  -- sql/stage_c2a_fix_ambiguous_player_id.sql. Dropping player_id as an
  -- output column removes half the hazard; this alias handles the rest.
  if not pl.is_global_admin and not exists (
    select 1 from league_members lm
    where lm.league_id = v_league_id and lm.player_id = pl.id
  ) then
    raise exception 'Not a member of this league';
  end if;
  -- Names still join players directly rather than through league_members,
  -- so a booted player's historical picks keep displaying — unchanged from
  -- the original. Note that rule is about the SUBJECT of a row; the gate
  -- above is about the CALLER. The two are independent and both intended.
  --
  -- The players alias is pl2, not pl: `pl` is the DECLAREd caller record,
  -- and reusing it here would shadow it and break the is_mine comparison.
  return query
    select (p.player_id = pl.id), pl2.name, p.slot, p.songname
    from picks p
    join players pl2 on pl2.id = p.player_id
    join brackets b on b.id = p.bracket_id
    join league_shows ls on ls.league_id = b.league_id and ls.show_id = p.show_id
    where p.bracket_id = p_bracket_id and p.show_id = p_show_id
      and ls.cutoff_at is not null and now() >= ls.cutoff_at;
end $$;

grant execute on function get_show_picks(text,text,bigint,bigint) to anon, authenticated;

commit;

-- ============================================================
-- VERIFICATION (run separately, after the commit above)
-- ============================================================
-- 1. TWO overloads are the CORRECT state after P1 — do not "fix" this:
--
--   select p.oid::regprocedure
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public' and p.proname = 'get_show_picks'
--   order by 1;
--
--   Expect exactly these two rows:
--     get_show_picks(bigint,bigint)                 <- old, still live on purpose
--     get_show_picks(text,text,bigint,bigint)       <- new
--
--   The old two-arg form is what keeps already-loaded browser bundles
--   working during the deploy window; stage_p2 removes it. Seeing two rows
--   here is the intended intermediate state, NOT a stale overload.
--   ONE row means something is wrong: only the four-arg form means the old
--   one was dropped early (cached clients will break), and only the two-arg
--   form means this file did not actually apply.
--
-- 2. An unauthenticated call to the NEW signature must fail. From a shell,
--    using only the publishable key:
--
--   curl -s -X POST \
--     'https://zdfhglvjxquvkjyvophz.supabase.co/rest/v1/rpc/get_show_picks' \
--     -H "apikey: $ANON" -H "Authorization: Bearer $ANON" \
--     -H 'Content-Type: application/json' \
--     -d '{"p_name":"__nope__","p_pin":"0000","p_bracket_id":2,"p_show_id":1765912122}'
--
--   Expect P0001 "Wrong name or PIN". A PGRST202 here means the argument
--   set did not match the new signature — that is a probe error, not proof
--   the function is missing (see CLAUDE.md's note on PostgREST resolving
--   RPCs by exact argument-name set).
--
-- 3. A real member call should still return rows for a past show, and
--    is_mine should be true on exactly that caller's own rows and false on
--    everyone else's — check both, since an is_mine that is uniformly
--    false would still look plausible in the UI (just no highlighting).
--
-- 4. The OLD two-arg call should STILL WORK at this point — that is the
--    whole reason P1 is additive. Confirm it before deploying the
--    frontend, because if it is already broken the split has bought
--    nothing and cached clients are failing right now:
--
--   curl -s -X POST \
--     'https://zdfhglvjxquvkjyvophz.supabase.co/rest/v1/rpc/get_show_picks' \
--     -H "apikey: $ANON" -H "Authorization: Bearer $ANON" \
--     -H 'Content-Type: application/json' \
--     -d '{"p_bracket_id":2,"p_show_id":1765912122}'
--
--   Expect rows (a past show) or []. A PGRST202 here means the old form is
--   already gone — stop and re-apply it before pushing the frontend.
--
-- ============================================================
-- NEXT STEP — do not stop here
-- ============================================================
-- P1 alone leaves the anon hole open. After this file:
--   1. Deploy the frontend (npm run build, commit app.js, push).
--   2. Confirm the new bundle is actually being served:
--        curl -s https://fantasyeggy.wooklord.net/app.js | grep -c p_pin
--      A non-zero count means the deployed bundle sends credentials.
--      Allow for max-age=600 on the CDN edge before trusting a miss.
--   3. Run sql/stage_p2_drop_legacy_get_show_picks.sql.
