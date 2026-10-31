# Scoring rules: Stage B design, format/orphan behaviour, fix candidates

> Extracted verbatim from `CLAUDE.md` at commit 54a5ab8 (2026-10-18), original lines 2626–2702, 4013–4102, 4118–4209. Nested entries were de-indented to top level; wording is unchanged.
> Decision record — currently binding. `CLAUDE.md` holds only a pointer stub under the same entry name; this file is the full text and rationale.

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

---

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

---

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

---

## Debut detection — how it actually works (2026-10-18)

Recorded from a read-only trace during the Wild Mountain Honey incident
(`docs/history/2026-10-15-wild-mountain-honey-footnote.md`).

- **There is no stored debut flag.** Every consumer runs `/debut/i` over the
  Carton footnote text at the moment it needs it: `scoring.js:47` (the
  `debut_call` slot), `:56` (`debut_call` impossible), `:83` (`anyDebut`,
  which drives the Any Debut wildcard), `:272` (the `+debut` bonus on a hit
  pick); and outside the scorer, `index.ts:633` (the Discord song post),
  `src/features/picks.js:447` (the setlist view's DEBUT tag) and
  `src/core/realtime.js:74` (the live toast).
- **"FTP" has never matched anything.** The regex is the only pattern; a
  footnote of `FTP, Steve Miller Band cover` contains no "debut", so a
  cover's first performance is not a debut today — by accident of the regex,
  not by decision.
- **`is_cover` comes from `isoriginal`** (`index.ts:578`: `!Number(r.isoriginal)`),
  independent of the footnote. The same Carton edit that removed "Debut"
  also flipped `isoriginal` to 0.
- **Scoring reads the live Carton fetch, never `setlist_songs`.** Every pass
  refetches `/setlists/showdate/<date>.json` (`index.ts:566`), rebuilds
  `songs` from the response (`:572-590`, footnote joined and entity-decoded at
  `:579`), and passes that array to `deriveSlotFacts(songs, isFinal)` (`:613`)
  and `scoreBracket({... songs ...})` (`:664`). The stored table is written for
  the UI and the song-by-song diff only; the scorer does not read it back.
- **Finalized shows are never rescored.** The cron scores only
  `eligibleLeagueShows()` (`index.ts:372-376`): `status != 'final'`, cutoff
  not null and passed, showdate within the last day. `status` becomes `final`
  per league, either by the manual `finalize` action (`:779-790`) or by
  `autoFinalize` at 8 AM Eastern the next morning (`:398-408`); each runs one
  last pass with `isFinal = true` first. Until that moment scores float with
  every Carton edit; after it they are frozen.
- **Reopen is the only path back** (`index.ts:732-749`): it deletes that
  league's `scores` for the show, sets status to `live` and `winner_sent`
  null, and the next cron tick rescores the whole league against current
  Carton data. There is no per-player or per-song correction.

### OPEN RULES DECISIONS — undecided 2026-10-18, admins to weigh in

**(a) Does a cover's first performance (Carton "FTP") count as a debut for
the wildcard and bonus?** Options on the table:
1. **Originals only** — the current behaviour, by accident of the regex, not
   by decision. "Debut" in Carton usage is a first-ever performance of an
   original; "FTP" (first time played) is the tapers' term for a cover's
   first appearance.
2. **FTP counts** — extend the match to `/debut|\bFTP\b/i`. Makes the
   wildcard and bonus pay on a first-time cover too.
3. **Derive first-time-played from Carton history instead of the footnote** —
   a song is a debut if it has no earlier `setlist_songs`/Carton appearance.
   Removes the dependency on taper wording entirely, but needs the full
   setlist-history backfill that Module A also needs (`scoring-modes.md`);
   `setlist_songs` holds only the rolling sync window today.
Not decided. Note that whichever way it goes, the stored `scores.breakdown`
of already-final shows will not change (see (b)).

**(b) Finalize policy — scores float until finalize, then freeze; Reopen is
the override.** That is what the code does today and it is how a
post-finalize Carton correction is handled: an admin presses Reopen, the
league rescores, the admin finalizes again. **Proposed: keep it, but state it
in the Rules card** so players know that (1) scores can move until the show
is finalized, including on Carton edits, and (2) after that they move only
if an admin reopens. Undecided — the Rules card copy is not written and the
question of whether a Carton correction *should* trigger a reopen is the
admins' call, not the code's.

## Known bugs — found 2026-10-18

**(i) The sync diff ignores `footnote` and `is_cover`, so `setlist_songs`
goes stale while the scorer uses live data.** `index.ts:597` selects only
`position, songname, setnumber, is_encore, segue` from the stored rows and
`:599-601` compares only those five fields, so a Carton edit that changes
only the footnote or the cover flag is never written back. The scorer does
not care (it reads the live fetch, above), but the UI does: after the
2026-10-15 edit the setlist view (`picks.js:447`) still showed a DEBUT tag on
Wild Mountain Honey while the scorer had stopped crediting it, and the stored
row still reads `footnote = "Debut", is_cover = false` against a live
`FTP, Steve Miller Band cover` / `isoriginal = 0`. Three other footnotes on
the same show are stale the same way. **Fix shape:** add `is_cover` and
`footnote` to both the `select` at `:597` and the comparison at `:601`.
Cosmetic until the debut rule above is decided, because scoring is
unaffected; worth doing in the same change as that decision.

**(ii) The score-write change check never matches, so every pass rewrites
every row and pings realtime; `updated_at` is meaningless.** `index.ts:720`
compares `JSON.stringify(prev.breakdown)` against `JSON.stringify(breakdown)`.
`prev.breakdown` comes back from Postgres `jsonb`, which stores object keys
in its own order (shortest first, then bytewise: `hit, slot, points, reason,
songname`), while the fresh object is built in insertion order (`slot,
songname, hit, points, reason`). The two strings never agree, so the
"write only on change" branch always writes, `score_writes` is always
non-zero, `pingRealtime` fires on every pass of every live show, and
`scores.updated_at` records the last scoring pass rather than the last real
change. Observed directly: every `scores` row for show 1786387666 in brackets
3 and 4 carries an `updated_at` inside the 04:10:18–22Z finalize window and
both bracket-2 rows sit at 12:00:01–02Z, i.e. each league's final pass.
**Fix shape:** compare canonicalised JSON (stringify with sorted keys on both
sides) or compare field-by-field per breakdown row (`slot`, `songname`,
`hit`, `points`, `reason`) plus `points`. Add a scenario/unit case that
scores the same picks twice against the same setlist and asserts zero
writes on the second pass. Points were never wrong — this is a wasted-write,
wasted-ping and lost-history bug, not a scoring bug.

## Open items — found 2026-10-30

**OPEN, not a decision: the stored 2026-08-14 setlist is one song short of The
Carton.** Found 2026-10-30 during a read-only check: the stored setlist for
that show has 15 songs and The Carton has 16, with "Rampage" missing at
position 3.
- **Impact unverified.** The scorer is believed to read The Carton live rather
  than stored rows, so scores are likely unaffected, but this has NOT been
  checked for this show.
- **Unknown:** why the stored row didn't pick up the insert (possibly because
  the stored row is only rewritten when song order changes), and whether other
  shows have the same drift.
- **Next action:** a read-only comparison of stored vs Carton setlists for
  every 2026 show, plus a check of that show's scores. Not yet scheduled.
- **Code read while recording (2026-10-31), not checked against data:** the
  live read at `index.ts:734` only runs until a show goes final
  (`eligibleLeagueShows`, `:537`), and the diff compares song names by position
  (`:767-770`), so a pass that saw the insert should have rewritten the rows.
  If The Carton added the song after the last pass, the final scores were
  computed without it too, and the live read would not protect them. If a
  write failed instead (the upsert at `:772` checks no error), the scores could
  be right with only the stored rows stale.
