-- ============================================================
-- FANTASY EGGY — STAGE M: Global console support RPC
-- ============================================================
-- Run ONCE in the Supabase SQL Editor, after stage_k and stage_l. Session
-- 4, step 5. global_create_league, global_appoint_league_admin, and
-- global_boot_player already exist (sql/stage_c1_rpcs.sql) with zero
-- frontend callers before this session — the frontend work (admin.js) wires
-- those up directly, no SQL change needed for them.
--
-- The one real gap: finding a player app-wide. admin_find_players
-- (stage_c2b_member_mgmt.sql) is wrong for this — it's scoped to a
-- p_league_id and explicitly EXCLUDES players already in that league,
-- backwards for "promote an existing member to league admin" or "reset
-- this player's PIN regardless of league." Same prefix-match/min-2-char/
-- cap-8 shape and accepted privacy tradeoff as admin_find_players — no new
-- privacy posture introduced, just an unscoped version for Global only.
-- ============================================================

begin;

create or replace function global_find_players(p_name text, p_pin text, p_query text)
returns table(player_id uuid, name text)
language plpgsql security definer set search_path = public, extensions as $$
declare pl players; q text := trim(coalesce(p_query, ''));
begin
  pl := _auth_player(p_name, p_pin);
  if not pl.is_global_admin then raise exception 'Global admins only'; end if;
  if length(q) < 2 then raise exception 'Enter at least 2 characters'; end if;
  return query select p.id, p.name from players p where p.name ilike q || '%' order by p.name limit 8;
end $$;

grant execute on function global_find_players(text,text,text) to anon, authenticated;

commit;
