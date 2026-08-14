# Module B — ranked-choice scoring mode

## Context

Fantasy Eggy's slot-based scoring only rewards positional accuracy (opener,
closer, etc.). Module B is a second, slot-independent scoring mode designed
in an earlier session and sketched in CLAUDE.md's "Alternate scoring modes"
section: N ranked picks against a fixed descending point ladder (e.g.
5/4/3/2/1) — a pick either gets played or it doesn't, no positional matching.
That sketch was never built. This session builds it.

A prior session assumed Module B needed no edge-function change and recorded
that in the working agreement. It was wrong — scoring only ever happens in
`supabase/functions/carton-sync/scoring.js` (imported by both the Deno edge
function and `test/scoring.test.mjs`; there is no client-side scoring copy),
so a new mode structurally requires editing that file. This was caught and
corrected before any code was written. This session's scope now explicitly
includes editing `scoring.js`, but **not** running `supabase functions
deploy` — that stays a separate, later, explicitly-approved step.

## Phase 0 — groundwork (execute immediately on approval, before any feature code, own commit(s))

**Status: 0.1–0.5 executed below (CLAUDE.md written, plan copied to
`docs/`, screenshot deleted, `.gitignore` updated). 0.6 (commits) pending —
see end of this document for current state and next step.**

### 0.1 — CLAUDE.md: Module B locked decisions (done — actual text committed differs slightly, see CLAUDE.md itself; also folds in the coverage-vs-count fix to decision 2 and an added "open, not decided: ladder mutability" bullet, both from the second approval round)

Append to the "Module B — ranked choice" bullet list in the "Alternate
scoring modes (designed, not scheduled)" section, after the existing
"Multiple hits sum their assigned ranks" line:

```
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
     hitting every row).
  3. Fixed row count regardless of show format. Standard slots reference set
     structure ("Set 2 Closer"), which is why one-set shows and festivals
     need separate handling there (`resolveConfigSection`'s `oneset`
     branch). Ranked choice has no positional concept at all, so that
     distinction doesn't apply — row count is set once by the bracket's
     ladder length and never varies by format.
  4. Fewer than N picks submitted: allowed, no penalty. Any subset of the N
     rank rows may be left blank; a blank row simply contributes no pick and
     scores nothing, the same way an unfilled slot or flat pick already
     behaves today. Rows are not free-assignment — each row is a fixed rank
     position (Rank 1 always pays the ladder's first value, Rank 2 the
     second, etc.), so there's no duplicate-value-prevention UI the way free
     assignment would have required.
```

### 0.2 — CLAUDE.md: Test 3 activation checkpoint

Add immediately after the existing "silent multi-row-insert failure" gotcha
in the Postgres/Supabase gotchas section (this is the live verification of
that exact fix):

```
- **Open checkpoint, not yet verified: Test 3 season activation
  (`roster_locked_at` fix).** The Test 3 season is scheduled to activate
  2026-08-14. Traced the exact code before writing this checkpoint
  (`activateSeasons()`, `supabase/functions/carton-sync/index.ts:338-364`):
  `added_at` (line 349, `joinedAt`) and `roster_locked_at` (line 362) are
  two SEPARATE `new Date().toISOString()` calls in JS, with an awaited
  network round-trip for the roster upsert in between — not the same
  Postgres transaction, so don't check exact equality; allow a tolerance
  (recommend ~60 seconds — generous enough to absorb normal upsert latency,
  tight enough that a different cron run or a manual edit hours/days apart
  still fails the check).
  A second wrinkle: the fix (see the gotcha above) deliberately preserves a
  manually pre-added row's original, older `added_at` rather than
  overwriting it (`ignoreDuplicates`) — so a legitimately pre-added member's
  row is SUPPOSED to differ from `roster_locked_at`, and that's correct
  behavior, not a bug. So the actual check: group Test 3's `season_rosters`
  rows by `added_at` — the largest cluster should share one timestamp within
  ~60s of `roster_locked_at` (that cluster, not just `roster_locked_at`
  being non-null, is the real proof the automatic batch wrote successfully).
  Any row sitting meaningfully outside that cluster is only expected if it
  corresponds to a real pre-add you made via `admin_set_season_roster`
  before activation — if you didn't pre-add anyone to Test 3, an outlier
  timestamp there is the bug, not a false alarm. Was supposed to be recorded
  and checked last session; wasn't — recorded now so it survives to whoever's
  driving after 2026-08-14.
```

### 0.3 — CLAUDE.md: Session durability protocol

New section, inserted after "THE MERCILESS EDITING DISCIPLINE" and before
"Feature set frozen at the start of 2.0":

```
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
```

### 0.4 — Move the plan into the repo

Write the full, current version of this plan document to
`docs/module_b_ranked_choice_plan.md` and track it in git. Descriptive name,
version-controlled, survives `~/.claude/plans` cleanup. Keep it updated as
work proceeds (per the durability protocol above) rather than treating it as
a one-shot snapshot.

### 0.5 — Housekeeping: untracked screenshot

`Screenshot 2026-08-02 200756.png` sits untracked at the repo root, making
"working tree clean" a weaker check than it should be. Delete the file from
disk (it's untracked, so this only removes it from the filesystem, nothing
git-tracked is affected), and add a narrow `.gitignore` entry —
`/Screenshot *.png` — so it doesn't recur. Not a blanket `*.png` pattern:
other tracked PNGs may exist as real assets, and a blanket pattern risks
silently swallowing a future real one.

### 0.6 — Commits

Two commits, matching the two numbered asks in your message:
1. CLAUDE.md changes (0.1 + 0.2 + 0.3).
2. `docs/module_b_ranked_choice_plan.md` + `.gitignore` (0.4 + 0.5).

## Confirmed readings (per your message, locking these in)

- **Ladder**: fixed descending point list, default `[5,4,3,2,1]`,
  admin-configurable per bracket.
- **"Configurable per bracket" + "fixed row count regardless of format"
  are compatible**: the ladder is set once on the bracket's config and never
  varies by show format. Nothing in the codebase today varies row count for
  this mode (it doesn't exist yet) — the design commits to keeping it that
  way by reading `cfg.ranked` directly rather than through
  `resolveConfigSection`'s `oneset` branch, which only slot mode uses.
- **"Sum ranks on multiple hits"**: several of a player's *distinct* ranked
  picks, each independently played, add their assigned ladder values
  together. A single pick's song recurring later in the same show does not
  score twice — matches the existing `played` set idiom elsewhere in
  `scoring.js`, which is a boolean "was this played," not a count.
- **Partial sheets**: any subset of rows may be left blank, no penalty,
  scored as simply absent (no breakdown row) — not top-ranks-only, not
  require-all-N. Perfect-sheet is measured against the *full* ladder length,
  never against however many picks were actually submitted, closing the
  "submit 1, hit it, collect the bonus" exploit. A test case locks this in.

## Deploy gating

Since `scoring.js` will be committed but not deployed, a ranked-choice
bracket must not be selectable anywhere real picks could accumulate against
a scoring path that doesn't exist yet. Recommended: a single frontend
constant, `RANKED_CHOICE_ENABLED = false`, added to `src/core/config.js`
(the existing home for instance-level toggles per that file's stated role).
`admin.js`'s new "Scoring mode" `<select>` only renders the "Ranked choice"
`<option>` when this is `true` — the option is entirely absent from the
dropdown otherwise, not merely disabled.

This is a UI-only gate, not a server-side block — `admin_update_config`
accepts arbitrary JSON with no schema validation, so a determined admin
could still hand-craft the RPC call to set `mode:"ranked_choice"` directly.
Not closing that: it would require an SQL/RPC change (reopening the same
scope question this session already had to correct once), and this app's
entire trust model is already "admin-adds-you" at a small, closed scale —
the existing Global console is gated the same UI-only way. Flip the
constant to `true` in the same commit that turns on deploy; its only job is
preventing "the option exists in the UI before the code behind it does."

Automated tests are unaffected by the gate: `test/fixtures.mjs` and
`test/scoring.test.mjs` set `config.mode` directly on fixture objects, never
through the admin dropdown, so ranked-choice test coverage doesn't require
flipping the flag. Manual browser smoke-testing via `npm run dev` does —
flip locally, test, revert before committing.

## Resolved — ladder mutability mid-season: stays unguarded, with a revisit trigger

**Decision (2026-08-12): no guard, no new scope.** Nothing stops an admin
from editing the ladder after picks are submitted, and nothing will. The
reasoning, and the trigger that reopens it, are below — the trigger is the
part that matters, because it's dated rather than vague.

Traced whether the same exposure already exists for `slots` today, and
whether anything guards it:

- **`admin_update_config`** (`sql/stage_c1_rpcs.sql:241-251`) has no guard
  beyond league-admin auth — no season-status check, no lock, no snapshot.
  It's a bare `update brackets set config = p_data where id = p_bracket_id`.
- **`scoreBracket`** (`supabase/functions/carton-sync/index.ts:679-718`)
  reads `cfg = bracket.config` fresh from the DB on every scoring pass —
  confirmed no caching, no snapshot. A config edit takes effect on the very
  next cron tick.
- **The only mitigation that exists today is a warning label**, not a
  guard: admin.js's Save-all-rules panel (`src/features/admin.js:276`) —
  "Rule changes apply on the next scoring run. Don't change mid-show unless
  you enjoy arguments." Contrast with `season_rosters`, which genuinely is
  frozen at activation (decision baked into the 2.0 rebuild) — `brackets.config`
  has no equivalent freeze mechanism anywhere in the schema.

**So: slots have the identical exposure today, unguarded, by design (or at
least by long-standing precedent) — shortening a bracket's slots mid-season
already silently changes what already-submitted picks score against, same
as shortening/lengthening a ladder would. Ranked choice isn't introducing a
new category of risk, just a new instance of an existing, already-accepted
one.** Building a guard for the ladder alone would be new scope AND would
leave `slots` — the identical hole — open right beside it, so nothing is
built here.

**The refinement that sets the revisit date: a config change is visible
going forward, but silent backward.** Forward is genuinely fine — the pick
sheet and "The Rules" card both re-render from `cfg`, so a player sees the
new ladder before picking against it. The retroactive half has no such
tell: because `scoreBracket` re-reads config fresh on every pass, editing a
ladder rewrites `breakdown` and `points` for shows that were *already
scored and already shown to players*. They see a different number than
before, with no notice and no record that a rule moved underneath it. (Not
the same as the frozen-`breakdown`-text gotcha in CLAUDE.md — that one
freezes the *wording* written at score time; the point values a later pass
recomputes are not frozen.)

That's acceptable only while exactly one person — the dev — can edit
bracket config. It stops being acceptable the moment a league admin who
isn't the dev exists. **Revisit before appointing any league admin who
isn't the dev — i.e. before Session 5's Facebook League admins.** Not an
"if it gets painful" trigger; a dated one.

**The narrower question — orphaned rows, resolved without needing the above
decided first:** out-of-ladder pick rows (e.g. a stale "rank5" after the
ladder shortens to 3) are not dropped from the breakdown — `scoreRankedPicks`
still scores them (their `ladder[idx]` lookup is `undefined`, so they
compute at 0 points via the existing `?? 0`, same as any pick past the end
of a shorter ladder), and the perfect-sheet fix above already excludes them
from the completeness/hit checks via `inLadder`. On the display side,
`breakdownSlotInfo`'s ranked branch only populates `order`/`label` for the
*current* ladder's positions, so an orphaned row falls through to the
existing "missing from order" fallback (`picks.js:81-89`, already documented
and already relied on for a legacy/removed slot type in slots mode) — it
still renders, labeled via `prettifySlotKey` ("rank5" → "Rank 5"), just
sorted after the current ladder's rows instead of in position. This mirrors
exactly how slots mode already handles a removed slot type today, so no new
code is needed for this part regardless of what you decide above.

## Pre-implementation checks (both verified 2026-08-12, both clear)

Two things had to be true before a bracket could run ranked choice while its
sibling stays on slots. Both were traced against the source rather than
assumed:

**1. Nothing aggregates scores across brackets — verified, so mixed
currencies can't collide.** Ranked ladder points and slot points are
different units, so any cross-bracket total would silently become
meaningless the moment the two brackets run different modes. There is no
such total. The argument is positive evidence about call sites, not the
absence of a keyword — aggregation needs no particular token (it can be
`count()`, `avg()`, a window function, or plain JS; `scoring.js` already
does `breakdown.reduce((sum, b) => sum + b.points, 0)`, so summing
demonstrably happens — the only question was ever whether any of it spans
brackets). What was actually checked:
- **Every `get_bracket_scores` call site passes exactly one
  `p_bracket_id: state.currentBracketId`** — `core/realtime.js:31`,
  `features/picks.js:284`, `features/shows.js:159`,
  `features/standings.js:80`. That is the complete set of callers; none
  loops over brackets or passes a second id.
- **`get_bracket_seasons` is likewise per-bracket** (`standings.js:82`).
- **Standings' second data source** — the season roster join dates feeding
  the "fewest zeros" tiebreaker — is season-scoped, and a season belongs to
  exactly one bracket.
- **The Global console renders nothing score-derived at all**, checked
  specifically because a cross-league surface is the one place two
  currencies could actually meet. `globalConsoleHtml()`
  (`features/admin.js:94-110`) renders exactly three controls: create
  league (text input), appoint league admin (league `<select>` + player
  search), and reset a player's PIN (player search). Its only data sources
  are `state.allLeagues` (an `id,name` read off `leagues`,
  `admin.js:114`) and `global_find_players` (a name lookup). It never
  calls `get_bracket_scores`, never reads `scores`/`seasons`/
  `season_rosters`, and displays no points, totals, standings, or bracket
  config. The cross-league *stats* screen that would have been the real
  risk was deliberately never built (see CLAUDE.md's Global-console
  decision) — but the console that does exist was confirmed clean rather
  than assumed clean on the strength of that.

**Conclusion: every score surface in the app is strictly per-bracket;
Casual-on-ranked + Official-on-slots cannot produce a mixed-currency number
anywhere.**

**2. `state.cfg` cannot diverge from the bracket `saveConfig()` writes to —
verified, so the read-through fallback is safe.** The fallback added above
is only correct if `state.cfg` is always the config of the bracket being
edited; otherwise a save could copy one bracket's values onto another.
It can't: `state.currentBracketId` is assigned in exactly two places
(`core/switcher.js:54`, the boot-time resolve; and `core/switcher.js:106`,
`switchToBracket`), `loadConfig()` reads `brackets.config where id =
state.currentBracketId` into `state.cfg` (`switcher.js:20-24`), and
`switchToBracket` calls `await loadConfig()` immediately after the
assignment (`switcher.js:111`). `renderAdmin()` additionally re-runs
`loadConfig()` before rendering the panel (`admin.js:173`), and
`saveConfig()` writes to `p_bracket_id: state.currentBracketId`
(`admin.js:582`). **There is no separate "bracket being edited" concept at
all — the admin panel edits whatever bracket the switcher currently has
selected, so viewed and edited are the same bracket by construction.**
- Residual caveat, pre-existing and not introduced by the fallback: if
  another admin (or another tab) changes the same bracket's config between
  `renderAdmin`'s `loadConfig()` and the save, `state.cfg` is stale and the
  save silently overwrites their change. That's already true of every field
  in `saveConfig()` today — it writes the whole config blob wholesale, so
  it's a last-write-wins surface regardless of this change. Worth knowing;
  not this session's problem to fix.

## Config schema

New top-level keys on `brackets.config` (a schemaless `jsonb` column,
confirmed no migration needed):

```js
{
  mode: "slots" | "ranked_choice",   // absent/undefined behaves as "slots" — existing brackets untouched
  ranked: { ladder: [5, 4, 3, 2, 1] }, // descending point values, admin-editable count
  // ...every existing key (slots, oneset, bonuses, wildcards, etc.) stays exactly as-is and present but unread when mode is ranked_choice
}
```

`bonuses.perfect` is the one existing field a ranked bracket still needs
(decision 2) — see the admin.js layout note below for where it moves.

## Implementation

### `supabase/functions/carton-sync/scoring.js`

Add a new, fully separate `scoreRankedPicks()` function rather than
threading `if (mode === ...)` checks through the existing slot-scoring
loop. This is what makes the cover/debut/wildcard suppression structural
(decision 1) instead of a runtime flag check — the function that computes
ranked scores has no code path that could apply them, not a branch that
happens to skip them:

```js
export function scoreRankedPicks({ picks, songs, cfg }) {
  const ladder = (cfg.ranked?.ladder ?? []).map(Number);
  const played = new Set(songs.map((s) => norm(s.songname)));
  const breakdown = picks.map((p) => {
    const idx = Number(String(p.slot).replace("rank", "")) - 1;
    const value = ladder[idx] ?? 0;
    const hit = played.has(norm(p.songname));
    return { slot: p.slot, songname: p.songname, hit, points: hit ? value : 0, reason: hit ? "played" : "not played" };
  });
  // Perfect-sheet must be gated on which distinct rank POSITIONS are
  // covered, not on how many picks were submitted — picks.length===expected
  // has the same shape as the exploit this replaced: 5 submitted rows that
  // don't actually cover rank1..rank5 (a duplicated slot, a stale row from
  // an earlier ladder length) could satisfy a count check while a real rank
  // sits unfilled.
  const expectedSlots = ladder.map((_, i) => "rank" + (i + 1));
  const filledSlots = new Set(breakdown.map((b) => b.slot));
  const complete = expectedSlots.length > 0 && expectedSlots.every((k) => filledSlots.has(k));
  // Hit check must be scoped to the ladder positions themselves, not every
  // breakdown row — an orphaned pick outside the current ladder (e.g. a
  // "rank7" row left over from a longer ladder the admin has since
  // shortened) would otherwise block a genuinely complete, all-hit sheet
  // just by existing and not having been played.
  const inLadder = breakdown.filter((b) => expectedSlots.includes(b.slot));
  const perf = Number((cfg.bonuses ?? {}).perfect ?? 0);
  if (perf > 0 && complete && inLadder.every((x) => x.hit)) {
    breakdown.push({ slot: "bonus", songname: "Perfect sheet", hit: true, points: perf, reason: "every pick hit" });
  }
  const total = breakdown.reduce((sum, b) => sum + b.points, 0);
  return { breakdown, total };
}
```

`scorePicks()` (line 105) gets one new line at the top:
`if (cfg.mode === "ranked_choice") return scoreRankedPicks({ picks, songs, cfg });`
— everything else in `scorePicks` (slot/flat logic, `resolveConfigSection`,
the Any Debut branch, cover/debut bonuses) is unreachable for a ranked
bracket, by construction. `deriveSlotFacts` still runs upstream in
`index.ts` unchanged (one call per show, shared across brackets) — a ranked
bracket just doesn't read most of what it computed. Not worth special-casing
away; it's cheap and touching that call site is unnecessary risk for no
real gain.

### `test/scoring.test.mjs`

New fixture config (`rankedCfg`, mirroring `standardCfg`/`oneSetCapableCfg`'s
existing shape) with `mode:"ranked_choice"`, `ranked:{ladder:[5,4,3,2,1]}`,
`bonuses:{perfect:5}`. Reuse the existing real-show setlist fixtures
(mode-agnostic). New test block covering:
- A hit and a miss scored at their correct ladder positions.
- Partial sheet (2 of 5 rows submitted) scores normally, no penalty, no
  perfect-sheet bonus even if both submitted picks hit.
- **The exploit case, explicitly**: 1 pick submitted, hits → perfect-sheet
  bonus must NOT fire (coverage check requires all of rank1..rank5 present,
  not just `picks.length` reaching 5).
- **The count-vs-coverage variant**: 5 picks submitted, all hit, but they
  don't cover rank1..rank5 (e.g. two picks both tagged `"rank1"`, `"rank2"`
  never submitted) → perfect-sheet bonus must NOT fire, even though
  `picks.length === ladder.length`. This is the specific gap a naive
  length-only check leaves open.
- Full sheet (5 of 5), all hit → perfect-sheet bonus fires exactly once.
- **The orphaned-row variant**: 5-row ladder, rank1..rank5 all filled and
  hit, plus one extra "rank7" row (outside the ladder) that was NOT played
  → perfect-sheet bonus MUST still fire. Proves the hit check is scoped to
  `inLadder`, not the full breakdown — the mirror-image of the coverage
  fix above.
- A `mode:"ranked_choice"` fixture with `bonuses.cover`/`bonuses.debut` and
  `wildcards.debut` all set truthy, and a pick submitted as `"Any Debut"` —
  confirms none of that ever appears in the breakdown (proves suppression
  is structural, not config-off).

### `readLadder()` save-time requirements (referenced by a comment in `scoring.js` — don't drop these)

`scoreRankedPicks` coerces any non-finite ladder rung to `0` defensively,
and its comment points here for the half a scorer structurally cannot do.
When `readLadder()` is built in `admin.js`, it must:

1. **Reject any row with no value** — do not drop it. (This requirement was
   originally written as "drop blank rows" and is corrected here; see the
   note below for why the original was both wrong and unimplementable.)
   `Number("")` is `0`, so a blank row saved as-is would become a real
   ladder position worth nothing that still counts toward perfect-sheet
   coverage — a player fills it, hits it, scores 0, and the sheet still
   reads complete. Dropping it instead is no better: the row silently
   vanishes on save and every rank below it shifts up one, with nothing
   telling the admin. So every rendered row must carry a value, and
   removing a rank is done with the row's ✕ button.
2. **Folded into #1, not a separate rule.** This was originally "reject
   non-numeric input with a message" — but that is **impossible to
   implement as written** on a `type="number"` input, which is what the
   ladder editor uses. Both real browsers and JSDOM coerce unparseable
   content to `""` at `.value` (verified: `.value = "abc"` and
   `setAttribute("value","abc")` both read back `""`), so `readLadder()`
   can never observe non-numeric text and a `!Number.isFinite` branch is
   unreachable from the UI. "Empty because cleared" and "empty because the
   admin typed `1.2.3`" are indistinguishable at `.value`.
   `validity.badInput` distinguishes them in a real browser but JSDOM
   reports it `false` unconditionally, so code built on it could not be
   tested here. Rejecting empty covers both causes with a message that is
   correct either way. The non-finite branch is kept in `readLadder()` only
   as a guard against a value arriving some other way (a devtools edit, a
   future input-type change) — not as a UI path.
3. **Coerce survivors with `Number()`** so the stored jsonb is numeric.
   `readLadder()` scrapes DOM input values, which are strings, so without
   this the stored config is `["5","4","3","2","1"]` and the scorer is left
   fixing types at read time on every scoring pass.

Why both layers rather than picking one: save-time validation is the right
*primary* defense but cannot be the only one — `brackets.config` is
schemaless `jsonb` and `admin_update_config` writes whatever JSON it is
handed, so nothing between an admin's keystroke and the scorer enforces
anything. Equally, the scorer alone cannot be sufficient: it cannot tell a
blank from an admin deliberately typing `0`, so only save-time validation
can catch that case at all. Covered by test block **7o** in
`test/scoring.test.mjs`, which asserts `Number.isFinite(total)` for all five
malformed shapes and pins the 0-rung-counts-toward-coverage residual.

### `src/core/config.js`

Add `export const RANKED_CHOICE_ENABLED = false;` alongside the existing
instance constants.

### `src/features/admin.js`

- New `<div class="field">` for "Scoring mode" (`<select id="c-mode">`),
  same shape as the existing "Voting override" field (line ~216), placed in
  the "Master switch" section. Options: `slots` (default) always present;
  `ranked_choice` only rendered when `RANKED_CHOICE_ENABLED`.
- **Move the "Bonus: perfect sheet" field** out of the "Game rules —
  standard shows" grid (currently line ~257, inside the section that gets
  hidden for ranked mode below) into a mode-independent location — next to
  the new Scoring mode field is the natural spot. Required because decision
  2 keeps perfect-sheet live for ranked brackets, but decision 1 requires
  the standard section (which holds cover/debut bonuses too) to disappear
  entirely for ranked mode. Leaving it inside would either resurrect
  cover/debut alongside it or make perfect-sheet inaccessible to configure
  on a ranked bracket — both wrong.
- "Game rules — standard shows" and "Game rules — one-set shows"
  collapsibles: only rendered when `cfg.mode !== "ranked_choice"` (lines
  245–272). This is what makes cover/debut bonuses, the Any Debut wildcard
  toggle, partial credit, and allow-duplicates disappear from the UI for a
  ranked bracket — subtractive, no new abstraction, matching the working
  agreement's stated preference.
- New "Game rules — ranked choice" collapsible, rendered only when
  `cfg.mode === "ranked_choice"`, in the same position the other two Game
  rules sections occupy. Ladder editor mirrors the "House rules" repeatable-
  row pattern exactly (`customRuleRow`/`addCustomRule`/`readCustomRules`,
  lines 32–52): a `rankRow(pts)` row-builder, `addRankRow()`/`removeRankRow`
  buttons, `readLadder()` scraper. No arbitrary cap on ladder length — none
  of the locked decisions specify one, and inventing one isn't this
  session's call.
- `saveConfig()` (line 559): add `mode: $("#c-mode").value` and
  `ranked: { ladder: readLadder() }` to the assembled `data` object.
  **Required guard — read through to the existing config, not to a
  literal default.** Every field that only exists inside the now-
  conditionally-rendered standard/one-set sections, and the ladder editor
  symmetrically, must fall back to whatever `state.cfg` already has when
  its DOM element is absent — not to `0`/`false`/`[]`. A bare `?? 0`-style
  literal fallback is a real data-loss path, not a harmless default: flip a
  bracket to ranked, save (standard section absent → every guarded field
  writes its literal fallback), flip back to slots, and every cover/debut/
  duplicates/partial-credit value — and the slots list itself — the admin
  had configured is gone, overwritten with zeros/empties on the ranked-mode
  save. `scoreRankedPicks` never reads any of these fields, but a later
  round-trip back to slots mode does, so they have to survive the trip
  unmodified. Applies to both directions — slots→ranked must preserve the
  ladder, ranked→slots must preserve the slots/bonus/flag fields:
  ```js
  const slotsEl = document.getElementById('slots');
  const slots = slotsEl ? readSlots('slots') : (state.cfg.slots ?? []);
  const slots1El = document.getElementById('slots1');
  const slots1 = slots1El ? readSlots('slots1') : (state.cfg.oneset?.slots ?? []);
  const rankEl = document.getElementById('rankladder');
  const ladder = rankEl ? readLadder() : (state.cfg.ranked?.ladder ?? []);
  // ...
  flat_picks: Number($("#c-flat")?.value ?? state.cfg.flat_picks ?? 0),
  flat_points: Number($("#c-flatpts")?.value ?? state.cfg.flat_points ?? 1),
  partial_credit: $("#c-partial") ? $("#c-partial").value === "true" : !!state.cfg.partial_credit,
  partial_points: Number($("#c-partpts")?.value ?? state.cfg.partial_points ?? 1),
  allow_duplicates: $("#c-dupes") ? $("#c-dupes").value === "true" : !!state.cfg.allow_duplicates,
  bonuses: {
    cover: Number($("#c-bcover")?.value ?? state.cfg.bonuses?.cover ?? 0),
    debut: Number($("#c-bdebut")?.value ?? state.cfg.bonuses?.debut ?? 0),
    perfect: Number($("#c-bperfect").value), // always rendered, no guard needed
    jamchart: 0, // no admin field exists for this and scoring.js never reads it — confirmed by grep, dead since introduction
  },
  wildcards: { debut: $("#c-wcdebut") ? $("#c-wcdebut").value === "true" : (state.cfg.wildcards?.debut ?? true) },
  oneset: {
    slots: slots1,
    flat_picks: Number($("#c1-flat")?.value ?? state.cfg.oneset?.flat_picks ?? 0),
    flat_points: Number($("#c1-flatpts")?.value ?? state.cfg.oneset?.flat_points ?? 1),
  },
  ```
  None of the app's fields are actual `<input type="checkbox">` elements —
  `c-partial`/`c-dupes`/`c-wcdebut` are `<select>`s with `"true"/"false"`
  string values (confirmed against the current `saveConfig()` body) — so the
  guard there checks element presence and reads `.value`, not `.checked`.

### `src/features/picks.js`

- `slotDefs(format)` (line 116): branch at the top —
  `if (state.cfg.mode === "ranked_choice") return (state.cfg.ranked?.ladder ?? []).map((pts, i) => ({ key:"rank"+(i+1), label:"Rank "+(i+1), tooltip:null, pts, type:"ranked" }));`
  before the existing slot/flat logic. Every ranked row has `flat` unset
  (falsy), so `renderPickSheet`'s existing `structured`/`flats` split (line
  141) puts them all in `structured` with no code change there — they
  render as the main input list, no "Anywhere in the show" divider (correct,
  since `flats.length` is naturally 0).
- **`ruleDefs` in `renderPickSheet`** (line 151): the existing dedup-by-
  label logic doesn't collapse ranked rows (each has a distinct "Rank N"
  label), so left alone it would render N near-empty rule rows instead of
  one explanation. Add a ranked branch mirroring the existing flat-picks
  special case:
  `if (state.cfg.mode === "ranked_choice") return [{ term: \`Rank 1–${ladder.length}\`, desc: \`Worth ${ladder.join("/")} pts if played, in that order.\` }];`
- **`breakdownSlotInfo(format)`** (line 90): without a branch here, ranked
  breakdown rows fall through to the "missing from order" fallback (line
  84's documented case) — labels correctly via `prettifySlotKey` ("rank1" →
  "Rank 1", confirming your plan note), but *ordering* isn't guaranteed:
  `sortBySlotOrder`'s comparator treats every unrecognized key as equally
  "last" (both `indexOf` calls return -1), so relative order among Rank 1..N
  falls back to whatever order `breakdown` was built in — which depends on
  DB row order from `get_show_picks`/`get_my_picks`, not necessarily
  submission order. Worth a small branch here too, so the frozen breakdown
  always displays Rank 1 through N in order rather than a fallback that
  happens to look right most of the time:
  `if (state.cfg.mode === "ranked_choice") { const ladder = state.cfg.ranked?.ladder ?? []; const order = ladder.map((_,i)=>"rank"+(i+1)); const label = {}; order.forEach((k,i)=>label[k]="Rank "+(i+1)); return { order, label }; }`
- **Autocomplete / "Any Debut" catalog entry**: not yet located precisely —
  need to find wherever the pick-sheet autocomplete's song catalog gets
  "Any Debut" appended (gated on `cfg.wildcards.debut` today) and confirm it
  isn't offered as a suggestion on a ranked-mode input. Since
  `scoreRankedPicks` would score a literal "Any Debut" songname as 0 (it
  can never match a real played song), this is a UX cleanliness item, not a
  scoring-correctness one — but worth tracing during implementation rather
  than assuming, per the "trace critical paths end-to-end" discipline.

## Verification

- `node test/scoring.test.mjs` — new ranked-choice blocks pass, including
  the exploit-prevention case.
- `npm test` (`test/scenario.test.mjs`) — add a ranked-choice bracket to
  `test/fixtures.mjs` (own `config.mode:"ranked_choice"`) and a new
  `runRankedChoiceScenario` sibling to `runNonAdminScenario`/
  `runGlobalAdminScenario` in `test/harness.mjs`, exercising: pick-sheet
  render (N generic rank inputs, no named slots), the auto-generated Rules
  card row, save/dirty-tracking, and a scored show's breakdown display.
  Required, not optional — CLAUDE.md's own history (the global-admin
  fixture gap) is the documented precedent for what happens when a new
  config shape ships without a fixture exercising it.
- `node build.mjs`, commit the rebuilt `app.js`/`app.js.map` alongside the
  `src/` changes — the bundle is what GitHub Pages actually serves.
- Manual smoke test via `npm run dev`: flip `RANKED_CHOICE_ENABLED` to
  `true` locally only, create a ranked bracket, fill a partial sheet, save,
  reload, confirm the ladder editor and Rules card render correctly and
  cover/debut/wildcard fields are genuinely gone from the DOM (not just
  hidden by CSS). Revert the flag before committing.
- **Config round-trip check, specifically**: on a bracket with real slots +
  non-zero cover/debut bonuses + duplicates allowed, switch mode to Ranked
  choice and Save, then switch back to Slots and Save again (without
  touching anything else in between) — confirm every original slots-mode
  value is byte-for-byte unchanged. This is the concrete regression the
  saveConfig() read-through-to-existing-config guard exists to prevent.

## Explicitly out of scope this session (unchanged from your original instructions)

- Session 5 / Facebook League launch.
- Login rate-limiting, desktop sidebar redesign.
- The shows-since-last-played (Module A) scoring model.
- `supabase functions deploy` — code is written and tested, not deployed.
- Rejected, do not propose: pick-slot info buttons, a larger/multi-row
  trophy podium.
- Rebranding-rationale constraint stays in force for every comment/doc
  string touched above: mechanical justification only, no "other bands"
  framing anywhere.

## STATUS as of 2026-08-13 (durability checkpoint — read this first)

**The edge-function half is DONE and committed. The entire frontend half is
NOT STARTED. Nothing is deployed.**

Done:
- `scoreRankedPicks()` in `supabase/functions/carton-sync/scoring.js`.
- The mode dispatch as the **first line** of `scorePicks()`, before any
  slot logic runs.
- Non-finite ladder-rung coercion (`Number.isFinite` guard → 0).
- Test blocks **7a–7p** in `test/scoring.test.mjs`, mutation-verified (see
  below). `node test/scoring.test.mjs` passes.

Not started:
- `src/core/config.js` — `RANKED_CHOICE_ENABLED` **does not exist yet**.
- `src/features/admin.js` — scoring-mode `<select>`; moving the
  perfect-sheet field out of the standard section; making the two Game
  rules sections conditional; the ranked collapsible + ladder editor
  (`rankRow`/`addRankRow`/`readLadder`); the `saveConfig()`
  read-through-to-`state.cfg` guards.
- `src/features/picks.js` — `slotDefs()`, `ruleDefs`, `breakdownSlotInfo()`
  ranked branches.
- `test/fixtures.mjs` + `test/harness.mjs` — ranked bracket fixture and
  `runRankedChoiceScenario`.
- `node build.mjs` + committing the bundle; the manual smoke test; the
  config round-trip check.
- **Deploy** — `supabase functions deploy carton-sync` has NOT been run, so
  ranked scoring does not execute against real shows. Deploy is a separate,
  explicitly-approved step.

**NEXT STEP, concretely, in this order**: `src/core/config.js` →
`src/features/admin.js` → `src/features/picks.js`.

## Mutation-testing results (which fix is protected by which test)

Recorded because a green suite is itself a proxy — it proves the tests pass,
not that they'd catch the bug. Each of the three review-driven fixes was
reverted in turn and the suite re-run. Block numbers are the **final**
numbering (7a–7p); mutations were run before the 7j-gap renumber, so old
7n→7m and old 7o(a)/(b)→7n(a)/(b).

| Fix | Mutation applied | Blocks that failed | Guardians |
|---|---|---|---|
| Canonical index (`rankIndex`) vs string surgery | `ladder[Number(slot.replace("rank",""))-1]` | **7h (3 checks), 7n(a) (2 checks)** | 7h, 7n(a) — both demonstrated |
| Coverage vs count | `complete = picks.length === ladder.length` | 7d, 7f, 7h, 7i, 7m (9 checks) | 7d, 7f, 7h, 7i, 7m — demonstrated |
| In-ladder hit scoping | `breakdown.every(hit)` | **7f (2 checks), 7n(b) (2 checks)** | 7f, 7n(b) — both demonstrated |

Every guardian above is demonstrated by an observed failure rather than
inferred from reasoning — but the runs are from two different dates, and
the distinction matters:
- **Mutations 1 (canonical index) and 3 (in-ladder scoping) were re-run
  2026-08-13**, specifically because 7n(a) and 7n(b) were written *after*
  the original runs and were therefore claimed rather than demonstrated.
  Both now fail as predicted; the failure lists below are from that re-run.
- **The coverage mutation's failure list is from the original 2026-08-12
  run and was not re-executed.** That's sufficient here and not a gap: all
  five of its guardians (7d, 7f, 7h, 7i, 7m) predate the 7n additions and
  were observed failing in that run, so nothing about it is inferred. It
  would need re-running only if a *new* test were later claimed to guard it.

Exact failing checks from the 2026-08-13 re-run:
- **Canonical index**: `7h: "rank02" is hit but scores 0` (`[true,0]` →
  `[true,4]`), `7h: " rank2" is hit but scores 0` (same), `7h: total …no
  leaked points` (20 → 28), `7n(a): hitting zero-padded key scores 0, not
  rank1's value` (0 → 5), `7n(a): and does not inflate the total` (20 → 25).
- **In-ladder hit scoping**: `7f: orphan does not block perfect` (1 → 0),
  `7f: total unchanged by orphan` (20 → 15), `7n(b): missed non-canonical
  row does not block perfect` (1 → 0), `7n(b): total 15 + 5 bonus`
  (20 → 15).

Notes worth keeping:
- The coverage mutation failed in **both directions** — 7d caught it firing
  when it shouldn't (the exploit direction), while 7f/7h/7i/7m caught it
  *ceasing* to fire when it should. Two-directional coverage was not
  designed in; it fell out of the orphan/duplicate cases.
- The in-ladder mutation can only fail one direction by construction:
  widening the hit check makes perfect strictly harder to earn, never
  easier.
- **The canonical-index fix was guarded by a single block (7h) until
  7n(a)'s hitting zero-padded row was added.** 7n(b)'s `"rank02"` does not
  back it up — that row misses, and `points = hit ? value : 0` zeroes a
  miss under either implementation. **Only a *hitting* non-canonical row
  discriminates.**
- **Tests that stay green under the coverage mutation by luck, not design —
  do not read their green as coverage of the coverage check**: any
  full-sheet block where `picks.length` coincidentally equals the ladder
  length (the count and the coverage agree by accident), and the
  short-sheet blocks where the count is false for the wrong reason. Blocks
  in that category at the time of the run were the full-all-hit case and
  the 1- and 2-pick cases. (Derived from the observed failure lists rather
  than separately re-verified after the renumber — if this matters, re-run
  the mutation rather than trusting this line.)

## Mutation-testing results — admin frontend (2026-08-13)

Same discipline as the scoring-engine table above: each guard was reverted in
turn and `npm test` re-run, so every entry is an observed failure rather than
reasoning. All four reverted cleanly afterwards.

| # | Mutation applied | Failing check | Caught by |
|---|---|---|---|
| S1 | scalar guard → literal: `Number($("#c-bcover")?.value ?? 0)` | `preserves every scalar slots-mode field` (`cover: 1→0`) | run 1 |
| S2 | array guard → unconditional: `readSlots("slots")` | `preserves slots array contents` (3 slots → `[]`) | run 1 |
| S3 | boolean guard dropped: `$("#c-wcdebut")?.value === "true"` | `preserves wildcards.debut when it is ON` (`true→false`) | **run 2 only** |
| S4 | boolean literal fallback: `… : true` | `preserves every scalar slots-mode field` (`wildcardDebut false→true`) | **run 1 only** |

**The S3/S4 split is the point, and it's expensive to reconstruct**, so it's
recorded rather than left in a transcript. They fail in *opposite* directions
and each is invisible to the other's run — which is the evidence that running
`runRankedChoiceScenario` twice with `wildcardDebut` flipped actually does
what its comment claims, rather than merely looking thorough. `wildcards.debut`
is the only config boolean needing this: it's the only one whose natural
default is ON, so `false` distinguishes the literal-fallback regression while
`true` distinguishes the guard-dropped one, and no third boolean exists.
`partial_credit` and `allow_duplicates` are covered by a single run because
their literal fallbacks are falsy — **do not "tidy" those fixture values to
`false`, it silently removes their coverage.**

S2 has the worst blast radius of the four: it wipes an entire bracket's slot
configuration on one save, versus one wrong number for the others.

## Open questions — recorded as open, not dropped

1. **Where the pick-sheet autocomplete appends "Any Debut" was never
   located.** Needs tracing during the `picks.js` work, to confirm it isn't
   offered as a suggestion on a ranked-mode input. **UX cleanliness, not
   scoring correctness** — `scoreRankedPicks` scores the literal string as
   a normal unmatched song name, i.e. 0 (pinned by 7g).
2. **Duplicate ladder keys are pinned, not decided.** Test 7i records
   current behavior: coverage passes on `Set` semantics so perfect-sheet
   still fires, and the duplicated position pays its value twice. There is
   no duplicate prevention in the UI or at the DB level today, same as slot
   mode. Pinned so a later edit can't move it silently — but whether that
   behavior is *desired* was never decided.
3. ~~**Whether any of the 13 current players have already installed the app
   to a home screen.**~~ **ANSWERED 2026-08-13: several have.** The domain
   move is therefore no longer free — affected players get logged out, lose
   in-progress pick drafts, and must re-add the app and log in again. Full
   consequences and the two new scheduling constraints are recorded in the
   domain-move bullet in CLAUDE.md; the trigger is unchanged and the
   argument for acting before recruitment is now stronger, not weaker.
4. ~~**7n(a) and 7n(b) are CLAIMED guardians, not demonstrated ones.**~~
   **RESOLVED 2026-08-13.** Both were written after mutations 1 and 3 had
   already run, so they appeared in the guardian column without appearing
   in any failure list — guardianship asserted from reasoning, which is the
   very thing mutation testing exists to replace (discipline item 5). Both
   mutations were re-run and **both tests failed as predicted**: 7n(a)'s
   hitting zero-padded row scored 5 instead of 0 under string surgery, and
   7n(b)'s missed non-canonical row suppressed the bonus under a
   breakdown-wide hit check. The guardian table above now carries the
   observed failures for both. No follow-up needed.
