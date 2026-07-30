-- ============================================================
-- FANTASY EGGY — STAGE C2b: member management (list / find / roster read)
-- ============================================================
-- Run ONCE in the Supabase SQL Editor, after sql/stage_c2a_rpcs.sql (already
-- run). Adds the read-side RPCs the C2b admin "Members" panel needs — every
-- mutation it calls (admin_add_league_member, admin_league_boot,
-- admin_list_bans, admin_unban, admin_set_season_roster) already exists from
-- Stage C1; this file only fills the missing reads.
--
-- Why these didn't exist yet: the pre-2.0 "Players" panel read the app-wide
-- players_public view directly (no league scoping existed to need an RPC).
-- Stage A trimmed that view to id/name/created_at and left no public read on
-- league_members, so the panel has been listing EVERY registered player
-- app-wide ever since, with a Boot button that silently no-ops for anyone
-- who isn't actually in the current league. These RPCs replace that.
--
-- Gating: all three are admin-only (_is_league_admin_or_global, from
-- sql/stage_c1_rpcs.sql), same posture as admin_pick_status/admin_list_bans —
-- join dates and opt-in status aren't shown to plain members.
-- ============================================================

begin;

-- ============================================================
-- SECTION 1 — LIST MEMBERS (replaces the app-wide players_public read)
-- ============================================================

create or replace function admin_list_members(p_name text, p_pin text, p_league_id bigint)
returns table(player_id uuid, name text, joined_at timestamptz,
              is_league_admin boolean, official_opt_in boolean)
language plpgsql security definer set search_path = public, extensions as $$
declare pl players;
begin
  pl := _auth_player(p_name, p_pin);
  if not _is_league_admin_or_global(pl.id, p_league_id) then raise exception 'League admins only'; end if;
  return query
    select p.id, p.name, lm.joined_at, lm.is_league_admin, lm.official_opt_in
    from league_members lm
    join players p on p.id = lm.player_id
    where lm.league_id = p_league_id
    order by p.name;
end $$;

-- ============================================================
-- SECTION 2 — FIND PLAYERS (discovery for "add a member")
-- ============================================================
-- Prefix match, minimum query length enforced server-side (not just in the
-- UI — a direct RPC call can't bypass it), capped result count. Excludes
-- players already in this league. See CLAUDE.md / the C2b plan for the
-- privacy tradeoff this accepts (a capped prefix search still allows slow
-- enumeration by an admin iterating single letters) versus the alternative
-- (exact-name-only, which closes that off but breaks on any typo/case
-- mismatch) — accepted given the small, admin-adds-you trust model this app
-- already runs on.
create or replace function admin_find_players(p_name text, p_pin text, p_league_id bigint, p_query text)
returns table(player_id uuid, name text)
language plpgsql security definer set search_path = public, extensions as $$
declare pl players; q text := trim(coalesce(p_query, ''));
begin
  pl := _auth_player(p_name, p_pin);
  if not _is_league_admin_or_global(pl.id, p_league_id) then raise exception 'League admins only'; end if;
  if length(q) < 2 then raise exception 'Enter at least 2 characters'; end if;
  return query
    select p.id, p.name
    from players p
    where p.name ilike q || '%'
      and not exists (
        select 1 from league_members lm where lm.league_id = p_league_id and lm.player_id = p.id
      )
    order by p.name
    limit 8;
end $$;

-- ============================================================
-- SECTION 3 — SEASON ROSTER READ (feeds the opt-in override UI)
-- ============================================================
-- admin_set_season_roster (the mutation) already exists from Stage C1; this
-- is just the read the frontend needs to know current roster membership
-- before rendering add/remove controls per league member.
create or replace function admin_list_season_roster(p_name text, p_pin text, p_season_id bigint)
returns table(player_id uuid)
language plpgsql security definer set search_path = public, extensions as $$
declare pl players; v_league_id bigint;
begin
  pl := _auth_player(p_name, p_pin);
  select b.league_id into v_league_id from seasons s join brackets b on b.id = s.bracket_id where s.id = p_season_id;
  if v_league_id is null then raise exception 'Season not found'; end if;
  if not _is_league_admin_or_global(pl.id, v_league_id) then raise exception 'League admins only'; end if;
  return query select sr.player_id from season_rosters sr where sr.season_id = p_season_id;
end $$;

-- ============================================================
-- SECTION 4 — GRANTS
-- ============================================================

grant execute on function admin_list_members(text,text,bigint) to anon, authenticated;
grant execute on function admin_find_players(text,text,bigint,text) to anon, authenticated;
grant execute on function admin_list_season_roster(text,text,bigint) to anon, authenticated;

commit;

-- ============================================================
-- SECTION 5 — VERIFICATION (run these AFTER; all should look sane)
-- ============================================================
-- select proname, pg_get_function_identity_arguments(oid) as args
-- from pg_proc
-- where pronamespace = 'public'::regnamespace
--   and proname in ('admin_list_members','admin_find_players','admin_list_season_roster')
-- order by proname;
-- Expect: 3 rows.
--
-- Fill in your real Ambassadors admin name/PIN and a league_id to smoke-test:
-- select * from admin_list_members('NAME','PIN', <league_id>);
-- select * from admin_find_players('NAME','PIN', <league_id>, 'a');  -- expect the length error
-- select * from admin_find_players('NAME','PIN', <league_id>, 'wo'); -- expect real matches, minus current members
