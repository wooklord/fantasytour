# Booting a player mid-season does not stop zero accrual (removed_at fix)

> Extracted verbatim from `CLAUDE.md` at commit 54a5ab8 (2026-10-18), original lines 3796–3876. Nested entries were de-indented to top level; wording is unchanged.
> Decision record — currently binding. `CLAUDE.md` holds only a pointer stub under the same entry name; this file is the full text and rationale.

**BUG (behavioural, with wrong documentation attached): BOOTING A PLAYER
MID-SEASON DOES NOT STOP THEM ACCRUING — THEY KEEP TAKING ZEROS IN
OFFICIAL'S TIEBREAKER FOR THE REST OF THE SEASON.** Found 2026-08-17.
`admin_league_boot` does not remove the player from `season_rosters`, and
standings computes zeros from roster membership rather than from score
rows. **Two places in this codebase currently state the opposite**, which
is why this is filed as a bug and not a nuance:
- `admin_league_boot`'s own SQL comment — *"picks/scores in this league are
  left untouched (frozen-roster rule: a booted player's season line
  persists, **they just stop accruing**)"*.
- The frontend confirm text (`admin.js:578`) — *"Their past picks/scores
  stay on the books — **they just stop being able to submit new ones**."*
Both are true about *points* and false about *zeros*. The accurate
statement: they stop accruing points and keep accruing zeros, which is
worse than freezing rather than equivalent to it.
- **This reverses the "Boot is recoverable" framing reached earlier the
  same evening.** That framing was about the *player* — re-add them, unban
  if needed, and their access is restored. It does not extend to their
  **standings position**: every zero taken while they sat booted on the
  roster stays in the fewest-zeros computation, and re-adding to
  `league_members` does not remove those zeros, because the zeros never
  came from `league_members` in the first place. Recoverable for the
  person, not for their record.
- Boot's only destructive statement is `delete from league_members`. The
  tables that carry gameplay are all untouched: `picks`, `scores`, and
  crucially `season_rosters`. Nothing cascades off `league_members`.
- The edge function is not where this bites — `scoreBracket` filters
  *picks* by roster membership (`index.ts:701`), so a rostered player with
  no picks simply gets no `scores` row.
- **Standings is where it bites.** `computeStandings` takes `rosterIds` —
  "every player_id on the season's roster" — and the fewest-zeros layer
  counts any in-scope show worth 0 points *including one never picked at
  all*, scoped from `added_at`. A booted player is still on the roster, so
  every subsequent show in that season scores as a zero against them.
- **So "remove from league" and "stop accruing in Official" are two
  different operations, in two different admin sections** — Members ▸ Boot,
  and Seasons ▸ manage roster (`admin_set_season_roster`, remove branch).
  Boot's confirm text ("Their past picks/scores stay on the books — they
  just stop being able to submit new ones") is true as far as it goes and
  implies the second happened. It didn't.
- **REJECTED FIX, recorded so it isn't re-proposed as the obvious one:
  having `admin_league_boot` also delete the player's `season_rosters` row.
  It does not work and makes things worse.** `computeStandings` builds its
  player table `T` from `scoreRows` FIRST (`tiebreak.js:51`) and adds
  `rosterIds` only second (`:58`), then runs the zeros loop over
  `Object.keys(T)` (`:68`). So any player with a final-show score row
  anywhere in that bracket's history is in `T` permanently, roster or not —
  deleting the roster row leaves the zeros counting exactly as before. And
  it drops `rosterJoinDates[playerId]`, so `lo` falls back to
  `season.start_date` (`:70`), which can *widen* the zero window backwards
  for a mid-season joiner. Strictly not-better, sometimes worse.
- **THE REAL FIX: a `season_rosters.removed_at` column.** The zero window
  has a lower bound (`added_at`) and no upper bound; stopping accrual needs
  one, and no current column can express it. Scope: add the column (existing
  rows correctly stay null); stamp it in `admin_league_boot` for seasons
  with `end_date >= current_date`; return it from `admin_list_season_roster`
  and the standings read; give `computeStandings` an upper bound beside
  `joinDate` so `rosterJoinDates` becomes a range; add fixtures in
  `tiebreak.test.mjs` for the bounded case. Touches SQL, a read path, core
  scoring-adjacent logic and tests — its own session, not a bolt-on.
- **GATE (state-based, not dated): build it before any league has an
  Official season that scores a show while a booted player sits on its
  roster.** Chosen state-based deliberately, because the point is that
  **Ambassadors already satisfies it** — Test, Test 2 and Test 3 have all
  activated and scored (verified 2026-08-17), so the exposure there is not
  future work. Green Eggs is the one with runway: it has zero seasons, so
  nothing can go wrong there until its first season scores.
  - **What bounds the urgency, and it is worth knowing precisely: no
    Ambassadors season is currently RUNNING.** Test 3 ended 2026-08-14;
    Test 4 (2026-09-04) and The Final Tour (2026-10-15 → 12-05) are both
    unactivated. A boot *today* is therefore clean and accrues nothing. The
    next window opens **2026-09-04**.
  - Until it is built there is no workaround — see the rejected fix above.
    The mitigation is the confirm text (shipped 2026-08-17), which names the
    running season and says plainly that nothing prevents the accrual.
- **Both wrong sentences are FIXED as of 2026-08-17**, in the same pass:
  `admin_league_boot`'s SQL comment (corrected in place in
  `sql/stage_n_reject_pending_pin_change_writes.sql`, comment only — the
  function body is byte-identical to what was executed) and the frontend
  confirm (`bootPlayer`, now three branches with mutation-tested coverage).
