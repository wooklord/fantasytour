# Testing harness: rules and known blind spots

> Extracted verbatim from `CLAUDE.md` at commit 54a5ab8 (2026-10-18), original lines 188–351, 435–513. Nested entries were de-indented to top level; wording is unchanged.
> Decision record — currently binding. `CLAUDE.md` holds only a pointer stub under the same entry name; this file is the full text and rationale.

**`test/compare.mjs` and `legacy-index.html` are retired (Stage C2a).** That harness
diffed the current build's rendered DOM against a frozen pre-2.0 monolith, to catch
accidental behavior changes during the `index.html`-splitting refactor — its premise
was "same behavior, different file layout." Stage C2 makes the app deliberately
different (league/bracket switcher, Official gating, bracket-scoped data), so
"identical to the old build" stopped being the thing worth proving; both files were
deleted rather than kept around as a stale "reference" someone could mistake for a
spec of the old flat schema.

**What replaced it: `test/scenario.test.mjs`**, run via `npm test`. Same underlying
mechanism as before (`test/harness.mjs` + `test/fakeSupabase.mjs` stub the Supabase
client and browser globals, then `window.eval()` the real bundled `app.js` through a
scripted user flow, with a `_emit()` hook to fake Realtime pushes) — the only change
is what the run is checked against: fixed expectations instead of a second run.
`test/fixtures.mjs` is the bracket-scoped fixture data (leagues/brackets/
league_members/league_shows/seasons/season_rosters/bracket-scoped scores) the fake
RPC handlers compute real join/gating logic against, not flat pre-2.0 stubs.
`test/scoring.test.mjs` is untouched by any of this — it tests `scoring.js` in
isolation against real Carton setlist fixtures, with no DOM/Supabase dependency.

**Known limitation, still true of the new harness:** it asserts DOM structure and
JS behavior — it is still blind to CSS (computed styles, cascade interactions
between dead and live selectors), external resource loading (fonts, the Supabase CDN
script), and anything in `<head>` that isn't reflected in DOM text. One real bug
already slipped past the old version this way: a dormant `.logo span` CSS rule
(never matched anything pre-split, since `.logo` had no `<span>`) went live and
broke the header title's font styling when a `<span>` was added to that element for
the `APP_NAME` work — a PASS the whole time, because the DOM text was unchanged.
Don't treat a scenario-test PASS as proof a frontend change is visually correct —
it only proves the DOM/JS behavior didn't change. Also worth remembering when
writing fixtures: build cutoff/date fixtures off the real wall clock (`Date.now()`),
not a hardcoded date — a fixed past "now" silently drifts into the past itself and
every show reads as already-locked regardless of what the test intends to exercise
(this bit the C2a rewrite once, caught immediately by the new fixed-expectation
assertions rather than staying invisible the way a diff-only check would have).

**Session-shape blind spot, found the hard way:** every scenario in `test/harness.mjs`
presets `p1` (Wooklord) — `is_league_admin: true` in the fixture — except
`runNonAdminScenario` (added after the incident below). That meant `isCurrentLeagueAdmin()`
was `true` in literally every test ever run for this app, so any bug that only
manifests for a genuine non-admin was structurally invisible to the whole suite, not
just under-covered. This is exactly how a real bug shipped and sat unnoticed until a
non-admin tester hit it live: `core/realtime.js`'s `refreshCurrent()` called
`renderAdmin()` directly instead of the role-aware `renderAdminOrSettings()` dispatcher
on the shared admin/settings tab — for an admin the two calls are equivalent, so it
looked correct in every admin-tested session; for a non-admin backgrounding the app
on Settings, it silently rendered the admin panel (and its admin-gated RPCs, which
then reject) instead. Fixed, and `runNonAdminScenario` (presets `p2`,
`is_league_admin: false`) now locks in both the initial Settings render and the exact
backgrounding/foregrounding regression.

**A SET-VALUED COMPUTATION NEEDS A CASE WHERE THE SET IS EMPTY. Presence
assertions cannot tell "the right things" from "the right things plus
extras" — this is a DIFFERENT shape from the substitution pattern below, and
strengthening the existing checks would not have caught it.**
- **Found 2026-08-18 by mutation.** `toggleFormat`'s orphan confirm computes
  which slot keys a format change removes: `cur.filter(k => !nxt.includes(k))`.
  Mutated to `cur.slice()` — return every current key rather than the
  difference — and **the whole suite stayed green.**
- **Why every existing assertion missed it.** They were all presence checks
  on specific strings: does the dialog name `Set 2 Closer`, `Encore`,
  `Flat pick 2`. An over-broad list contains all of those *and more*, so
  each check passes. Adding more strings, or checking them harder, changes
  nothing — the mutation makes the set strictly LARGER, and presence
  assertions are monotone in exactly the wrong direction.
- **What caught it: a case where the correct answer is an EMPTY set.** The
  fixture's `oneset` keys (`opener`, `flat1`) are a subset of its standard
  keys, so `one_set → standard` loses nothing and must show NO dialog even
  though picks exist for that show. Under the mutation the set is non-empty,
  a dialog fires, and the case fails. That single assertion is what pins the
  computation to the difference rather than to the input.
- **The general rule: whenever a function produces a set/list that drives a
  decision, cover the case where it should come out empty.** Non-empty cases
  constrain the lower bound (these things must be in it); only an empty case
  constrains the upper bound (nothing else may be). Both are needed, and the
  empty one is the one people skip because it looks like it asserts nothing.
- Distinguish this from the entry below: those are correlates standing in
  for conditions — the check asks the wrong question. Here the checks asked
  the right question and were simply **incomplete**, because no input
  exercised the boundary. Same green suite, different repair.

**THE SUBSTITUTION PATTERN REACHED A VERIFICATION BLOCK, 2026-08-17 — the
first time it appeared in a check the dev was explicitly told to trust.**
Discipline item 5 covers a correlate standing in for a condition in *code*.
This is the same shape in *instructions*: `sql/stage_q_unaffiliated_players.sql`
shipped with a verification block whose headline check was
- `select count(*) from players p where not exists (... league_members ...)`

That is a **raw table query**. It never touches the RPC the file creates, and
returns exactly the same answer whether or not the function exists. It was
run, returned `1`, was reported as confirmation that "the predicate and the
panel agree" — and the function **had never been created**. The panel failed
with `PGRST202` on first use. `pg_proc` returned no row for
`admin_list_unaffiliated_players` while `get_show_picks(text,text,bigint,bigint)`
sat right beside it, proving both that the query worked and that Stage P had
landed.
- **What made it worse than the earlier instances:** those were correlates
  chosen by the person writing code. This one was written INTO the
  verification block as the thing to check, so following the instructions
  correctly produced false confidence. A wrong check that is obeyed is worse
  than no check.
- **The fix, applied to that file:** deployment check FIRST (`pg_proc`
  expecting `admin_list_unaffiliated_players(text,text,bigint)`), then the
  auth probe, and the count demoted to step 3 with an explicit warning that
  it proves nothing about deployment and a note recording that it already
  misled once.
- **General rule for any future stage file: the first verification step must
  be "does this object now exist", queried from the catalog.** Everything
  downstream — counts, row shapes, behaviour — is only meaningful once that
  passes, and every one of them can succeed against a database where the
  migration silently did nothing. A `PGRST202` from a caller is the same
  signal arriving later and more confusingly.

**COMMITTING A STAGE FILE AND DEPLOYING IT ARE SEPARATE EVENTS, and this
repo's history conflates them at least once.** Stage Q's commit message
(`2bc6c31`) reads as though the RPC shipped with the code. It did not: the
file was committed and pushed while `admin_list_unaffiliated_players` did not
exist in the database, and the panel calling it failed with `PGRST202` on
first use. It was applied separately afterwards, on 2026-08-17, and verified
against `pg_proc`.
- **Not amended** — rewriting pushed history to fix a commit message costs
  every SHA cited elsewhere in this file, for a message nobody reads as
  authoritative anyway. The record lives here instead.
- **The general hazard: git status tells you nothing about the database.**
  `sql/` is version-controlled; the schema is not. A clean tree, a green
  suite and a pushed commit are all fully compatible with a migration that
  was never run — the frontend is the only thing that finds out, and only
  when someone uses the feature.
- **So when reading this repo's history, treat "the stage file exists in
  `sql/`" as evidence the SQL was WRITTEN, never that it was APPLIED.** The
  only reliable check is the catalog, live. This applies retroactively to
  every stage file here, not just Stage Q — most were genuinely run, but the
  commit is not what establishes that.

**ASSERTING THAT A CONTROL EXISTS IS NOT ASSERTING WHAT IT DOES — and this
harness has now produced two green-looking gaps of that family. Check the
target is actually reached before trusting a check that names it.**
- **`get_show_picks`'s fake returned `[]` unconditionally until 2026-08-13**,
  so `renderShowDetail`'s pre-scoring pick board ("The picks are in") could
  never render in ANY scenario, in either mode. Assertions referencing that
  surface existed and passed; the surface was unreachable.
- **`bootPlayer` had ZERO coverage until 2026-08-17**, despite three checks
  asserting the Members panel — including *"Members panel offers Reset PIN
  per member"*. Those assert the buttons are in the markup. **Nothing ever
  invoked either handler.** So the panel read as well-covered while both of
  its destructive controls were entirely untested.
- **`setRosterMember` had zero coverage until 2026-08-17** — third instance,
  same shape as the second. `toggleRoster(501)` was already called and the
  roster panel's render asserted, while the handler behind its buttons was
  never invoked.
- The distinction that matters: the first is a fake that made a real surface
  unreachable; the second and third are presence standing in for behaviour.
  All look identical from a green run. This is the same substitution
  discipline item 5 names — a correlate passing for the condition — applied
  to tests rather than to production code.
- **"Does anything actually INVOKE this handler?" is now a standard check,
  not an occasional one.** Three instances, and **two of the three were
  found by asking rather than by any failure** — nothing was ever going to
  surface them, because the suite was green and the panels were asserted.
  Grepping `test/` for the handler name takes seconds and is the whole
  check: if the only hits are a fake handler and a render assertion, the
  behaviour is untested no matter how well-covered the panel looks. Do this
  before trusting green on any control that writes or deletes.

---

**MUTATION-SHAPE TALLY, and the rule it yields — worth knowing where
assertion coverage is actually load-bearing rather than belt-and-braces.**
Seven mutations were run on 2026-08-17. They fall into two kinds:
- **Self-detonating (2)** — the corrupted value reaches a *dereference*, so
  JavaScript catches it and no assertion is consulted:
  - `setRosterMember`'s catch `return` dropped → `season` is `null` and the
    very next line reads `season.roster_locked_at`. Immediate.
  - `resolveLeagues`'s guard inverted → league-ful players route to the
    empty state, `state.cfg` never loads, and a render crashes on it later.
    **Delayed and in a different module**, which is worth noting: the crash
    need not be adjacent to the mutation to count.
- **Silent and plausible (1)** — the corrupted value is absorbed by a branch
  that treats it as legitimate:
  - `bootPlayer`'s catch `return` dropped → `live` is `null`, which is a
    *valid* value meaning "no season running", so execution continues into
    a perfectly reasonable dialog and the boot proceeds. **Only tests catch
    this**, and it took 2 of 3 assertions.
- The remaining 4 changed rendered output and were caught by assertions on
  that output (branch strings swapped, lock condition inverted, confirm
  bypassed, the claim softened).

**The rule: it is not "does the next statement dereference" — it is whether
the corrupted value ever reaches a dereference at all, or is absorbed by a
branch that accepts it as valid.** `null` meaning "nothing found" is the
dangerous case precisely because it is indistinguishable from `null`
meaning "lookup failed". When adding a guard, ask which kind the failure
value is: if it is absorbable, the tests are the only thing standing there.

**Other session shapes still not exercised by anything in this harness** — read this
before assuming a change is covered just because the suite is green:
- **A genuine global admin** (`is_global_admin: true`). No fixture player has this set;
  `p1`'s admin status comes entirely from `league_members.is_league_admin`. Right now
  the two produce identical rendering (both satisfy `isCurrentLeagueAdmin()`'s
  OR-condition, and nothing else in `src/` checks `is_global_admin` directly), so
  there's nothing currently divergent to miss — but any future Global-exclusive
  feature (cross-league stats, nuclear boot, the league-creation screen — none of
  which exist in `src/` yet despite being described in the spec) needs a
  global-admin session added to the harness from the day it's built, not after.
- **More than one league.** `renderLeagueSelector()`'s actual dropdown branch
  (`leagueIds.length > 1`) has never run **in the test suite** — the fixture has
  exactly one league (Ambassadors), so the function always takes the "hide the
  selector" early return. **Still true of the fixtures as of 2026-08-16, and now
  a real gap rather than a hypothetical one: a second league exists in
  production as of that date**, so the harness is no longer modelling the
  shape the app actually runs in. A two-league fixture (plus a player who is
  a member of both) is the missing piece.
  - The production behaviour of this branch was traced by hand when the
    second league was created — see **"Multi-league switcher behavior"**
    below for what it actually does, including the onboarding-critical
    reload requirement. That trace is a code read, **not** test coverage,
    and does not substitute for the fixture.
  - **⬆ RAISED IN PRIORITY 2026-08-17, and the reason is a connection worth
    recording rather than leaving as two separate list items: the
    "Registered, not in any league" panel (Stage Q) measurably increases how
    often a player ends up in BOTH leagues, which is exactly the state this
    missing fixture fails to cover.** The mechanism: the panel shows the same
    unaffiliated players to every league admin, `league_members` has PK
    `(league_id, player_id)` so adding the same person to two leagues creates
    two distinct rows and **cannot conflict**, and neither admin's open panel
    refreshes when the other acts. So two admins working the list
    concurrently silently produce a dual-league player — who is then also
    opted into BOTH Official brackets, since `admin_add_league_member` takes
    the `official_opt_in` default. Nobody sees an error.
    - The on-screen mitigation is copy, asserted by
      `runUnaffiliatedScenario`: the panel says these people may not have
      asked to join *this* league and to add someone only if they contacted
      you. That reduces the rate; it cannot prevent it.
    - **So the fixture gap stops being theoretical.** Before Stage Q,
      dual-league membership needed someone to deliberately create it. Now
      it is a plausible accident during recruitment, and the code that
      renders for such a player — `renderLeagueSelector`'s dropdown branch —
      has still never run in a test.
- **A player who is NOT opted into Official / not on the season roster, blocked from
  submitting picks for that reason.** `p2`'s `official_opt_in: false` in the fixture
  has never been exercised through an actual login, and separately, the fake
  `can_submit_picks` handler in `harness.mjs` only models the "no season covers this
  show" rejection — it doesn't check `official_opt_in` or `season_rosters` at all. So
  even adding the session wouldn't currently prove the real roster-based rejection
  path works; the fake handler needs the same real-join treatment `get_bracket_scores`
  and `admin_list_members` already get before that's actually covered.
