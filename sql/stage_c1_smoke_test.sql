-- ============================================================
-- FANTASY EGGY — STAGE C1 SMOKE TEST
-- ============================================================
-- Run this AFTER sql/stage_c1_rpcs.sql has been applied successfully.
-- Fill in v_name/v_pin with your real Ambassadors admin name/PIN below, then
-- run this whole file. Everything else (league/bracket/show IDs) is resolved
-- automatically. Results come back as a table (last statement below) — one
-- row per test, with PASS/FAIL and the underlying message — instead of
-- `raise notice`, since the SQL editor only surfaces result sets.
--
-- Safe to re-run in the same editor session: the temp table is
-- truncated at the top of every run.
--
-- What this writes to production, and removes before it finishes:
--   - Test 2 inserts one real `picks` row (your player, Casual bracket, the
--     soonest upcoming Ambassadors show with an open cutoff, slot 'opener',
--     songname 'Test Song') — deleted in the cleanup step below.
--   - Test 4 temporarily bans YOUR OWN name in `banned_names` for Ambassadors
--     (self-contained: doesn't require any other player to exist) — removed
--     immediately after test 4's assertion, not deferred to the final
--     cleanup step, to keep the window it's live as small as possible.
--   - Test 5 may flip your own `official_opt_in` flag for Ambassadors true —
--     NOT reverted automatically (no active season exists yet post-Stage-A,
--     so the lock never engages and this call is expected to succeed; the
--     flag itself is low-stakes and easy to flip back if you don't want it
--     set). Nothing else in this file is left behind.
-- If setup can't resolve the league/player/show, everything below is
-- skipped — you'll see a single FAIL row explaining why, and nothing gets
-- written at all.

create temp table if not exists smoke_results (seq int, test text, result text, detail text);
truncate table smoke_results;

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
begin
  select id into v_league_id from leagues where name = 'Ambassadors';
  select id into v_casual_id   from brackets where league_id = v_league_id and kind = 'casual';
  select id into v_official_id from brackets where league_id = v_league_id and kind = 'official';
  select id into v_player_id from players where lower(name) = lower(trim(v_name));
  select ls.show_id into v_show_id
    from league_shows ls
    where ls.league_id = v_league_id and ls.cutoff_at > now() and ls.status <> 'final'
    order by ls.cutoff_at asc limit 1;

  -- Nothing below has written anything yet — if setup can't resolve real
  -- IDs, record one FAIL row and skip every test rather than raising (a
  -- raised exception here would abort the whole DO block and you'd get no
  -- result table at all).
  if v_league_id is null then
    insert into smoke_results values (0, 'setup', 'FAIL', 'Ambassadors league not found');
  elsif v_player_id is null then
    insert into smoke_results values (0, 'setup', 'FAIL', format('player "%s" not found — check the name', v_name));
  elsif v_show_id is null then
    insert into smoke_results values (0, 'setup', 'FAIL', 'no upcoming Ambassadors show with an open cutoff found');
  else
    insert into smoke_results values (0, 'setup', 'PASS',
      format('league_id=%s casual_id=%s official_id=%s show_id=%s', v_league_id, v_casual_id, v_official_id, v_show_id));

    -- 1. my_leagues returns both Ambassadors brackets
    begin
      select count(*) into v_rows from my_leagues(v_name, v_pin) where league_id = v_league_id;
      insert into smoke_results values (1, 'my_leagues returns both brackets',
        case when v_rows = 2 then 'PASS' else 'FAIL' end,
        format('returned %s Ambassadors row(s), expected 2', v_rows));
    exception when others then
      insert into smoke_results values (1, 'my_leagues returns both brackets', 'FAIL', sqlerrm);
    end;

    -- 2. submit_picks to Casual succeeds (writes a real picks row, cleaned up below)
    begin
      perform submit_picks(v_name, v_pin, v_casual_id, v_show_id,
        '[{"slot":"opener","songname":"Test Song"}]'::jsonb);
      insert into smoke_results values (2, 'submit_picks to Casual succeeds', 'PASS', null);
    exception when others then
      insert into smoke_results values (2, 'submit_picks to Casual succeeds', 'FAIL', sqlerrm);
    end;

    -- 3. submit_picks to Official fails with the no-season error (expected failure)
    begin
      perform submit_picks(v_name, v_pin, v_official_id, v_show_id,
        '[{"slot":"opener","songname":"Test Song"}]'::jsonb);
      insert into smoke_results values (3, 'submit_picks to Official fails (no season)', 'FAIL',
        'succeeded unexpectedly — expected the no-season error');
    exception when others then
      insert into smoke_results values (3, 'submit_picks to Official fails (no season)', 'PASS', sqlerrm);
    end;

    -- 4. admin_add_league_member refuses a banned name (expected failure) —
    --    bans the caller's own name temporarily, self-contained. Cleanup is
    --    inline, right after the assertion, not deferred to the end of the
    --    block — this is a real (if narrow) ban on your own name, and any
    --    failure between insert and delete would otherwise leave it in place
    --    silently until it surfaced as a baffling "can't add myself to
    --    another league" months later.
    insert into banned_names (league_id, name) values (v_league_id, lower(v_name)) on conflict do nothing;
    begin
      perform admin_add_league_member(v_name, v_pin, v_league_id, v_player_id);
      insert into smoke_results values (4, 'admin_add_league_member refuses banned name', 'FAIL', 'succeeded unexpectedly');
    exception when others then
      insert into smoke_results values (4, 'admin_add_league_member refuses banned name', 'PASS', sqlerrm);
    end;
    delete from banned_names where league_id = v_league_id and name = lower(v_name);

    -- 5. set_official_opt_in succeeds (no active season exists post-wipe)
    begin
      perform set_official_opt_in(v_name, v_pin, v_league_id, true);
      insert into smoke_results values (5, 'set_official_opt_in succeeds', 'PASS', null);
    exception when others then
      insert into smoke_results values (5, 'set_official_opt_in succeeds', 'FAIL', sqlerrm);
    end;

    -- ---- cleanup: remove everything else this block wrote ----
    -- Matches BOTH brackets, not just Casual: if test 3 unexpectedly
    -- succeeds (e.g. an Official season already covers v_show_id),
    -- submit_picks would write a real row under v_official_id instead of
    -- raising — this still removes it. (The banned_names row from test 4 is
    -- already removed above.)
    delete from picks where player_id = v_player_id and bracket_id in (v_casual_id, v_official_id)
      and show_id = v_show_id and slot = 'opener' and songname = 'Test Song';
    insert into smoke_results values (6, 'cleanup', 'PASS',
      'removed the test pick row(s); the temporary self-ban was already removed after test 4');
  end if;
end $$;

select seq as "#", test, result, detail from smoke_results order by seq;
