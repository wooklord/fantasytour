# 2026-10-11: Green Eggs overlay rows — pre-sync check, sync verified, secondary findings

> Extracted verbatim from `CLAUDE.md` at commit 54a5ab8 (2026-10-18), original lines 678–705, 846–927. Nested entries were de-indented to top level; wording is unchanged.
> Historical record — resolved, closed or superseded. Kept for its method and evidence. Not a current instruction.

- **PRE-SYNC SAFETY CHECK, 2026-10-11 (read-only) — VERDICT: SAFE TO
  PRESS "Sync shows". Approved by the dev the same day.** What was
  checked, so the next data fix of this kind can reuse the list:
  - **Window contents, from The Carton itself, not the DB** — the sync
    writes whatever the API returns, so the DB alone cannot predict it.
    200 rows returned; 16 survive the 14-day floor; same 16 ids as
    `shows`; earliest 2026-10-15, so NO past show gets a Green Eggs row.
    Festival-tag query empty.
  - **New rows carry `status = 'upcoming'` (column default) and NULL
    announcement flags** — the insert writes only league/show/cutoff/
    format. Harmless for future shows. For a PAST show it would be:
    older than yesterday → never scored (eligibility floor), lock notice
    skipped (`showdate < easternDate(-1)`), never finalized, sits
    `upcoming` forever; yesterday/today → scores with zero picks and
    posts "0 sheets in".
  - **League 1 untouched in `league_shows`**: 0 missing overlays, 0 null
    cutoffs, no festival ids, so all three write paths are no-ops. The
    `shows` upsert rewrites 16 rows with values compared field-by-field
    (venue after entity decoding, city, state, permalink, timezone) and
    found identical; `created_at` is not in the payload. Only effect: 16
    UPDATE events on `shows`, which nothing in `realtime.js` subscribes
    to. `sync_shows` runs no scoring, and the next cron tick has nothing
    to fire (no cutoff within 1h or passed).
  - **Null-state shows 1786388421/1786388443 (Washington, D.C.)** get the
    Eastern fallback: 18:00 ET = 23:00 UTC on Nov 20/21 (EST). Correct by
    luck of geography and identical to league 1's rows. `admin_set_cutoff`
    works once the row exists; the panel shows device-local with the
    "timezone unknown" caveat.

---

  - **✅ SYNC PRESSED AND VERIFIED 2026-10-11 ~17:00Z.** League 2: 16
    rows, 0 null cutoffs, 16 × `upcoming`, 0 flags set, and a row-by-row
    join against league 1 for the same 16 shows found zero cutoff or
    format differences. D.C. shows at `23:00:00+00` on 2026-11-20/21 in
    both leagues. League 1: still 37 rows, 0 null cutoffs, the 16 window
    rows byte-identical to the pre-press reading. `shows`: still 37,
    `max(created_at)` still 2026-08-15 (the upsert added nothing). Cron
    responses after the press: still `"note":"no eligible shows"`.
    **Green Eggs' first season can now take picks.**
  - **Side observation, not for this week:** The Carton's `shows.json`
    rows now carry a `timezone` field per show. It could replace
    `STATE_TZ` and the null-state fallback outright. Unverified beyond
    the field's presence.
- **Three secondary findings from the same read, each its own thing:**
  - **Stage F was never applied.** `league_members.official_opt_in` has
    `column_default = false` in the live catalog, though
    `sql/stage_f_official_default_optin.sql` sets it `true` — see the
    correction on the Stage F bullet in the 2.0 key decisions. All 18
    Green Eggs members are opted OUT. Not blocking today, because season
    11's roster is locked so `_official_gate` reads `season_rosters`.
    Another committed-but-not-applied stage file; the catalog, not the
    commit, is the record.
  - **Green Eggs' season (id 11) has `roster_locked_at` =
    2026-08-17 15:34Z, two months BEFORE its 2026-10-14 start.** Roster
    is frozen at 18 rows = 18 members, so consistent today, but anyone
    added to the league after that moment is NOT on the roster.
    **✅ INVESTIGATED 2026-10-12, read-only — what stamped it, and it
    WILL recur for the next season created the same way.**
    - **Only one writer exists.** `roster_locked_at` is written in
      exactly one place in the whole system: `activateSeasons()`
      (`index.ts:362`), which the cron runs every minute. No SQL
      function writes it (`_official_gate` and `get_bracket_seasons`
      only read it), there are no triggers in `public`, and the admin
      tab has no lock/activate control — `admin.js` touches
      `roster_locked_at` once, to word the roster-removal confirm.
    - **Its gate is `start_date <= today` (Eastern) and `roster_locked_at
      is null`.** So at 15:34:01Z on 2026-08-17 the season's
      `start_date` was on or before 2026-08-17. It is 2026-10-14 now.
      **`admin_save_season` updates `start_date`/`end_date` and never
      clears `roster_locked_at`**, so the inference is: the season was
      created on 2026-08-17 with a start date on or before that day
      (`leagues.created_at` puts the league at 04:06Z the same day),
      the next cron tick activated it within the minute, and the dates
      were edited to Oct 14 → Dec 6 afterwards with the lock left in
      place. No row history exists to confirm the original dates; this
      is the only chain consistent with the one writer. (A hand-run
      SQL update cannot be ruled out, but nothing suggests one.)
    - **The timing corroborates the cron, not a batch of hand-adds:**
      the stamp is 15:34:01.287Z, one second after a minute boundary,
      and the roster's first row sits 29.7s BEFORE it — a single manual
      `admin_set_season_roster` add, not activation's own write (that
      lands ~0.1s before the stamp, per the Test 3 record). The
      activation snapshot itself wrote NOTHING that survives: every one
      of today's 23 roster rows has a distinct `added_at` — 1 on
      2026-08-17, 17 on 2026-10-11 ~16:46Z a second apart, 5 on
      2026-10-12 ~20:49Z — i.e. all hand-added, and consistent with an
      empty snapshot since all 23 members carry `official_opt_in =
      false` (Stage F unapplied) and only 1 member existed at the lock.
    - **Consequence for season 11:** activation will NOT run again on
      2026-10-14 (the `is null` half of the gate fails), so no member is
      ever auto-added; the roster is manual-only for the whole season,
      and the dev has been keeping it in step by hand (23 members, 23
      roster rows, 0 missing as of 2026-10-12 20:56Z). Applying Stage F
      changes none of this.
    - **Would it happen to the next season? YES, by the same route.**
      Any season saved with `start_date` on or before today's Eastern
      date is activated by the next cron tick, within 60 seconds, and
      editing the dates afterwards does not undo it. A season created
      "for today" as a placeholder and re-dated later is locked for
      good with whatever snapshot existed in that minute. Season 10
      (Ambassadors, 2026-10-15 → 12-05) is NOT in this state — still
      unlocked, will activate 2026-10-15 04:00Z normally.
    - **Only in-app signal of the lock** is the roster-removal confirm's
      "already activated" sentence; the Seasons panel shows nothing
      otherwise. No fix proposed here; recorded so the next early lock
      is recognised in a minute rather than two months.
  - **Bracket 3 (Green Eggs Official) now carries the FABRICATED `oneset`
    section** (opener/closer/cover1, `flat_picks: 3`) that the admin
    panel's hardcoded fallback invents and a save materialises — exactly
    the outcome the "two fallbacks disagree" entry below predicted.
    Bracket 4 (Casual) is still raw `def_cfg`: no `mode`, `oneset`,
    `tiebreakers` or `custom_rules`.
