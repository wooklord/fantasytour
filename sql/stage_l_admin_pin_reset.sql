-- ============================================================
-- FANTASY EGGY — STAGE L: admin/global PIN-reset RPC
-- ============================================================
-- Run ONCE in the Supabase SQL Editor, AFTER stage_k_pin_management.sql
-- (needs players.must_change_pin to exist). Session 4, step 3 — SQL only,
-- no frontend caller yet (that's step 4/stage_m's admin.js work) per the
-- session's manual-approval, no-reachable-button-before-it's-safe ordering.
--
-- Reuses _is_league_admin_or_global exactly as CLAUDE.md specifies ("no new
-- authorization architecture") plus one extra guard that shared guard
-- doesn't give for free: it proves the CALLER admins p_league_id, not that
-- the TARGET is actually a member of that league. Without the extra check
-- below, a plain league admin could pass their own league_id and reset any
-- registered player's PIN app-wide, not just their own league's roster.
--
-- p_league_id is nullable for the future Global console call site (step
-- 5/stage_m) — a global admin resetting someone app-wide has no "current
-- league." _is_league_admin_or_global's is_global_admin clause short-
-- circuits true regardless of p_league_id, and the "target not in league"
-- check below is explicitly skipped when the caller is a global admin.
--
-- The new PIN uses plain random(), not a cryptographic RNG — deliberately
-- consistent with this app's existing PIN posture (unrated numeric PINs, no
-- login rate limiting yet — that's a separate, later, deliberately-deferred
-- piece of work), not an oversight.
--
-- _reject_if_must_change_pin closes the gap the client-side interstitial
-- alone can't: must_change_pin(=true) is otherwise just a UI hint — the
-- relayed PIN itself is a fully valid credential to every RPC the instant
-- it's set, including submit_picks, so nothing server-side stopped it being
-- used to write/impersonate before the forced change ever happened. Called
-- from every WRITE rpc (this file's own admin_reset_player_pin included —
-- an admin whose own account has a pending forced change loses write access
-- too, same as anyone else) right after _auth_player, before any other
-- check — reads stay ungated (see sql/stage_n_reject_pending_pin_change_writes.sql,
-- which re-touches the other 14 write RPCs the same way). login and
-- change_own_pin are the two functions that must NEVER call this — they're
-- the only way out of the state it enforces. register_player doesn't call
-- _auth_player at all, so it's not applicable there either.
--
-- Defined here (in the not-yet-shipped file that first needed it) rather
-- than in stage_n, so the shared guard exists before anything references it
-- and the run order stays simple (k, then l, then m, then n).
-- ============================================================

begin;

create or replace function _reject_if_must_change_pin(pl players)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if pl.must_change_pin then
    raise exception 'PIN change required before this action';
  end if;
end $$;

revoke execute on function _reject_if_must_change_pin(players) from public;
grant execute on function _reject_if_must_change_pin(players) to service_role;

create or replace function admin_reset_player_pin(p_name text, p_pin text, p_league_id bigint, p_player_id uuid)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare pl players; tgt players; new_pin text;
begin
  pl := _auth_player(p_name, p_pin);
  perform _reject_if_must_change_pin(pl);
  if not _is_league_admin_or_global(pl.id, p_league_id) then raise exception 'League admins only'; end if;
  select * into tgt from players where id = p_player_id;
  if tgt.id is null then raise exception 'Player not found'; end if;
  if tgt.is_global_admin and not pl.is_global_admin then
    raise exception 'Only Global can reset a Global admin''s PIN';
  end if;
  if not pl.is_global_admin and not exists (
    select 1 from league_members where league_id = p_league_id and player_id = p_player_id
  ) then
    raise exception 'That player is not in this league';
  end if;
  new_pin := lpad(floor(random()*1000000)::text, 6, '0');
  update players set pin_hash = crypt(new_pin, gen_salt('bf')), must_change_pin = true where id = tgt.id;
  return json_build_object('ok', true, 'name', tgt.name, 'new_pin', new_pin);
end $$;

grant execute on function admin_reset_player_pin(text,text,bigint,uuid) to anon, authenticated;

commit;

-- Verification (run as a league admin who is NOT a global admin, against a
-- player who IS in their league — expect a new_pin back and must_change_pin
-- to flip true; then try it against a player NOT in their league — expect
-- 'That player is not in this league').
