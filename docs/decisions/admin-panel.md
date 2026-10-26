# Admin panel invariants: config writers, section order, Members signalling

> Extracted verbatim from `CLAUDE.md` at commit 54a5ab8 (2026-10-18), original lines 3696–3795, 3877–3899. Nested entries were de-indented to top level; wording is unchanged.
> Decision record — currently binding. `CLAUDE.md` holds only a pointer stub under the same entry name; this file is the full text and rationale.

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
    Community (league links, Stage S)│   ← added 2026-10-24, onboarding Batch 1
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

---

**Who's Picked — LOCKED 2026-10-25 (design settled in Chat, written the
same day, before any code; sibling record for the same batch:
`standings-ux.md`).**
- **Rows become two lines.** Line one: the nickname, with a **status pill**
  reading `No picks` / `Partial` / `Done`. Line two: the existing
  "n picks saved · when" text, **verbatim** — the wording does not change,
  it moves down a line so the name and the pill have the width. One
  grammar fix on the way (dev's call, 2026-10-25): exactly one pick reads
  "1 pick · saved …", not "1 picks"; the rest of the string is unchanged.
- **Partial is derived the same way `pickButtonInfo` does it:** saved
  count vs the required slot count for the show's format. One derivation,
  not two — if the panel and the pick button ever disagree about "done",
  one of them is wrong, and this rule says which (the button).
- **A "Show" chip with two positions: `Needs picks` (default) and `All`.**
  `Needs picks` lists players with zero or partial saved picks. **Not
  persisted** — this is a chase list, and it opens on `Needs picks` every
  load. (Contrast the standings View chip, which IS persisted; the
  difference is intent: a board view is a reading preference, a chase list
  is a task.) When nobody needs picks the panel must say so, not render
  empty — an empty-set case belongs in the harness scenario.
- Unchanged: the section stays FIRST, above the first divider, with its
  own `Who's picked: <Bracket>` scope heading (see above).
- **Refinement 2026-10-26 (dev's call after the live look): nicknames
  render at full text color on EVERY row, picked or not.** The
  `.pickres.miss` row-level opacity dimmed the whole row including the
  name, which hurt legibility now that the Show chip already explains
  why a row is listed. Dim stays on the status parts only — the leading
  mark, the status pill, and the line-two text — never on the name.
  **Build, same day:** the row rule `.pickres.miss{opacity:.55}` is gone
  AS A ROW RULE for Who's Picked rows; its three other users — the
  season-roster override list (not-on-roster members), the ban list, and
  the Scores page's missed picks (`picks.js`) — all rely on the row dim,
  so it survives for them as `.pickres.miss:not(.roster-row)`, behaviour
  unchanged. `.roster-row.miss` dims its first span (the mark), `.pill`
  and `.roster-l2` individually, and `.roster-row.miss .nm` is pinned to
  `opacity:1; color:var(--cream)`. No markup change: the mark was
  already the row's first span and the name already `.nm`. Harness: a
  static stylesheet check (no bare `.pickres.miss` opacity rule, the
  scoped survivor present, the three status parts dimmed, the name rule
  full and no roster-row rule dimming `.nm`), plus DOM facts on the
  Who's Picked scenario (no-picks rows still carry `.miss`; the name is
  not inside a dimmed element and is not the first span). One mutation:
  dim re-applied to the name.
  **BUILT 2026-10-26, bundle `cb905bf-b660a59`.** CSS only plus the
  harness; no markup change was needed. Mutation result: `opacity:.55`
  on the `.roster-row.miss .nm` rule failed the static stylesheet check
  in both modes; revert verified byte-identical, bundle matched the
  index after the rebuild.
- **Refinement 2026-10-26, PILL (dev's call): the no-picks status pill
  reads "Waiting on"** (was "No picks" — redundant with line two's "no
  picks yet") **and is styled coral**, border and text, the same
  construction as the other pills, completing a three-rung ladder: Done
  mint, Partial yolk, Waiting coral. **Rejected:** yolk (Partial owns it)
  and plain white (no signal). **The pill is EXEMPT from the status-parts
  dim** added earlier today: the mark and line two stay at 55%, the pill
  renders full strength. Line two's "no picks yet" is unchanged, and so
  is the row's `data-status="none"` (the status key; only the pill's
  class and text changed — `.pill.none` → `.pill.waiting`). Scope: CSS,
  the one pill template in `admin.js`, the harness. One mutation: the
  waiting pill left inside the dim list.
  **BUILT 2026-10-26, bundle `df9753e-0507543`.** The dim rule now lists
  exactly the first span and `.roster-l2`; `.pill.none{opacity:.8}` is
  gone and `.pill.waiting` is coral border+text. Harness: the Who's
  Picked check asserts "Waiting on" with class `.pill.waiting` and no
  `.none`, line two unchanged; the static check asserts the narrowed dim
  list, no roster-row rule dimming `.pill`, the coral rule present and
  `.pill.none` absent. Mutation result: the pill re-added to the dim
  list failed the static check in both modes; revert byte-identical,
  bundle matched the index after the rebuild.

---

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

**Members panel cleanup — LOCKED 2026-10-26 (dev's call, after Stage F
and the live look).** Three parts:
1. **The grey "Official" label on member rows is REMOVED.** Since Stage F
   (default TRUE, applied 2026-10-26) it appears on nearly every row and
   carries no information; it was also the main cause of the action
   buttons wrapping. The exception is now what is shown: a small muted
   pill **"casual only"** on rows where `official_opt_in` is false.
   **Reason, recorded:** the label was right when opt-in was the
   exception and wrong once it became the default — a marker only
   informs when it is rare.
2. **Row layout — ROWS A:** member rows become two lines. Line one: the
   admin star or dot, the name at full width (**no truncation in admin
   lists** — existing 27-character names must fit), the "admin" marker
   and the "casual only" pill. Line two: Reset PIN and Boot,
   right-aligned. Vertical padding tightened so the list does not double
   in height for nothing. **Rejected alternative (ROWS B):** one line
   with the name flexing to full width and a single "⋯" actions button
   toggling a row beneath with Reset PIN and Boot, one open at a time.
   Build-time call, stated: the viewer's own row has no buttons, so it
   keeps the "you" marker on line one and renders no line two — a second
   line holding only "you" is exactly the "for nothing" height this
   decision forbids.
3. **Other `.pickres` admin lists** (member search results, the
   unaffiliated panel, the global console, the season-roster override,
   the ban list) have a single action and stay single-line; they pick up
   the Official-label change only if they show it. Survey 2026-10-26:
   none of them renders the label — only the members list did.
Scope: the members-list render (`loadMembers`, `admin.js`), its CSS, and
the harness readers/assertions for the members panel. Asserted: no
"Official" text on any member row; "casual only" only for a false flag
(the fixture's second member has carried `official_opt_in: false` since
Stage A, so no new fixture row was needed); the admin row keeps its
star; names are not truncated (the Members list uses its own name class,
not `.nm` — `standings-ux.md` decision 4's "ellipsis on … admin Members"
is superseded for this list by this entry, and says so). One mutation:
pill shown for true instead of false. The Reset PIN / Boot signalling
note above is unchanged by this.
**BUILT 2026-10-26, bundle `2b1f242-faecd95`.** `loadMembers` renders
`.pickres.member-row` with `.member-l1` (mark, `.mname`, markers, pill)
and `.member-l2` (the two buttons), none for the viewer's own row; CSS
under the `.pickres` block; `runMembersPanelScenario` in the harness
reads the list structurally, and the long-name scenario's Members
selector moved from `.nm` to `.mname`. Mutation result: with the pill
keyed on `true`, it rendered on the two opted-in rows and not on the
opted-out one, and the pill check failed in both modes. Also fixed
while building: the new static-CSS check first referenced `runMode`'s
`css` const before its declaration (a TDZ crash, not a failure) and now
reads the stylesheet itself.
