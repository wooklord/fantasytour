# 2026-08-17: mutation-tested scenarios (boot, roster, no-league)

> Extracted verbatim from `CLAUDE.md` at commit 54a5ab8 (2026-10-18), original lines 352–434. Nested entries were de-indented to top level; wording is unchanged.
> Historical record — resolved, closed or superseded. Kept for its method and evidence. Not a current instruction.

**`runBootScenario` (added 2026-08-17) covers bootPlayer's three confirm
branches, and was mutation-tested rather than assumed.** Boot is the control
whose dialog is the only warning that exists — whether an Official season is
RUNNING at boot time decides whether the player keeps taking zeros for the
rest of it, and nothing in the app undoes that (see the boot bug entry
below). Results, worth keeping because they show which assertions are
load-bearing:
- **Mutation A — drop the `return` in `bootPlayer`'s catch:** 2 of case 3's
  3 assertions fail ("shows NO confirm at all", "does NOT call
  admin_league_boot"). The toast assertion correctly keeps passing, because
  `toast()` sits *before* the `return` — removing the return doesn't remove
  the toast. Those three are deliberately separate for exactly this reason:
  collapsed into one, "the boot proceeded" would be indistinguishable from
  "the warning vanished."
- **Mutation B — swap the two branch strings:** all 5 wording assertions
  fail across both cases. The two `booted === true` checks correctly keep
  passing, since swapping wording doesn't change whether the boot proceeds.
- **A draft assertion that would have passed under Mutation B, caught only
  by baselining first:** case 1 originally asserted `!/zero/i` on the
  no-season wording. That wording legitimately reads *"no zeros will
  accrue"*, so the word is present either way and the check discriminated
  nothing. Replaced with absence of the live-season *warning* markers
  (`fewest zeros`, `NO way to prevent`). **Baseline before mutating** — the
  bad assertion failed honestly against correct code instead of silently
  passing against broken code.
- The live season is injected inside the scenario, NOT added to
  `makeFixtures()`: the shared fixture's only season is deliberately past,
  and two unrelated checks depend on that ("Official (no covering season)
  shows the ineligible reason" and "standings defaults to All time"). Its
  dates are built off `Date.now()`, never hardcoded.

**`runRosterScenario` (added 2026-08-17) covers season-roster removal —
`setRosterMember`, the app's other destructive admin control, and the THIRD
instance of presence standing in for behaviour.** `toggleRoster(501)` was
already exercised, so the roster panel rendered and was asserted, while
`setRosterMember` was never invoked by anything and
`admin_set_season_roster`'s fake was a bare `{ok:true}` nothing reached.
Cases: unlocked removal, locked removal (extra activation sentence),
cancelled confirm, add (asserted confirm-FREE, so a future "confirm
everything" pass has to decide rather than drift), and failed lookup.
Mutation results:
- **Drop the `return` in the catch:** crashes with `TypeError: Cannot read
  properties of null (reading 'roster_locked_at')` before any assertion
  runs. Caught, but by JavaScript, not by the tests.
- **Invert the lock condition** (`!season.roster_locked_at`): both the
  locked and unlocked assertions fail. Pinned in both directions on
  purpose — a one-sided check would pass.
- **Bypass the confirm** (`if (false && !confirm(...))`): 5 assertions
  fail, and the load-bearing one is "cancelling … makes NO
  admin_set_season_roster call". The wording checks alone cannot catch a
  dialog that is *shown but whose answer is ignored*. Note the negative
  assertion ("UNLOCKED … omits the activation sentence") correctly
  survives — an empty dialog genuinely lacks the phrase, so negatives can
  never detect the dialog vanishing entirely. Positives carry that weight.
- **Soften the claim** — replace "standings edit, not a repair" with
  "restores their position": fails, and **only via the third clause of that
  assertion.** The softened text still contains `NO way to prevent` and
  `not a workaround`, so a two-clause check would have shipped it — leaving
  the dialog telling admins a remove/re-add round trip *restores* a
  player's position when it actually hands them an advantage.

**`runNoLeagueScenario` (added 2026-08-17) covers the registered-but-
league-less empty state AND the recruitment loop through it.** Every other
fixture deliberately prevents `renderNoLeague()` from firing (`p4` is given
a membership row specifically so it doesn't), so nothing was ever going to
stumble into this path. `p3` ("Wanderer") is already a registered
non-member, so no new fixture shape was needed.
- **Priority was the LOOP, not the wording**: register → admin adds you →
  reload → you are in the app. Copy can be re-read by a human at any time;
  a regression in the loop is invisible and strands every new player.
- **The reload is modelled as a second page load** — a fresh window over the
  SAME mutated `tables` — because that is exactly what `location.reload()`
  is. **SEAM, stated not hidden:** the Check again button is asserted to
  exist and to carry a `location.reload()` handler, but its click is NOT
  exercised, since jsdom does not implement navigation (that is the
  "Not implemented: navigation to another Document" line every run prints).
- **Mutation — invert `resolveLeagues`'s guard** (`!state.leagues.length` →
  `state.leagues.length`): takes down the MAIN scenario before the
  no-league checks are even reached, with `TypeError: Cannot read
  properties of null (reading 'mode')` in `slotDefs` — `state.cfg` is null
  because `boot()` returned early into `renderNoLeague()` and never ran
  `loadConfig()`. Correct blast radius for a guard this central.
