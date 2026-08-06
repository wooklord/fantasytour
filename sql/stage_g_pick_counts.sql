-- ============================================================
-- FANTASY EGGY — STAGE G: batch pick-count RPC for the shows-list marker
-- ============================================================
-- The shows list renders 25+ rows and wants a per-row "have I picked this
-- show?" indicator. get_my_picks is per-show (one round trip per row);
-- admin_pick_status is per-show too, and admin-gated besides, so neither
-- can be reused for a player-facing batch read. This is the batch version:
-- one call, every show's saved-pick count for the caller in this bracket.
--
-- Deliberately returns just show_id + a count, not the picks themselves —
-- the client already has each show's format (via the league_shows merge)
-- and the bracket config, so it computes the expected/target count itself
-- (slotDefs(format).length in picks.js) rather than this RPC trying to
-- know about slot config at all.
--
-- Gated exactly like get_bracket_scores: a plain member of the bracket's
-- league, or a Global admin, can read it; anyone else is rejected. Same
-- qualified-alias caution applies (lm.player_id, not player_id) — this
-- function's own RETURNS TABLE columns share names with league_members'
-- columns, and PL/pgSQL treats output columns as in-scope variables for
-- the whole body (see stage_c2a_fix_ambiguous_player_id.sql for the bug
-- this exact pattern caused once already).
-- ============================================================

begin;

create or replace function get_my_pick_counts(p_name text, p_pin text, p_bracket_id bigint)
returns table(show_id bigint, pick_count int)
language plpgsql security definer set search_path = public, extensions as $$
declare pl players; v_league_id bigint;
begin
  pl := _auth_player(p_name, p_pin);
  select league_id into v_league_id from brackets where id = p_bracket_id;
  if v_league_id is null then raise exception 'Bracket not found'; end if;
  if not pl.is_global_admin and not exists (
    select 1 from league_members lm where lm.league_id = v_league_id and lm.player_id = pl.id
  ) then
    raise exception 'Not a member of this league';
  end if;
  return query
    select p.show_id, count(*)::int as pick_count
    from picks p
    where p.bracket_id = p_bracket_id and p.player_id = pl.id
    group by p.show_id;
end $$;

revoke all on function get_my_pick_counts(text,text,bigint) from public;
grant execute on function get_my_pick_counts(text,text,bigint) to anon, authenticated;

commit;

-- ============================================================
-- VERIFICATION
-- ============================================================
-- select proname from pg_proc where proname = 'get_my_pick_counts';
--   Expect: one row.
-- select * from get_my_pick_counts('NAME', 'PIN', <bracket_id>);
--   Expect: one row per show you've saved at least one pick for, in that
--   bracket, with pick_count matching the slots you've actually filled.
-- select has_function_privilege('anon', 'get_my_pick_counts(text,text,bigint)', 'EXECUTE');
--   Expect: true.
