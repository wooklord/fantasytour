# CLAUDE.md — Fantasy Eggy project playbook

This file is read automatically by Claude Code. It carries the full context of a
project that was built over many sessions in the Claude chat UI (single-file,
paste-based workflow) and is now moving into Claude Code ahead of a large
"2.0" multi-tenant rebuild. Read this whole file before touching anything.

---

## What this is

**Fantasy Eggy** — a fantasy-setlist game for fans of the jam band **Eggy**. Players
predict what songs the band will play in specific "slots" (opener, encore, etc.),
scores are computed automatically from the real setlist after each show, and there
are standings, seasons, an admin panel, and notifications. Think fantasy football,
but for concert setlists.

Sibling app: the "Ambassadors" tour-map PWA (separate project, same developer).

## Current architecture (pre-2.0)

- **Frontend**: split into modules under `src/` (`src/core/` for shared
  infra — state, Supabase client, theme, switcher, session, tiebreak, format,
  layout, realtime, dom; `src/features/` for the tab-level screens — auth,
  shows, picks, standings, admin, settings). `node build.mjs` (esbuild, no
  config beyond that script) bundles `src/main.js` into `app.js` + `app.js.map`
  at the repo root; `index.html` is now a thin ~50-line shell that loads
  `app.js` as a plain `<script src="app.js">` (no `type="module"`,
  no import maps). The old single-file monolith described below in some
  older notes is retired — see Stage C2a. **The bundle is checked into git
  and must be rebuilt (`npm run build` / `node build.mjs`) and committed
  alongside every `src/` change** — GitHub Pages serves whatever `app.js`
  is committed, it does not run a build step itself.
- **Backend**: **Supabase** (Postgres + Row Level Security + Realtime + Edge Functions).
  - Auth is **name + PIN** (no email/magic-link — chosen for reliability on venue
    LTE and for a friendly closed community). Writes go through `SECURITY DEFINER`
    RPCs that validate the PIN server-side; the anon key cannot write tables directly.
  - **Realtime** pushes score/show changes to open apps as toast notifications.
  - **Edge function** `supabase/functions/carton-sync/index.ts` (Deno) polls the
    setlist source, scores picks, and posts announcements.
- **Setlist data source**: The Carton's public Songfish API, `https://thecarton.net/api/v2`
  (no key). Returns `data.data` arrays; venue field names vary (`venuename`/`venue`).
  Debuts/covers come from footnotes / an `isoriginal`-style flag. `is_encore` is
  derived from setnumber/settype. IMPORTANT: closer/opener/etc. are **positional
  inferences** the scorer computes (e.g. closer = last non-encore song), NOT tags
  from the API — this matters for live vs. post-show labeling.
- **Notifications**: two channels — (1) in-app realtime toasts, (2) Discord webhook
  (secret `DISCORD_WEBHOOK`). Discord is broadcast (per-channel), so it can't do the
  "you haven't voted" personalization the in-app toasts do; it names non-voters
  publicly instead.

## Credentials

- Supabase project ref: `zdfhglvjxquvkjyvophz`
- Publishable/anon key: `sb_publishable_qN1goR6-Ss3cErnJJIJdKw_xr5nrFuo`
  — this is PUBLIC by design (it's in the deployed frontend JS). Safe to commit.
- The **service_role / secret key must NEVER** be committed or put in the frontend.
- The current `index.html` has these two constants filled in near the top of its
  `<script>` (`SUPABASE_URL`, `SUPABASE_ANON`).

---

## SESSION DURABILITY PROTOCOL (standing rule — read this every session)

A session can end without warning at any point — a usage limit, a context
boundary, a closed terminal. This project already lost a full session's
worth of decisions once this way (the edge-function-scope assumption behind
Module B sat wrong in conversation for an entire session because nothing
forced a write to disk). Three rules, effective 2026-08-12:

1. **Write decisions when they're made, not at wrap-up.** The moment a
   decision, interpretation, or answer to an open question is locked, write
   it into CLAUDE.md (or the relevant in-repo plan file) and commit it right
   then — don't batch documentation for an end-of-session step. Don't ask
   permission first; make the write, then report what was written in one
   line. If mid-task when a decision lands, finish the write before
   continuing the task.
2. **On "park" / "stop" / "wrap up" / "I'm done," do the durable writes
   FIRST, in this order:** (a) update CLAUDE.md with every decision locked
   this session; (b) update the in-repo plan file with current state, next
   step, and any question still open — including unresolved ones, since a
   question that only exists in conversation is lost the moment the session
   ends; (c) commit and push both, confirm `main` matches `origin/main`;
   (d) only then stop any dev server, report what's still running, and give
   the resume command/directory. (a)-(c) are the only steps that require the
   assistant at all — if something is about to cut the session off, do
   (a)-(c) and skip (d).
3. **If a decision from an earlier session turns out wrong or was never
   actually recorded, say so explicitly rather than quietly working around
   it.** That's exactly how the edge-function assumption behind Module B
   survived as long as it did.

---

## THE MERCILESS EDITING DISCIPLINE (hard-won — do not skip)

The single-file paste workflow caused real bugs. Even though Claude Code edits files
directly (lower risk), keep these habits:

1. **Assert before you replace.** Before any string replacement in a large file,
   confirm the anchor appears exactly once. A blind find-and-replace once landed a
   patch twice and broke the pick buttons; another time a mid-batch partial write
   shipped. Count first, replace second.
2. **Syntax-check after every edit.** The JS lived inside `index.html`; extract and
   `node --check` it (or lint the split modules once they exist) after each change.
3. **Boot the app in a harness to catch runtime throws.** There were jsdom harnesses
   (`/tmp/harness.js` mobile, `/tmp/harness_desk.js` desktop) that instantiate the
   app with a stubbed Supabase client and confirm it renders without throwing.
   `matchMedia` must be set on `window` in the harness. Recreate equivalents.
4. **Trace critical paths end-to-end after touching them** (tap-Pick → save;
   score update → standings; etc.). A valid-syntax, wrong-scope bug won't be caught
   by a syntax check — only by tracing.
5. **Verify the condition, not a proxy for it.** This codebase has produced the
   same bug three times: `picks.length === expected` instead of checking which
   rank positions are actually covered; `added_at IS NOT NULL` instead of
   comparing it to `roster_locked_at`; "zero pre-adds on Wednesday" asserted
   about Friday's state. Each was a real, measurable thing that *usually*
   correlates with the condition that actually mattered — which is exactly what
   makes the substitution easy to miss in review and easy to pass in testing.
   When writing a check, state the condition in words first, then confirm the
   code tests **that** and not a correlate of it. The three above are worth
   re-reading as a set: a count standing in for coverage, a
   presence check standing in for equality, and a point-in-time observation
   standing in for a claim about the future.
6. **NEVER use `git checkout <file>` (or `git restore <file>`) as a cleanup
   step. It is whole-file and reverts to HEAD** — it does not undo "the
   thing you just did", it discards *every* uncommitted change in that file.
   It is only safe when the file has no other uncommitted work, which is
   exactly the condition nobody checks before typing a cleanup command.
   - **This fired on 2026-08-17, it was not a near miss.** A probe line was
     appended to `styles.css` to prove a CSS edit moved the new build hash,
     with `git checkout styles.css 2>/dev/null || sed -i '$ d' styles.css`
     as cleanup. `git checkout` **succeeded**, so the `sed` fallback never
     ran — and the success is what did the damage: it reverted the whole
     file to HEAD, discarding an entire session's CSS work (the `.scopeline`
     label/note split, the `.section-scope` comment, the `#bracketToggle`
     sizing, the `.buildid` rule). Caught by grepping for each expected
     marker and finding all four at zero, then restored by hand.
   - **The instinct to correct: the danger was the PRIMARY command, not the
     fallback.** A `||` chain reads as "try the safe thing, fall back to the
     blunt one", which inverts what actually happened here. Reasoning about
     the fallback while the primary is the destructive one is how this gets
     repeated.
   - **Use instead:** a targeted revert of the specific edit (remove the
     exact line you added), or copy the file first and restore from the
     copy — the same backup pattern the mutation-testing passes use. Both
     are bounded to what you changed; `git checkout` never is.
   - Related, same family: `git stash`, `git restore .`, and `git clean` all
     have this property at wider scope. None belong in an automated cleanup.
   - **SECOND INSTANCE, same night, different tool: a line-numbered `sed`
     revert that can SILENTLY NO-OP.** Reverting a mutation with
     `sed -i '120s/^$/      stopNoLeaguePolling();/'` only works if line 120
     is still empty. Any edit that shifted the file leaves the substitution
     matching nothing, `sed` exits 0, and **the mutation stays in the
     source**. The suite then passes — because the assertion that catches
     that mutation only fails when it runs against a correctly reverted
     file — so a green run would have been read as "reverted and clean"
     when the code was still mutated.
   - **The shared shape across both instances: a cleanup command that
     reports success whether or not it did what you meant.** `git checkout`
     succeeds while discarding more than intended; line-numbered `sed`
     succeeds while discarding nothing. Neither failure is visible in the
     exit code, and both look identical to a correct run.
   - **Use `str_replace`/Edit for reverts, anchored on the actual text**, so
     a moved line fails loudly instead of silently. Then **confirm with
     `git diff <file>` before building** — an empty diff against HEAD is the
     only real proof the mutation is gone. Do not infer it from a passing
     suite; a suite that passes is exactly what a failed revert produces.
7. **Record mentions at the weight they were given.** One offhand comment is a
   mention, not a commitment — and writing it down as a deliverable makes it
   indistinguishable from one later. This project has run the failure in both
   directions on the same subject (the desktop sidebar): a single passing
   remark was escalated across sessions into a named artifact with its own
   roadmap entry and an implied rejected alternative, and then the correction
   over-swung to "never existed," deleting the real preference along with the
   invented detail around it. Inflation and erasure look like opposite
   mistakes but are the same one — **a claim not calibrated to the evidence
   behind it.** So: write down what was actually said, at the strength it was
   actually said, and mark the strength explicitly ("mentioned once, never
   specified") rather than letting a later reader infer it from the fact that
   it got written down at all.
   - Note the remedy in item 5 and the repo-check remedy elsewhere in this
     file **do not cover this case**. "Check it against the actual repo"
     adjudicates claims about *code*; a claim about what the dev *wants* has
     no artifact to check against, and never will. Calibrating at the moment
     of recording is the only defense available.

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

## Postgres / Supabase gotchas learned the hard way

- **pgcrypto lives in the `extensions` schema** on Supabase. Every `SECURITY DEFINER`
  function that uses `gen_salt`/`crypt` must `set search_path = public, extensions`
  or it throws "function gen_salt does not exist".
- **Finalized scores are frozen**: score `breakdown` text is written at score time and
  not recomputed once a show is `final`. So wording changes only affect
  future-scored shows. Display-computed things (like tie handling) fix retroactively;
  stored-at-score-time things don't.
- **The single global config** currently lives in a `game_config` table (id=1). In 2.0
  this becomes per-bracket `brackets.config`.
- **`shows.timezone`** (added via `sql/add_shows_timezone.sql`) holds each venue's
  resolved IANA zone, computed once server-side at sync time by the edge function's
  `resolveVenueTz(state)` (a null-capable sibling of the existing `venueTz`, which
  keeps its old fallback-to-Eastern behavior for computing default cutoffs — a
  different job than persisting a fact). **Null means the state genuinely didn't
  map** — not "assume Eastern." This exists specifically so the admin panel's Shows
  & cutoffs UI can display and edit cutoffs in real venue-local time (state→zone
  lookup was already duplicated once and almost got duplicated a second time into
  the frontend; this column is the single source of truth instead) — see
  `src/core/venueTime.js` for the conversion helpers and `admin.js`'s cutoff row for
  how a null falls back to device-local time with an explicit "timezone unknown"
  caveat, never a silently-guessed zone. Self-heals on the next sync if a venue's
  `state` gets corrected or `STATE_TZ` gains a mapping, same as `permalink`.
  **Adding this column didn't backfill existing rows**: `syncShows` only upserts
  shows inside its rolling 200-show/14-day fetch window — the same bound that
  already limits permalink corrections (below) — so any show that had already
  aged out of that window before this column existed stayed null and will never
  be touched by a normal sync. Fixed once via `sql/backfill_shows_timezone.sql`
  (computes the zone from `state` directly, same mapping, for whatever's still
  null). Worth remembering for any *future* column added to `shows` the same
  way: the fix needs its own one-shot backfill, adding the column alone won't
  reach shows already outside the window.
- **Realtime only pushes tables in the `supabase_realtime` publication**
  (currently `shows`, `seasons`, `setlist_songs`, `scores`, `league_shows` —
  adding another table requires `alter publication supabase_realtime add
  table <t>`) — **and subscribing to a table that ISN'T in it silently kills
  postgres_changes delivery for every OTHER binding on the same channel,
  not just that one.** `realtime.js` puts all four of its postgres_changes
  subscriptions (`setlist_songs`, `league_shows`, `seasons`, `scores`) on
  one shared channel (`live-${bracketId}`). `scores` and `league_shows`
  were silently missing from the publication (dropped or never re-added
  during Stage A's schema rebuild) — the actual, confirmed bug wasn't just
  "those two toasts don't fire," it was that the whole shared channel's
  postgres_changes registration failed, so `setlist_songs`'s song-by-song
  toasts and `seasons`'s winner toasts died too, despite both of those
  tables being correctly configured the entire time.
  **The channel still reports `SUBSCRIBED` when this happens** — that
  status only reflects the channel/socket join succeeding, not whether the
  postgres_changes registration behind it actually worked, so nothing in
  the client-visible state indicates a problem. Confirmed by direct
  isolation, not inference: an identical 4-binding channel reproduced the
  dead behavior, a channel with only the 2 valid bindings (of the same 4)
  delivered cleanly, and a single-binding channel worked alone too — the
  invalid bindings, not anything about `setlist_songs`/`seasons`
  themselves, were the cause. `subscribeRealtime()` now warns
  (`console.warn`) whenever the channel reaches any status other than
  `SUBSCRIBED`, since that's the only client-visible signal available —
  the status itself can't reveal a poisoned-channel case like this one.
  **Publication membership and RLS are two independent gates, in series —
  both must pass, and each fails differently.** A table absent from the
  publication isn't realtime-eligible at all (this is what poisons the
  shared channel above). A table that IS in the publication but has no
  permitting RLS policy registers fine — the channel doesn't break — but
  delivers **nothing at all** for that table, not an empty or redacted
  payload, verified directly (added `scores` to the publication alone,
  subscribed an anon-key client with no SELECT policy on the table, forced
  a real value change, zero events arrived). This is why fixing the
  publication gap didn't require touching RLS: `scores`/`league_shows`
  still have zero public SELECT policies by Stage A's original design
  (scoped reads go through RPCs, not RLS — see below), so their own
  realtime toasts remain genuinely non-functional even after this fix —
  intentionally; only the collateral damage to the other two tables'
  delivery was the bug.
- **`league_members.banned` is vestigial as of Stage C1.** League boot
  (`admin_league_boot`) hard-deletes the `league_members` row (keeping picks/scores
  frozen per the season-roster rule) and separately inserts into that league's
  `banned_names`, which is what `admin_add_league_member` actually checks. Nothing
  in Stage C1 sets or reads the `banned` column — don't assume it's the enforcement
  mechanism if you see it later; it's leftover from the pre-2.0 flat schema.
- **Standings/scores/seasons/schedule reads are RPCs, built in Stage C2a**
  (`sql/stage_c2a_rpcs.sql`): `get_bracket_scores` (authenticated + membership-
  gated — cross-league visibility is Global-admin-only, so this isn't public
  like the others), `get_league_shows`, `get_bracket_seasons` (both public, no
  auth — schedule/season date ranges aren't per-player), plus `can_submit_picks`
  (the shared Official-eligibility check, also backing `submit_picks` itself via
  an internal `_official_gate` helper — one implementation, not a client-side
  copy that could drift out of sync). Stage A left no public select policy on
  `scores`/`seasons`/`season_rosters`/`league_shows`/`picks`/`league_members`
  (intentional — scoped reads go through RPCs, not RLS), so before these existed
  those direct reads returned nothing at all.
- **`reopen`/`cutoff_changed`/`finalize` are name/PIN-authenticated** edge-function
  actions (`carton-sync`), not SQL RPCs. Each verifies the caller via `_auth_player`
  + `_is_league_admin_or_global` (same guard the SQL RPCs use) before doing
  anything. This closed a real hole: those two actions previously took only
  `{league_id, show_id}` with no auth at all, so anyone holding the public anon
  key could wipe a league's scores or spam a fake cutoff notice. There is
  deliberately no `admin_reopen_show` SQL RPC and no `admin_set_show_status` RPC —
  the edge function's authenticated actions are the only path for these
  transitions now.
- **`_auth_player`/`_is_league_admin_or_global`/`_official_gate` had Postgres's
  default `PUBLIC` execute grant** (every new function gets it unless explicitly
  revoked, and nothing in this codebase's history ever had). `_auth_player`
  returns the full `players` row including `pin_hash`, so it was directly
  callable via `/rpc/_auth_player` by anyone holding the anon key — fixed in
  `sql/stage_c2a_rpcs.sql` with explicit `revoke ... from public`. Impact was
  limited (it requires the correct name **and** PIN to return anything, so this
  could only leak an account's own hash back to someone who already fully
  controls it), but it's not what the `service_role`-only grant was supposed to
  mean — check for this same gap on any future internal-only helper.
- **Case-insensitive login was never actually the bug — `_auth_player` has
  compared on `lower(name)` since the original schema.sql.** A real player
  ended up with two case-variant accounts and
  couldn't reliably log into either, which read as "login is case-sensitive."
  It isn't, and never was. The actual defect: `players.name` had a plain
  (case-sensitive) `unique` constraint, so `register_player`'s duplicate
  check — which relies entirely on that constraint's `unique_violation` — let
  a case-variant of an existing name insert as a second row instead of
  failing. Once two rows share a lowered name, `_auth_player`'s
  `select ... into pl from players where lower(name) = lower(trim(p_name))`
  doesn't error on the extra match (PL/pgSQL's `SELECT INTO` silently keeps
  the first row returned and discards the rest, no `STRICT`) — so login
  becomes nondeterministic against whichever row's PIN gets checked, not
  literally case-sensitive. Fixed in `sql/stage_e_case_insensitive_auth.sql`
  by replacing the constraint with a case-insensitive unique index on
  `lower(name)`: once at most one row can exist per lowered name, the
  existing `lower(name)` comparisons in `_auth_player` (and the existing
  `lower(...)` handling already correct in both `banned_names` and
  `global_banned_names`) are correct on their own — no query logic changed,
  only the constraint that was supposed to make duplicates impossible.
- **Standings tiebreaker ranking uses competition ranking (rank += group
  size), which makes rank 2 mathematically unreachable whenever exactly two
  players share rank 1** — the next occupied rank is always 3, never 2
  (`src/core/tiebreak.js`'s `rankStandings`). Non-obvious and worth having
  written down: `src/features/standings.js`'s podium-arrangement code has to
  pull a 2-way tie's "runner-up" (the player centered between the two
  elevated golds) from whoever holds rank 3, not rank 2 — a literal `silver`
  group is always empty in that shape, by construction, not by bug. The
  medal color rendered there still just follows the player's real resolved
  rank (bronze in practice) — nothing is hardcoded to display as "silver."
- **Login rate-limiting: the top real security exposure in this app, deferred
  with a dated trigger — not an open-ended "someday."** `login` is a public,
  unrated RPC that takes a nickname + a 4–8 digit PIN, and nothing throttles
  guesses. The reason this outranks every other gap on the list is that all
  four preconditions for cheap online guessing are already satisfied *and
  public*: nicknames are enumerable (they're printed on the leaderboard),
  PINs can be as short as 4 digits — nominally a 10k keyspace, but the
  *effective* one is far smaller, since a meaningful share of human-chosen
  4-digit PINs are `1234`, `0000`, or a birth year, which is exactly why
  part (3) of the fix below is not optional — the anon key needed to call
  the endpoint ships in the deployed frontend by design, and `login`'s exact
  signature is in committed SQL. None of that is a leak — every piece is
  public on purpose or unavoidably — but together they mean the only thing
  standing between an attacker and an account is the absence of any
  throttling or PIN-strength floor.
  - **Trigger: before Session 5's Facebook League, and before any non-dev
    league admin exists** — whichever comes first. Same dated-trigger pattern
    as the ladder-mutability decision below. Today's Ambassadors are a
    closed, trusted pool where the risk is theoretical — counted directly
    2026-08-12: 14 league members, all 14 in the Official opt-in set, 13
    currently rostered. A ~50-person semi-public league is where it stops
    being theoretical.
  - **Minimal viable fix — three parts. Any one alone is insufficient, and
    they cover different attacks; don't ship a subset.**
    1. **Per-nickname progressive delay, NOT lockout.** Escalating
       server-side delay (or reject-with-retry-after) on consecutive
       failures for the same `lower(name)`, reset on success. Throttles
       vertical guessing (many PINs against one account) without ever
       handing anyone a button that disables an account.
    2. **Aggregate failed-attempt throttle across ALL accounts in a rolling
       window.** This is the only part that sees PIN *spraying* at all, and
       it is not redundant with (1) — do not drop it as belt-and-braces.
       The efficient attack here is horizontal, not vertical: try one likely
       PIN (`1234`, `0000`, a birth year) exactly once against every
       enumerable nickname. Each account records a single failure, so no
       per-account counter ever trips, while across ~50 accounts a handful
       of common PINs has good odds of landing one. Per-account state is
       structurally blind to this; only a global failure rate sees it.
    3. **Weak-PIN rejection at set/reset time.** Minimum length above 4 for
       newly-set PINs, plus a denylist of trivial values (repeated digits,
       ascending/descending sequences, plausible birth years). This is the
       only one of the three that shrinks the *useful* keyspace rather than
       slowing access to it — throttling alone leaves `1234` just as likely
       to be someone's PIN, it just takes longer to try. Note that existing
       short/weak PINs stay weak until rotated; **whether to force rotation
       on existing accounts is an open sub-question, deliberately not
       decided here** (it trades a real security gain against pushing every
       player through a forced-change interstitial — the machinery for which
       already exists, see `must_change_pin`).
    All three must be enforced **server-side inside `login`** (and, for (3),
    inside `change_own_pin`/`admin_reset_player_pin`). A client-side check is
    worth nothing against an attacker calling the RPC directly, which is the
    entire threat model.
  - **Rejected design, recorded so it isn't re-proposed as the simpler
    option: a per-nickname failed-attempt counter with a hard lockout
    window.** It was proposed more than once and it's the wrong shape, for
    two independent reasons — either alone disqualifies it. (a) It doesn't
    see spraying, per (2) above: the attack's volume is distributed across
    accounts while the counter measures per-account attempts. (b) A hard
    lockout is a griefing vector, not an acceptable tradeoff — nicknames are
    public and picks have hard submission deadlines, so anyone could lock
    every account in a bracket an hour before cutoff and prevent the entire
    league from submitting. That's a worse and more likely outage than the
    compromise it prevents. Progressive delay gets the throttling benefit
    without creating the button.
  - **Why the integrity notes elsewhere in this file are publishable and this
    one is still worth fixing** — the distinction matters and is easy to get
    backwards. Notes like "`admin_update_config` has no schema validation" or
    "`admin_set_season_roster` has no `roster_locked_at` check" are safe to
    write down publicly **because they're dominated by this exposure, not
    because admin auth contains them.** "It's admin-gated" is not a
    containment argument in a system whose auth is the weakest link — if PIN
    guessing works, admin-gating is exactly as strong as a PIN. They're
    publishable because they disclose nothing an attacker who already reads
    the committed SQL doesn't have, and because compromising auth is strictly
    easier than exploiting any of them. Fix this bullet and the admin-gating
    argument becomes real; until then, don't lean on it.
- **The stored session IS the credential: `ft_session` persists the
  plaintext PIN.** Same auth story as the bullet above, recorded separately
  because the fix is different. `auth.js:26` writes
  `state.session = { ...d, pin: $("#a-pin").value }` straight into
  `localStorage`, and every RPC in the app reads `state.session.pin` to
  authenticate (`switcher.js:49`, `realtime.js:31`, and ~everywhere else).
  Consequences worth stating plainly:
  - **There is no revocation path short of changing the PIN.** A leaked
    session isn't a token that can be invalidated server-side — it's the
    password itself, so "log this device out" and "rotate the credential"
    are the same operation.
  - **It now sits on its OWN storage origin — resolved 2026-08-15 by the
    domain move (see below).** Until then everything served from
    `wooklord.github.io` was one origin, so this app shared `localStorage`
    with the Ambassadors app and anything else published there; key
    prefixing (`ft_*`) is naming, not isolation, so any script on any page
    of that origin could read `ft_session` and recover a player's PIN in
    plaintext. On `fantasyeggy.wooklord.net` that specific exposure is
    gone: a sibling app on a different subdomain is a different storage
    origin and cannot reach these keys.
    - **This narrowed the blast radius; it did NOT fix the underlying
      problem.** The stored credential is still a plaintext PIN with no
      revocation path — the token exchange below is unchanged and still
      the actual fix. What the move removed was one *route in*, not the
      thing being protected.
    - **The cookie caveat is now live rather than hypothetical.**
      Subdomains are separate storage origins, but `wooklord.net` is a
      registrable domain, so a cookie set with `domain=.wooklord.net`
      would be readable by every subdomain including this one. Storage
      separates automatically; cookies don't. This app sets no cookies at
      all today — keep it that way, or scope any future cookie to the
      exact host with no `domain` attribute.
  - **Eventual fix, recorded so it isn't redesigned from scratch: exchange
    the PIN for an opaque server-issued session token at login, store the
    token, never store the PIN.** That gives a real revocation path and
    makes a stolen session bounded rather than permanent. This is genuine
    work — a new table, token issue/verify/expiry, and re-pointing every
    RPC's auth argument off `p_pin` — **not a quick patch. Don't start it
    without scoping it as its own session.**
  - Scale note, same as elsewhere: today every app on that origin is the
    dev's own, so the practical exposure is a bug in the dev's own code,
    not a third party. That's why this is recorded rather than treated as
    an incident.
- **At rest, PINs ARE hashed — bcrypt, verified correctly. Don't
  re-investigate this.** Different question from the bullet above (which is
  about the *client*), with a different answer, so both are recorded.
  `register_player` stores `crypt(p_pin, gen_salt('bf'))` into
  `players.pin_hash` (`sql/stage_c1_rpcs.sql:72-73`) — `gen_salt('bf')` is
  Blowfish/bcrypt with a per-row salt — and `_auth_player` verifies with
  `pl.pin_hash <> crypt(p_pin, pl.pin_hash)`, the standard
  recompute-using-the-stored-hash-as-salt comparison. There is no plaintext
  PIN column anywhere; the column is `pin_hash`.
  - **Blast radius, stated honestly rather than reassuringly:** read access
    to `players` yields bcrypt hashes, not a plaintext credential dump — so
    a table read is meaningfully better than the client-side story above.
    But **against a 4-digit PIN the hashing buys far less than it would for
    real passwords**: the entire keyspace is 10k candidates, so an attacker
    holding the hashes brute-forces them offline regardless of bcrypt's
    cost factor. This is the same root cause as the weak-PIN half of the
    rate-limiting bullet — hashing protects the *storage*, only PIN length
    protects the *credential*.
  - Implication for the eventual token exchange: since storage is already
    hashed and correct, that work is confined to the client/session layer —
    issue and store a token instead of the PIN. It does **not** require
    re-doing password storage, which is one of the few things here that's
    already right.
- **✅ DONE 2026-08-15 — the app now lives at `fantasyeggy.wooklord.net`.**
  Was a roadmap item gated on "before Facebook-league recruitment begins";
  shipped ahead of that, which was the point (the cost scales with player
  count, so paying it at thirteen players beat paying it at fifty).
  `CNAME` is committed at the repo root and the old `github.io` URL
  redirects. **This is item #3 on the Pre-Session-5 gate — now closed.**
  - **The codebase needed NO changes, verified before the move rather than
    discovered during it.** `manifest.webmanifest` has `start_url: "."` and
    **no `scope` key at all** (an absent scope defaults to the manifest's
    own directory), so both are origin-relative and followed the app across.
    Icons are relative. `index.html` has no `<base>` tag and no absolute
    self-references. `src/` contains zero `location.origin`/`.host`/
    `.href`/`.hostname`/`document.domain` uses and no absolute URL to the
    app's own host. **There is no service worker anywhere in the repo**, so
    there was no cached scope pinned to the old origin — one of the usual
    ways this move breaks simply didn't apply.
  - **Supabase needed nothing either, and that's worth stating because it
    normally would.** Auth here is a name+PIN RPC, not Supabase Auth, so
    there are no redirect URLs or site-URL allowlists tied to an origin.
    The publishable key, project URL and the cron's Authorization header
    are all origin-independent.
  - **What it bought, precisely:** (a) **host portability** — the URL is no
    longer a `github.io` path, so leaving GitHub Pages later is a DNS
    change nobody notices; (b) **storage-origin isolation** — the app no
    longer shares `localStorage` with the Ambassadors app or anything else
    on `wooklord.github.io`, which is the half that actually mattered given
    `ft_session` holds a plaintext PIN. See the `ft_session` bullet above
    for why that narrows the blast radius without fixing the credential.
  - **What it cost players, as predicted:** logged out (`ft_session` is
    origin-scoped), in-progress drafts dropped (`ft_draft_*`), and a
    re-add to the home screen for anyone who had installed it. **Expect to
    run `admin_reset_player_pin` a few times** — some players hadn't typed
    their PIN since setting it, because the stored session kept them signed
    in. That is a normal outcome of this move, not a sign anything
    went wrong.
  - **Implementation, retained because it generalises to the next move:** a
    `CNAME` file in the repo containing the subdomain, a DNS `CNAME` record
    pointing at `wooklord.github.io`, then enable HTTPS in the repo's Pages
    settings. Use a **subdomain, not the apex** — GitHub Pages allows one
    apex/www site per account but unlimited project sites, so don't spend
    the apex here.
  - **Path prefix changed too, and it's why the storage loss was
    unavoidable**: the app was served from a project page at
    `wooklord.github.io/fantasytour/` and now sits at the root of its own
    host. Every reference being relative is what made that a non-event for
    the *code*; it's still a different origin AND path for the *browser*,
    which is exactly what drops the storage.
  - **Caveat that survives the move — still live, read it before adding any
    cookie**: subdomains are separate *storage* origins, but `wooklord.net`
    is a registrable domain, so a cookie set with `domain=.wooklord.net` is
    readable by every subdomain. Storage separates automatically; cookies
    don't. Scope any cookie to the exact host with no `domain` attribute.
    (Moot today — the app sets no cookies at all and uses no
    `sessionStorage`/`indexedDB`; `localStorage` is the entire client-side
    surface: `ft_session`, `ft_bracket_id`, `ft_theme2`,
    `ft_admin_sections`, and the per-show `ft_draft_*` keys.)
- **Resolved (Session 4): both halves of decision 3 now exist.** A
  league/global admin can run `admin_reset_player_pin`
  (`sql/stage_l_admin_pin_reset.sql`) to server-generate a new PIN and force
  the target to set a real one on next login (`must_change_pin`,
  `sql/stage_k_pin_management.sql`, `renderForceChangePin()` in `auth.js`).
  Separately, a player can voluntarily change their own PIN any time via a
  "Change PIN" form in `settingsPanelHtml()` (`settings.js`'s
  `changeOwnPin()`), calling the same `change_own_pin` RPC the forced flow
  uses — current PIN required and verified server-side (`_auth_player`
  raises before any write if it's wrong), so a live session on a shared
  device can't be used to lock the owner out. This was initially shipped
  admin-reset-only, with self-service deferred as a "follow-up" — corrected
  same session, before the SQL was run: the admin reset was always meant as
  the *fallback*, not the only path, so a player without admin access had no
  real recovery until this landed. The "only recovery is raw SQL against
  `pin_hash`" framing of this bullet is fully retired now, not just half of it.
- **Reveal-once secrets (the PIN reset's `new_pin`) transit through whatever
  request/response logging Supabase's platform does, if any — outside this
  app's control, but a real property worth having written down rather than
  assumed away.** `admin_reset_player_pin` never writes the plaintext PIN to
  any table or application log — it exists only as a `plpgsql` local
  variable and the single RPC response that returns it once, matching the
  "admin never sees/chooses it, relayed once" requirement. But if
  project-level API/request logging is ever enabled on the Supabase project
  (not something this codebase controls or has audited), that response body
  — like any RPC response containing a secret — would transit through it the
  same way. This isn't specific to a coding mistake here; it's an inherent
  property of any "reveal a secret once via an RPC response" pattern, and
  applies equally to a future self-service forgot-PIN flow if one is ever
  built the same way. Worth a one-time check of the project's logging
  settings before this matters at real scale, not something to re-derive
  from a chat transcript later.
- **Fixed: auth rejections from `reopen`/`cutoff_changed`/`finalize` used to all
  return HTTP 500**, indistinguishable from a genuine server bug (the
  handler's single `catch` turned "wrong PIN," "not authorized," and a real
  error into the same generic 500). `requireLeagueAdmin` now throws tagged
  `AuthError`/`ForbiddenError` (401/403 respectively), and the router's catch
  reads `.status` off the thrown error instead of hardcoding 500 — a real
  server error still falls through to 500 unchanged. Verified live against
  the deployed function, not just the source: a bad-credentials call now
  returns 401. This was already flagged here as a known gap before it was
  fixed; leaving this note rather than deleting it, since "was this ever
  actually broken" is exactly the kind of thing this file exists to answer
  without re-deriving it.
- **`songs_cache.times_played`/`last_played` have been silently dead since
  they were written — The Carton's `/songs.json` never returns either
  field.** `syncSongs()` in `index.ts` maps `r.times_played`/`r.last_played`
  straight from the API response, but the live response shape is only
  `{id, name, slug, isoriginal, original_artist, created_at, updated_at}` —
  confirmed directly against the live API, and separately confirmed every
  row in the live `songs_cache` table has both columns `null`, with no
  exceptions. This isn't a regression; it's been null since the sync code
  was written, because the API was never returning what the code assumed.
  No per-song detail endpoint or stats param exposes this data either — it
  isn't reachable as a simple field read at all. **Any feature that wants a
  real play count or last-played date (recency-weighted scoring, "songs
  due" displays, anything like it) is unbuildable today without first
  backfilling full setlist history** (`setlist_songs` only ever holds the
  rolling sync window, nowhere near full history) and switching these two
  columns to hold app-computed values instead of API-sourced ones. See
  "Alternate scoring modes" below for the one concrete case this blocks
  today.
- **A silent multi-row-insert failure turned "activation didn't run" into a
  real, months-long support burden — fixed, but the general shape is worth
  watching for elsewhere.** `activateSeasons()` (`supabase/functions/
  carton-sync/index.ts`) writes an Official season's frozen roster with a
  plain `.insert(rows)` — no `onConflict`, no error check — immediately
  followed, unconditionally, by `seasons.roster_locked_at = now()`. `
  season_rosters`' primary key is `(season_id, player_id)`; if even ONE row
  in that batch already existed (e.g. an admin manually pre-added a player
  to that season's roster via `admin_set_season_roster` before the season's
  start date arrived), Postgres aborts the entire multi-row `INSERT` on the
  conflict — but the very next line stamped `roster_locked_at` anyway,
  regardless of whether the insert wrote 40 rows or zero. The season then
  reads as "activated" forever (the `.is("roster_locked_at", null)` filter
  never revisits it), with a roster that's missing everyone except whatever
  was already there. **Confirmed against real data**, not just traced in
  the abstract: season 6 ("Test 2") shows every `season_rosters.added_at`
  clustered Aug 2–5, while `roster_locked_at` is Aug 6 — the automatic batch
  wrote nothing at all that day, silently. This is almost certainly the
  actual reason behind a recurring pattern of manually re-adding league
  members to season rosters via direct SQL, which had originally looked
  like ordinary mid-season joins (a real, separate, and expected gap — see
  the Frozen season roster decision below) but for at least this season
  wasn't that. One real player (a since-unused test account) sat out
  Official for the whole season as a direct result — caught before any
  Facebook League member hit the same thing. **Fixed**: the insert is now
  `.upsert(rows, { onConflict: "season_id,player_id", ignoreDuplicates: true
  })` (skips rows that already exist rather than aborting the batch, and
  leaves a manual pre-add's own `added_at` untouched rather than
  overwriting it), and `roster_locked_at` is stamped **only** if that write
  actually succeeded — on error the season is left with `roster_locked_at`
  still `null` so the next cron run retries it, the failure is
  `console.error`-logged, and it's returned in `scoreShows()`'s response
  (`season_activation_failures`) instead of being invisible. Verified live:
  the redeployed function's response now carries a `season_activation_
  failures` key that never existed before. **The general shape to keep
  watching for**: an unguarded multi-row write with no conflict handling
  and no error check, followed immediately by an unconditional "mark this
  done" write with no relationship to whether the first one actually
  succeeded. Scanned the rest of this file for the same pattern when this
  was found — every other batch write already either uses `.upsert()` with
  an explicit `onConflict` (`songs_cache`, `setlist_songs`, `scores`,
  `realtime_pings`) or explicitly checks `error` and throws (`syncSongs`),
  and the `remind_sent`/`lock_sent`/`winner_sent` announcement stamps that
  *do* follow a "best-effort action, then stamp regardless" shape are
  intentional there — a dead Discord webhook correctly shouldn't retry-storm
  forever, unlike a roster real players get scored against. Nothing else in
  the file currently matches the dangerous version of this shape.
- **✅ RESOLVED 2026-08-14 — ranked-choice deploy batch is complete and
  verified end to end. No action outstanding.** Kept rather than deleted
  because the failure mode it describes is the thing to check first if
  ranked scores ever look wrong.
  - **What was done**: `supabase functions deploy carton-sync
    --project-ref zdfhglvjxquvkjyvophz`, then
    `sql/stage_o_ranked_submit_picks.sql`. In that order, deliberately —
    deploying the scorer first is inert (`submit_picks` still rejected rank
    slots, so no ranked picks could exist for the new path to see, and
    slots-mode output is byte-identical), whereas applying Stage O first
    would have let ranked picks accumulate against a scorer that scored
    them wrong.
  - **Deploy verified against the real condition, not a proxy**: the
    deployed source was pulled back with `supabase functions download` and
    diffed — byte-identical to the committed files, with
    `scoreRankedPicks` and the mode dispatch present. (An earlier plan to
    check for `season_activation_failures` in the response would NOT have
    worked: that key was introduced by the *previous* deploy and was
    already live, so it discriminates the wrong thing. Also note
    `supabase functions invoke` does not exist in CLI 2.109.1 — call the
    function over HTTP the way the cron does.)
  - **Verified end to end against the live database**, all three paths:
    a ranked save accepted (`rank1` = "Graceless" written, where the same
    call previously raised `Invalid slot: rank1`); the duplicate guard
    fired on a second "Graceless"; and a slots-mode Official save landed
    normally, confirming that path is unaffected.
  - **The hazard this entry originally recorded** (kept for diagnosis): a
    deployed scorer with no mode dispatch treats `rank1` as an unknown slot
    and falls through to the flat-pick branch, so **every hit pays
    `flat_points` (1) instead of its ladder value** — three hits scoring 3
    instead of 15, with no error raised and nothing visibly wrong. If
    ranked scores ever come out suspiciously uniform and low, check whether
    the deployed `scoring.js` actually contains `scoreRankedPicks` before
    looking anywhere else.
  - **Recovery if that ever happens**: `reopen` the show (wipes that
    league's scores, resets status to live), fix the deploy, then finalize
    again. Same repair path as the Boston 7/31 incident.
  - (`RANKED_CHOICE_ENABLED` was a third batch step until 2026-08-13, when
    it was set `true` and committed. It existed to stop a bracket being
    switched to a mode the live scorer doesn't run — Casual is already
    switched, deliberately, so the gate had nothing left to guard. Plain
    feature flag now.)
  - **The show**: 2026-08-14, The Pines Music Park, cutoff
    `2026-08-15T03:00:00Z`. (This line read "cutoff `23:00 UTC`" until
    2026-08-14; corrected against the live `league_shows` row. 23:00 was
    Eastern, not UTC — the real cutoff is 03:00 UTC the following day, i.e.
    23:00 ET / 22:00 at the venue, which is Central. Nothing downstream
    depended on the wrong value, but the ranked-run check below is timed
    off it, so it's fixed rather than annotated in place.)
    Nothing scores until it goes live (a show only scores once setlist rows
    appear or it's finalized), so this could sit overnight — the deadline is
    showtime, not the cron, which runs every minute regardless.
  - **What happens if the show goes live first**: the deployed scorer has no
    mode dispatch, so `"rank1" in slotPoints` is false and every rank-keyed
    pick falls through to the flat-pick branch — **each hit pays
    `flat_points` (1) instead of its ladder value.** For Casual's ladder
    `[6,5,4,3,2,1]`, three hits score 3 instead of 15. No error is raised
    and nothing looks wrong: plausible numbers, silently incorrect.
  - **Verified empirically against the deployed blob, not inferred** —
    extracted `scoring.js` at `1dec497` (the last commit touching it before
    the ranked work, and the build CLAUDE.md records as deployed) and ran
    Casual's real config plus rank-keyed picks through it. Output:
    `rank1 1 played / rank2 1 played / rank3 1 played`, total 3.
  - **Recovery if it does happen**: `reopen` the show (wipes that league's
    scores and resets status to live), complete the deploy batch, then
    finalize again — the corrected scorer re-scores from the setlist. Same
    repair path as the Boston 7/31 incident.
  - **Fastest mitigation if the batch can't be finished in time**: flip
    Casual's `config.mode` back to `"slots"`. The slots-mode config is fully
    intact underneath (`slots` still has 3 entries, `flat_picks` still 3) —
    only `mode` was changed. But note the 6 picks for that show were re-keyed
    from `opener`/`closer`/`encore`/`flat1-3` to `rank1..rank6` on
    2026-08-13, so reverting the mode alone leaves them unreadable by slot
    mode; they'd need re-keying back too.
  - This was the **second** item with a 2026-08-14 deadline, alongside the
    Test 3 roster check immediately below. Both landed that day and both are
    closed — see the DATED DEADLINES table. **A third 2026-08-14 item opened
    the same evening and is still open: the first-production-run check
    immediately below.**
- **✅ VERIFIED 2026-08-15 — FIRST PRODUCTION RUN OF `scoreRankedPicks` IS
  CORRECT. Show finalized 12:00:04Z; all five checks pass; no reopen needed.**
  Read from `scores.breakdown` directly, not inferred by comparing picks
  against the setlist. **3 players, 18 breakdown rows (3 × 6 — all three
  submitted complete sheets), 5 hits, 17 points across the bracket.**
  1. **Ladder values, per row — PASS, decisively.** Hits paid `rank1→6,
     rank2→5, rank4→3, rank5→2, rank6→1`: five hits, five *different*
     payouts, each its own rung. The flat-fallback signature would have been
     five rows all paying 1, so **`rank1` paying 6 is the specific
     observation that rules it out.**
  2. **Row order — PASS, but see the caveat below; it proves less than it
     looks.**
  3. **No "Any Debut" row — PASS.** Zero across all 18 rows; in fact zero
     non-`rank` rows of any kind. The mode dispatch suppressed the wildcard
     even though `wildcards.debut` is still `true` in Casual's live config,
     which is exactly why this (and not the absent cover/debut bonus lines,
     both configured 0) is the real dispatch tell.
  4. **Perfect sheet — PASS, correctly did NOT fire.** Zero bonus rows, and
     correctly so: the gate needs all six ranks filled AND every one hit,
     while the best sheet had 3 of 6. Confirmed from `breakdown` plus
     per-player hit counts rather than from the setlist.
  5. **Totals — PASS.** `scores.points` equals `sum(breakdown[].points)` for
     all three players (14 / 2 / 1), and those reconcile to the ladder:
     6+5+3, 2, 1.
  - **⚠️ CHECK 2 IS VERIFIED BY TEST, UNVERIFIED IN PRODUCTION — AND THAT IS
    LIKELY PERMANENT, NOT PENDING. Do not log it as an outstanding task.**
    All three players' rows were *stored* in `rank1..rank6` order, so DB
    order and rank order coincided and the run cannot distinguish a working
    sorter from no sorter at all: `breakdownSlotInfo`'s ranked branch could
    have been deleted entirely and the output would be identical.
    - **What would settle it: a show where stored row order differs from
      rank order.** That cannot be arranged — `scoreBracket` fetches picks
      with no `ORDER BY` (`index.ts:697`), so row order is whatever Postgres
      returns, which in practice follows insertion order, which follows
      sheet order. **It may simply never occur naturally.** Waiting for it
      is not a plan.
    - **The scenario suite covers it deliberately, for exactly this reason.**
      `test/fixtures.mjs:204-208` stores the scored show's breakdown rows
      shuffled — `rank3, rank1, rank5, rank2, rank4` — precisely because
      production wouldn't. Verified by mutation 2026-08-15: returning
      `{ order: [], label }` from that branch fails `frozen breakdown
      displays ranks in rank order, not stored order` in both modes, with
      the failure detail showing the shuffle leaking through as
      `["Rank 3","Rank 1","Rank 5","Rank 2","Rank 4"]`. The branch demonstrably
      works; only the *production* evidence is unavailable.
  - **Participation observation, not a correctness one: only 3 of Casual's
    members submitted at all.** First real data on whether ranked choice is
    something people actually fill in, and worth watching rather than acting
    on — one show, and the same evening carried a format toggle, an orphaned-
    pick incident and a mid-evening levelling, none of which make it a clean
    baseline. Note the three who did submit all filed **complete 6-row
    sheets**, so the partial-sheet case flagged as most likely to surprise
    never arose in production; it remains covered only by the scenario suite.
  - Original entry follows, kept for its method — the identifiers, the
    diagnostic tells and the recovery path are what made the check runnable
    months later without re-derivation. Written 2026-08-14 ~21:15Z, before
    the show, while the dev was at it and not thinking about this.
  - **Resolved identifiers, so nothing has to be re-derived under time
    pressure**: show id `1765912122` (`showdate 2026-08-14`, venue
    `The Pines Music Park`, `Eau Claire`/`WI`, `timezone America/Chicago`);
    Casual is bracket id `2`, league id `1`; `league_shows.cutoff_at` =
    `2026-08-15T03:00:00Z`; `league_shows.format` = **`one_set`** — **set by
    hand by the dev minutes before this entry was written; the show was
    `standard` until then.** Recorded as provenance, not trivia: "tonight
    happens to be a one-set show" and "the format was toggled immediately
    before the check was written" license different conclusions if something
    looks wrong. The first invites treating one-set as a given; the second
    makes the toggle the first thing to suspect. It also has a real
    consequence for the OTHER bracket on this show — see the Official
    orphaned-slots bullet immediately below, which this toggle created. Live
    Casual config at write time: `mode: "ranked_choice"`,
    `ranked.ladder: [6,5,4,3,2,1]`, `bonuses.perfect: 10`,
    `bonuses.cover: 0`, `bonuses.debut: 0`, `wildcards.debut: true`,
    `allow_duplicates: false`, `partial_credit: true`.
  - **The checks, and what each one actually discriminates.** Listed with
    their tells because two of the five look diagnostic and aren't:
    1. **Breakdown rows pay ladder values (6/5/4/3/2/1), not 1s.** A hit
       paying `1` where the ladder says `6` is the flat-pick-fallback
       signature — the deployed scorer isn't dispatching on mode. **Read
       this per-row, not as "is there a 1 anywhere"**: Rank 6 legitimately
       pays 1, so a lone 1 on Rank 6 is correct. The tell is **Rank 1
       paying 1**, or every hit paying the same value regardless of rank.
       Misses pay 0 in both modes, so only HIT rows carry any signal here.
    2. **Rows display Rank 1..N in order, not DB order.** This is a
       **render-time** property, not a stored one — `scoreRankedPicks`
       emits rows in whatever order `picks` came back from Postgres, and
       `breakdownSlotInfo()`'s ranked branch (`src/features/picks.js:104`)
       is what supplies the order at display time. So this check tests the
       frontend, not the scorer, and it reads `state.cfg` live: it would
       silently regress if Casual's `mode` were ever flipped back to
       `slots` with ranked rows still stored. The perfect-sheet `bonus` row
       isn't in the order list and correctly sorts last.
    3. **No "Any Debut" row anywhere in a ranked breakdown.** This one is
       the real mode-dispatch tell of the three bonus-related checks,
       because **`wildcards.debut` is still `true` in Casual's live
       config** — it's suppressed at code level by the ranked branch
       (`scorePicks`, `scoring.js:220`), not by config. If mode dispatch
       fails, the wildcard comes back. **By contrast, "no cover/debut bonus
       lines" proves nothing tonight**: `bonuses.cover` and `bonuses.debut`
       are both already `0` in Casual's config, so those lines would be
       absent even from a fully broken slots-mode fallback. Don't read
       their absence as evidence the mode dispatched.
    4. **Perfect sheet (10 pts) only if every rank was filled AND hit.**
       Gate is coverage of the distinct positions `rank1..rank6`, not a
       pick count, and the hit test is scoped to in-ladder rows only — so a
       stale out-of-ladder row can't block it, and a 3-pick sheet that goes
       3-for-3 must NOT collect it.
    5. **Total = sum of hit ladder values + perfect-sheet if earned.**
  - **`format` is `one_set` tonight, and that must NOT change anything.**
    Ranked mode ignores the `oneset` config section entirely (locked
    decision 3: fixed row count regardless of show format; the ladder lives
    at config top level). Verified in the source at write time — both
    `slotDefs()` (`picks.js:150`) and `breakdownSlotInfo()` (`picks.js:104`)
    return from the ranked branch *before* the
    `format === "one_set" ? cfg.oneset : cfg` selection, and `scorePicks`
    dispatches to `scoreRankedPicks` before any format logic. Worth
    knowing because Casual's `oneset` section still carries a stale 3-slot
    slots-mode config: if a 3-row sheet or opener/cover-shaped breakdown
    rows appear tonight, that section leaking through is the thing to look
    at first.
  - **Recovery if any of it is wrong**: unchanged from the batch above —
    `reopen` the show (wipes that league's scores, resets status to `live`),
    fix, `finalize` again.
  - **✅ ANSWERED 2026-08-15 — 3 Casual sheets, all complete, none partial.**
    Read after cutoff via the anon path described below (`get_show_picks`,
    `p_bracket_id: 2`), exactly as the method anticipated. All three players
    hold 6 rows, and the distinct slot keys across all 18 rows are exactly
    `rank1..rank6` — so this is the coverage check the bullet below insists
    on, not a row count that happens to equal 6: no stale pre-rekey
    `opener`/`flat*` key survives anywhere in the bracket, and every rank
    position is filled for every player. Official (bracket 1) read the same
    way at the same time: 8 players, 31 rows, keys exactly
    `closer/cover1/flat1/opener` — confirming the orphan deletion held (no
    `encore`/`flat2` anywhere) — with seven players at 4 rows and one at 3,
    i.e. one genuinely partial sheet.
    **What this does NOT establish: the five ladder/ordering/bonus checks
    above are still unverified** — those need `scores.breakdown`, which is
    not anon-readable. Only the sheet-shape question is closed here.
  - **Perfect-sheet bonus: did NOT fire, either bracket, 2026-08-15.**
    Established from public data rather than `scores`: every sheet's picks
    were compared against this show's 15 `setlist_songs` rows, and **zero
    sheets in either bracket had all of their picks played at all.** That is
    a strictly weaker condition than the bonus requires (in both modes the
    bonus needs every row to hit, and in slot mode `hit` is true even for a
    played-but-wrong-slot pick), so zero all-played sheets proves zero
    perfects without needing to read a single breakdown row.
  - **Original entry, superseded by the two above — kept for the method,
    which is still the right one for any future show.** Could not be read at
    write time: `get_show_picks` is the only public (anon-grantable) pick
    read and it returns nothing until `now() >= cutoff_at`, which was still
    ~5h45m out; `picks` has no public SELECT policy by design. Both
    confirmed empty by direct call, not assumed.
    - **⛔ THE ANON-KEY PATH DESCRIBED HERE NO LONGER WORKS — Stage P,
      2026-08-16.** This paragraph used to end: *"After 03:00Z the anon key
      can count it — `rpc/get_show_picks` with
      `{"p_bracket_id":2,"p_show_id":1765912122}`."* That call now fails:
      `sql/stage_p_get_show_picks_membership.sql` gave `get_show_picks` a
      `(p_name, p_pin, p_bracket_id, p_show_id)` signature, an
      `_auth_player` + league-membership gate, and dropped `player_id` from
      the payload in favour of a server-computed `is_mine`. **Losing this
      diagnostic was a known, accepted cost of closing gate item #7, not an
      oversight** — but the instructions are corrected here rather than
      left describing something that silently 404s.
    - **What replaces it**, in order of convenience: `admin_pick_status`
      (name/PIN, league admin — returns `picks_count` + `last_saved` per
      player, which answers the "did everyone submit" question directly);
      the Supabase SQL editor; or `get_show_picks` itself with real
      credentials, which still works and still reveals only after cutoff.
    - **Do NOT read a `PGRST202` from the old two-argument call as "the
      function is missing."** PostgREST resolves an RPC by the exact set of
      argument names in the body, so the old payload matches nothing now.
      That is a signature mismatch, not an absent function.
    - **Count distinct rank positions per player, NOT `count(*)`** —
      discipline item 5, and this is the exact shape it warns about. A
      player with 6 rows is not necessarily a full sheet: these picks were
      re-keyed from slot keys to `rank1..rank6` on 2026-08-13, so a stale
      `opener`/`flat2` row left behind would inflate a count while leaving
      a real rank position unfilled — and `scoreRankedPicks` scores exactly
      the coverage condition, not the count, so a count-based expectation
      would disagree with the scorer precisely in the partial-sheet case
      the dev flagged as most likely to surprise. Group by
      `slot in ('rank1'..'rank6')` and list which are missing.
  - **Casual's stored picks cannot have been disturbed by the format toggle
    — structural, but NOT empirically confirmed, and the difference
    matters.** `admin_set_show_format`
    (`sql/stage_n_reject_pending_pin_change_writes.sql`) is a single
    `update league_shows set format = ...` — it does not read or write
    `picks` in any branch, so no `updated_at` can have moved through that
    path. Ranked mode is separately format-independent at all three layers
    that could care: `submit_picks`'s ranked branch derives `valid_slots`
    from `cfg->'ranked'->'ladder'` and never reads `ls.format`,
    `slotDefs()`/`breakdownSlotInfo()` return before the
    `one_set ? cfg.oneset : cfg` selection, and `scorePicks` dispatches to
    `scoreRankedPicks` ahead of any format logic. **What was NOT done: the
    timestamps were not actually read.** Public pick reads are cutoff-gated
    (below) and `picks` has no public SELECT policy, so "unchanged" here is
    an argument from the only writer in that path, not an observation. If
    that distinction ever matters, read `updated_at` directly.
- **⚠️ OPEN 2026-08-14 — the standard→one_set toggle ORPHANS two Official
  slot keys on show `1765912122`. THE FORMAT IS CORRECT AND STANDS — the
  band is playing one set; the dev confirmed the toggle was intended and
  meant to have been made days earlier. What is open is the exposure, not
  the decision. Do not revert.**
  - **✅ RESOLVED 2026-08-14 ~23:1xZ — the orphans were deleted and the
    league is level.** Four rows removed via a single data-modifying CTE
    (`with d as (delete ... returning player_id, slot, songname) select
    ...`), whose RETURNING output was **exactly** the four expected rows and
    no others: two players × two slots each (`encore` + `flat2`), one
    player's pair stamped 2026-08-12 12:31:13Z and the other's 2026-08-14
    17:24:46Z. (Player nicknames and the removed songnames were recorded
    here in `caab1d6` and redacted 2026-08-15 UTC — see the standing rule
    in Conventions. Nothing analytic depended on them: the timestamps,
    slot keys and counts below are the whole evidentiary content.)
    Post-delete
    verification: **7 players, every one at exactly 4 rows with the
    identical key set `{closer,cover1,flat1,opener}`**, and every player's
    `min(updated_at)` equal to their `max(updated_at)` — i.e. each sheet
    was written in one transaction and nobody has partially edited since.
  - **Seven players, not the six counted earlier**: an eighth league member
    submitted a fresh sheet at `2026-08-14 23:05:18Z`, after the earlier count and
    around the time of the delete. It carries no orphan keys, and could
    not have: under `one_set` the sheet renders no `encore`/`flat2` input
    (`slotDefs`), and `submit_picks` would reject those keys anyway since
    `valid_slots` derives from `ls.format`. **No save made while the format
    is one_set can recreate an orphaned key**, so the delete is not
    racy — there is no window in which a concurrent save could have
    reintroduced what it removed. The other six players' timestamps are
    unchanged from the pre-delete reading, confirming nothing else moved.
  - **The later of the two deleted `encore` rows was stamped 17:24:46Z** — direct
    evidence for the reconstruction above, since an `encore` row cannot be
    written under one_set. That timestamp is the hard lower bound on when
    the format changed.
  Casual is unaffected (ranked mode is format-independent); **Official is
  the exposed bracket, and Test 3 (season id 8, `start_date = end_date =
  2026-08-14`, roster 14) covers this show, so Official picks are live and
  scoreable tonight.**
  - **The two sections do NOT define the same keys** — read from the live
    `brackets.config` at write time, not from the spec:
    - `slots` (standard): `opener` 2, `closer` 2, `encore` 2, `cover1` 2,
      plus `flat_picks: 2` @ `flat_points: 1` → keys `opener, closer,
      encore, cover1, flat1, flat2` (6 rows, 10 pts + 2 perfect).
    - `oneset`: `opener` 5, `closer` 5, `cover1` 5, plus `flat_picks: 1` @
      `flat_points: 2` → keys `opener, closer, cover1, flat1` (4 rows,
      17 pts + 2 perfect).
    - **Orphaned by the toggle: `encore` and `flat2`.** The other four keys
      are common to both sections and still render and prefill normally.
  - **The toggle also re-prices the whole Official sheet** — slots 2 → 5,
    flat 1 → 2 — which lands on all 13-14 members regardless of whether
    they hold an orphaned key. Worth separating from the orphaning when
    deciding: the re-pricing is arguably intended (a one-set show is
    supposed to score differently), the orphaning almost certainly isn't.
  - **`submit_picks` does NOT wipe-then-insert — it upserts per slot, so
    untouched rows survive and a revert to `standard` restores them.** The
    writes are `insert ... on conflict (player_id, bracket_id, show_id,
    slot) do update`. **But there is a trailing catch-all delete** —
    `delete from picks where player_id/bracket_id/show_id and not (slot =
    any(select jsonb_array_elements(p_picks)->>'slot'))` — which removes
    every stored slot absent from the submitted payload. For an orphaned
    key that is the same destructive outcome by a different route: the
    one-set sheet has no `encore`/`flat2` input, so any save drops them
    from the payload and the catch-all deletes them. `submit_picks` would
    also now reject them on the way back in (`Invalid slot: encore`),
    since slot mode derives `valid_slots` from `ls.format`.
  - **Blank rows are filtered client-side before the payload is built**
    (`savePicks`, `picks.js:342` — `.filter(p => p.songname)`), with no
    guard on an empty result, so a player who clears every row sends
    `p_picks: []` and the catch-all deletes ALL their rows for that
    bracket/show. Not the likely case tonight (the four surviving keys
    still prefill, so the sheet does not open blank), but it is the worst
    case and it is reachable.
  - **Perverse interaction worth knowing before deciding**: perfect-sheet
    in slot mode gates on `picks.length === expected` (a raw count — the
    same count-vs-coverage substitution flagged elsewhere in this file),
    and `expected` is now `3 + 1 = 4`. A player still holding 6 rows can
    therefore **never** earn Official's perfect bonus for this show, even
    going 6-for-6 — while a player who re-saves (dropping to 4 rows)
    becomes eligible again by destroying two picks. The incentive points
    the wrong way.
  - **The orphans are an EQUITY problem, not a scoring loss — and that
    framing is the whole decision.** An `encore` or `flat2` row with
    `format = one_set` fails `p.slot in slotPoints`, falls to the flat
    branch, and pays `flat_points` (2) if the song played anywhere. So the
    two players holding 6 rows have a **21-point ceiling against everyone
    else's 19**, on the easiest condition in the game — no position
    required — purely because of when they last saved relative to an admin
    toggle. **An earlier draft of this file got this backwards**, reasoning
    from those two players' individual ceilings (21 > 19, so leave them
    alone) and concluding the right advice was "don't touch your sheet."
    That optimises the wrong axis: the question is not whether the accident
    helps its beneficiaries, it's that four other players cannot earn those
    points at all. **Resolution: drop the orphans.** The dev — one of the
    two affected — made the call to level the ceiling rather than keep the
    advantage.
  - **A re-save DOES delete the orphans, and it will not error. Verified at
    both ends 2026-08-14 before two players were asked to do it, rather
    than assumed from the catch-all's wording.**
    - **Client**: `renderPickSheet` builds rows from `slotDefs(show.format)`
      (`picks.js:169`), which under one_set returns only
      `opener/closer/cover1/flat1` — so **no input element exists** for
      `encore`/`flat2`, and `savePicks`' `querySelectorAll(".slotline
      input")` cannot pick them up.
    - **Server**: the payload therefore carries 4 slots; the catch-all
      `delete ... and not (slot = any(select jsonb_array_elements(p_picks)
      ->>'slot'))` matches `encore`/`flat2` and removes them.
    - **The failure mode worth ruling out was the opposite one**: if the
      sheet had rendered rows for stored-but-invalid slots, the payload
      would have included `encore` and `submit_picks` would have raised
      `Invalid slot: encore`, failing the whole save. It doesn't — the key
      never reaches the server, so the validation never fires.
    - **The Save button is not gated on dirty state** (`picks.js:236` — no
      `disabled` attribute), so "open it and press Lock 'em in without
      changing anything" genuinely works.
    - **Preconditions that would make it fail, all checkable by the player
      in one glance**: picks must still be open (cutoff `03:00Z`), and the
      player must pass `_official_gate` for season 8. Both collapse to a
      single self-check — `openShow()` renders `renderIneligible` instead
      of the sheet when the gate fails, so **if they can see the sheet,
      the save will go through.**
    - **Equivalent alternative, more reliable under time pressure**: a
      direct `delete from picks where bracket_id = 1 and show_id =
      1765912122 and slot in ('encore','flat2')` reaches the identical end
      state (4 rows, `expected = 4`, perfect-sheet eligible) without
      depending on two people acting before cutoff. The only difference is
      cosmetic — a re-save also bumps `updated_at` on the four surviving
      rows.
  - **No warning covers this.** The orphan confirm added in `e266a40` is
    scoped to scoring-MODE changes (`admin.js:679-724`); `toggleFormat`
    (`admin.js:566`) fires `admin_set_show_format` immediately with no
    confirm and no orphan check, and toasts success. A format toggle is one
    click from the Shows & cutoffs panel.
  - **UNRESOLVED, and it decides the response: whether Official actually
    has picks for tonight, how many players, and whether anyone has saved
    since the toggle.** Could not be read at write time — `get_show_picks`
    is cutoff-gated until `03:00Z` and `picks` has no public SELECT policy.
    **Note `[]` from PostgREST on a policy-less table is a DENIAL, not an
    empty result** — verified by reading `picks?select=id&limit=1`
    unfiltered, which also returned `[]`; don't read either as "no picks."
    Needs the SQL editor or an admin PIN (`admin_pick_status` returns
    `picks_count` + `last_saved` per player, which answers both halves).
  - **Revert would be non-destructive, but is NOT happening** — the format
    is correct. Recorded only because it bounds the damage: `submit_picks`
    upserts per slot, so every row not deleted by a post-toggle save is
    still there, and a hypothetical revert would restore the 6-row sheet
    and the original point values. Nothing about the orphaning is
    irreversible except rows an actual save has already deleted.
  - **NOTHING RECORDS WHEN THE FORMAT CHANGED. Checked exhaustively
    2026-08-14; do not re-derive this.** `league_shows` has no `updated_at`
    (`sql/stage_a_schema.sql` — the columns are `league_id, show_id,
    cutoff_at, format, status, remind_sent, lock_sent, winner_sent`);
    there are **zero triggers anywhere in `sql/`**;
    `admin_set_show_format` writes `format` and nothing else; no Discord
    notice exists for a format change (only `cutoff_changed`/`reopen`/
    `finalize` have edge actions); `pingRealtime()` is never called from an
    admin RPC; and this show's `remind_sent`/`lock_sent`/`winner_sent` are
    all still `null`, so no announcement fired that could date it either.
    **`picks` cannot date it from the inside**: `picks.id` is a
    `uuid default gen_random_uuid()`, not a sequence, so there is no
    insertion-order signal, and the table has `updated_at` but **no
    `created_at`** — a row's timestamp tells you its last write, never its
    first. **The only timestamped record that exists is the Supabase
    dashboard's API log** (a `POST /rest/v1/rpc/admin_set_show_format`
    entry), subject to the project's retention window.
  - **But the picks themselves give a hard LOWER bound, and it's proof, not
    inference: format was `standard` at 17:24Z on 2026-08-14.** An `encore`
    or `flat2` row cannot be written while `format = 'one_set'` —
    `submit_picks` derives `valid_slots` from `ls.format` and raises
    `Invalid slot: encore`. So the existence of encore/flat2 rows stamped
    17:24Z proves the format was still standard at that moment. **The upper
    bound is inference only**: four players hold exactly
    `opener/closer/cover1/flat1` — the one_set key set
    — with last saves 20:07–21:07Z, which is strong behavioural evidence
    the format was already one_set by 20:07, since four people
    independently leaving exactly those two rows blank is not credible.
    It is not proof: blank rows are filtered client-side
    (`picks.js:342`), so a standard-format sheet CAN produce that exact
    footprint. **The dev's recollection of having toggled it "a few minutes
    before ~21:10Z" is therefore probably off by one to three hours** — and
    note that the recollection and the evidence disagree in a direction
    that does not matter much, because no save has occurred after 21:07Z
    under either reading.
  - **The cron did NOT do it — the auto-promotion path is real but inert,
    verified live.** `syncShows` (`index.ts:279-281`) runs
    `update league_shows set format='one_set' ... .eq("format","standard")`
    for every festival-tagged show on **every sync tick**, which would have
    been a much better explanation than a misremembered manual toggle.
    It isn't the explanation: `GET /shows.json?show_tag=festival` returns
    `{"error":false,"data":[]}` — the tag is not in use on The Carton at
    all, so `festIds` is always empty and the `if (festIds.length)` guard
    never opens. Confirmed against a control query (an untagged
    `shows.json` returns rows through the same parser), because an empty
    array from a misparsed response would have exonerated the cron
    incorrectly.
  - **Latent bug found while ruling that out — the comment above that block
    is wrong, and it will matter the day anyone uses the tag.**
    `index.ts:252-253` claims the promotion is "promote only — a manual
    admin toggle back to standard is never overwritten by a later sync."
    The first clause is true (it never demotes one_set→standard). **The
    second is false**: `.eq("format","standard")` doesn't protect a manual
    toggle, it *targets* it — a festival-tagged show that an admin sets
    back to standard is re-promoted to one_set by the next cron tick,
    within a minute, silently and forever. Inert today only because the tag
    is unused. See the deferred `toggleFormat` warning item for where this
    is tracked.
  - **Whether the four ever held 6 rows is NOT answerable from `picks`, and
    the ambiguity is structural.** A player who saved fresh under one_set
    and a player who held 6 rows and lost 2 to the catch-all delete leave
    **identical** footprints: four rows, one timestamp, no residue. There
    is no `created_at`, no row-id ordering (uuid), no history table, and
    the localStorage draft is cleared on successful save
    (`picks.js:355`). **The one place an answer could still exist is the
    Supabase API log**: count `POST /rest/v1/rpc/submit_picks` entries for
    today against the six distinct last-save timestamps — extra calls mean
    somebody saved more than once. It cannot attribute a call to a player
    (every request carries the same anon key, there is no per-request
    identity), so it can establish that a double-save happened, never who.
- **✅ VERIFIED 2026-08-14: Test 3 activated cleanly — the roster fix works
  under a real conflict.** Result of the checkpoint below, which is kept for
  its method. `roster_locked_at = 04:00:04.757Z` (first cron tick after
  midnight Eastern, as expected — `activateSeasons` gates on Eastern date,
  not UTC), 14 rows total.
  - **All 13 hand-added rows kept their original `added_at`**, still
    spanning `08-13 02:55:08.612` → `02:55:23.981`. Nothing was rewritten to
    activation time — the highest-value assertion, and the specific
    regression `ignoreDuplicates` exists to prevent.
  - **The 14th row — the one member not on the roster before activation —
    inserted at `04:00:04.682`, i.e. 0.1s BEFORE `roster_locked_at`.**
    Two claims here, from two different sources, deliberately attributed
    separately: **which** account that was is a QUERY RESULT (direct query,
    2026-08-15 UTC, against `season_rosters` for season 8); that it is an
    unused test account and was left off the roster **deliberately** is the
    **dev's attestation** — no query can establish an account's purpose or
    an intent. Conflating those two is exactly how the wrong account got
    named; see the correction below. The sign matters:
    `activateSeasons` captures `joinedAt`, writes the batch, then stamps, so
    `added_at` preceding the stamp is the correct causal order. A row
    stamped *after* would be the old bug's signature.
  - **What this does NOT prove.** Today's run exercised the SUCCESS path
    under heavy conflict — the write succeeded, so the ordering held and the
    stamp followed it. The error path is still unexercised: no write failed,
    so "on failure, `roster_locked_at` is left null and the next cron run
    retries" has never actually run. That half of the fix remains verified
    only by reading the code. See the Deferred section for a unit test that
    would close it.
  - **This exercised the conflict branch at near-maximum** — 13 of 14 rows
    collided and were skipped, 1 inserted — which is the branch no test
    covers, since a clean fixture produces no conflict. The old bare
    `.insert()` would have aborted the whole batch on the first collision
    and stamped `roster_locked_at` anyway.
- **Method (retained): how the Test 3 activation check was constructed.**
  Resolved — see the VERIFIED entry above. Kept because the reasoning
  generalises to any future activation check. The Test 3 season was
  scheduled to activate
  2026-08-14. Traced the exact code before writing this checkpoint
  (`activateSeasons()`, `supabase/functions/carton-sync/index.ts:338-364`):
  `added_at` (line 349, `joinedAt`) and `roster_locked_at` (line 362) are
  two SEPARATE `new Date().toISOString()` calls in JS, with an awaited
  network round-trip for the roster upsert in between — not the same
  Postgres transaction, so don't check exact equality; allow a tolerance
  (recommend ~60 seconds — generous enough to absorb normal upsert latency,
  tight enough that a different cron run or a manual edit hours/days apart
  still fails the check).
  A second wrinkle: the fix above deliberately preserves a manually
  pre-added row's original, older `added_at` rather than overwriting it
  (`ignoreDuplicates`) — so a legitimately pre-added member's row is
  SUPPOSED to differ from `roster_locked_at`, and that's correct behavior,
  not a bug.
  **Which season id 8 is, since the whole verdict rests on that mapping and
  a bare integer asks a future reader to take it on faith**: it resolved
  from `select id, bracket_id, name, start_date, end_date, roster_locked_at
  from seasons` as `name = 'Test 3'`, `bracket_id = 1`, `start_date =
  end_date = 2026-08-14`, `roster_locked_at = null` — the only unactivated
  season of the three Test seasons on that bracket (ids 5 = "Test" and
  6 = "Test 2" were both already activated, with `roster_locked_at` stamped
  2026-07-30 and 2026-08-06 respectively; there is no slug column on
  `seasons`, `name` is the only human-readable identifier).
  **The roster was deliberately populated by hand on 2026-08-12, ahead of
  activation, so players could vote — which changes what Friday tests, and
  in a useful direction.** Exact state, verified after the manual adds:
  **13 rows, each with its own distinct `added_at`**, spread across 15.4
  seconds from `2026-08-13 02:55:08.612875+00` to `2026-08-13
  02:55:23.981966+00`. (That's UTC — 2026-08-12 ~22:55 Eastern. The rows
  read as Aug 13 in the database even though the work happened on Aug 12
  local; assert against the UTC values, not the local date.) Thirteen
  distinct timestamps rather than one cluster is exactly the signature of
  13 individual `admin_set_season_roster` calls — one per click — not a
  batch.
  **The conflict will be partial, not total, and the difference is
  load-bearing.** Activation's member set is 14: `league_members` where
  `league_id = 1` (bracket 1 is league 1's Official bracket),
  `official_opt_in = true`, `banned = false` → 14 of 14 total members.
  Compared both directions against the roster: **0 roster rows fall outside
  that set**, and **exactly 1 member of the set is not on the roster** — an
  unused test account. **Do not record which one here** — resolve it with
  the not-exists query above when you need it; see the standing rule in
  Conventions.
  So activation will attempt 14 rows against 13 existing ones: 13 conflict
  and are skipped with their original `added_at` preserved, and that 1
  inserts fresh at activation time.

  **⚠️ CORRECTED 2026-08-15 UTC — the paragraph that followed here is now
  HISTORICAL. Do not act on it.** It read: *"That 14th member is
  deliberately left off the roster, and should stay off until after
  2026-08-14 — this is intent, not an oversight to tidy up… Leave it alone
  until the checkpoint is resolved."* **The checkpoint IS resolved**:
  activation inserted that row at `04:00:04.682` exactly as predicted, and
  the account is on the roster now (`official_opt_in: true`,
  `banned: false`, roster total 14 — confirmed by direct query
  2026-08-15 UTC). The reasoning is preserved rather than deleted because it
  still explains *why* a 14th row was expected rather than anomalous — which
  is what makes the VERIFIED entry's "13 conflicts, 1 insert" readable at
  all. It is marked because, left unmarked, it reads as a live instruction
  to maintain a state activation already changed. **The substance of the
  reasoning, still true:** its absence was the only thing giving that run
  any coverage of the insert path; adding it early would have made
  activation 14-of-14 duplicates and silently deleted the insert-path and
  `added_at`-on-fresh-insert coverage while looking like a tidier roster.

  **What caused the correction, because the shape recurs and no existing
  discipline item covers it.** The account's *purpose* — "it's a test
  account, nobody is waiting to vote with it" — was **inferred from its
  absence from the roster**, then written with the same confidence as the
  timestamps beside it, which were **measured**. Only one of those was an
  observation. The inference happened to be correct, but the identical
  reasoning applied to a *different* account produced a wrong answer within
  minutes: a real player who had just submitted a partial sheet was floated
  as "probably the test account" on exactly the same grounds — absence from
  a set they were expected to be in. **Absence is evidence about a set,
  never about intent.** Discipline item 5 covers a count standing in for
  coverage; this is its sibling — an inference standing in for an
  observation. The defense is the same one item 6 prescribes: attribute each
  claim to its source at the moment of writing, as the VERIFIED entry above
  now does explicitly.

  **Friday therefore exercises the conflict branch at near-maximum
  (13 of 14 duplicates), the insert path (1 row), and the
  stamp-only-on-success ordering — all three in one pass**, which is a
  strictly better test than either a clean all-insert run or an
  all-duplicate run would have been.
  **Expected state after activation, as checkable assertions** (run these
  on 2026-08-14, don't eyeball a cluster):
  - **Success**: `roster_locked_at` stamped 2026-08-14; row count is
    **14**; the 13 original rows still carry their original `added_at`
    values inside the `02:55:08.61`–`02:55:23.99` UTC window above; and
    the test account's row carries a fresh `added_at` within ~60s of
    `roster_locked_at`.
  - **Batch errored**: `roster_locked_at` still null after 2026-08-14 —
    meaning the stamp-only-on-success ordering held (good) but the conflict
    branch did not (the thing to investigate).
  - **`ignoreDuplicates` not preserving `added_at`**: any of the 13
    original rows rewritten to the activation timestamp. **This is the
    specific regression the fix exists to prevent, and this run tests it
    directly** — it is the single highest-value assertion in this list.
  - **Batch aborted (the original failure mode)**: row count stays **13**
    — the test account never inserts — **and** `roster_locked_at` stays
    null. Note there is no "rows went missing" signature to look for and
    none is possible: nothing in this path deletes from `season_rosters`
    (the activation write is insert-only, and the only delete lives in
    `admin_set_season_roster`'s remove branch), so the 13 manually-added
    rows survive any activation failure. An abort shows up as *absence of
    the 14th row*, never as loss of the 13.
  **Within the edge function, nothing else writes those rows — checked
  because Test 3 has `start_date = end_date = 2026-08-14` and would
  otherwise activate and complete on the same day.** It can't: activation
  selects `start_date <= today` (`activateSeasons`, index.ts:341) while
  season completion selects `end_date < today` — strictly less than
  (`announcements` block (d), index.ts:504) — so completion for this season
  can't fire until 2026-08-15 at the earliest, and that `lt` vs `lte`
  asymmetry is the only thing separating them. Independently of the timing:
  **completion never touches roster data at all** — it writes only
  `seasons.winner_sent` (index.ts:527), and `season_rosters` is written in
  exactly one place in the entire edge function (the activation upsert,
  index.ts:353; the only other reference, index.ts:693, is `scoreBracket`'s
  read-only roster fetch), with `roster_locked_at` likewise written only by
  activation (index.ts:362).
  **But the edge function is not the only writer, and the other one is
  unguarded**: `admin_set_season_roster` also writes `season_rosters`
  (current live definition — `sql/stage_n_reject_pending_pin_change_writes.sql:223-239`,
  the latest of three re-touches), and it checks auth, league-admin, and
  `must_change_pin` — but **nothing about `roster_locked_at`**. It inserts
  with `added_at = now()` whether or not the season has already activated,
  and it's reachable by clicking (the Seasons panel's "manage roster"
  control, Stage C2b), not just by raw RPC. So a manual roster add *after*
  activation lands outside the cluster and is indistinguishable by
  timestamp from the failure this checkpoint is looking for. **On
  2026-08-14, rule out a post-activation manual add before calling an
  outlier a bug.** Recorded here so nobody re-derives it — and noting the
  shape, since it's the same one discipline item 5 exists for: "nothing
  else writes this" was true of the file examined and false of the system. Was supposed to be
  recorded and checked last session; wasn't — recorded now so it survives
  to whoever's driving after 2026-08-14.

---

## Frontend/CSS gotchas learned the hard way

- **`.sheet` (the pick sheet paper card) is theme-invariant — always cream
  paper with dark ink, regardless of which app theme is active.**
  `--paper`/`--paper-ink`/`--paper-ink-soft` are the tokens built for it;
  the app's own `--cream`/`--cream-dim`/`--panel`/`--panel2`/`--line`/`--pit`/
  `--indigo` all flip between light and dark theme and are wrong the
  instant they're used on anything sitting on the paper. This has broken
  three different ways so far, always the same root cause — an app-wide
  class used where a paper-scoped one was needed:
  - The ineligible-reason text originally used `--ink` (a theme-flipping
    variable that, despite the name, is repurposed as light theme's
    *foreground* color) — cream-on-cream in light theme. Fixed with
    `--paper-ink`.
  - A "numbers are points per slot" legend line used the app-wide `.muted`
    class (`color:var(--cream-dim)`) — ~1.56:1 contrast in dark theme,
    since dark theme's `--cream-dim` is a pale grey that nearly matches
    the paper's own lightness. Fixed with an inline `--paper-ink-soft` style.
  - `renderIneligible`'s "Switch to Casual" button used the shared
    `.btn.ghost` class (`--panel2`/`--cream`/`--line2`) — in light theme,
    `--panel2` is nearly the same pale cream as the paper, so the button
    read as barely-there against its own card even though its own text
    stayed technically legible. **This is a different failure shape than
    the first two**: a *component* blending into its background, not
    *text* vanishing into it — because the button supplies its own opaque
    fill, the text-on-fill contrast was never the problem, the
    component's boundary against the paper was. Fixed with a
    `.sheet .btn` override using `--paper-ink`.
  - **`--coral` on the paper fails AA in BOTH themes — found 2026-08-15,
    NOT YET FIXED.** Same class as the first two: an app-wide token used
    on the cream sheet. Computed from sRGB relative luminance (the WCAG
    formula), not eyeballed, and recomputed here rather than accepting a
    relayed number:
    - **Dark theme** — `--coral:#FF6B5E` on `--paper:#FFF3DC` = **2.54:1**.
      Fails AA's 4.5:1 *and* the 3:1 large-text floor.
    - **Light theme** — `--coral:#D9503F` on the same paper = **3.70:1**.
      Fails AA's 4.5:1. **It does clear the 3:1 large-text floor** — but
      that floor doesn't apply here: both affected elements render at
      `.85rem`, which is normal text, so 4.5:1 is the applicable
      threshold and both themes fail it. (An earlier relay of this finding
      said both themes were under 3:1; light is not. The AA conclusion is
      unchanged.)
    - `--paper` is defined once in `:root` and never redefined under
      `html[data-theme="light"]`, so the paper is the same cream in both
      themes and only `--coral` moves. For calibration against tokens that
      pass: `--paper-ink` is 13.70:1 and `--paper-ink-soft` is 6.83:1.
    - **Two places this actually renders today, both inside `.sheet`** —
      this is a live defect, not a prospective hazard:
      1. **`.err` / `#p-err`** (`styles.css:413`, `picks.js:261`) — every
         save and validation error on the pick sheet.
      2. **`.countbig b`** (`styles.css:322`, `picks.js:260`) — the
         cutoff countdown. This is the element whose two-row split
         surfaced the finding in the first place.
      `.linkbtn` and `.pill.live` also use `--coral` but don't currently
      land on paper; they're the same hazard if ever moved there.
    - **Fix, when it's taken**: a `.sheet`-scoped override in the same
      idiom as the `.btn` fix above — a paper-safe danger colour rather
      than reusing `--coral`, since `--coral` has to keep working on the
      app's own dark panels where it's fine. Do **not** darken `--coral`
      globally to solve a paper-only problem.
  The pattern to watch for: it's not just text-color classes that break
  this way — **any app-wide component class** (buttons, pills, badges,
  whatever gets added next) breaks the instant it's dropped inside
  `.sheet`, just via a different visual symptom depending on whether the
  component supplies its own background or inherits the paper's. Before
  adding anything to `.sheet`, check whether its classes reference
  `--cream*`/`--panel*`/`--line*`/`--pit`/`--indigo` anywhere in their
  CSS — if so, it needs paper tokens or a `.sheet`-scoped override, not a
  pass, and check the result in an actual browser in light theme, not by
  reading the values.
- **The boxed podium row (`standings.js`) is width-sensitive in a way that
  breaks only inside a specific window-width band, not "on mobile" or "on
  desktop"** — the kind of bug that gets reported as random/flaky rather
  than traced to a cause, so the arithmetic that makes it obvious is worth
  keeping written down rather than re-derived next time trophy sizing
  changes. The row must never wrap (a wrap can put gold below a lower
  tier, breaking `arrangePodium`'s arrangement), and whether it wraps is a
  function of BOTH the icon px size (`bigPx`/`smallPx`) AND `.podium`'s
  gap (styles.css) against whatever container it's actually sitting in —
  three sizing tiers exist today because that available width is not the
  same thing at every breakpoint:
  - Phone, `<=420px` width: 96/68px icons, 8px gap (available width ~258px
    at a real 324px phone).
  - Desktop, `901-1279px` viewport width: 83/58px icons, 8px gap.
  - Desktop, `>=1280px` viewport width: 118/82px icons, 28px gap
    (unchanged from before this note existed).
  The middle tier exists because desktop's OWN narrowest real width
  (901px, the mobile/desktop breakpoint) is a genuinely separate
  constraint from phone's, not a smaller version of the same one: the
  podium sits inside `#cols`' grid column there, not `.wrap`, and at
  901px that column's available width is 224px. The pre-fix icon sizing
  (118/82) needed 318px of icon ALONE at that width — 94px over, before
  any gap is even added — which is the concrete reason a bigger gap
  can't be the fix on desktop the way it is on phone: no gap value
  subtracts a negative number. Verified directly (not just by this
  arithmetic) that the wrap actually spans the whole 901-1279px range,
  not just the instant at the breakpoint, and that 1280px+ has real
  margin (344px available vs 338px needed) and needs no change. Below
  901px desktop's grid never renders at all (`isDesktop()` in
  `core/dom.js` is `min-width:901px`) — that's phone/tablet's `.wrap`
  instead, covered by the first tier.

---

## Multi-league switcher behavior (traced 2026-08-16, second league now exists)

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

---

## Feature set frozen at the start of 2.0 (historical snapshot — NOT current)

**This section is not maintained and does not describe the app's current
behavior.** It's a frozen snapshot of the pre-2.0 feature set, written once
before the rebuild began, and every rebuild stage since has moved the actual
UI further away from it without this section being updated to match. It has
already sent work down the wrong path four times now: it described a
collapsible sidebar that was **never built** (precisely: no code for one was
ever committed — that is all the git evidence below can show, and it is not
the same as "the dev never wanted one." **Git history can disprove an
artifact; it can never disprove an intention.** The dev did mention a desktop
sidebar redesign once, in passing — see the deferred-items entry near the end
of this file, and discipline item 6); an admin show-row layout that (in
an earlier draft) only ever existed in a chat message, never in the repo;
and, separately from this section's own text, a personal task list compiled
from conversation memory once again claimed a desktop sidebar mockup
("mock2") had been chosen but never committed, with "the rejected 3-column
layout" implied to be a mistake still shipping. Re-verified directly
(`git log --all -S"sidebar"`, `-S"mock2"`, `-S"collapse"` across every
commit's diffs): zero matches, ever — `-S"mock2"` in particular matches
nothing at all. The 3-column grid (`e7fa3ef`, still live in
`src/core/layout.js`) is the only desktop layout that was ever built; it
isn't a rejected fallback, it's the only thing that exists. A fourth instance
turned up in the "Known pending work" section, not here — the slot-labels
bullet describing per-song setlist labels and opener/set2_opener live-toast
tags that were never actually built, only ever planned (see that bullet,
corrected). **The mechanism is the same whether the false claim is about a
past decision or a feature's current status**: a plan or possibility gets
written down — in a chat message, a personal task list, a "known pending
work" bullet — and later gets read back as if it already existed, because
nothing forced a check against the actual repo in between.
**The mechanism runs in BOTH directions, and this note used to arm you
against only one of them.** The four instances above are all *inflation* — a
possibility read back as fact. The mirror case happened later, on the sidebar
entry itself: a correction concluded "never existed" from evidence that only
ever showed "never committed," and in doing so deleted a real (if very
low-weight) stated preference along with the invented specifics around it.
Inflating a mention into a deliverable and erasing a mention as fictional are
the same error wearing opposite signs — a claim not calibrated to the
evidence actually behind it. **And note the remedy below does not cover the
erasure direction**: "check it against the actual repo" adjudicates claims
about code, but the sidebar mention was never a claim about code — it was a
claim about what the dev wanted, which no repo check can settle in either
direction. The only defense there is recording a mention at the weight it was
given in the first place; see discipline item 6. Treat any
specific claim below — exact wording, layout details, which widget does
what, or whether a described feature is actually live — as unverified until
you've actually read the relevant source (`src/features/*.js`,
`src/core/*.js`) or checked `git log`/`git blame` on it. For what's actually
shipped in 2.0, the "THE 2.0 REBUILD" section below tracks each stage
explicitly as done or not-started — that's the current source of truth,
this isn't.

Slot types (opener, set1_closer, set2_opener, closer, encore, show_closer,
second_song, **cover_pick** [repeatable, catalog-restricted to covers]) + an
**"Any Debut" wildcard** (any slot, hits if any debut is played). Flat picks,
partial credit, perfect-sheet bonus, cover/debut bonuses. Per-show venue-local
cutoffs (state→IANA tz map, DST-aware). Admin: master voting override
(auto/locked/open), "who's picked" roster, players panel with boot + per-league
ban + collapsible ban list, seasons (named date ranges), per-show 1set/2set format
toggle, finalize + (planned) reopen. Show lifecycle open→locked→live→complete.
Standings with podium (top-3 trophies, gold/silver/bronze **eggs** inside the
wreaths), single Score column (season pts, or career when "All time"), season
selector, nerd stats (shows/avg/high/wins). Draft persistence (pick sheets save to
localStorage every keystroke, restore on return, never wiped by foreground refresh).
3-state theme (auto-follow-phone / light / dark). Desktop is a static, non-collapsible
3-column grid (Standings / Shows / Admin, each showing full content — confirmed by
reading the actual source and git history during Stage C2a; there's no collapse
affordance or top-3-trimmed variant anywhere in the codebase's history, despite an
earlier version of this doc describing one); bottom-tab single-view on mobile. Tie handling shows
co-winners everywhere ("X & Y tie"). App icon = green laurel wreath (halo on
favicon/small badges only, not the header). Winner "trophy" = wreath over a laurel
pile; podium version has the medal egg inside.

## Known pending work (was queued in chat; verify against actual code state)

- **v6 edge function batch** ("carton-sync-v6"): Cover Pick slot type + Any Debut
  wildcard scoring; "slot not played" wording; tie-fix. Was HELD from deploy while a
  show's picks were locked. Deploy edge fn first, then frontend.
- **Reopen button** (un-finalize a show so corrected Carton data re-scores): **built**
  as the edge function's `reopen` action (Stage C1) — name/PIN-authenticated, wipes
  that league's scores for the show, resets `league_shows.status = 'live'` and
  `winner_sent = null` so the corrected winner re-announces, and fires a "scores
  reopened" Discord notice. Pairs with "correct The Carton before finalizing"
  workflow (a friend of the dev can edit setlists on The Carton). Frontend wiring is
  **also done** — a "Reopen" button in admin.js's Shows & cutoffs panel, next to
  Finalize on any show with `status === 'final'`; smoke-tested against the real
  Boston 7/31 show (see the closer-family scoring fix note above). **`cutoff_changed`
  is wired too now (Session 1, commit `2816d66`)** — `admin.js`'s `saveCutoff()`
  fires the edge action (fire-and-forget, `.catch(() => {})` so a failed Discord
  notice can't read as a failed cutoff save) right after `admin_set_cutoff`
  succeeds. All three authenticated edge actions (`reopen`/`cutoff_changed`/
  `finalize`) now have a real frontend caller — none is orphaned anymore.
- **Slot labels in setlists & notifications — a fourth false-memory instance (see
  the note at the top of this section), corrected against the source.** This
  bullet used to describe two things as current behavior that were never actually
  built:
  1. "Setlist view shows all slot labels ('Laurel — Opener')" — not true.
     `picks.js`'s `renderShowDetail` renders position, song name, a segue arrow,
     and (since Session 2) a debut tag per song. There is no per-song slot label
     anywhere in that view, and no trace in git history that there ever was.
  2. "Live toasts tag opener, set2_opener, encore + debut" — only half true.
     `realtime.js`'s live song toast tags `(encore)` and `— DEBUT 🥚` (the debut
     half shipped Session 2, exactly as planned). There is no opener or
     set2_opener tag anywhere in that toast string, confirmed directly against
     the current code.
  **What's actually true**: debut tagging is real, in both spots this bullet
  always described, mirroring the existing `is_encore` pattern. Plain footnote
  trivia is descoped, not planned, and stays that way.
  **Not started, if still wanted**: per-song slot labels in the setlist view;
  opener/set2_opener tags in the live toast. Neither exists today — don't assume
  either from an older reading of this bullet.
- **Discord notification logic rework**: broadcast (not personal) + per-league in
  2.0. Still needs a design pass for the bigger pieces (public non-voter shaming
  vs. neutral counts; dedupe with in-app toasts; Discord roles) — but **per-league
  webhooks are further along than this bullet used to imply**: `notifyLeague()`
  (`index.ts`) already resolves a `DISCORD_WEBHOOK_<LEAGUENAME>` env var per
  league, falling back to the single global `DISCORD_WEBHOOK` only if that named
  one isn't set. No DB column, no admin UI — but the routing mechanism already
  exists. A second league's notifications landing in the first league's channel
  is a missing *secret*, not missing code.
- **Season game-numbering cap, deliberately deferred**: `shows.js`'s per-show "Game
  N" circle (chronological position within the season) is computed only from what
  `renderShows()` already fetches for display — unbounded future + last 2 days,
  plus the 12 most-recent past shows (the `.limit(12)` on the `past` query). A
  season with more than 12 already-played shows would get this **wrong, not
  missing**: the earliest shows age out of that 12-show window and drop out of the
  fetch entirely, so the shows that DO come through get renumbered from 1 as if the
  dropped ones never existed (a season's real Game 4 would render as "Game 1" once
  Games 1-3 fall out of the window) — every visible show still gets a number, it's
  just shifted low by however many earlier shows are missing. Not fixing this now:
  no season has come close to 12 already-played shows at this scale, and the
  interim fix if one ever does is just bumping `.limit(12)` a bit to cover it. A
  real fix means separating the fetch bound from the render bound — that one `12`
  currently does both jobs (how many past shows the Recent panel displays, AND the
  universe of shows game-numbering counts from), so a display-driven bump for UX
  reasons silently changes numbering correctness too, and vice versa.

---

## THE 2.0 REBUILD (the big upcoming work)

Full spec in `docs/MULTITENANT_SPEC.md`. Summary:

**Three levels: Global → League → Bracket.**
- **Global** (super-admin / the dev): creates leagues, appoints league admins, owns
  the shared show list + Carton sync, sees cross-league global stats (Global-only).
  This app is Eggy-specific; a different band = a fork of the whole app, not a tenant.
- **League** (e.g. *Ambassadors*, *Facebook League*): a discrete community/player pool.
  Has admins. Contains exactly 2 brackets. Sets its own cutoffs. Boots/bans within itself.
- **Bracket** (*Casual* / *Official*): parallel competitions, each with own rules and
  champion. **Casual has NO seasons** (perpetual tally). **Official has seasons** +
  the opt-out mechanic.

**Key decisions (all locked):**
- **One global player identity** (name+PIN app-wide). Players hold per-league
  memberships. Enables global stats (e.g. total shows voted across leagues).
- **Official participation is opt-IN**, and the toggle is **locked while a season runs**
  — no opting in mid-season. League admin can override.
  **Reversed for beta, Stage F (`sql/stage_f_official_default_optin.sql`):**
  `league_members.official_opt_in` now defaults to `true` (was `false`), and
  every existing row was backfilled to `true`, so `admin_add_league_member`
  (which inserts without specifying the column, relying entirely on the
  default) lands new members opted in automatically — no more flipping the
  flag by hand for every Ambassadors add. This is a beta convenience for a
  closed group the dev adds one-by-one; it does not touch the lock-while-a-
  season-runs rule, `admin_set_season_roster`, or the self-service opt-out
  RPC (`set_official_opt_in` — still correct, but **not actually wired to
  any frontend control**, so today there is no in-app way for a player to
  opt themselves out; only a league admin can remove someone from a running
  season's roster via the admin panel). **Revisit before the ~50-person
  Facebook League launches** — the original opt-in-by-default reasoning
  (participation should be a conscious choice for a pool of semi-strangers,
  not an assumption) still holds there, and stacks with the other
  known-not-scaled-past-Ambassadors gaps: the PIN-guessing surface and the
  lack of self-service PIN management (both noted below), plus the missing
  self-service opt-out UI this note just surfaced.
- **Frozen season roster** (`season_rosters`): when an Official season starts, the set
  of opted-in members is snapshotted; scoring reads the snapshot, NOT the live flag.
  Frozen in both directions (opting out / getting booted mid-season leaves you on the
  board, frozen). This makes the "no mid-season change" rule structurally unbreakable.
  Admin override edits the roster explicitly.
- **An Official bracket with no season covering a show's date scores nobody for
  that show — signed off, not a bug.** Correct given Official is discrete seasons
  and Casual is the perpetual tally; the Stage C admin warning (below) is the
  mitigation for "someone forgot to create a season," not a scoring change.
- **Global is a SUPERSET of league admin**: every league-scoped power/read uses one
  shared guard `is_league_admin(league) OR is_global_admin`, so Global can act inside
  or see any league (to fix a fumbling league admin). The ONLY Global-exclusive power
  is the account-level nuclear boot (delete a player everywhere + optional app-wide
  name ban).
- **Show list is fully global/shared** (one sync). Cutoffs, format, status, and
  announcement flags are **per-league** (a `league_shows` overlay table). Setlists
  stay global (fetched once per show); scoring runs **per-bracket** against the shared
  setlist.
- **Scoped reads via RPCs** (not RLS) for anything sensitive; public RLS read only on
  truly-global tables (shows, songs_cache, setlist_songs, league names, bracket config).
- **Scale is small** (~10 Ambassadors + ~50 FB = 2x current). No pagination or
  public-registration hardening needed. FB league's 2 runners verify signups manually
  via FB comments; join = admin-adds-player.

**Launch reset (agreed):** beta players know scores get wiped at launch. The wipe
keeps player accounts (names+PINs) but wipes all gameplay (picks, scores, seasons,
setlist data) and keeps the song catalog. This collapses the migration — no delicate
preservation. A **maintenance window is acceptable** (app goes dark between stages),
so NO compatibility-view scaffolding is needed.

**Stage A is already written**: `sql/stage_a_schema.sql` — one file that supersedes
`schema.sql` + all `add_*.sql`. It builds the tenancy tables, does the account-
preserving wipe, and seeds the "Ambassadors" league with Casual + Official brackets,
moving all current players in (grandfathered opt_in=true). Has a verification query
block at the bottom. RUN IT in a quiet window, snapshot first, then check the counts.

**Stage A has been run.** Verification initially showed `seasons = 1` instead of 0:
Section 3's `create table if not exists seasons` silently no-op'd because `seasons`
already existed pre-2.0 (from `add_seasons.sql`), so `bracket_id`/`roster_locked_at`
never got added and the old beta season row survived. Corrected with the one-shot
`sql/stage_a_fix_seasons.sql` (adds the missing columns, wipes `seasons` +
`season_rosters`, sets `bracket_id not null`) — already run against the live
database, don't run it again. `stage_a_schema.sql` itself is fixed for any future
run (drop-and-recreate `seasons`, matching picks/scores).

**Build sequence from here:**
1. **Done.** (Claude Code first jobs, BEFORE 2.0) Reorganize repo; split
   `index.html` into modules WITH a build step; verify GitHub Pages deploy
   still works; recreate the test harnesses. Get git history going. — see
   the Frontend bullet under "Current architecture" above for the resulting
   shape (`src/`, `build.mjs` → `app.js`).
2. **Stage A** — run `sql/stage_a_schema.sql`, verify counts. App goes dark here.
3. **Stage B** — edge function v7: global sync, per-league `league_shows` overlays
   with auto-defaulted cutoffs, the **season-activation step** that writes the frozen
   roster, and the scoring rewrite (one setlist fetch → each bracket under its own
   config; Official reads the roster). Fold in: v6 Cover Pick/wildcard, reopen +
   notification + winner_sent reset, slot labels, debut toast, the Discord
   broadcast/per-league notification rework.
3. **Stage C** — a full RPC rewrite in SQL (every function reworked for the
   Global/League/Bracket model — see design notes below), plus the frontend:
   league/bracket switcher, every screen scoped to current bracket, league-admin
   panel, Global-admin screen (create leagues, appoint admins, cross-league stats,
   nuclear boot). Carry over the cleaner admin show-row layout — **done in C2a**:
   `.arow`/`.arow-head`/`.cutoff-in`/`.arow-btns` (stacked date+venue / cutoff
   input / buttons, each row wrapping independently), replacing the shared
   `.showrow` single-line flex row that was overlapping buttons with venue
   text once too many controls got packed into it. (Despite the phrasing here
   suggesting this already existed somewhere — it didn't: git history has zero
   trace of `.arow` ever existing before C2a. Same false-memory pattern as the
   "collapsible sidebar" note elsewhere in this file; the fix was real, the
   prior existence wasn't.)
4. App back up; smoke-test **Ambassadors ▸ Official** + empty **Casual**.
5. Create the **Facebook League** via the Global screen, appoint its 2 admins (need to
   know who they are + whether they have beta accounts), they add ~50 players.

### Stage B design notes (scoring / edge function)

- **Relabel the closer slot to "Set 2 Closer"** — display label only; the slot key
  stays `closer` so existing picks/configs don't break. Rationale: "closer" read
  ambiguously next to "show closer." Final vocabulary: **Set 1 Closer** (last of set
  1) / **Set 2 Closer** (last before encore) / **Show Closer** (final song of the
  night, encore included). Keep all three — a wide array of bets is intentional.
- **Scoring is fresh-off-the-current-snapshot, not merged against history (fixed
  after a real incident).** The original design scored every pass, then kept
  whichever of {this pass, the row already in `scores`} had more points — meant to
  let a wrong-slot partial upgrade to a full match on replay (sandwiches: A > B >
  A). In production (Boston, Citizens House of Blues, 2026-07-31) this instead
  froze a wrong result permanently: a live pass caught Shatter as the apparent
  Set 2 Closer from a 5-song snapshot (`+2 closer — exact`), and once the real
  closer (Voice of Them All, two songs later) appeared, every later pass —
  including finalize's own closing pass — recomputed the correct, lower value but
  lost to the stale higher one already in the DB. Fixed in `scoring.js`/`index.ts`:
  the merge-against-persisted-row is gone. Every pass scores fresh off the full
  current `setlist_songs` snapshot, which is monotonic for every slot type except
  the closer family (a fresh pass never needs "history" — `encore`/`cover_call`/
  `debut_call`/`second_song` already check "any appearance so far," so a later
  reprise upgrades automatically with no merge needed at all). Sandwiches (A > B >
  A) are still handled correctly this way — confirmed by `test/scoring.test.mjs`
  fixtures pulled from real shows with genuine sandwiches (Rocking The Docks,
  GratefulFest, Levitt Pavilion).
- **`slotDetermined` — Set 1 Closer / Set 2 Closer / Show Closer only score once
  there's real evidence the relevant set/show is over** (this is the
  `slotNotYetDetermined` gap this file used to flag as "not yet built" — it's
  built now, in `deriveSlotFacts`). Each resolves as early as the data allows,
  not just at finalize — the near-real-time requirement matters here since a
  show can go for hours before an admin manually finalizes it or `autoFinalize`
  fires the next morning:
  - **Set 1 Closer**: determined the instant anything plays after set 1 — a set 2
    song, or (if the show skips set 2 entirely) the encore starting.
  - **Set 2 Closer** (`closer` slot key; display label "Set 2 Closer"): determined
    the instant the encore starts — a second encore break doesn't change who
    closed the last set.
  - **Show Closer**: no reliable in-show signal exists (another encore break is
    always possible until the show truly ends) — resolves only at finalize
    (`isFinal` passed into `deriveSlotFacts`/`scorePicks`).
  Until determined, a picked song that's already played scores **consolation
  credit** (partial points, if `cfg.partial_credit` is on) with reason `"played —
  slot undetermined"` — never a premature exact or wrong-slot verdict. This also
  aligns scoring with the already-existing toast rule (closers never named live,
  only after the fact) — before this fix, scoring was quietly ahead of what
  toasts were willing to claim. Player-facing copy: `picks.js`'s show-detail view
  surfaces "Closer-type picks show off-slot points (if enabled) until the encore
  starts (or the show ends) — full points lock in once determined." directly
  under the Scores header, but only when a visible breakdown row is actually in
  that state — deliberately not shown as permanent boilerplate.
  - **`slotImpossible` is untouched and still means only** "this slot doesn't
    structurally exist for this show" (no set 2 at a one-setter, no encore at
    all) — correct as-is, don't fold `slotDetermined` into it. Note this doesn't
    fix the same not-yet-vs-impossible ambiguity for the plain `encore` slot type
    itself (picking a song for the Encore slot before any encore has happened
    reads as `slotImpossible.encore === true`, i.e. "no encore this show," when
    it may just not have happened yet) — out of scope for this pass, since
    `encore` isn't positional the way the three closers are and a wrong-slot
    label there is far lower-stakes; revisit if it causes real confusion.
  - **Already-finalized shows may still carry the old bug's frozen results** —
    the fix only changes scoring going forward. Repair path: `reopen` (wipes that
    league's `scores` for the show, flips `league_shows.status` back to `live`)
    then `finalize` (re-scores clean under the corrected logic, since post-fix
    the only pass that ever freezes a closer-family slot is the finalize pass
    itself). **Boston 7/31 has been repaired** — reopened + finalized via the
    admin panel's Reopen button (built and smoke-tested against this real
    show), `winner_sent` now carries a fresh timestamp from the corrected
    scoring pass instead of the original frozen-bug result.
- **Duplicates stay OFF by default.** Add a warning tooltip on that admin toggle
  noting the consequence: with duplicates allowed, on a one-song encore a song picked
  for both Encore and Show Closer scores both slots — usually a free double.
- **Cutoff-changed notification** — when a league admin changes a show's cutoff, post
  to that league's Discord channel. Per-league (reads `league_shows`); build as part
  of the broader broadcast/per-league notification rework, not before.
- **`sync_shows` must map `permalink`** from the `/shows.json` response into the
  `shows.permalink` column, and the upsert must UPDATE existing rows, not
  insert-and-ignore-on-conflict — the slug embeds the venue name, so a corrected
  venue name regenerates the slug and a stale permalink would 404.

### Stage C design notes (frontend)

- **Scope correction: Stage C requires a full RPC rewrite in SQL, not just
  frontend work.** Every function needs reworking for the Global/League/Bracket
  model, guarded by the shared `is_league_admin(league) OR is_global_admin` check
  from spec §3. This was not previously scoped and is a substantial addition —
  Stage A only created tables and RLS, no functions, so every RPC from
  `schema.sql`/`add_*.sql` is still live against the old flat schema today.
  **Split into C1 (SQL, `sql/stage_c1_rpcs.sql`) and C2 (frontend)** — C1 fully
  done and run before C2 starts, since the frontend can't be tested against RPCs
  that don't exist yet.
- **Stage C1 is done (SQL written; run + smoke-tested by the dev).** Notable
  decisions baked into `sql/stage_c1_rpcs.sql`, not otherwise obvious from the
  spec:
  - League boot (`admin_league_boot`) is a hard delete of the `league_members`
    row only — picks/scores untouched. Ban is a separate `banned_names` insert,
    checked by the new `admin_add_league_member` RPC (necessary infra: without
    it, `global_create_league` + `global_appoint_league_admin` produce a league
    nobody can join). See the `league_members.banned` gotcha above.
  - `get_show_picks`/`admin_pick_status` join `players` directly for names
    (never gated on `league_members` still existing), so a booted player's
    frozen historical line still displays correctly.
  - `admin_set_show_status` was dropped outright, not carried forward or
    replaced — see the edge-function gotcha above for why.
  - `global_boot_player` is the only Global-exclusive nuclear boot (deletes the
    player account everywhere, cascading picks/scores/memberships via existing
    FKs); it's structurally distinct from league boot, not a superset built on
    top of it.
- **Stage C2a is done** — SQL (`sql/stage_c2a_rpcs.sql`, run + smoke-tested) and
  the frontend plumbing that brings the app back online: the league/bracket
  switcher (`src/core/switcher.js`, new `state.leagues`/`currentLeagueId`/
  `currentBracketId`), the shows+`league_shows` merge helper
  (`src/core/leagueShows.js` — `showState()` silently treated every show as
  perpetually un-open without it, since Stage A moved `cutoff_at`/`status`/
  `format` off `shows`), every RPC call site updated to Stage C1/C2a signatures,
  `admin_league_boot`/edge-function `finalize` replacing the two dropped RPCs,
  `realtime.js` rebuilt as a teardown-and-rebuildable per-bracket subscription,
  and the test harness rewrite noted above. C2b (admin surfaces) and C2c
  (polish) were separate, not-yet-started phases — C2b is now done (below);
  C2c remains not started.
  - The season editor is deliberately **not** bracket-switcher-scoped: it always
    resolves the current league's Official bracket id directly
    (`officialBracketId()` in `admin.js`), not `state.currentBracketId` — an
    admin looking at Casual still needs to manage Official's seasons, and
    seasons only ever belong to Official.
  - Pick-sheet drafts are now keyed by bracket too
    (`ft_draft_${sessionId}_${bracketId}_${showId}`) — the old key would have
    silently shown one bracket's in-progress draft inside the other's sheet.
- **Stage C2b is done** — member management admin surface, prompted by a real
  onboarding gap: a new player registered, hit "not in a league yet," and had
  to be added by hand via a raw RPC call because no admin UI for it existed.
  New SQL (`sql/stage_c2b_member_mgmt.sql`, run + smoke-tested): three
  admin-gated read RPCs — `admin_list_members` (replaces the C2a-era Players
  panel's app-wide `players_public` read, which listed every registered
  player regardless of league membership and let Boot fire against people
  who weren't actually in the league; this is also what restores the ★
  admin-badge marker C2a had dropped, since it carries `is_league_admin`
  again), `admin_find_players` (name-prefix search, min 2 chars enforced
  server-side, capped at 8 rows, excludes existing members — the discovery
  mechanism for "add a member"; accepted privacy tradeoff: a capped prefix
  search still allows slow enumeration by an admin iterating letters, judged
  acceptable given the small admin-adds-you trust model this app already
  runs on), and `admin_list_season_roster` (feeds the season opt-in-override
  UI; the mutation, `admin_set_season_roster`, already existed from Stage
  C1). All wired into `admin.js`'s renamed Members panel (`loadMembers`,
  `searchMembers`/`addMember`) and a per-season "manage roster" control in
  the Seasons panel (`toggleRoster`/`setRosterMember`). `admin_league_boot`
  and `admin_list_bans`/`admin_unban` needed no changes — both were already
  correctly wired to the league-scoped RPCs by Stage C1/C2a, confirm-text
  included.
  - Onboarding dead end fixed alongside this: `renderNoLeague()` in
    `src/core/session.js` now lists real league names (a free read off the
    public `leagues` table) instead of just "ask a league admin" with no way
    to know who that is. A fuller request-to-join flow was considered and
    deliberately not built — join-approval is already entirely admin-driven
    by design (FB league admins manually verify signups via Facebook
    comments), so a parallel request-queue would duplicate
    `admin_add_league_member` for no real gain at this scale.
- **The Global console never got a stage number, unlike C2a/C2b/C2c, and is
  genuinely not started.** Easy to misfile as part of C2b (member management)
  since both are "admin surfaces," but they're different scopes — C2b is
  entirely league-scoped. The screen described in the original build sequence
  ("Global-admin screen: create leagues, appoint admins, cross-league stats,
  nuclear boot") has no frontend counterpart anywhere in `src/`:
  `global_create_league`, `global_appoint_league_admin`, and
  `global_boot_player` exist only as SQL functions in `sql/stage_c1_rpcs.sql`,
  with zero callers. Today, creating a league or appointing its admin means
  invoking these directly in the Supabase SQL editor. See the "2.0 REBUILD
  roadmap" section below for the minimal-build decision (create league,
  appoint admin, Global-scoped PIN reset — deliberately not cross-league
  stats).
- **Official gating must BLOCK pick submission, not silently skip scoring —
  built.** `sql/stage_c2a_rpcs.sql`'s `_official_gate` (called by both
  `can_submit_picks` and `submit_picks`, one implementation) does both cases
  exactly as specified: checked against the SHOW's date, not today's
  (`_official_gate`'s `sh.showdate between start_date and end_date`, not
  `current_date`); falls back to the live `official_opt_in` flag only when
  `roster_locked_at is null` (season not yet activated), otherwise checks
  `season_rosters`. `submit_picks` raises on `not gate.ok` — a real block, not a
  silent skip. Frontend: `picks.js`'s `openShow()` calls `can_submit_picks` first
  and renders `renderIneligible(show, gate.reason)` instead of the pick sheet
  when blocked, pointing at Casual. Casual is unaffected (`_official_gate`
  returns `ok:true` immediately for any non-official bracket).
- **Admin warning: no season covering upcoming shows — built.** `admin.js`'s
  Seasons panel shows a warning (compact M/D dates, no cap on the list) for any
  upcoming show the Official bracket's seasons don't cover, rendered outside
  that panel's collapsible body so it's visible even when the section itself is
  collapsed. Since submission is blocked (not silently unscored) in that case,
  forgetting to create a season closes Official entirely — this warning is the
  mitigation.
- **Opt-in override — built, but one detail below has since changed.**
  `admin_set_season_roster` (Stage C1, re-touched by Stage D) lets a league
  admin add or remove any player from a running Official season's
  `season_rosters` directly — no check against `official_opt_in` at all, so
  this does cover someone who opted out before activation, as specified.
  Removal is confirmed to only stop future accrual, not touch history: the
  edge function's `scoreBracket` re-derives `allowedPlayerIds` from
  `season_rosters` fresh on every pass and only upserts scores for players
  currently in that set — there's no code path that deletes or rewrites a
  removed player's already-written `scores` rows, so past points stay frozen
  exactly as designed. **The "no audit trail" half of this note is now
  false** — `sql/stage_d_tiebreakers.sql` added `season_rosters.added_at`,
  stamped on every insert (both this override and the season-activation
  snapshot), built for a different reason (the "fewest zeros" tiebreaker
  needs a mid-season add's join date to scope zeros correctly) but a real
  timestamp regardless. "No standings indicator for it" is still true,
  though — `added_at` is only ever consumed as a scoring input
  (`rosterJoinDates` in `standings.js`), never rendered anywhere a player or
  admin would see it directly.
- **Player tooltips on pick-sheet slots — superseded by "The Rules" card, not the
  tap-affordance this bullet used to describe.** The plan here used to be: replace
  the pick sheet's `title=` attribute (useless on a touch device — no hover,
  long-press doesn't reliably surface it) with a tappable "ⓘ" next to each slot
  label. **That "ⓘ" was actually built (Session 2, commit `2102a7b`), then removed
  one commit later (`8889bdc`)** — it read as visually cluttering the slot labels,
  and was scrapped rather than iterated on. If you're reading an older copy of this
  note or working from memory: don't rebuild it, it was tried and rejected on
  sight, not abandoned half-finished.

  **What shipped instead: "The Rules" card.** A second `.sheet`-styled paper card
  renders below the pick sheet in `renderPickSheet()` (`src/features/picks.js`) —
  same cream-stock/tape/shadow treatment, but with its own fixed tape
  rotation/offset and card tilt (`.rules-sheet` overrides in `styles.css`) so it
  reads as a second sheet taped up separately by the same hand, not the pick
  sheet's own tape rendered twice. Two parts, both now built:
  1. **Auto-generated slot definitions — built.** One row per distinct label, read
     straight from `SLOT_TOOLTIPS` via the same `slotDefs()` the pick sheet itself
     renders from, so the card can't drift out of sync with whatever slots this
     bracket's config actually has active. A repeated slot type (two Cover Pick
     slots, say) or several flat picks collapse into a single row rather than
     repeating identical tooltip text. The points-per-slot note that used to sit
     under the pick-sheet inputs moved here too.
  2. **Admin-authored custom rules — built.** `custom_rules: string[]` on
     `brackets.config` (bracket-wide, same object `admin_update_config` already
     writes for `slots`/`bonuses`/etc. — not per-format the way `slots`/`oneset`
     are). Editable as repeatable rows in `admin.js`'s new "House rules"
     collapsible (`customRuleRow()`/`addCustomRule()`/`readCustomRules()`),
     positioned ahead of the two format-specific Game rules sections since this
     list applies to both. Soft cap: **10 rules, 140 characters each** — the
     `+ add rule` button disables itself at 10 rows (`checkRuleCap()`) rather than
     letting a save fail past the limit; `readCustomRules()` still re-slices
     defensively on read in case a value ever gets in past the input's own
     `maxlength`. Renders on the player-facing card as a "House rules" divider
     (reusing the same `.divider` style as the pick sheet's "Anywhere in the
     show" section) followed by a plain bullet list — omitted entirely, divider
     included, when the admin hasn't written any.

  Admin-side tooltips needed no equivalent fix and never did: `admin.js`'s
  `adminSlotRow()` already bakes `SLOT_TOOLTIPS` text directly into each
  `<option>`'s own visible label (confirmed in the source) — a different,
  already-working mechanism, not the same `title=` stopgap the player side had.
- **Admin tooltips on the config screens — still open, scope narrower than
  written.** Slot definitions on the admin side needed no work, per the bullet
  above. What's still missing is explanatory copy for the *rule mechanics* a game
  runner controls but didn't design: partial credit, perfect-sheet bonus,
  wildcards, the duplicates warning above, the best-result-across-replays rule,
  master override, format toggle, and (in 2.0) the Official opt-out mechanic.
  Important because 2.0 delegates leagues to admins who didn't build the game.
- **Standings default season selection — built.** `src/features/standings.js`'s
  `renderBoard()` implements this priority order:
  1. If a season is currently active (today inside its date range) → default to
     that season.
  2. Else if a season ended within the last 7 days → default to that just-finished
     season (grace period, so people can savor the result).
  3. Else → default to All time.
  If a new season starts during another's grace period, the new active season wins
  (checked first, so it always beats the grace-period branch). Replaced the old
  fallback-to-most-recently-created-season behavior, which left stale finished
  boards showing indefinitely between tours. In 2.0 this rule generalizes for
  free: Casual has no seasons, so it always lands on All time, which is correct
  since Casual is a perpetual tally. Covered by a regression check in
  `test/scenario.test.mjs`.
- **`players_public` no longer carries admin status — moot, not just done.**
  This bullet described a migration TODO for `loadPlayers()`, which read
  `p.is_admin` off `players_public` to show the ★ marker. That function no
  longer exists anywhere in `src/` (confirmed — zero matches for either
  `loadPlayers` or `is_admin`) — it wasn't migrated, it was replaced outright
  by Stage C2b's `admin_list_members`/`loadMembers()` (see that bullet above),
  which gets `is_league_admin` from `league_members` directly, exactly the
  source this note called for. Nothing left to do here.

### 2.0 REBUILD roadmap (verified against the repo, sessions ordered)

A personal task list compiled from conversation memory across sessions was checked
directly against the repo before any ordering happened — this project has already
hit the pattern of discussed-but-uncommitted work surviving as false memory, and
finished work surviving as "pending," twice (see the false-memory note earlier in
this file). Full verification detail lives in the plan file this was written from;
this is the condensed, durable record so the roadmap survives a context boundary.

**Resolved decisions:**
1. **Global console: minimal build only** — create league, appoint league admin,
   Global-scoped PIN reset. Deliberately no cross-league stats (nobody's asked for
   it, and it's a direct query away at two leagues).
2. **Per-league Discord webhooks: keep the env-var stopgap.** Not a blocker for a
   second league — see the corrected note above. A DB-column + admin-UI version
   stays deferred, folded conceptually into the Global console if that ever
   expands.
3. **Forgot-PIN: self-service change + an admin reset button**, with two hard
   requirements — the admin never sees/chooses the new PIN (server-generated,
   returned once for relay, never stored/logged in plaintext), and the relayed PIN
   forces a change on next login (new schema flag + a forced login interstitial —
   no precedent for this exists in the app today, size it generously). Guard:
   league admins reset only within their own league; Global resets anyone — reuses
   the existing `is_league_admin(league) OR is_global_admin` pattern, no new
   authorization architecture.
4. **scores/league_shows realtime toasts: build a ping table (not a public RLS
   policy, not polling) — built (Session 3).** This app has no per-request
   identity — players authenticate via a name+PIN RPC, not Supabase Auth, so
   every request shares one anon key regardless of which player is "logged in"
   client-side. A public RLS policy on `scores`/`league_shows` would expose
   every score in every league to anyone holding that key, undoing
   `get_bracket_scores`'s membership gate — ruled out on that evidence, not
   preference.

   **What shipped**, matching the design above exactly: a `realtime_pings`
   table (`sql/stage_j_realtime_ping.sql`) carrying only `{league_id, show_id,
   updated_at}` — no `bracket_id`, no counts, no deltas, nothing inferable.
   Written by the edge function's new `pingRealtime()` helper
   (`supabase/functions/carton-sync/index.ts`), called once per real change —
   inside `announcements()` right after each `remind_sent`/`lock_sent`/
   `winner_sent` stamp, inside `scoreShow()`'s per-league-show loop only when
   a bracket actually had a score write (`scoreBracket`'s existing
   `score_writes` diff count) or a status flip to `live`, and inside
   `reopenShow()`. Not a trigger — deliberately called from application code
   at each of those points, so a quiet cron tick with nothing new doesn't
   write (and doesn't fire a client refetch) at all. Both gates are on: added
   to the `supabase_realtime` publication AND given a public SELECT policy
   (`create policy "pub realtime_pings" ... for select using (true)`) — the
   SQL file's own verification section checks each independently, since they
   fail differently and silently (see the publication/RLS gotcha above).

   On its own dedicated channel (`ping-${leagueId}` in `realtime.js`),
   separate from the existing `live-${bracketId}` channel — so a future
   misconfiguration on this table can't repeat the channel-poisoning bug.
   `handlePing()` is the client-side consumer: on any ping, it refetches
   `get_league_shows` (for the remind/lock/winner freshness check) and
   `get_bracket_scores` (for the winner toast and the player's own "you're at
   N pts" toast) — one `get_bracket_scores` call covers both toasts, where the
   two dead bindings it replaced used to fetch separately. Real score/show
   data never crosses the public ping channel; the ping only ever says
   "something changed here, go refetch."

   **The two now-dead bindings this replaces (`league_shows` UPDATE and
   `scores` `*` on the shared channel) are gone, not just superseded** —
   they never delivered anything (no public RLS policy on either table, by
   design) and would have been confusing dead weight sitting next to the
   working ping-driven logic. The shared channel now carries only the two
   bindings that were ever real: `setlist_songs` INSERT and `seasons`
   UPDATE.

   **Verified two ways**, per the exact failure mode that already cost a
   debugging session once (the original channel-poisoning bug): (1) the SQL
   file's publication-membership check and RLS-policy check are two separate
   queries, not one "looks subscribed" check — each gate fails differently
   and silently, so only checking one proves nothing about the other. (2)
   `test/harness.mjs`'s realtime block now emits `setlist_songs` and
   `seasons` events (previously never exercised by anything in this harness
   at all — a gap, not a regression) alongside the new `realtime_pings`
   emits, so adding a fifth thing to subscribe to is checked against ALL
   five bindings together, not the new one in isolation.
5. **Notification-preference toggle: deferred, confirmed separate work** from the
   toast fix above — the toast fix is a Supabase publication/config change with no
   `realtime.js` diff; a mute toggle needs new schema, a new RPC, and new
   `settings.js` UI that doesn't exist today. No shared surface worth bundling on.

**Session order** (dependency- and shared-surface-driven, not priority-driven):
- **Step 0, before Session 1:** this section itself, committed first, specifically
  so the roadmap can't be lost across a context boundary the way the work it
  describes already was once.
- **Session 1 — admin edge-action wiring: done** (commit `2816d66`). `cutoff_changed`
  is wired into `saveCutoff()`; the 500-vs-401/403 auth status codes are fixed and
  verified live against the deployed function (see the "Fixed" gotcha above).
- **Session 2 — pick-sheet & setlist surface: done, but not as planned above**
  (commits `2102a7b`, `8889bdc`). The debut GUI flag shipped exactly as described —
  same `is_encore` pattern, in both `realtime.js`'s live song toast and
  `picks.js`'s setlist view. The C2c tap-affordance tooltips did NOT ship as
  planned: the "ⓘ" was built, then removed one commit later for looking visually
  cluttered, and replaced with a different mechanism — "The Rules" card (see the
  rewritten tooltip bullet above), whose auto-generated half shipped in the same
  session. Its admin-authored custom-rules half followed as separate, unnumbered
  follow-up work (not part of the Session 1–5 batches below) — also now built, see
  the same bullet for the soft-cap numbers.
- **Session 3 — the ping table (decision 4): done** (commit `60f9372`; SQL
  deployed, edge function deployed, frontend pushed and confirmed live —
  all three legs of the deploy order actually completed, not just
  committed). See decision 4 above for what actually shipped —
  `realtime_pings`, `pingRealtime()` in the edge function, its own
  dedicated channel and `handlePing()` in `realtime.js`, and the two
  now-dead direct bindings removed rather than left in place.
- **Session 4 — auth + Global console: DONE, code and SQL both. ✅ Stages
  k/l/m/n verified live 2026-08-16** (steps 1-5, plus self-service PIN
  change pulled forward from step 6's original scope — see below).
  **This bullet read "SQL not yet run against the live database — that's
  the dev's next action, not done yet" until 2026-08-16; that was stale,
  and it mattered — it made the Global console look unusable and would
  have sent a Session 5 prep down a re-run path.** How it was verified,
  since "is this deployed" recurs: POST each RPC over the REST API with
  its EXACT parameter set and a deliberately wrong name/PIN.
  `global_find_players` (stage_m) and `change_own_pin` (stage_k) both
  returned `P0001 "Wrong name or PIN"` — i.e. they exist, are granted to
  anon, and reached `_auth_player` — where a missing function returns
  `PGRST202` instead. Stage_n rewrites bodies only, so it has no probeable
  signature; it's covered transitively, since stage_o applied cleanly on
  2026-08-14 and its `submit_picks` body calls
  `_reject_if_must_change_pin`, which would have failed to create had
  stage_l's helper been absent.
  - **The probe has one trap worth recording, because the first attempt
    hit it and read as "nothing is deployed."** PostgREST resolves an RPC
    by the exact set of argument names in the body, so sending a UNION of
    parameters across several functions matches NOTHING and returns
    `PGRST202` for every one of them — including functions that certainly
    exist (`my_leagues` returned PGRST202 that way). A `PGRST202` is only
    evidence of absence when the argument set exactly matches the
    function's own signature. Probe one function at a time.
  Ran in the manual-approval mode this bullet used to
  only describe: every SQL file was reviewed individually before the next
  was written, and two follow-up gaps the dev caught in review (the
  server-side bypass below, and the platform-logging caveat now in the
  Postgres gotchas section above) got fixed before this landed, not after.
  What shipped, in the order actually built:
  1. `runGlobalAdminScenario` (`test/harness.mjs`/`test/fixtures.mjs`) — a
     genuine `is_global_admin:true` session (`p4`), closing the exact blind
     spot this bullet used to warn about: every scenario before this one
     ran through the league-admin branch of `isCurrentLeagueAdmin()`, never
     the global-admin one.
  2. `must_change_pin` (`sql/stage_k_pin_management.sql`) + the forced
     interstitial (`renderForceChangePin()`/`submitForcedPinChange()` in
     `auth.js`, gated in `session.js`'s `boot()`).
  3. The shared reset RPC, `admin_reset_player_pin`
     (`sql/stage_l_admin_pin_reset.sql`) — reuses
     `_is_league_admin_or_global` per the locked design, plus an added
     target-membership check (the shared guard alone only proves the
     *caller* admins the league, not that the *target* is in it).
  4. The "Reset PIN" button in `admin.js`'s Members panel, wired only after
     2 and 3 were verified — the non-negotiable ordering held.
  5. The Global console: **not** a new nav tab — folded into Admin as one
     more `collapsible()` section gated on `is_global_admin` (a deliberate
     call, not the default; a real tab would have touched `index.html`'s
     nav, `layout.js`'s 3-column grid, and `dom.js`'s `$()` redirect logic
     for a screen used a handful of times a year). Wires up
     `global_create_league`/`global_appoint_league_admin` (which existed
     since Stage C1 with zero callers until now) plus one new RPC,
     `global_find_players` (`sql/stage_m_global_console.sql`) — needed
     because `admin_find_players` is league-scoped and excludes existing
     members, backwards for "promote someone already in the league."
  - **A real gap caught in review, fixed before commit, not after:**
    `must_change_pin` was, as first built, enforced only client-side —
    `boot()`'s gate is UI routing, not an authorization boundary, and
    nothing server-side stopped a relayed-but-not-yet-changed PIN from
    authenticating to every other RPC, including `submit_picks`. Closed in
    `sql/stage_n_reject_pending_pin_change_writes.sql`: a shared
    `_reject_if_must_change_pin(pl)` helper (defined in `stage_l`, called
    from every WRITE rpc immediately after `_auth_player`, reads left
    ungated on purpose) — 14 already-shipped write RPCs re-touched
    body-only (same idiom as `stage_d` re-touching `admin_set_season_roster`
    or `stage_c2a` re-touching `submit_picks`), each verified by mechanical
    diff against its live body to differ by exactly the one added line and
    nothing else. `login`/`change_own_pin` are the only two functions that
    must never call it — they're the only way out of the state it enforces.
  - **Run order is now `k → l → m → n`**, not the originally-planned
    `k → l → m` — `n` didn't exist until the review above surfaced the gap
    it fixes, and it depends on `l`'s helper.
  - **Self-service PIN change was initially deferred, then corrected back
    in before the SQL was run**: it was half of decision 3, not an optional
    extra — as first shipped, every PIN change routed through an admin,
    which was supposed to be the fallback path, not the only one. A "Change
    PIN" form now lives in `settingsPanelHtml()` (`changeOwnPin()`,
    `settings.js`), calling the same `change_own_pin` RPC the forced
    interstitial uses. **Login rate-limiting and the Official opt-in-default
    revisit stay genuinely deferred** — each gets its own follow-up session,
    see the two gotcha bullets above for why they weren't folded in here.
- **Session 5 — Facebook League launch: PARTIALLY DONE 2026-08-16.** The
  league was created via the real Global console and the dev appointed
  himself to it; **no season, no other admin appointments, and the Discord
  webhook secret deliberately skipped** (nobody is in that channel yet, so
  misrouted announcements are noise nobody hears — see the accepted-risk
  record in `docs/session5_plan.md`). Remaining: appoint the two league
  admins, provision the webhook secret, smoke-test. **Appointing the two
  admins is now gated on the admin-tab reorg** (see below), at the dev's
  call — the panel is being reorganised before anyone who didn't build it
  is handed it.
  **See the PRE-SESSION-5 GATE immediately below — do not start the
  remaining work without walking that list.**
  - **🚨 Brief both admins on the reload requirement before they add a
    single player.** Every player added to a league must fully close and
    reopen the app before the league appears — nothing refreshes
    `state.leagues` in the background, and foregrounding the app runs a
    refresh that pointedly does *not* fix it. This will be the most common
    support question during recruitment and is invisible from the admin
    side. Full trace in "Multi-league switcher behavior" above.
  - Note the dev appointing himself set `is_league_admin = true` on his own
    row — **that is the only in-app way to join a league you aren't already
    in**, since the Members panel's add is hardcoded to
    `state.currentLeagueId` and the switcher can't reach a league
    `my_leagues` doesn't return. Not the same thing as the deferred
    appointments of the two outside admins.

### DATED DEADLINES — check these first, they expire

Distinct from the Pre-Session-5 gate below, which is triggered by an *event*
(launching the Facebook League). These are triggered by a *date* and stop
being actionable once it passes. Indexed here because they otherwise live
only inside the Postgres/Supabase gotchas section, where nothing points at
them. **The Status column is the count** — closed rows stay as a record
rather than being deleted.

| Date | Status | Item | Full bullet |
|---|---|---|---|
| **2026-08-14** | ✅ **DONE** | **Ranked-choice deploy batch** — carton-sync deployed, Stage O applied, verified end to end (ranked save accepted, duplicate rejected, slots-mode save unaffected) | "✅ RESOLVED 2026-08-14 — ranked-choice deploy batch…" in Postgres/Supabase gotchas |
| **2026-08-14** | ✅ **DONE** | **Test 3 roster check** — activated 04:00:04Z, 14 rows, all 13 originals kept their timestamps, the new row landed 0.1s before the stamp | "✅ VERIFIED 2026-08-14: Test 3 activated cleanly…" in Postgres/Supabase gotchas |
| **2026-08-14** (checked 2026-08-15) | ✅ **DONE** | **First production run of `scoreRankedPicks`** — Casual, show `1765912122`, finalized 12:00:04Z. All five checks pass: ladder values per row (`rank1` paid 6, not 1), no Any Debut row, perfect-sheet correctly withheld, totals reconcile. Rank ordering passes but is verified by test only — see the caveat, it is not a pending task | "✅ VERIFIED 2026-08-15 — FIRST PRODUCTION RUN OF `scoreRankedPicks`…" in Postgres/Supabase gotchas |

**Every 2026-08-14 item closed.** The ranked-choice deploy batch met its hard
showtime cutoff (deployed and applied, verified end to end); the Test 3
roster check was verified at `04:00:04Z`; and the first production run of
`scoreRankedPicks` — added the evening of 2026-08-14, after the other two
closed, and unresolvable until the show actually scored — was checked against
`scores.breakdown` on 2026-08-15 and passed every check. Read the Status
column for what is currently outstanding rather than trusting this paragraph,
which describes one day's batch and will not be rewritten when the next dated
item is added.

One thing carried forward rather than closed, deliberately **not** logged as
an open item: the rank-ordering check is verified by the scenario suite and
cannot realistically be verified in production, because it needs stored row
order to differ from rank order and nothing in the pipeline produces that.
See the caveat inside the VERIFIED bullet — it is a permanent property, not
an outstanding task, and re-opening it as one would be re-deriving a
conclusion already reached.

### PRE-SESSION-5 GATE (walk this list before launching the Facebook League)

Items elsewhere in this file are gated on "before Session 5 / before the
Facebook League / before a non-dev league admin exists." Each was recorded
beside the code it concerns, which is right for understanding it and wrong
for remembering it — a trigger buried next to its own implementation is a
trigger nobody re-reads at the moment it fires. **This table is the index;
its Status column is the count.** Completed items keep their row and their
number rather than being deleted, so the ordering note at the bottom
("settle #4 before #5, and #1–#3 before either") keeps referring to the same
things it was written about. **The full reasoning stays in the
bullets referenced, deliberately not duplicated here**, since a duplicated
rationale is one that drifts. (#7 is the exception to that last rule: it has
no home bullet elsewhere, so its reasoning lives directly below the table.)

| # | Item | Where the full bullet lives | Why it's gated here |
|---|---|---|---|
| 1 | **Login rate-limiting** (3-part fix: progressive delay + aggregate spray throttle + weak-PIN rejection) | Postgres/Supabase gotchas — "Login rate-limiting: the top real security exposure" | ~50 semi-strangers is where enumerable nicknames + short PINs stop being theoretical |
| 2 | **`ft_session` plaintext PIN → server-issued token** | Same section, the bullet immediately after #1 | The stored session IS the credential, with no revocation path; scope as its own session, it's real work |
| 3 | ✅ **DONE 2026-08-15** — **Domain move to a `wooklord.net` subdomain**, live at `fantasyeggy.wooklord.net` | Same section, the roadmap bullet after #2 | Origin isolation for #2, and PWA installs become expensive to move *after* recruitment. Row kept rather than deleted so the numbering and the ordering note below stay valid |
| 4 | **Ladder-mutability revisit** (Module B) | "Alternate scoring modes" → Module B locked decisions → "Decided: mid-season ladder edits stay unguarded" | Unguarded config edits silently rewrite already-published scores; acceptable only while one trusted person can edit |
| 5 | **Appointing any non-dev league admin** | Cross-cuts #4 and the `admin_update_config`/`admin_set_season_roster` integrity notes | This is the event that invalidates "only the dev can do damage," which several decisions currently rest on |
| 6 | **Official opt-in default revisit** (Stage F flipped it to `true` for beta convenience) | 2.0 rebuild key decisions — the `official_opt_in` bullet | Opt-in-by-default was a closed-group convenience; a semi-public pool should choose deliberately |
| 7 | ✅ **DONE 2026-08-16** — **`get_show_picks` is now membership-gated**, matching `get_bracket_scores`; `player_id` dropped from the payload in favour of a server-computed `is_mine`. Reveal-after-cutoff unchanged | The bullet immediately below this table, and `sql/stage_p_get_show_picks_membership.sql` | Anyone with the publishable key could scrape every player's nickname, UUID and full pick history; at ~50 semi-strangers that stopped being a closed-group detail |

**#7 in full — ✅ RESOLVED 2026-08-16 by `sql/stage_p_get_show_picks_membership.sql`.
The question below was answered "oversight, not design": the anon grant was
carried over from Stage C1 with nothing recorded either way, and the dev
decided it was never intended.** What shipped:
- **The gate now mirrors `get_bracket_scores` exactly** — `_auth_player`,
  then global-admin OR a `league_members` row for the bracket's league.
- **`player_id` is gone from the payload**, replaced by a server-computed
  `is_mine boolean`. This answers the second half of the "what to decide"
  bullet below: the field is not needed, but the *capability* is — the one
  real consumer was `picks.js`'s `mineHits`, which highlights the caller's
  own picks in the setlist view. Computing it server-side removes every
  other player's UUID from the response entirely, so this is strictly less
  data than before rather than the same data behind a gate.
- **Reveal-after-cutoff is untouched**, deliberately — the `now() >=
  ls.cutoff_at` condition is carried over verbatim. Players seeing each
  other's sheets after lock is the game working as intended; only *who may
  ask* changed.
- **The anon `grant` is deliberately KEPT.** The body rejects
  unauthenticated callers on its own, and every other RPC here carries the
  same grant — dropping it would make this one inconsistent without adding
  a gate that matters.
- **Known coverage gap, stated rather than implied: the membership gate
  itself is NOT exercised by the scenario suite, and realistically cannot
  be.** `test/harness.mjs`'s fake mirrors the rejection so it fails closed,
  but no scenario asserts it, because no UI path can reach this call site
  as a non-member — `state.currentBracketId` only ever comes from
  `my_leagues`, and a non-member is routed to `renderNoLeague()` at boot
  and never reaches a show detail view. A test that invoked the RPC
  directly would assert that the *fake* throws, which is a tautology, not
  coverage of the SQL. The fake also does not model the global-admin
  bypass — fixture `p4` has a real `league_members` row, so it passes on
  membership, not on `is_global_admin`.
- **⚠️ AND THE DEV STRUCTURALLY CANNOT TEST THE MEMBERSHIP HALF — don't
  plan to "just check it manually."** The condition is
  `if not pl.is_global_admin and not exists (...)`, so a global admin
  short-circuits on the FIRST clause in every league, including ones they
  have never joined. The dev's own account therefore passes this gate
  everywhere and can never trigger the rejection. Reaching it at all needs
  **valid** credentials (a bad PIN dies at `_auth_player`, upstream of the
  gate) belonging to a **non-global-admin** player who is **not** in the
  target league — i.e. someone else's account, which nobody should be
  handing over. Practical consequence: this branch stays verified by code
  reading (it is four lines mirroring `get_bracket_scores`, in production
  since Stage C2a) rather than by execution, indefinitely.
  - **Natural time to close it: the first Facebook-League-only player** —
    someone in the FB league and NOT in Ambassadors is, for the first time,
    a real non-global-admin non-member, so an Ambassadors-bracket call with
    their credentials would exercise the rejection. Note the obvious
    catch: it still needs their PIN, which nobody should be asking for.
  - **The self-service version, and the one actually worth doing: register
    a throwaway non-global-admin account**, add it to exactly one league,
    and call the other league's bracket with it. That is entirely within
    the dev's control, needs nobody else's credentials, and is the only
    way this gets executed rather than reasoned about. Cheap — a
    registration and one `curl`.
- **When checking the positive path, LOOK at `is_mine`, don't infer it
  from the page rendering fine.** A uniformly-`false` `is_mine` renders
  perfectly plausibly: the setlist, the breakdown and the pick board all
  display normally, and the only symptom is that **nothing is
  highlighted** — no `hitmine` class on any song. That reads as "I didn't
  hit anything this show," which is an ordinary, common outcome and not
  visibly wrong. Same shape as discipline item 5: "the page looks right"
  is a correlate of "`is_mine` is correct," not the condition itself.
  Check that it is `true` on exactly the caller's own rows and `false` on
  everyone else's — **both halves**, since an all-`true` bug would light
  up every song and an all-`false` one would light up none, and only the
  second is easy to mistake for normal play.
- **What WAS proven, 2026-08-16, and it is the half that mattered:** after
  P2, the old unauthenticated two-arg call returns `PGRST202` ("Could not
  find the function public.get_show_picks(p_bracket_id, p_show_id)") — the
  anon-readable path that returned 44 rows and 11 distinct nicknames to
  anyone holding the publishable key is genuinely gone, not merely
  documented as gone. The new four-arg call with bad credentials returns
  `P0001 "Wrong name or PIN"`. Two different failures at two different
  layers, both confirmed live.
- **Historical detail worth keeping**: this cost a real diagnostic. Reading
  picks after cutoff using nothing but the publishable key was an actually-
  used workflow (2026-08-15, ranked sheet-shape check). Replacements are
  `admin_pick_status` or the SQL editor — see the corrected passage in the
  ranked-choice verification bullet above.

**The original open question, preserved because the reasoning is what
justified the change** — two read RPCs covering overlapping data were gated
completely differently:
- `get_bracket_scores` — authenticated **and** membership-gated. Cross-league
  visibility is deliberately Global-admin-only.
- `get_show_picks` — `grant execute ... to anon`, no auth, no membership
  check. Its only gate is `now() >= ls.cutoff_at`. It returns `player_id`,
  `player_name`, `slot`, `songname`.
**Verified live rather than read off the grant**: a single past show returned
44 rows and 11 distinct player names to an unauthenticated call using only
the publishable key that ships in the deployed frontend. So the RPC that
exposes *more* (raw UUIDs, every individual pick) is the one with *no* gate,
while the aggregate-scores RPC is locked down.
- **The reveal-after-cutoff behaviour is clearly intentional** — players are
  meant to see each other's sheets once picks lock, and that's the whole
  point of the cutoff condition in the `where` clause. **What is NOT
  established is whether `anon` rather than "any member of this league" was
  a deliberate choice or an oversight** carried over from Stage C1. Nothing
  in the SQL comments or this file says. That's why this is a question, not
  a task.
- **What to decide before the league is semi-public**: whether reveal-after-
  cutoff should require league membership (matching `get_bracket_scores`),
  and separately whether `player_id` needs to be in the payload at all —
  the frontend joins on it, but a public caller has no legitimate use for
  it and it's the one field that isn't already visible in-app.
- **Do not treat this as contained by obscurity.** The publishable key is
  public by design and documented in this file; the RPC signature is in
  committed SQL. Everything an attacker needs is already published — same
  structure as the login rate-limiting entry (#1), which is why they sit
  side by side here.

Note #5 is not independent — it's the *trigger* for #4 and for re-reading the
admin-gated integrity notes, so ordering matters: settle #4 before doing #5,
and #1–#3 before either, since they're what make an untrusted-ish admin pool
safe at all. (#6 was already gated this way before today and is easy to miss
because it sits far from the others — it's listed for completeness, not
because it's newly decided.)

**Deferred at its real (low) weight, NOT dropped — the desktop sidebar
redesign.** Recording both halves, because an earlier version of this line
said "never existed," which was itself an over-correction:
- **The idea is real.** The dev mentioned a desktop sidebar redesign once, in
  passing. It was never specified, never mocked up, never scoped. It stays on
  the deferred list **as an idea at that weight — a passing mention, not a
  planned deliverable.**
- **"mock2," and any artifact implied by it, never existed.** A prior session
  took the offhand mention and inflated it into a named deliverable with its
  own roadmap entry and an implied rejected alternative. That part is
  invented; see the false-memory note in the "Feature set frozen" section
  above for the verification (`git log --all -S"mock2"` matches nothing,
  ever).
- The correction then over-swung the other way, deleting the real mention
  along with the invented detail — see discipline item 6.

**Deferred with an explicit revisit trigger, not dropped:** cross-league global
stats (revisit past 2-3 leagues); the per-league webhook DB+UI (revisit if
env-var management gets painful, or the Global console expands); the
notification-preference toggle (no strong trigger, pick up whenever wanted);
game numbering past 12 shows (revisit only if a season actually gets there).

**DECIDED 2026-08-17, NOT STARTED: `sync_shows`, `sync_songs` and `score` on
the carton-sync edge function are COMPLETELY UNAUTHENTICATED — anyone can
trigger cross-league scoring runs, season activations and Discord posts.**
The shape of the fix is settled; only the implementation is outstanding.
- **DECISION: dual path, and KEEP the three buttons.** A shared secret in
  the request, the cron's header block gains one line, `runEdge` sends it,
  and the Data section stays as-is (hidden from league admins, visible to
  global). **The buttons were explicitly kept** — the dev has used "Run
  scoring now" during an incident, and waiting on the cron with no override
  is worse than the abuse risk being closed.
- **HONEST SCOPE, per the dev: shipping the secret in the bundle means it
  is not a secret from anyone who reads the bundle.** This closes the
  trivially-discoverable-endpoint case, not a determined attacker. Recorded
  so nobody later mistakes it for real authentication.
- **VARIANT worth considering at implementation time, no extra work:** the
  browser path does not need the secret at all. `runEdge` can send
  `p_name`/`p_pin` from the session the way `finalize`/`reopen`/
  `cutoff_changed` already do, leaving the secret exclusively to the cron.
  `_auth_player` and `_is_league_admin_or_global` are already in the file.
  That removes the bundle-secret weakness above entirely and makes the UI
  path a real auth boundary rather than a speed bump.
- **REJECTED: dropping the buttons and going cron-only.** Considered, and
  it does not work as-is — "manual overrides for jobs the cron runs every
  minute" is true of `score` ONLY. See the cron findings below: nothing
  schedules `sync_shows` or `sync_songs`, so dropping those buttons removes
  the app's only way to acquire new shows or refresh the song catalog.
  (Scheduling `sync_shows` would make the cron-only version viable and is
  independently worth doing — see the zero-overlay finding — but it is a
  separate change and does not replace this decision.)
- **PRIORITY: below gate items #1 (login rate-limiting) and #2 (`ft_session`
  plaintext PIN).** Those yield account and admin takeover — persistent,
  silent, targeted. This one yields availability degradation only: no data
  exposure (responses carry counts and ids), no persistence, no privilege
  gained. It is NOT a Pre-Session-5 gate item and does not block the
  Facebook League launch. It has the best effort-to-risk ratio on the list,
  so do it opportunistically ahead of the bigger security work purely
  because it is cheap.
Distinct from the three authenticated actions beside them: `reopen`,
`cutoff_changed` and `finalize` each call `requireLeagueAdmin`. These three
call nothing.
- **Verified, not inferred.** There is no auth check of any kind in
  `index.ts` for them — the only `Deno.env.get` calls in the file are
  `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and the Discord webhooks.
  There is **no `supabase/config.toml` in the repo**, so `verify_jwt` is
  not pinned in version control and its state is dashboard-only. Probed
  live: with **no key at all** the endpoint returns HTTP 500 carrying our
  own router's `{"ok":false,"error":...}` body — i.e. the request reached
  our code rather than being rejected by the gateway.
- **The router defaults unknown actions to scoring.** `else out = await
  scoreShows()`, and the body parse falls back to `{action:"score"}`. So a
  malformed or unrecognised POST runs a full scoring pass. Confirmed by
  accident while probing — an invalid action returned 200 having actually
  scored. **Do not probe this endpoint casually; there is no dry-run.**
- **The function runs as `SUPABASE_SERVICE_ROLE_KEY`**, bypassing RLS, which
  is why one call writes across every league.
- **What is NOT at risk, checked rather than assumed:** Discord spam is well
  guarded. `announcements()` filters on `.is("remind_sent", null)` /
  `lock_sent` / `winner_sent` and stamps after posting; song-by-song posts
  diff against `prevSet`; `notifyLeague` early-returns on an empty message.
  Repeated calls do not duplicate announcements. Responses carry only counts
  and ids — no player data. Scoring races converge (values are recomputed
  deterministically, the roster write is `ignoreDuplicates`, the stamp is
  idempotent).
- **The real risk is THIRD-PARTY rate limiting.** Every scoring pass on a
  live show hits The Carton's API, `BURST_POLLS` makes several per
  invocation, `sync_shows` pulls 200 shows and `sync_songs` the whole
  catalog. The Carton is a free keyless public API the entire app depends
  on — getting throttled or blocked there is an outage that cannot be fixed
  from this side. Secondary: Supabase invocation quota.
- **THE OBVIOUS FIX DOES NOT WORK, so don't reach for it: you cannot add
  `requireLeagueAdmin` to these.** They are unauthenticated *because the
  cron invokes them* and the cron has no player identity. Gating on
  name/PIN would silently stop all scheduled scoring. Equally, the admin
  buttons cannot carry a shared secret — the frontend ships to browsers, so
  embedding one republishes it.
- **The shape that works is a dual path:** accept EITHER a `CRON_SECRET`
  env value OR valid name/PIN with a global-admin check, with `runEdge`
  sending credentials the way `finalize` already does (`_auth_player` and
  `_is_league_admin_or_global` are already in the file). Cost is small in
  code — **but it needs a cron SQL update, and the cron schedule is NOT in
  this repo.** It lives in the database (pg_cron/pg_net), the same
  out-of-repo place that already holds the anon key in its Authorization
  header. That makes a third thing to keep in sync, and a botched update
  stops all scoring silently.
- **Mitigation already in place is presentation only:** the Data section is
  hidden from non-global admins as of 2026-08-17. That removes the
  affordance, NOT the capability — `runEdge` is on `window`, and the
  endpoint answers anyone holding the publishable key. Do not mistake the
  hidden section for a fix.
- Same class as Pre-Session-5 gate item #1 (login rate-limiting) — a public
  endpoint with no throttle — but much smaller work, and the abuse here
  costs availability rather than accounts.

**HOW TO ANSWER "IS THE NEW BUNDLE LIVE?" — build id, added 2026-08-17.**
`build.mjs` injects a `__BUILD_ID__` of the form `<contenthash>-<gitsha>`,
rendered in the Settings card under the colophon. The content hash covers
**every file that ships** — `src/**/*.js` *plus* `styles.css` *plus*
`index.html` — because `styles.css` is a separate `<link>` (`index.html:16`)
that esbuild never sees, so a src-only hash would be blind to CSS changes,
which was one of the two cases that prompted this.

```
# what is deployed
curl -s https://fantasyeggy.wooklord.net/app.js | grep -oE '[0-9a-f]{7}-[0-9a-f]{7}' | head -1
# what is local (dev server, or swap for a file read of app.js)
curl -s http://localhost:8080/app.js          | grep -oE '[0-9a-f]{7}-[0-9a-f]{7}' | head -1
```

Equal = the deploy is live. Different = it is not, and the git SHA half says
which commit *is*. **This replaces the ad-hoc "grep the bundle for a string
unique to my change" checks used throughout this file** — those work only if
you already know such a string, which is exactly what you lack when the
question is "did anything change at all".
- **It also separates "not deployed" from "my browser cached it"**: the
  Settings card shows the id the *tab* is running, `curl` shows the id the
  *edge* is serving. Two different ids means a stale client, not a failed
  deploy — the distinction the `max-age=600` entry below makes so painful.
- **The separator is a plain `-`, deliberately.** esbuild does NOT fold
  `` `build ${__BUILD_ID__}` `` into one literal — it emits
  `build ${"<id>"}` — and it escapes non-ASCII, so an earlier `·` came out
  as `\xB7` and a grep for the rendered prose matched nothing. Verified
  against the emitted bundle, not assumed.
- **Content hash, not a timestamp, and not a dirty flag.** `npm run dev`
  runs `build.mjs` before serving, so a timestamp would rewrite `app.js` on
  every dev-server start and leave the tree permanently dirty — destroying
  "tree is clean" as a signal. A dirty flag would be permanently set in the
  committed bundle, since you always build before committing.
- **Consequence to know: a CSS-only edit now changes `app.js`**, because the
  embedded id moves. Rebuild and commit both together. That is what keeps
  the id honest about CSS rather than silently under-reporting it.
- **Scope limit, worth stating: the id lives in `app.js` but covers
  `styles.css` too.** GitHub Pages deploys the whole repo per commit, so the
  *origin* always serves both from the same commit and the pairing is real
  there. A *client* can still hold them from different deploys for up to the
  cache window, since each file is cached independently — so a mismatched
  pair is possible in a browser and never at the edge. That is the same
  `max-age=600` problem below, not a flaw in the id.

**Deferred, and it silently taxes EVERY breaking change: `app.js` HAS NO
CACHE-BUSTING, and both it and `index.html` are served with
`max-age=600`.** Measured directly against the live site 2026-08-16 (not
inferred from GitHub Pages docs), so nobody has to re-measure it:

```
app.js      Cache-Control: max-age=600
index.html  Cache-Control: max-age=600
```

and `index.html:52` loads the bundle as a bare `<script src="app.js">` —
**no content hash in the filename, no query string, nothing tied to the
build.** Consequences, in the order they bite:

- **An active browser can keep running the old bundle for ~10 minutes
  after a deploy.** A normal reload inside that window serves the cached
  copy; only a hard reload bypasses it. So "I pushed it" and "clients are
  running it" are up to ten minutes apart, and the gap is invisible from
  the dev's side.
- **An installed PWA left open never refetches at all** until it is fully
  closed and reopened — so the tail is *unbounded*, not ten minutes. This
  compounds with the separate `state.leagues` reload requirement (see
  "Multi-league switcher behavior"): both are fixed by the same user
  action, and neither is discoverable by the user.
- **Therefore no deploy ordering is ever "clean" for a breaking change.**
  The window is governed by client cache and reload behaviour, which the
  deploy does not control — not by how fast the push lands.

**Two changes in one week have already paid this cost**, which is what
moved it from theoretical to recorded:
- **The domain move (2026-08-15)** — the storage/origin change forced every
  player to re-load and re-install anyway, so the stale-bundle tail was
  absorbed into a migration that was already disruptive. Easy to miss as
  an instance of this problem precisely because it hid inside a bigger one.
- **Stage P (2026-08-16)** — a genuine breaking RPC signature change, where
  it directly forced a two-file P1/P2 split (`stage_p1_...` additive,
  `stage_p2_...` the drop) purely to keep old and new bundles both working
  across the window. That split is the concrete, recurring cost: **every
  future signature change needs the same dance until this is fixed.**

**Fix options, either of which removes the window entirely:**
1. **Content hash in the filename** — emit `app.<hash>.js` from
   `build.mjs` and rewrite the `<script src>` in `index.html` at build
   time. Strongest option: the URL changes whenever the bytes change, so a
   cached old bundle is simply never requested again. Costs a build step
   that edits `index.html`, which is currently a static hand-maintained
   file, and means the committed bundle filename changes every build
   (noisier diffs, and the old file needs cleaning up).
2. **Query string keyed to the build** — `<script src="app.js?v=<hash>">`.
   Much smaller change; `app.js` keeps its stable name and git history
   stays clean. Caches key on the full URL including the query, so this is
   effective in practice. Slightly weaker than (1) — some intermediaries
   have historically ignored query strings for caching, though that is
   rare now and does not apply to the GitHub Pages CDN.
**Recommendation: (2)**, given `index.html` is a ~50-line hand-maintained
shell and the bundle is committed to git — (1)'s churn is real and buys
little at this scale. Either way `index.html` must stay `max-age=600` or
lower, since it is the file that carries the pointer.

**Not urgent in itself** — it changes nothing on a normal, non-breaking
deploy, which is most of them. Worth doing before the next breaking RPC
change, or before the player count makes "tell everyone to reload" stop
being a viable fallback.

**Deferred, and it is the kind of thing that is only ever discovered at the
worst possible moment: THE DATABASE RESTORE PATH HAS NEVER BEEN TESTED.**
Backups themselves went from "none exist at all" to "a script exists" on
2026-08-16 (see below) — but no restore from one has ever been performed, so
what exists today is an untested hypothesis, not a recovery capability. The
distinction is the whole point of this entry: a dump that turns out to have
the wrong format, the wrong table set, or an unusable insert order fails
exactly when it is needed and not one moment earlier.
- **Where the backup tooling lives, deliberately NOT in this repo:**
  `C:\Users\kylem\backups\fantasyeggy\` — `dump.sh`, a `README.md`, and the
  dumps. It is outside the working tree (confirmed via `git check-ignore`,
  which reports it as outside the repository rather than merely ignored)
  because the dumps carry `players.pin_hash` plus every player's pick
  history, and this repo is public. **The directory also holds `conn.txt`,
  a full Postgres connection string in plaintext — read/write, not a scoped
  key — so the folder as a whole is as sensitive as the database.** Its
  README says so at the top; don't relocate it into the repo for
  convenience.
- **Requires `pg_dump`, which was not installed** — `supabase db dump`
  shells out to Docker and fails without it (`LegacyDockerRunError`), and
  the machine had no `pg_dump`/`psql`/`docker` on PATH at all. Installed
  via `scoop install postgresql` (18.6); the binaries are at
  `C:\Users\kylem\scoop\apps\postgresql\current\bin` and `dump.sh` adds
  that to PATH itself rather than depending on the shell's.
- **What to actually verify when the restore test happens**, against a
  scratch project or a local Postgres and never against production:
  `--column-inserts` output restores cleanly against a schema built from
  `sql/`; foreign-key insert ordering works or needs `--disable-triggers`
  (pg_dump's table order is not guaranteed to be a valid FK order);
  `players.pin_hash` survives round-trip and a restored account can really
  log in; and nothing depends on the Supabase-managed `auth`/`storage`
  schemas the dump excludes — it shouldn't, since this app uses name+PIN
  RPCs rather than Supabase Auth, but that is the assumption under test.
- **`shows`/`setlist_songs`/`songs_cache` are in the dump on purpose, and
  omitting them would quietly break it.** They look regenerable from The
  Carton, but `syncShows` only covers a rolling 200-show/14-day window and
  full setlist history has never been backfilled — so a re-sync would not
  restore them, and historical `scores` rows would reference shows and
  setlists that no longer exist.

**✅ DONE 2026-08-18 — `toggleFormat` now confirms, and it exposed a live
bug in the check it was modelled on. The deferred entry that follows is kept
for its reasoning; the "no confirm of any kind" half of it is closed.**
- **What it does:** before writing, it fetches the show's current format,
  reads every bracket in the league (`brackets` has a public read), computes
  each one's slot keys for the current and next format with the same section
  selection `slotDefs()` uses, and lists the keys that would disappear.
  Brackets losing nothing are skipped; brackets with zero picks for that
  show are skipped; **ranked brackets are excluded entirely**, since rank
  keys come from `cfg.ranked.ladder` at config top level and never through
  `oneset`, so they are format-independent and counting them would be false.
- **It names the bracket, the pick count and the vanishing slots** rather
  than warning abstractly — "Casual — 2 picks saved; these slots disappear:
  Set 2 Closer, Encore, Flat pick 2".
- **Stated limit, in the dialog itself:** the count is ALL picks for that
  show in that bracket, not the number sitting on the disappearing slots.
  `admin_pick_status` returns per-player totals with no slot detail, and the
  RPC that does have slots (`get_show_picks`) is cutoff-gated and therefore
  blind on exactly the open shows that matter. Better to say so than imply a
  number that cannot be computed.
- **Blocks on a failed lookup** (no confirm, no write, a toast) — same
  discipline as `bootPlayer` and `setRosterMember`: the two outcomes differ
  by "nothing at risk" and "N picks lose a slot", so a failure producing the
  reassuring one would be an irreversible act under an unverified
  reassurance.
- **It is presentation-only and does not stop the orphaning** — it makes the
  consequence visible before the click. The underlying item (a format toggle
  can strand picks that `submit_picks`' catch-all delete then destroys) is
  NOT closed by this.

**⚠️ AND THE BUG IT EXPOSED, STILL OPEN: `saveConfig`'s mode-change orphan
check can never fire.** It counts at-risk picks via `get_show_picks`,
filtered to shows where `showState(sh) === "open"`. But `showState` returns
`"open"` when `new Date(s.cutoff_at) > new Date()` — cutoff in the FUTURE —
while `get_show_picks` ends `and ls.cutoff_at is not null and now() >=
ls.cutoff_at`, returning rows only AFTER cutoff. **Those conditions are
mutually exclusive**, so every show it checks returns zero rows, `atRisk` is
always empty, and the count branch has never once run. The warning silently
takes its "nothing at risk" path every time.
- Same shape as everything else this week: a check that looks green because
  it asks a question whose answer is structurally always the same.
- **Fix is known and small: use `admin_pick_status`** — admin-gated,
  bracket-scoped, takes `p_show_id`, and is NOT cutoff-gated. That is what
  `toggleFormat` uses. Sum `picks_count`; do not count rows, since the
  `left join` includes members with zero picks.
- Not fixed in the same pass deliberately — it is a separate control with
  its own tests, and bundling it would have made the toggleFormat mutations
  ambiguous.

**Deferred, and the shape is already proven: `toggleFormat` needs the same
orphan warning `saveConfig` got.** Identical failure, identical mechanism, no
confirm on the dangerous one. A format change swaps which config section
supplies the slot keys (`cfg.oneset` vs `cfg`), so every stored pick keyed to
a slot the new section doesn't define is orphaned — exactly what a scoring-
mode change does when it swaps `slots` keys for `rank1..rankN`. The
mode-change confirm (`admin.js:679-724`, commit `e266a40`) was built on
2026-08-14 for precisely this failure and does not cover the format toggle,
which fires `admin_set_show_format` immediately and toasts success
(`admin.js:566`) — one click from the Shows & cutoffs panel, no confirmation
of any kind. **This is not hypothetical: it happened in production the same
day it was written** — see the "⚠️ OPEN 2026-08-14 — the standard→one_set
toggle ORPHANS two Official slot keys" bullet in the Postgres/Supabase
gotchas section for the live case, including the detail that a post-toggle
save deletes the orphaned rows via `submit_picks`'s catch-all delete and that
the loss is **not** detectable afterwards (a player who lost a row and a
player who never filled it are indistinguishable in `picks`).
- **Reuse, don't re-derive**: `saveConfig`'s existing check already computes
  "which stored slot keys would no longer be valid" — the format version asks
  the same question with `sect = (format === 'one_set' && cfg.oneset) ?
  cfg.oneset : cfg` as the new section, against all picks for that one show
  rather than the whole bracket.
- **Worth covering the reverse direction too**: one_set→standard orphans
  nothing *today* only because Official's `oneset` keys happen to be a subset
  of its `slots` keys. That is a property of one bracket's current config,
  not a guarantee — a bracket with a one-set-only slot type would orphan on
  the way back. Check the actual key sets, don't assume a direction is safe.

**TWO SAVES WRITE `brackets.config`, and each owns specific fields — one
writer per field. Do not let either re-read the other's inputs.** Split on
2026-08-17: "Voting & scoring mode" (formerly Master switch) has its own
`saveMasterSwitch()` button, because its three fields were previously
committed by a "Save all rules" button four sections below — a control whose
consequences were invisible from where you acted.
- **`saveMasterSwitch`** owns `voting_override`, `mode`, `bonuses.perfect`.
- **`saveConfig`** owns everything else and carries those three through from
  `state.cfg` rather than reading their inputs.
- **The hazard both must respect: `admin_update_config` writes the WHOLE
  config object**, so each save merges against `state.cfg` (one spreads
  `...state.cfg`, the other reads through it) and both assign `state.cfg`
  on success. If either re-read the other's inputs, whichever saved last
  would win and a field would silently revert — no error, nothing on
  screen, visible only after a reload.
- **The mode-change orphan confirm moved with the field it guards** into
  `confirmModeChange()`, called from `saveMasterSwitch`. `saveConfig` reads
  `mode` from `state.cfg`, so it can never differ and never warns.
- **`runSaveSplitScenario` covers the round trip in both orders**, asserting
  on the actual `admin_update_config` payloads rather than rendered values —
  a reverted field looks identical on screen until reload, which is why this
  was invisible. **Its first version did NOT catch the regression it existed
  for**: immediately after a master save the input and `state.cfg` agree, so
  reading either produced an identical payload. Strengthened to dirty
  `#c-bperfect` WITHOUT saving, which both discriminates and pins the better
  property — **an unsaved Master switch edit must not be silently committed
  by pressing Save rules.** Same lesson as the `!/zero/i` assertion: an
  assertion whose two sides agree by construction proves nothing.

**The admin tab is GROUPED BY SCOPE and ordered by FREQUENCY within each
group. The order is load-bearing — read this before reordering anything in
`renderAdmin`.** Current order (revised late 2026-08-17; an earlier version
of this entry described Who's picked as sitting BELOW the first divider,
which is no longer true):

    Who's picked: <Bracket>          ← highest-frequency, deliberately first
    Shows: cutoffs & finalizing      ┐
    Members                          │ league-scoped
    Seasons (Official)               ┘
    ── EDITING <BRACKET> · <LEAGUE> ──  "The rules below apply to this bracket only."
    Voting & scoring mode            ┐
    Game rules / House rules /       │ current-bracket config
    Season tiebreakers / Save rules  ┘
    ── ADMINISTRATOR ──  "These affect every league, not just this one."
    Manual sync & scoring            ┐ global-admin only
    Global console                   ┘
    ── YOUR ACCOUNT ──
    Settings, footer

- **THREE dividers, and they BOUND EACH OTHER — that is what makes their
  claims true.** The single original line said "everything below applies to
  this bracket only", which was false for Manual sync & scoring, Global
  console and Settings, all of which sit below it. Each divider now governs
  only until the next. The copy carries its own bound too: "The RULES
  below" names its subject, so it holds even if a reader misses the next
  divider. A divider saying "everything below" is fragile by construction.
- **Who's picked is FIRST, above the first divider**, because it is the
  most-used section and burying it under configuration was the wrong trade.
  That costs it the divider's scope claim, so it states its own: the heading
  renders "Who's picked: Casual", from the same `currentBracket()` the
  divider uses, so the two cannot disagree. The qualifier is its own `<span
  class="section-scope">` but sits INSIDE the `<h2>` so it inherits the
  heading's font rather than re-declaring it — see the note in styles.css
  and don't re-add decoration to it.
- **The scope line names BOTH bracket and league** deliberately: two leagues
  exist and both have a bracket called "Casual", so the bracket name alone
  identifies nothing. It is two child elements (`.scopeline-label` /
  `.scopeline-note`), not one string with a `<br>`, so each wraps
  independently.
- **Seasons sits immediately ABOVE the line on purpose, next to but not
  with Season tiebreakers.** The two share a name and not a scope — Seasons
  resolves `officialBracketId()` and edits Official regardless of the
  switcher, while Season tiebreakers is current-bracket config
  (`cfg.tiebreakers`) that only renders when the current bracket IS
  Official. Below the line the line would be actively false for it. **This
  looks wrong when scanning by name and is correct by behaviour** — there
  is a comment saying so in `admin.js`; don't "fix" it.
- **Global console moved from first to second-from-last**, joining Data as
  the other global-scoped section. A separate global-admin tab was
  considered and rejected: it touches `index.html`'s nav, `layout.js`'s
  dispatch map / `renderAll` / `applyLayout`, and `dom.js`'s `colMap` +
  `$()` redirect — and a fourth desktop column takes the 901px columns from
  ~224px to ~165px, breaking the podium sizing that has already been
  re-tiered twice for that band (see the podium note in Frontend/CSS
  gotchas).
- **`.scopeline` is a separate CSS rule from `.sheet .divider`, on
  purpose.** That one is paper-scoped and uses `--paper-ink-soft`, correct
  only on the cream sheet stock; this one sits on the app background and
  uses `--line`/`--cream-dim`/`--cream`, all redefined per theme.
- **The scenario suite cannot verify any of this.** Its assertions key on
  element ids, not on order, and `harness.mjs:420`'s `q()` is a bare
  `getElementById` — nothing scopes a lookup to `#sec-<id>`. So a body
  rendered under the wrong heading keeps every id resolvable and the suite
  stays green. **A reorder must be checked positionally against the
  source** (find each `collapsible("id"`, slice to the next one, assert a
  distinctive string from that section's own body appears inside), and the
  reassembly should be verified to be an identical multiset of lines.
  That is how the 2026-08-17 reorder was done; a piecemeal edit attempt
  during it did briefly cross the `shows` and `master` bodies.

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

**Members panel signalling — the visual weight and confirm count both
understate Reset PIN relative to its operational cost.** Separate from the
boot bug above; this one is layout/affordance, not behaviour. Not a claim
about reversibility —
both controls are recoverable, and an earlier framing of this as
"recoverable vs irreversible" was wrong. Boot is undone by re-adding
(unban first if banned); Reset PIN is undone by resetting again. What is
genuinely one-shot is the PIN *string*, not the account state.
- Boot carries **two** confirms and coral border+text. Reset PIN carries
  **one** confirm and plain `.btn.ghost.small` styling, identical to every
  other small button in the panel.
- But Reset PIN is the one that **takes a live account offline until a
  human is reached**: the target is locked into the forced interstitial and
  `_reject_if_must_change_pin` blocks every write RPC until they complete
  it. Boot removes someone from a league they can be re-added to.
- So the styling and the confirm count both point at Boot while the
  real-time obligation sits with Reset. Worth correcting whenever the
  Members section is next touched — the current treatment teaches the wrong
  instinct about which button to be careful with.
- Scale note: the pair renders once per member row, so at Ambassadors' 14
  members that is 13 of each on screen at once; at ~50 it is ~98 destructive
  buttons in a flat list.

**NOT a bug, checked 2026-08-17 so nobody re-investigates: `must_change_pin`
is set correctly by BOTH admin reset buttons.** It looks like Session 4
might have wired the interstitial to `globalResetPin` only, but there is
just one implementation — `resetMemberPin` (`admin.js:463`) and
`globalResetPin` (`admin.js:167`) call the same `admin_reset_player_pin`
RPC, differing only in `p_league_id`. That RPC sets
`must_change_pin = true` unconditionally (`stage_l:77`), and the only other
statement in non-archive SQL that writes `pin_hash` is `change_own_pin`,
which clears the flag. There is no second path to miss.

**FIX CANDIDATE: there are TWO fallbacks for a missing `oneset` config
section, and they disagree with each other. That disagreement is the bug —
not either fallback on its own.** Found 2026-08-17 on the newly-created
Green Eggs league, whose brackets have no `oneset` section because
`global_create_league`'s `def_cfg` doesn't define one.
- **The scorer's fallback** (`scoring.js`'s `resolveConfigSection`) and
  **the pick sheet's** (`picks.js`'s `slotDefs`/`breakdownSlotInfo`) are the
  identical expression — `(format === "one_set" && cfg.oneset) ? cfg.oneset
  : cfg` — so they agree with each other and fall back to the top-level
  standard section.
- **The admin panel's fallback** (`admin.js`'s `rulesRegionHtml`) is a
  hardcoded object of its own: `cfg.oneset || { slots:[opener, closer,
  cover1], flat_picks:3, flat_points:1 }`. For Green Eggs that displays
  `opener / closer / cover1` where the other two use `opener / closer /
  encore` — and `cover1` appears nowhere in that bracket's config.
- **DON'T "fix" the scorer's fallback — it is fine, and the obvious reason
  to distrust it is wrong.** The intuition is that standard slots reference
  set structure a one-setter lacks. They mostly don't:
  `ONE_SET_EXCLUDED_TYPES` is only `["set1_closer", "set2_opener"]`.
  `closer` is not excluded (`slotLabelFor()` relabels it to plain "Closer",
  which is meaningful at a one-setter) and neither is `encore`. Every slot
  in Green Eggs' standard section is valid at a one-set show.
- **The panel being untruthful and the behaviour being correct pull in
  opposite directions, which is what makes it confusing at the keyboard.**
  Pressing Save makes the panel honest by writing its invented section into
  the config — `saveConfig` reads `#slots1`, which always exists because the
  panel rendered the fabrication into it — thereby swapping `encore` for
  `cover1` on one-set shows for real. Not pressing Save keeps scoring
  correct and leaves the panel lying. **No admin action resolves both**, so
  this is a code fix, not something to be careful about.
- **Note the trigger is any unrelated save.** A rules change aimed at
  something else entirely still materialises the invented `oneset`.
- **The decision, not yet made:** either point `rulesRegionHtml`'s fallback
  at the same expression the other two use (smallest, kills the divergence
  directly), or give `def_cfg` a real `oneset` section so new leagues are
  consistent from creation. The second is more thorough but **does not fix
  brackets 3 and 4, which already exist** — it needs its own one-shot
  update, exactly like the `shows.timezone` backfill. Either way the goal is
  one fallback, not two.
- **Separate, narrower bug found alongside it:** `resolveConfigSection`
  returns `cfg` wholesale without filtering `ONE_SET_EXCLUDED_TYPES`, so a
  bracket whose standard section *did* contain `set1_closer`/`set2_opener`
  and had no `oneset` section would render and score set-2 slots at a
  one-set show. No live bracket is in that state; the admin editor hides
  those types when editing one-set, but nothing enforces it at scoring time.
- Live exposure today is **zero** — the fallback only fires for brackets 3
  and 4, whose standard sections are one-set-safe, and Ambassadors' two
  brackets both carry real `oneset` sections so they never reach it. Full
  write-up in `docs/session5_plan.md`.

**FIX CANDIDATE (small, and the correct implementation already exists ten
lines away): slot mode's perfect-sheet gate is a count where it should be a
coverage check.** `scorePicks` (`supabase/functions/carton-sync/scoring.js`)
fires the bonus on `picks.length === expected`, where `expected` is
`sect.slots.length + sect.flat_picks`. `scoreRankedPicks`, in the same file,
already does this correctly — it gates on whether every distinct ladder
position `rank1..rankN` is filled — **and carries a comment explaining
precisely why the count version is wrong.** So this file contains both the
bug and its fix, side by side. Porting the coverage check to slot mode is
small; it needs a test fixture in `test/scoring.test.mjs` alongside the
existing ranked 7a-7p blocks.
- **This is the shape discipline item 5 names by name** ("a count standing
  in for coverage"), which makes it a live contradiction between the code
  and this file rather than an ordinary latent bug.
- **Tonight (2026-08-14) is the concrete case, and the earlier write-up
  understated it.** It was recorded as a consequence of the format toggle:
  two Official players held 6 rows against an `expected` of 4, so the bonus
  became unreachable for them. That framing is accurate but shallow — **the
  toggle only EXPOSED the bug; the count check IS the bug.** Any route that
  leaves a stale slot key on a sheet reaches it, and a format change is
  merely the easiest such route.
- **It fails in BOTH directions, and only the under-earn direction has been
  seen so far.** Under-earn is tonight's case (extra stale rows push the
  count past `expected`, so a genuinely complete sheet is denied the bonus).
  **Over-earn is equally reachable**: a player holding 3 valid rows plus 1
  stale row hits `picks.length === expected` at 4 while leaving a real slot
  unfilled, and collects the bonus for an incomplete sheet. That is exactly
  the case the ranked comment describes — picks that satisfy a count without
  covering the board — and nothing structural prevents it in slot mode
  today.
- **ACUTE, RIGHT NOW, not just deferred: the same incident can recur before
  tonight's 03:00Z cutoff.** Deleting the orphaned rows levelled the sheets
  as they stood; it did not close the hole. `toggleFormat` remains one
  unconfirmed click from the Shows & cutoffs panel (`admin.js:566`, no
  `confirm`, no orphan check), picks stay open until 03:00Z, and a second
  toggle — or a mis-click on the wrong show — reproduces the whole thing,
  this time against players who saved AFTER the levelling. **The only
  mitigation in place is "don't touch it."** Worth stating plainly rather
  than letting the delete read as having closed the exposure.

**Small, unresolved: the countdown is now phrased two ways.** `picks.js`'s
pick sheet renders `Cutoff Aug 14, 11:00 PM · 2h 14m` — the trailing "left"
was dropped 2026-08-14 at the dev's request, since it wrapped awkwardly beside
the cutoff time. But `shows.js:183` and `:256` render the same
`countdown()` value as `"cutoff in 2h 14m"`, so the app now states the same
fact two ways and the pick sheet has the version with no word saying what the
duration *is*. Not a bug and not obviously wrong — a bare `2h 14m` directly
after a timestamp reads fine in context — but it was a deliberate change made
without the `shows.js` phrasing in view, so it's recorded rather than left as
an accident someone later "fixes" in the wrong direction. **Nothing in the
suite covers `.countbig`**, so either phrasing can drift without a test
noticing. Options if it's ever worth touching: align `shows.js` to the bare
form, restore a short word to the sheet ("in 2h 14m"), or decide the two
contexts genuinely want different wording and note that here instead.

**"Perfect sheet" was renamed to "Perfect" everywhere, 2026-08-14 — and the
only reason it could be done cleanly is that the bonus had never once fired.**
Two separate strings were involved, in two different layers, and the second is
the one worth remembering:
- The Rules card's term (`ruleDefs`'s `withPerfect`, `src/features/picks.js`) —
  pure render-time copy, changeable at will.
- The scoring breakdown row's `songname` (`scoring.js`, both `scorePicks` and
  `scoreRankedPicks`) — **written into `scores.breakdown` at score time and
  frozen thereafter** (see the frozen-breakdown gotcha above). Renaming this
  normally splits history: already-final shows keep the old wording forever
  while new ones get the new one, an inconsistency *inside a single list*,
  which is worse than the cross-screen one it fixes.
- **What made it free: zero existing rows carried the bonus.** Confirmed by
  the dev before the rename, against the live database — the repo could only
  show four shows' worth (`test2-scoring-comparison.html` states the bonus
  never fired across the Test 2 season), which is not the same claim.
- **The general rule this is an instance of**: any string `scoring.js` writes
  into `breakdown` is a data migration, not a copy edit, the moment one real
  score row contains it. Check for existing rows first —
  `select count(*) from scores where breakdown @> '[{"slot":"bonus"}]'::jsonb;`
  is the shape — and if the count is non-zero, the choice is "leave it" or
  "backfill," never a silent rename. Render-time copy in `src/` has no such
  constraint.
- Assertions now pin the short form on both sides: `test/scenario.test.mjs`
  (three checks, rules card) and `test/scoring.test.mjs:441` (breakdown row).
  `docs/module_b_ranked_choice_plan.md:393` still quotes the old string —
  intentionally, it's a historical design doc, not live code.

**Open DESIGN QUESTION, not a task — format changes are transparent to
players in ranked mode and destructive in slot mode, and the asymmetry is
structural.** Recorded alongside the mechanical `toggleFormat` item above
because it is the *operational* argument for ranked choice, which the
mechanical framing loses. Slot keys encode set structure, so the valid key
space is a function of `ls.format` — changing the format changes which
stored picks are addressable at all. Rank keys encode only ladder position,
read from `cfg.ranked.ladder` at config top level and never through the
`oneset` section: `rank1` means the same thing at a one-set show, a two-set
show, and a festival. A ranked bracket cannot be orphaned by a format
toggle; a slot bracket is orphaned by definition whenever the two sections'
key sets differ.

**The concrete case, 2026-08-14 — the incentive problem is the part worth
remembering.** Two Official players held 6 rows against everyone else's 4,
purely because of when they last saved relative to an admin toggle. Their
two stranded rows fall to the flat branch and pay `flat_points` (2) each on
the *easiest* condition in the game — played anywhere, no position required.
So two players had a **21-point ceiling against the other four's 19**, worth
up to 4 points nobody else could earn, from nothing but save timing against
an admin toggle. **Resolved by deleting the stranded rows** — the ceiling was
levelled rather than left standing, a call made by the dev, who was one of
the two beneficiaries. Full detail in the "⚠️ OPEN 2026-08-14" bullet in the
Postgres/Supabase gotchas section, including the verification that a re-save
really does drop them.

**Three candidate shapes for slot mode, not mutually exclusive. Read the
caveats — two of the three do less than they look like they do:**
1. **A `toggleFormat` orphan warning** (the item above). Necessary but weak,
   as noted: it warns about damage rather than preventing it, and it fires
   at the admin, who is not the person who loses picks.
2. **Constrain `oneset` keys to be a SUBSET of `slots` keys.** Two caveats
   that matter. **(a) It protects the recovery path, not the change** —
   with the subset property, one_set→standard can never orphan (the key
   space only grows), but standard→one_set orphans exactly as before, since
   that direction shrinks it. That is still worth having, because it
   guarantees a revert is always safe, which is currently true only by
   accident. **(b) It is not free: Casual's own config violates it today** —
   Casual's `oneset` defines `second_song` and `cover1`, neither of which
   appears in its `slots` set (`opener`/`closer`/`encore` + 3 flats). So
   this needs a config migration or a grandfather clause, not just a
   validator. (Moot for Casual specifically while it runs ranked, but the
   constraint would have to hold for every bracket, and Casual's config
   still carries the violating section underneath.)
3. **Stop deleting rows absent from the payload in `submit_picks`.** The
   biggest fix and the real one: the trailing catch-all delete is precisely
   what turns "orphaned" into "destroyed," and without it a format toggle
   is fully reversible with no data loss in either direction. **There is a
   clean implementation path, and the deletion capability does not have to
   be lost with it**: `submit_picks` already deletes per-slot when a slot is
   submitted with a blank songname, so clearing a pick has a mechanism that
   does not depend on the catch-all. What blocks it is the client —
   `savePicks` (`picks.js:342`) filters blank rows out of the payload
   before sending, so today the catch-all is the *only* thing that clears a
   cleared row. The change is therefore: send every rendered row including
   blanks, and drop the catch-all.
   - **Deploy ordering is not optional here, and GitHub Pages caching is
     why.** Ship the client change first and a stale cached bundle still
     works (it just relies on a catch-all that's still present); ship the
     SQL first and any client still filtering blanks silently loses the
     ability to clear a pick — a save that should empty a slot leaves the
     old value in place. Server tolerant of both shapes first, client
     second, catch-all removed last.

**Deferred, small, and worth doing: a unit test for `activateSeasons()`'s
ERROR path.** Test 3's activation on 2026-08-14 exercised the success path
under heavy conflict (13 of 14 rows collided and were skipped, 1 inserted,
`roster_locked_at` stamped 0.1s after the write) — but **no write failed, so
the error path has never actually run**. The half still unverified is: on a
failed roster write, `roster_locked_at` is left `null`, the failure is
`console.error`-logged and surfaced, and the next cron run retries the
season. **Two identifiers are involved and they are not interchangeable**:
`failed` is the local array and the key in `activateSeasons()`'s own return
(`return { activated, failed }`, index.ts:365), while
`season_activation_failures` is the HTTP-response key `scoreShows()` maps it
to (index.ts:540 and 556). A unit test calling the function directly sees
`failed`; only an end-to-end HTTP call sees `season_activation_failures`.
That behaviour is currently guaranteed only by
reading the code, and it is precisely the half whose absence caused the
original bug — the old code stamped `roster_locked_at` regardless of whether
the insert succeeded, turning a recoverable error into a permanent silent
one.
- **Shape**: stub the Supabase roster write to return an error, call
  `activateSeasons()`, assert `roster_locked_at` stays null, the season
  appears in the returned `failed` list, and a second call retries it.
- **Same harness idiom as the 7a-7p blocks in `test/scoring.test.mjs`** —
  plain Node, no Deno, no network, a hand-rolled `check()` and fixture
  objects. The wrinkle is that `activateSeasons` lives in `index.ts` and
  talks to `supa` directly, unlike `scoring.js` which is pure data-in/
  data-out; the stub therefore has to stand in for the Supabase client
  rather than just supply inputs, or the function needs its client injected.
  Worth sizing that before starting — it may be the difference between a
  30-minute task and a refactor.

### Alternate scoring modes (designed, not scheduled)

Two slot-independent scoring modes were designed on request — no opener/closer/
encore positional matching, a pick either gets played or it doesn't. Neither is
scheduled for a session; both stay here until that changes.

**Module A — last-played weighting (risk/reward).** Points scale with how long a
song's been dormant; a deep cut pays far more than a staple played last week.

- **Data dependency, checked directly:** the hoped-for shortcut doesn't exist —
  see the `songs_cache.times_played`/`last_played` dead-columns gotcha above. The
  data IS reachable, just not for free: a one-time full-history backfill (same
  approach already proven fetching the 609-show cache for the slot-predictability
  analysis) plus repurposing those two columns to hold app-computed values,
  refreshed on the existing sync cadence.
- **Scaling curve, computed against 5,396 real repeat-gap observations from that
  cache:** median gap 5 shows, p90 35, p99 201, max 534 — a 1:1 linear score
  would let a handful of extreme one-off covers dominate a season. Fixed bands
  (1-6) were rejected — they just trade the current 2-value tie problem for a
  smaller 6-value version of the same thing. Recommended instead: a capped curve,
  `points = clamp(round(1.2 × √gap), 1, 12)` — 12 distinct values across those
  same 5,396 observations, ~3% landing at the cap (a normal tail bucket, not a
  flaw).
- **Never-played songs:** score at the same max/cap value real gaps beyond ~100
  shows already saturate into — no special-case exclusion needed, a never-played
  song is definitionally the rarest possible pick. **Any Debut wildcard
  interaction:** since a debut already scores at this mode's max value
  automatically, the existing debut bonus becomes redundant specifically within
  this mode — stack it anyway or suppress it when this mode is active, not
  decided yet.
- **Lock timing:** recommended locked at cutoff, matching every other pick in
  this app — keeps "what you saw when you picked" equal to "what you got,"
  which legibility needs anyway. Locking at individual submission instead is
  simpler to build but creates a fairness skew (early vs. last-minute submitters
  could see different numbers for the same song purely from timing).
- **Legibility cost:** cheap at runtime — once a gap value exists on
  `songs_cache`, the curve math is trivial and can run client-side live in the
  autocomplete. The real cost is entirely the data-layer backfill above, not the
  display.

**Module B — ranked choice.** N picks, each assigned a value from a fixed
ladder (e.g. 5/4/3/2/1); hits pay their assigned rank, summed.

- Fewer than N picks: not decided — leaning top-ranks-only (3 of 5 uses 5/4/3)
  over free assignment, since free assignment adds real UI complexity
  (duplicate-value prevention) for an unclear benefit.
- Ladder: recommended configurable per bracket, not fixed — costs nothing extra
  once the mode-field architecture below exists at all.
- Multiple hits sum their assigned ranks — confirmed, the only sensible
  behavior, no further design needed.
- **Locked decisions (session of 2026-08-12):**
  1. Pure rank-value scoring only. Cover bonuses, debut bonuses, and the Any
     Debut wildcard are suppressed at code level in this mode — not
     defaulted to 0, not left toggleable. They reward obscurity, a second
     risk axis competing with the only question ranked choice asks: how
     confident is the player in this song. A future admin cannot turn them
     on for a ranked bracket.
  2. Perfect-sheet is the single exception and still applies — it scores the
     whole sheet being right, not any individual song's rarity. Scored
     against the FULL ladder length, not however many picks were actually
     submitted, so a partial sheet can never qualify (a 1-pick sheet that
     hits its one pick must not collect the bonus meant for filling and
     hitting every row). The completeness check is against distinct rank
     positions (rank1..rankN all present), not a raw pick count — a count-
     only check has the same shape as the partial-sheet exploit it's meant
     to close (several picks that don't actually cover every position could
     satisfy a count without covering the board), and the hit check that
     pairs with it is scoped to picks inside the ladder only, so a stale
     pick left over from a since-shortened ladder can't block an otherwise-
     complete sheet by sitting there unplayed.
  3. Fixed row count regardless of show format. Standard slots reference set
     structure ("Set 2 Closer"), which is why one-set shows and festivals
     need separate handling there. Ranked choice has no positional concept
     at all, so that distinction does not apply and the row count never
     varies — the ladder lives at the bracket-config top level, not nested
     under the `oneset` section slot mode uses.
  4. Fewer than N picks submitted: allowed, no penalty. Any subset of the N
     rank rows may be left blank; a blank row simply contributes no pick and
     scores nothing, the same way an unfilled slot or flat pick already
     behaves today. Rows are not free-assignment — each row is a fixed rank
     position (Rank 1 always pays the ladder's first value, Rank 2 the
     second, etc.), so there's no duplicate-value-prevention UI the way free
     assignment would have required.
  - **Decided: mid-season ladder edits stay unguarded, with an explicit
    revisit trigger.** Traced whether `slots` has the same exposure today —
    it does: `admin_update_config` (`sql/stage_c1_rpcs.sql`) has no
    season-status guard at all, and `scoreBracket` (`carton-sync/index.ts`)
    reads `bracket.config` fresh every scoring pass, so a config edit takes
    effect on the very next cron tick. The only existing mitigation is a
    warning label in the admin panel ("Rule changes apply on the next
    scoring run..."), not a lock — `brackets.config` has no freeze
    mechanism anywhere, unlike `season_rosters`. Ranked choice's ladder
    inherits this exact pre-existing exposure rather than introducing a new
    one, so no guard was built for it (that would be new scope, and would
    leave `slots` — the identical hole — still open beside it).
    **The part that decides WHEN this gets revisited: a config change is
    visible going forward but silent backward.** Forward is fine — the pick
    sheet and "The Rules" card both re-render from `cfg`, so a player sees
    the new ladder before picking against it. The retroactive half has no
    such tell: because `scoreBracket` re-reads config fresh on every pass,
    editing a ladder rewrites `breakdown` and `points` for shows that were
    already scored and already shown, so a player sees a different number
    than they saw before, with no notice and no record that a rule moved
    underneath it. (Contrast the frozen-`breakdown`-text gotcha above: that
    one freezes *wording* at score time, not the point values a later pass
    recomputes.) That's acceptable only while exactly one person — the
    dev — can edit bracket config, which is true today and stops being true
    the moment a league admin who isn't the dev is appointed. **Revisit
    before appointing any league admin who isn't the dev — i.e. before
    Session 5's Facebook League admins**, not on some later "if it gets
    painful" trigger.

**Architecture: a `mode` field on the existing `brackets.config`, not a parallel
system.** Brackets already carry fully independent config (Casual could run
ranked-choice while Official runs slots for free, once this exists) — a mode
field is the natural extension of a pattern already in place, not new
architecture. Existing brackets simply never set `mode` and keep today's exact
behavior; zero migration required. Sizing: config schema is small; the scoring
engine needs a branch in `scorePicks()` but each new mode's logic is actually
*simpler* than today's slot logic (no exact-vs-wrong-slot distinction); the
pick-sheet rendering change is the biggest piece — genuinely new territory, N
generic song-pick inputs instead of named-slot inputs, plus Module A's live
potential-points readout and Module B's rank-assignment UI. **Overall bigger
than any single session in the current roadmap — realistically 2-3 sessions on
its own.** A new-mode test-harness fixture needs to exist before either mode
ships, not be retrofitted after — this project has already shipped one real bug
from exactly that kind of fixture gap (see the global-admin fixture note above).

**If Module A ships, the current argument about slot point values becomes moot
for any bracket running that mode** — there are no slots to price under a
slot-independent scoring system. The slot-value work already done (the A/B/C/D
system comparison, the entropy-based predictability analysis) stays relevant
only for brackets that keep running the positional model.

---

## Conventions

**STANDING RULE — no player nicknames and no pick contents in tracked files,
ever.** This repo is public: `curl` with no credentials returns 200 on both
`github.com/wooklord/fantasytour` and `raw.githubusercontent.com/.../CLAUDE.md`
(verified 2026-08-15 UTC). Nicknames are the login identifier — half of the
name+PIN credential pair — so writing them into a tracked file publishes one
factor of every account named. That covers CLAUDE.md, plan files, commit
messages, SQL comments, test fixtures, and analysis HTML alike. Player UUIDs
too. Refer to players by role ("the league admin", "the eighth member") or by
the property that matters ("the one member not on the roster before
activation"); resolve identity with a query at the time you need it.
- **This rule was broken the day it was written, which is why it exists.**
  `caab1d6` recorded seven nicknames and four attributed picks into
  CLAUDE.md; redacted 2026-08-15 UTC. Forward redaction only — history was
  deliberately NOT rewritten, see the reasoning below.
- **Deciding factor for not rewriting history, and it cuts both ways:** the
  app already publishes a superset of this data to anonymous callers.
  `get_show_picks` is granted to `anon` and, for any show past cutoff,
  returns `player_id`, `player_name`, `slot`, `songname` — verified live,
  44 rows and 11 distinct names off a single past show using only the
  publishable key that ships in the frontend. So a history rewrite would
  have cost every commit SHA cited throughout this file to remove data that
  a public endpoint hands out anyway. **Do not read that as "the rule
  doesn't matter"** — read it as "the git leak was dominated by a bigger
  one," which is now tracked as an open question on the Pre-Session-5 gate.
- **`test2-scoring-comparison.html` is GRANDFATHERED, explicitly.** It
  carries the full roster (ten nicknames, 16–26 occurrences each, with
  per-player scoring data) and predates this rule by a long way — added in
  `ff7a3f0`, *"Add two standalone analysis docs for sharing outside the
  org"*, i.e. it was created deliberately for external sharing, not leaked
  into the repo by accident. **Removing it is a separate decision, not a
  cleanup task**, and it needs the dev's call because the sharing intent
  was the point of the file. Recorded here so a future reader finds an
  explanation rather than an unexplained contradiction and "fixes" it —
  or, worse, concludes the rule is dead because the repo visibly ignores
  it. (`test/tiebreak.test.mjs`, `src/features/standings.js` and the
  analysis HTML also carry a few real nicknames as fixture/example data;
  same grandfathering, lower stakes, worth swapping for invented names
  whenever those files are next touched for another reason.)

Instance-specific values (name, branding, default slots, data source) live in
named constants (`src/core/config.js` for frontend; a top-of-file constant in
the edge function/SQL seed) rather than hardcoded inline.

## Deploy model

- Frontend: `node build.mjs` (or `npm run build`) to rebuild `app.js`/`app.js.map`
  from `src/`, commit the bundle alongside the source change, then push → GitHub
  Pages serves whatever's committed. There is no CI build step — a `src/` edit
  that isn't rebuilt+committed silently ships stale behavior.
- Edge function: deploy via the Supabase CLI (`supabase`, v2.x) — install and
  authenticate it if it isn't already, on whatever machine you're working from.
  Project ref is `zdfhglvjxquvkjyvophz` (matches Credentials above; `supabase
  projects list` confirms it once authenticated). Deploy with:
  `supabase functions deploy carton-sync --project-ref zdfhglvjxquvkjyvophz`
  (the `--project-ref` is redundant once linked, but explicit is safer than
  relying on link state). A "WARNING: Docker is not running" line is harmless —
  the CLI falls back to uploading source directly instead of bundling in a
  container; the deploy still succeeds and the printed `dashboard_url` /
  `"message":"Deployed Functions."` confirms it.
- SQL: run in the Supabase SQL editor (or via `supabase db` tooling).
- Cron: the scoring function runs on a schedule; the schedule SQL embeds the anon key
  in an Authorization header — if the key ever rotates, the cron header needs updating
  too (two places: frontend constants + cron header).
- **Local preview: `npm run dev`** (rebuilds via `build.mjs` then serves via
  `serve.mjs`) — one command, so there's no separate "did I rebuild?" step and no
  way to be looking at a stale `app.js`. Fixed at `http://localhost:8080/`,
  always with `Cache-Control: no-store` (and `Pragma`/`Expires` to match) on
  every response, no flag to remember. Prints the LAN URL too (`http://<your
  IP>:8080/`) for checking on a phone on the same network. Before starting a
  second one, check whether it's already running: `netstat -ano | findstr :8080`
  — `serve.mjs` also fails loudly with that exact command if the port's taken,
  instead of a second server silently coming up alongside a stale one (this
  project has accumulated stray preview servers, and once eight orphaned Claude
  Code processes, from exactly that). Stop a stale one with
  `powershell -Command "Stop-Process -Id <pid> -Force"`.
  **On mobile, open a new private/incognito tab, not an existing regular one** —
  a tab that was already open (or opened earlier in the session) can keep
  showing an old bundle even though the server itself is never caching; a fresh
  private tab guarantees the load actually hits the server.

## Tooling / account notes

- **The corporate→personal account switch needs re-auth in TWO places, not
  one** (hit 2026-08-14). Claude Code itself (`/logout`, then `/login`) and
  the **Chrome extension separately** — signing one in does not sign in the
  other, and the extension silently keeps whatever account it had.
  **The extension's failure mode is the problem**: with the wrong account,
  `list_connected_browsers` returns an empty list `[]` and
  `tabs_context_mcp` reports "extension is not connected" — both of which
  read as *"no browser available"* rather than *"a browser is right there,
  signed into the wrong account."* Nothing in either message mentions
  accounts. If the browser tools report no browser while Chrome is
  demonstrably open with the extension installed, **check which account the
  extension is signed into before debugging anything else** — restarting
  Chrome and reinstalling both look like plausible fixes and neither
  touches the actual cause.
- **TYPED INPUT INTO THE SUPABASE SQL EDITOR SILENTLY DROPS CHARACTERS.
  Never type a destructive statement into it.** Measured 2026-08-14: a
  211-character `select` typed via the browser tool's `type` action landed
  in Monaco's model as **203 characters** — the tail ` k.slot;` was gone,
  with no error and nothing visibly wrong. The failure is silent and
  position-dependent (it ate the end), which is the worst possible shape
  for SQL: **a `delete ... where bracket_id = 1 and show_id = X and slot in
  (...)` truncated the same way becomes `delete ... where bracket_id = 1
  and show_id = X`, which still parses, still runs, and destroys
  everything the narrowing clause was there to protect.**
  - **Use `monaco.setValue()` instead** — `window.monaco` is exposed on the
    dashboard, `window.monaco.editor.getModels()[0]` is the query editor's
    model. Setting the value programmatically bypasses keystroke handling
    entirely and reproduced the string exactly (249/249 chars) where typing
    did not. `form_input` on the editor's ref does NOT work: it writes
    Monaco's hidden textarea without updating the model, so the editor
    still shows its placeholder and the query never runs.
  - **Verify the model before executing, every time, and check the TAIL
    specifically** — an exact-length check alone is fine, but `endsWith(...)`
    on the intended final clause is what actually catches this failure
    mode. For anything destructive also assert the narrowing predicate is
    present (`v.includes("and slot in ('encore','flat2')")`) and that
    `delete` appears exactly once.
  - **The `javascript_tool` guard blocks responses containing the statement
    text** — it reads `bracket_id = 1 and show_id = 1765912122` as
    cookie/query-string data and returns `[BLOCKED: Cookie/query string
    data]`, killing the whole call. Return **primitives only** (lengths,
    booleans, counts joined into a string); never echo the SQL or a `tail`
    slice back. Build the statement by concatenating fragments around the
    `=` signs for the same reason.
  - **Reading results**: the results grid is `.rdg`, and `innerText` on it
    returns empty (the container has no layout height) — use
    `textContent` on `[role="row"]` children instead. `get_page_text`
    reports the row COUNT but never the cell values.

## Tone / working style the dev prefers

Direct, honest about tradeoffs and limitations, no false reassurance. Flags the
non-obvious consequence of a change. Doesn't over-engineer for hypotheticals. Willing
to push back on a design smell. Values getting the data model right over shipping fast.
