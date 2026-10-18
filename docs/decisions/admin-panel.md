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
