-- Stage D: season standings tiebreaker system. Config lives on the Official
-- bracket's config.tiebreakers — an ordered array (0-3, no dupes) of
-- 'fewest_zeros' | 'most_wins' | 'highest_single_show'. Resolution itself is
-- client-side (src/core/tiebreak.js) — get_bracket_scores/get_league_shows/
-- get_bracket_seasons already carry everything else standings.js needs; the
-- only gap was per-player roster-join dates, which this file adds.
--
-- season_rosters gets a join-date column back. added_at was deliberately
-- dropped earlier (mid-season fairness was meant to be handled by humans,
-- not code) — but "fewest zeros" needs to know a mid-season add's scope
-- starts at their join date, not the season's start_date, or they'd
-- unfairly eat zeros for shows that happened before they were even allowed
-- to submit picks (submit_picks already blocks that).
begin;

alter table season_rosters add column if not exists added_at timestamptz;

-- Backfill: no historical record of real join times exists (the column
-- didn't exist yet), so every existing row backfills to its season's
-- start_date — the honest, no-evidence-of-a-late-add default. Deliberately
-- NOT inferred from picks.updated_at: a player's earliest submission is when
-- they first voted, not when they gained roster access — someone on the
-- roster from day one who simply didn't vote until show 3 would misread as
-- a late add and get an unearned zeros advantage.
update season_rosters sr
  set added_at = s.start_date::timestamptz
  from seasons s
  where sr.season_id = s.id and sr.added_at is null;

alter table season_rosters alter column added_at set not null;
alter table season_rosters alter column added_at set default now();

-- Both insert paths into season_rosters (activateSeasons()'s bulk snapshot
-- in the edge function, and this override) now stamp added_at explicitly
-- rather than leaning on the column default alone. Body-only change (same
-- signature as stage_c1_rpcs.sql) — plain create-or-replace is safe here.
create or replace function admin_set_season_roster(p_name text, p_pin text, p_season_id bigint, p_player_id uuid, p_add boolean)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare pl players; v_league_id bigint;
begin
  pl := _auth_player(p_name, p_pin);
  select b.league_id into v_league_id from seasons s join brackets b on b.id = s.bracket_id where s.id = p_season_id;
  if v_league_id is null then raise exception 'Season not found'; end if;
  if not _is_league_admin_or_global(pl.id, v_league_id) then raise exception 'League admins only'; end if;
  if p_add then
    insert into season_rosters (season_id, player_id, added_at) values (p_season_id, p_player_id, now())
      on conflict do nothing;
  else
    delete from season_rosters where season_id = p_season_id and player_id = p_player_id;
  end if;
  return json_build_object('ok', true);
end $$;

-- New read RPC: standings needs every tied player's roster join date to
-- scope the "fewest zeros" layer, but admin_list_season_roster (Stage C2b)
-- is admin-gated by design — this is for every league member, same
-- membership guard as get_bracket_scores (genuinely checked, not the
-- unauthenticated-helper gap C2a review caught elsewhere).
create or replace function get_season_roster(p_name text, p_pin text, p_season_id bigint)
returns table(player_id uuid, added_at timestamptz)
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
  return query select sr.player_id, sr.added_at from season_rosters sr where sr.season_id = p_season_id;
end $$;

grant execute on function get_season_roster(text,text,bigint) to anon, authenticated;

commit;

-- ============================================================
-- VERIFICATION
-- ============================================================
-- select season_id, player_id, added_at from season_rosters order by season_id;
--   Expect: every row has a non-null added_at; pre-existing rows equal
--   their season's start_date (cast to timestamptz).
--
-- select proname, pg_get_function_identity_arguments(oid) from pg_proc
--   where proname = 'get_season_roster';
--   Expect: one row, (text,text,bigint).
--
-- Confirm the membership guard is real, same check C2a review demanded of
-- get_bracket_scores: call get_season_roster with a valid name+PIN for a
-- player who is NOT a member of that season's league and confirm it raises
-- "Not a member of this league" rather than returning rows.
