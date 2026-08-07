-- ============================================================
-- FANTASY EGGY — STAGE H: get_season_roster returns player names
-- ============================================================
-- Standings currently builds its entire player list from get_bracket_scores
-- rows — a season-roster member with zero scored shows (opted in but never
-- had an Official show finalize while eligible) is invisible, not shown at
-- 0. Fix (frontend, separate from this file) is to seed standings with
-- every roster member. That needs names, and get_season_roster only ever
-- returned (player_id, added_at) — it was built for the tiebreaker "join
-- date" lookup alone, which never needed a name. Adding one here rather
-- than introducing a second roster RPC.
--
-- Return-shape change, not just a body fix — same reasoning as every other
-- "drop, don't just replace" note in this codebase's history (Postgres
-- won't let create-or-replace change a RETURNS TABLE column set).
-- ============================================================

begin;

drop function if exists get_season_roster(text, text, bigint);

create function get_season_roster(p_name text, p_pin text, p_season_id bigint)
returns table(player_id uuid, name text, added_at timestamptz)
language plpgsql security definer set search_path = public, extensions as $$
declare pl players; v_league_id bigint;
begin
  pl := _auth_player(p_name, p_pin);
  select b.league_id into v_league_id from seasons s join brackets b on b.id = s.bracket_id where s.id = p_season_id;
  if v_league_id is null then raise exception 'Season not found'; end if;
  if not pl.is_global_admin and not exists (
    select 1 from league_members lm where lm.league_id = v_league_id and lm.player_id = pl.id
  ) then
    raise exception 'Not a member of this league';
  end if;
  return query
    select sr.player_id, p.name, sr.added_at
    from season_rosters sr
    join players p on p.id = sr.player_id
    where sr.season_id = p_season_id;
end $$;

revoke all on function get_season_roster(text,text,bigint) from public;
grant execute on function get_season_roster(text,text,bigint) to anon, authenticated;

commit;

-- ============================================================
-- VERIFICATION
-- ============================================================
-- select * from get_season_roster('NAME', 'PIN', <season_id>);
--   Expect: one row per roster member, each with a non-null name.
