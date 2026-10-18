# Multi-league switcher behavior (traced 2026-08-16)

> Extracted verbatim from `CLAUDE.md` at commit 54a5ab8 (2026-10-18), original lines 2201–2353. Nested entries were de-indented to top level; wording is unchanged.
> Decision record — currently binding. `CLAUDE.md` holds only a pointer stub under the same entry name; this file is the full text and rationale.

Traced end to end against `src/core/switcher.js` the day the second league
was created — i.e. the first time any of this could run at all. Written down
because two of the three findings are counterintuitive and the third is an
unstated assumption the code silently depends on.

- **✅ LARGELY FIXED 2026-08-20 for the case that mattered — the NO-LEAGUE
  screen now polls and updates itself.** `renderNoLeague()` starts a 15s
  poll of `my_leagues` and re-runs `boot()` the moment membership appears,
  plus a `visibilitychange` handler so foregrounding checks IMMEDIATELY —
  which is the real-world sequence (they message an admin, get added, switch
  back). No reload, no button press.
  - **Polling here costs nothing for anyone already in a league**, because
    the screen never renders for them. That is precisely why it lives here
    rather than in `refreshCurrent()`, which every session runs on every
    foreground.
  - **It calls `my_leagues` directly, NOT `resolveLeagues()`** — the latter
    also rewrites `currentBracketId`/`ft_bracket_id` and does not call
    `loadConfig`/`subscribeRealtime`, so using it would half-transition the
    session. Confirm membership, then re-run `boot()`, which is already
    correct.
  - **Bounded three ways**: skipped entirely while `document.hidden` (a tab
    left open overnight makes no requests and burns no budget), a 40-attempt
    cap on foreground polls, and a stop after 3 consecutive failures. Each
    terminal state updates `#nl-status` and points at Check again — silently
    spinning while claiming to check would be the worst outcome.
  - **How it is tested, and why the obvious assertion would NOT have
    worked.** `runNoLeaguePollTimersScenario` stubs `window.setInterval` /
    `clearInterval` before `window.eval` (the `installGlobals` seam runs
    first), captures the callback and counts clears. Timers are stubbed
    rather than `pollNoLeague` being exported: exporting it would prove the
    body while proving nothing about the interval.
    - **Mechanism note that makes the assertion possible: the poll calls
      `boot()` DIRECTLY, not `location.reload()`.** The Check again *button*
      reloads; the poll transitions in place. So nothing about navigation is
      observable either way, and the only external evidence that polling
      stopped is a `clearInterval` call. That is why the assertion counts
      them.
    - **Mutations, each by name and what it pins:**
      - **`document.hidden` guard removed** → fails *"a hidden tab makes no
        my_leagues request at all"*. Pins the abandoned-overnight case.
      - **cap check (`nlPolls >= NO_LEAGUE_MAX_POLLS`) removed** → fails
        *"the attempt cap stops polling and says so"* AND *"the attempt cap
        actually bounds the requests"*. Pins both that it stops and that it
        says so, with Check again surviving as the manual fallback.
      - **`stopNoLeaguePolling()` removed from the success path** → fails
        *"a successful poll clears the interval, not just transitions"*.
        **This is the instructive one.** Under that mutation the app is
        VISIBLY correct — `boot()` runs, the tabs appear, the no-league
        screen is gone — and the only defect is an orphaned interval firing
        against a replaced DOM. Phrased the natural way ("after a successful
        poll the app is no longer on the no-league screen") the assertion
        would have passed green with the bug present.
    - The cap assertion deliberately does not encode
      `NO_LEAGUE_MAX_POLLS`: it fires 400 ticks and requires far fewer
      calls, so the constant moved 40 → 120 without a test edit.
    - **jsdom detail worth not rediscovering: `document.hidden` is its own
      getter there, NOT derived from `visibilityState`.** Overriding
      `visibilityState` alone leaves `hidden === false` and the guard never
      trips. Both must be defined — found by this assertion failing at
      baseline, and recorded so nobody copies the one-property idiom from
      `runNonAdminScenario` and gets a silently passing test.
  - **Known untested consequence:** the `rows && rows.length` guard before
    `boot()` is NOT a correctness gate (boot re-checks membership anyway) —
    its real job is preventing a teardown-and-rebuild per poll. Since
    `renderNoLeague()` restarts polling, losing that guard resets `nlPolls`
    every tick and **the 40-attempt cap never fires**. Verified by mutation
    that no assertion catches this; testing it needs 40 polls or an exposed
    counter, so it is recorded rather than covered.
  - **What this does NOT fix**: a player added to a SECOND league
    mid-session, or REMOVED from one. Both still need a reload, and removal
    is entirely unhandled — see the scoping note below.
- **🚨 STILL TRUE FOR THE OTHER CASES — a player already in a league who is
  added to another, or removed, must FULLY RELOAD the
  app before that league appears. Nothing refreshes it in the background.
  Expect this to be the single most common support question during Facebook
  League recruitment, and note that neither new league admin will have any
  way to guess the cause** — from the player's side the app simply doesn't
  show the league they were just told they're in, with no error and no
  pending state.
  - **The call chain, so nobody re-derives it:** `state.leagues` is
    populated only by `resolveLeagues()` (`switcher.js:48`), whose sole
    caller is `session.js:66` inside `boot()`, whose sole caller is
    `main.js:33` at page load. That is the entire graph — verified by
    grep, not assumed.
  - **Backgrounding and returning does NOT work, and this is the part that
    makes it confusing.** The `visibilitychange` listener
    (`realtime.js:109`) calls `refreshCurrent()`, which re-renders the
    current tab and refetches shows/scores — so the app visibly *does*
    update on foreground, just never its league list. Something that looks
    like a refresh happens and the league still isn't there.
  - **For PWA users, "reload" means fully closing and reopening the app**,
    not switching back to it. There is no in-app reload control on the
    normal path (the only `location.reload()` is on `boot()`'s error
    screen).
  - Same applies to a player being *removed* from a league — their open
    session keeps showing it until they reload.
  - Worth telling the two league admins explicitly as part of handing them
    the role: "after you add someone, tell them to close the app completely
    and reopen it."
- **The league selector is ABSENT, not disabled, for a single-league
  player** — `renderLeagueSelector()` returns early with
  `el.innerHTML = ""` when `leagueIds.length <= 1` (`switcher.js:93`). It
  renders into `#leagueSelect` inside `settingsPanelHtml()`
  (`settings.js:16`), which for an admin sits at the very BOTTOM of the
  Admin tab, below the Data section. So "I don't see a league dropdown" is
  the expected single-league state, not a bug.
- **`switchToBracket` resets the tab**: `state.tab = "shows"` and
  `state.currentShow = null` (`switcher.js:110`), deliberately, so an open
  pick sheet isn't carried across. Consequence worth knowing —
  **switching leagues from the bottom of the Admin tab bounces you to
  Shows.**
- **The stale-`ft_bracket_id` failure everyone predicts does NOT exist —
  don't "fix" it.** The intuition is that a localStorage bracket id from
  the other league would leave the app pointing at a bracket that isn't in
  the league it thinks it's in. It can't: `resolveLeagues` resolves the
  saved value with `state.leagues.find(l => l.bracket_id === saved)`
  (`switcher.js:52`) — a lookup **against the membership list**, not a bare
  read — so an id from a league the player isn't in is simply not found,
  and it falls through to `defaultBracketFor(...)`. When it *is* found,
  `currentBracketId` and `currentLeagueId` are set from the SAME row
  (lines 54-55), so the pair cannot desync. This is correct by
  construction, not by an explicit guard someone might later remove as
  redundant.
- **Real two-league wrinkle, in the fallback: a stale saved bracket lands
  the player in the ALPHABETICALLY FIRST league, not their own.**
  `defaultBracketFor(state.leagues[0].league_id)` (`switcher.js:53`) takes
  `leagues[0]`, and `my_leagues` orders by `l.name, b.kind` — so
  "Ambassadors" sorts ahead of "Facebook League" and an FB player who
  belongs to both gets dropped into Ambassadors. **Only reachable when the
  saved value is invalid** (bracket deleted, player removed from that
  league, or localStorage cleared/copied between origins) — a valid saved
  choice always wins, so this is not the everyday path. Low severity, but
  it is the one place a second league produces a non-obvious result.
- **STRUCTURAL DEPENDENCY, nowhere documented at the point of use: bracket
  ids are GLOBALLY unique, not per-league** (`bigserial` on `brackets` in
  `sql/stage_a_schema.sql`). That is the entire reason a single
  `ft_bracket_id` key can identify both the bracket AND the league — every
  lookup above recovers `league_id` by finding the bracket row. If brackets
  were ever renumbered per-league, or if a bracket id were ever reused,
  every one of those lookups breaks silently rather than erroring.
  - **This is also what `switchToLeague`'s missing error path quietly rests
    on.** `switchToLeague` (`switcher.js:120`) holds no state of its own —
    it picks a bracket and delegates entirely to `switchToBracket`, which
    early-returns on `!row || bracketId === state.currentBracketId`. If
    that guard ever fired, the `<select>` would already be displaying the
    new league while `currentLeagueId` never changed — a silent desync with
    no toast and no thrown error. It is unreachable **only** because
    bracket ids are globally unique (so the id-equality guard can't be true
    across two different leagues) and because `global_create_league` always
    seeds exactly two brackets (so `pick` is never undefined). The function
    asserts neither.
