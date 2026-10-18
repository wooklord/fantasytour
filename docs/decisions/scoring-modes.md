# Alternate scoring modes (Module A / Module B) and the dead play-count columns

> Extracted verbatim from `CLAUDE.md` at commit 54a5ab8 (2026-10-18), original lines 1309–1326, 4240–4373. Nested entries were de-indented to top level; wording is unchanged.
> Decision record — currently binding. `CLAUDE.md` holds only a pointer stub under the same entry name; this file is the full text and rationale.

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

---

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
