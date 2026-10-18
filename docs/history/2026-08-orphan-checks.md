# 2026-08: toggleFormat confirm and the dead saveConfig orphan check

> Extracted verbatim from `CLAUDE.md` at commit 54a5ab8 (2026-10-18), original lines 3578–3695. Nested entries were de-indented to top level; wording is unchanged.
> Historical record — resolved, closed or superseded. Kept for its method and evidence. Not a current instruction.

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

**✅ FIXED 2026-08-21 — and the fake that hid it is fixed too. THE FAKE
BEING MORE PERMISSIVE THAN THE REAL RPC IS WHAT KEPT THIS GREEN FOR MONTHS.**
The orphan check now counts via `admin_pick_status` (admin-gated, NOT
cutoff-gated), summing `picks_count` rather than counting rows — the left
join returns one row per league MEMBER, so a row count reports league size.
- **Confirmed by mutating the FAKE, not the code.** Adding the real cutoff
  gate to `get_show_picks`'s fake turned **5 assertions × 2 modes = 10
  failures** red. So the mode-change warning's entire coverage was passing
  only because the fake returned pre-cutoff rows the real RPC refuses. The
  one component that could have revealed the bug was the component modelling
  it wrongly.
- **The cutoff gate is now PERMANENT in the fake.** Removing it re-opens
  exactly this hole. Notably it broke nothing else: the pick board and the
  frozen breakdown both read post-cutoff shows, so they were never relying
  on the permissiveness.
- **Named priors of the same shape (fake more permissive / less faithful
  than the real RPC), rather than an ordinal:** `get_show_picks` returning
  `[]` unconditionally until 2026-08-13, which made the pre-scoring pick
  board unreachable in every scenario; `admin_pick_status` returning a fixed
  `{picks_count: 1}` row until 2026-08-18, which made every bracket look
  equally affected in `toggleFormat`'s confirm;
  `admin_list_unaffiliated_players` stubbed rather than joined, which would
  have passed either predicate. All three are now real joins.
- **The assertion needed fixing too, and for a different reason.** It read
  `/\d+ pick(s)? across \d+ open show(s)?/` — any digits. Under a row-count
  regression it renders "3 picks" and still matches. Now pinned to the real
  number (`1 pick across 1 open show` against a 3-member league), so sum and
  row count are distinguishable. Verified by mutation: `reduce(...)` →
  `.length` produces "3 picks" and fails.
- **A rename hazard caught mid-fix, worth its own note: CAPTURE AND RESTORE
  ARE SEPARATE LINES, and repointing a handler swap has to touch both.**
  The failed-lookup block captures a fake, replaces it with a thrower, and
  restores it afterwards. Repointing the capture from `get_show_picks` to
  `admin_pick_status` while leaving the restore as
  `RPC_HANDLERS.get_show_picks = origShowPicks` would have written
  `admin_pick_status`'s implementation INTO `get_show_picks` and left
  `admin_pick_status` throwing for the remainder of the run — silently, with
  downstream failures in scenarios that have nothing to do with what the
  block tests. `grep` for the old variable name after any such rename; one
  stale reference is enough.

**⚠️ THE ORIGINAL FINDING, kept because the mechanism recurs:
`saveConfig`'s mode-change orphan check could never fire.** It counts at-risk picks via `get_show_picks`,
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
