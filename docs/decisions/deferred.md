# Deferred items with their weight and revisit triggers

> Extracted verbatim from `CLAUDE.md` at commit 54a5ab8 (2026-10-18), original lines 3304–3325, 2477–2493, 2874–2880. Nested entries were de-indented to top level; wording is unchanged.
> Decision record — currently binding. `CLAUDE.md` holds only a pointer stub under the same entry name; this file is the full text and rationale.

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

---

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

- **Admin tooltips on the config screens — still open, scope narrower than
  written.** Slot definitions on the admin side needed no work, per the bullet
  above. What's still missing is explanatory copy for the *rule mechanics* a game
  runner controls but didn't design: partial credit, perfect-sheet bonus,
  wildcards, the duplicates warning above, the best-result-across-replays rule,
  master override, format toggle, and (in 2.0) the Official opt-out mechanic.
  Important because 2.0 delegates leagues to admins who didn't build the game.

---

**Two scoring-pipeline bugs found 2026-10-18, recorded in
`docs/decisions/scoring-rules.md` under "Known bugs — found 2026-10-18":**
the sync diff ignores `footnote`/`is_cover` (stale `setlist_songs`, UI shows
a debut the scorer no longer credits), and the score-write change check
never matches (every pass rewrites every row, `updated_at` is meaningless).
Fix shapes are there; neither is scheduled.
