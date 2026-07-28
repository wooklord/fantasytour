-- ============================================================
-- FANTASY EGGY — STAGE C2a SMOKE TEST
-- ============================================================
-- Run this AFTER sql/stage_c2a_rpcs.sql (and, if applying fresh,
-- stage_c2a_fix_ambiguous_player_id.sql) has been applied successfully.
-- Fill in v_name/v_pin with your real Ambassadors admin name/PIN below, then
-- run this whole file. Results come back as a table (the final select),
-- same convention as stage_c1_smoke_test.sql.
--
-- Note on tests 6/7 below: can_submit_picks's Official result depends on
-- whether an Official season currently covers the chosen show — which is
-- legitimate state that changes over time (e.g. once an admin creates one).
-- Those two rows report the actual value returned rather than asserting a
-- fixed expectation, so this file stays meaningful to re-run later instead
-- of going stale the first time a season exists.
--
-- Note on tests 2/2b: get_bracket_scores's membership-check bug ("column
-- reference player_id is ambiguous") only triggered for a caller whose
-- is_global_admin is false — the guard is `not pl.is_global_admin and not
-- exists(...)`, and boolean AND short-circuits, so a global admin never
-- reaches the ambiguous subquery at all. These tests are only meaningful
-- coverage of that path if v_name/v_pin is a plain league admin, not a
-- global one — true for the real account this shipped against, but worth
-- knowing if you ever fill this in with a global admin's credentials
-- instead: a PASS there wouldn't prove much. Both the no-show-id and
-- with-show-id call shapes are exercised (2 and 2b) — they share identical
-- query text today, so neither would currently hide a bug the other
-- catches, but it's cheap insurance against a future edit that only
-- touches one shape.
--
-- What this writes to production, and removes before it finishes:
--   - Test 8 inserts one real `picks` row (your player, Casual bracket, the
--     soonest upcoming Ambassadors show with an open cutoff, slot 'opener',
--     songname 'Test Song') — deleted in the cleanup step below. Nothing
--     else in this file writes anything (all other tests are reads).

create temp table if not exists smoke_results_c2a (seq int, test text, result text, detail text);
truncate table smoke_results_c2a;

do $$
declare
  v_name text := 'NAME';   -- <-- fill in your real Ambassadors admin name
  v_pin  text := 'PIN';    -- <-- fill in your real PIN
  v_league_id    bigint;
  v_casual_id    bigint;
  v_official_id  bigint;
  v_show_id      bigint;
  v_player_id    uuid;
  v_rows         int;
  v_gate         record;
  v_opt_in       boolean;
begin
  select id into v_league_id from leagues where name = 'Ambassadors';
  select id into v_casual_id   from brackets where league_id = v_league_id and kind = 'casual';
  select id into v_official_id from brackets where league_id = v_league_id and kind = 'official';
  select id into v_player_id from players where lower(name) = lower(trim(v_name));
  select ls.show_id into v_show_id
    from league_shows ls
    where ls.league_id = v_league_id and ls.cutoff_at > now() and ls.status <> 'final'
    order by ls.cutoff_at asc limit 1;

  if v_league_id is null then
    insert into smoke_results_c2a values (0, 'setup', 'FAIL', 'Ambassadors league not found');
  elsif v_player_id is null then
    insert into smoke_results_c2a values (0, 'setup', 'FAIL', format('player "%s" not found — check the name', v_name));
  elsif v_show_id is null then
    insert into smoke_results_c2a values (0, 'setup', 'FAIL', 'no upcoming Ambassadors show with an open cutoff found');
  else
    insert into smoke_results_c2a values (0, 'setup', 'PASS',
      format('league_id=%s casual_id=%s official_id=%s show_id=%s', v_league_id, v_casual_id, v_official_id, v_show_id));

    -- 1. get_league_shows returns rows for this league
    begin
      select count(*) into v_rows from get_league_shows(v_league_id);
      insert into smoke_results_c2a values (1, 'get_league_shows returns rows', case when v_rows > 0 then 'PASS' else 'FAIL' end,
        format('%s row(s)', v_rows));
    exception when others then
      insert into smoke_results_c2a values (1, 'get_league_shows returns rows', 'FAIL', sqlerrm);
    end;

    -- 2. get_bracket_scores, no p_show_id (the shape standings.js calls) —
    --    this exact call is what raised "column reference player_id is
    --    ambiguous" in production before the fix. It was never exercised by
    --    this smoke test at all in the version that shipped with the bug;
    --    it is now.
    begin
      select count(*) into v_rows from get_bracket_scores(v_name, v_pin, v_casual_id);
      insert into smoke_results_c2a values (2, 'get_bracket_scores callable (no show_id)', 'PASS', format('%s row(s)', v_rows));
    exception when others then
      insert into smoke_results_c2a values (2, 'get_bracket_scores callable (no show_id)', 'FAIL', sqlerrm);
    end;

    -- 2b. get_bracket_scores, WITH p_show_id (the shape picks.js's score
    --     breakdown calls) — same query text either way (the p_show_id
    --     is null or... predicate doesn't change which columns are
    --     referenced), so this wouldn't have hidden a *different* bug from
    --     test 2 today, but it's cheap insurance against a future edit that
    --     adds show-id-specific logic and reintroduces an unqualified
    --     reference only on this path.
    begin
      select count(*) into v_rows from get_bracket_scores(v_name, v_pin, v_casual_id, v_show_id);
      insert into smoke_results_c2a values (3, 'get_bracket_scores callable (with show_id)', 'PASS', format('%s row(s)', v_rows));
    exception when others then
      insert into smoke_results_c2a values (3, 'get_bracket_scores callable (with show_id)', 'FAIL', sqlerrm);
    end;

    -- 4. get_bracket_seasons doesn't error (0 rows is a valid, expected answer post-wipe)
    begin
      select count(*) into v_rows from get_bracket_seasons(v_official_id);
      insert into smoke_results_c2a values (4, 'get_bracket_seasons callable', 'PASS', format('%s season(s)', v_rows));
    exception when others then
      insert into smoke_results_c2a values (4, 'get_bracket_seasons callable', 'FAIL', sqlerrm);
    end;

    -- 5. my_leagues returns the new official_opt_in column, non-null
    begin
      select official_opt_in into v_opt_in from my_leagues(v_name, v_pin) where bracket_id = v_casual_id;
      insert into smoke_results_c2a values (5, 'my_leagues returns official_opt_in', case when v_opt_in is not null then 'PASS' else 'FAIL' end,
        format('official_opt_in=%s', v_opt_in));
    exception when others then
      insert into smoke_results_c2a values (5, 'my_leagues returns official_opt_in', 'FAIL', sqlerrm);
    end;

    -- 6. can_submit_picks — Casual should always be ok=true
    begin
      select * into v_gate from can_submit_picks(v_name, v_pin, v_casual_id, v_show_id);
      insert into smoke_results_c2a values (6, 'can_submit_picks: Casual', case when v_gate.ok then 'PASS' else 'FAIL' end,
        format('ok=%s reason=%s', v_gate.ok, v_gate.reason));
    exception when others then
      insert into smoke_results_c2a values (6, 'can_submit_picks: Casual', 'FAIL', sqlerrm);
    end;

    -- 7. can_submit_picks — Official: reports the actual result (see header note)
    begin
      select * into v_gate from can_submit_picks(v_name, v_pin, v_official_id, v_show_id);
      insert into smoke_results_c2a values (7, 'can_submit_picks: Official', 'INFO',
        format('ok=%s reason=%s', v_gate.ok, v_gate.reason));
    exception when others then
      insert into smoke_results_c2a values (7, 'can_submit_picks: Official', 'FAIL', sqlerrm);
    end;

    -- 8. submit_picks to Casual still works after the body re-touch (writes a real pick row, cleaned up below)
    begin
      perform submit_picks(v_name, v_pin, v_casual_id, v_show_id,
        '[{"slot":"opener","songname":"Test Song"}]'::jsonb);
      insert into smoke_results_c2a values (8, 'submit_picks to Casual still succeeds', 'PASS', null);
    exception when others then
      insert into smoke_results_c2a values (8, 'submit_picks to Casual still succeeds', 'FAIL', sqlerrm);
    end;

    -- ---- cleanup: remove the one thing this block wrote ----
    delete from picks where player_id = v_player_id and bracket_id in (v_casual_id, v_official_id)
      and show_id = v_show_id and slot = 'opener' and songname = 'Test Song';
    insert into smoke_results_c2a values (9, 'cleanup', 'PASS', 'removed the test pick row');
  end if;
end $$;

select seq as "#", test, result, detail from smoke_results_c2a order by seq;
