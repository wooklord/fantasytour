# The zero-overlay finding, the LOCKED list and the post-first-show batch

> Extracted verbatim from `CLAUDE.md` at commit 54a5ab8 (2026-10-18), original lines 518–677, 2048–2097. Nested entries were de-indented to top level; wording is unchanged.
> Decision record — currently binding. `CLAUDE.md` holds only a pointer stub under the same entry name; this file is the full text and rationale.

- **🚨 FOUND 2026-10-11 — A NEW LEAGUE GETS ZERO `league_shows` ROWS, SO
  EVERY SHOW READS "no cutoff", EVERY BUTTON SAYS "Score", NOBODY CAN
  SUBMIT, AND THE SCORER SKIPS IT. Green Eggs sat in this state from its
  creation on 2026-08-17 until found 2026-10-11, three days before its
  first season starts (2026-10-14). This is a CODE-PATH GAP that recurs
  for every future league, not a one-off data accident.**
  - **Root cause.** `global_create_league` (`sql/stage_c1_rpcs.sql`)
    inserts the league and two brackets and nothing else. The ONLY creator
    of `league_shows` rows is `syncShows()` in the edge function
    (`index.ts`, the per-league overlay loop), and the only thing that
    invokes `sync_shows` is the global-admin "Sync shows" button — the cron
    body is `{"action":"score"}` and nothing else, verified in `cron.job`.
    Nobody pressed the button after creating the league, so the loop never
    ran for league 2.
  - **Evidence, all read-only via psql 2026-10-11:** league 2 has 0
    `league_shows` rows against league 1's 37 (0 null cutoffs). All 16
    upcoming shows lack a league-2 row; all 16 fall inside `syncShows`'
    fetch window. Latest `shows.created_at` is 2026-08-15, two days before
    the league existed — the last `sync_shows` predates it. The cron has
    43,200 straight successes in 30 days and every recent response reads
    `"note":"no eligible shows"`, because `eligibleLeagueShows` filters
    `cutoff_at not null`.
  - **How it presents, so the next person recognises it:** `showState()`
    (`src/core/format.js:29`) returns `"no cutoff"` when `cutoff_at` is
    falsy, and `shows.js:64` labels anything not `"open"` as "Score".
    `fetchShows` (`src/core/leagueShows.js`) spreads the overlay row over
    the base show, so a missing row leaves `cutoff_at`/`status`/`format` all
    undefined — the show still LISTS (it comes from the global `shows`
    table), it just has no league state. `submit_picks` and
    `can_submit_picks` both raise on a missing row ("not on this league's
    schedule"), so `voting_override = open` would not rescue it either.
  - **The admin panel CANNOT repair it.** `admin_set_cutoff` is an UPDATE
    that raises "Show not found for this league" when no row exists; the
    Shows panel renders a blank cutoff input for such a show and saving
    fails. The input looks like "no cutoff set yet" when the real state is
    "no row at all" — two different things with one rendering.
  - **LOCKED 2026-10-11 (dev):**
    1. **No second creator of overlay rows.** `admin_set_cutoff` stays
       UPDATE-only; the Shows panel is to say "Not on this league's
       schedule" instead of a blank input (plan only, not built).
    2. **Nothing changes production behaviour the week of 2026-10-11
       except the data fix** — pressing "Sync shows" to create league 2's
       rows, after a read-only pre-sync safety check.
    3. **Seed overlays in `global_create_league`** so a league is correct at
       creation. **✍️ WRITTEN 2026-10-11 as
       `sql/stage_r_seed_league_shows_on_create.sql` — NOT APPLIED. Apply
       after the first Green Eggs show scores, alongside the cron change.**
       Until the file's SECTION 3 catalog check passes (body of
       `global_create_league` contains `insert into league_shows`), the live
       function is still the stage N body and a new league still starts
       with zero overlay rows. The file says so in its first lines; this
       entry says so here, so it cannot be mistaken for live the way Stage
       F was. Change both together when it is applied.
       - **Based on the LIVE body, not the stage file**: `pg_get_functiondef`
         was read 2026-10-11 and diffed, whitespace/CRLF-normalised, against
         `sql/stage_n_reject_pending_pin_change_writes.sql` — **identical**,
         so stage N is genuinely applied and nothing drifted in between.
       - Cutoff computed in SQL as 18:00 in `coalesce(shows.timezone,
         'America/New_York')`. **It can drift from `venueCutoffISO()`** —
         the hour and fallback zone are duplicated literals, and the DST
         probe method differs (TS at 12:00Z, SQL at 18:00 local; equal for
         any zone whose transitions are at 02:00 local). Pinned at apply
         time by the file's step 3: every upcoming overlay row, all of
         which TS wrote, must equal the SQL helper — expected 0 drifted
         across 32 rows covering both DST offsets and the null-zone
         fallback. Ongoing pin is four literal asserts, to be mirrored in a
         node test when `venueCutoffISO` moves to a shared module
         (post-first-show batch; `supabase/functions` untouched this week).
       - Past shows seeded `final` with flags stamped (Stage A copied old
         statuses instead) — so a league created mid-season can still get
         its champion announced; format always `standard`.
       - **Harness fake updated the same day** (`test/harness.mjs`,
         `global_create_league`) to seed overlay rows too, so the fake is no
         more permissive than the real RPC will be. Two assertions added:
         overlay show ids equal the fixture's show ids exactly, and zero
         null cutoffs. **Mutation-tested**: emptying the seed loop fails
         exactly those two checks in both modes (4 failures), nothing else.
         Note the fake now models the INTENDED behaviour, not the live one,
         until Stage R is applied.
    4. **Scheduling `sync_shows` on the cron is HELD until the first Green
       Eggs show has scored cleanly.** Folds into the `CRON_SECRET`
       dual-path change below (the "DECIDED 2026-08-17, NOT STARTED"
       entry), not a separate change.
    5. **A zero-overlay test fixture — ✅ BUILT 2026-10-11, test files
       only.** `runNoOverlayScenario` (`test/harness.mjs`): `makeFixtures()`
       with `league_shows` emptied and a live Official season injected off
       `Date.now()`. Six checks in `test/scenario.test.mjs`: shows still
       LISTED (they come from the global table), every pill "no cutoff",
       every button "Score", opening a show renders the detail view with
       zero `.slotline` inputs, the `submit_picks` fake rejects with the
       real message, and a POSITIVE CONTROL — the identical call succeeds
       once the row is restored — so the rejection is pinned to the missing
       row and not to anything else.
       - **The `submit_picks` fake had NO schedule check at all** until this
         day — a league with zero overlay rows could "save" picks the real
         RPC rejects. Now mirrors the real block in the real order:
         bracket, show, overlay row ("This show is not on this league's
         schedule"), `voting_override` locked/open, null cutoff ("Picks are
         not open for this show yet"), passed cutoff. Suite stayed green
         with no fixture changes, so no existing scenario depended on the
         permissiveness. Same family as the `get_show_picks` cutoff gate.
       - **`can_submit_picks` was deliberately NOT tightened.** The plan said
         "both"; the real one runs only `_official_gate` and never reads
         `league_shows`, so adding the check there would make the fake
         STRICTER than production — the opposite error. Plan corrected
         against the SQL before writing.
       - **Mutation** (restore the fixture's overlay rows): pill, button,
         detail-view and rejection checks fail in both modes — 8 failures —
         while "still listed" and the positive control correctly survive,
         since both hold either way. Reverted by anchored edit, confirmed
         by case-sensitive grep for the marker.
       - **The scorer skip is NOT exercised and is stated as such** in the
         scenario header: `eligibleLeagueShows()` lives in `index.ts`,
         off-limits this week and not unit-testable until the shared-module
         move. Verified by reading only.
    6. **THE POST-FIRST-SHOW BATCH — one batch, one deploy, after the first
       Green Eggs show scores cleanly. Decided 2026-10-11; nothing in it
       ships before then.** Contents: (a) apply Stage R; (b) the
       `CRON_SECRET` dual-path change WITH hourly `sync_shows`; (c) the
       Shows-panel "Not on this league's schedule" label (part E, approved
       as a plan, HELD — the state it handles no longer exists in either
       league); (d) the admin cutoff-fallback DST fix (part F, approved as a
       plan, HELD — see the Frontend/CSS gotchas entry); **(e) apply
       Stage F, `sql/stage_f_official_default_optin.sql` — added
       2026-10-12 after the dev REAFFIRMED that Official opt-in defaults
       to TRUE; the file stands as the fix.** Catalog check that proves it
       applied, run AFTER the file: `column_default` on
       `league_members.official_opt_in` reads `true` (via
       `information_schema.columns`), and
       `select count(*) from league_members where not official_opt_in`
       returns 0 (the file backfills; a non-zero count means the backfill
       half did not run). **No effect on season 11**: its roster is
       locked, so `_official_gate` reads `season_rosters` and never the
       flag — the default only matters for the NEXT season's activation
       snapshot and for `admin_add_league_member`. **(f) Re-enable
       Discord for AMBASSADORS and SEPARATE THE CHANNELS — added
       2026-10-14, re-scoped the same day.** Green Eggs' SECRET exists
       (`DISCORD_WEBHOOK_GREEN_EGGS`, set 2026-10-14, see the "🔔 ENABLED"
       sub-bullet below), but its VALUE is the Ambassadors channel's
       webhook URL, so today both leagues' names resolve to one Discord
       channel (league 1 to nothing, league 2 to Ambassadors'). (f) now
       covers: **(i) give each league its OWN Discord-side webhook** —
       create a webhook in the Green Eggs channel, put its URL in
       `DISCORD_WEBHOOK_GREEN_EGGS`; **(ii) a per-league Ambassadors
       secret** (`DISCORD_WEBHOOK_AMBASSADORS`; the global `DISCORD_WEBHOOK`
       is NOT to be restored); **(iii) the league-name prefix** on every
       `notifyLeague` message — which DOES still matter for Green Eggs
       while its posts share the Ambassadors channel (the earlier
       "no longer blocking" reading assumed a single-league channel, which
       is not the current state). **ORDER FOR (i): replace the secret's
       value FIRST, and only THEN delete any Discord-side webhook.** A
       dead URL fails SILENTLY — `notifyLeague` wraps the fetch in
       `.catch(() => {})` (`index.ts:103-107`) and the stamps are written
       regardless — so deleting the webhook on Discord's side before
       re-pointing the secret would silently drop every post and leave
       nothing to replay. (c), (d) and (f) all touch code, i.e. a rebuilt
       bundle on `main` and a Pages deploy (or, for (f), an edge-function
       deploy), which is exactly what this week excludes. `src/` and the
       bundle were not touched on 2026-10-11, verified by `git status`
       before each commit.

---

- **BUG, found 2026-10-11, NOT YET FIXED — the admin Shows panel's
  "Device time — venue timezone unknown" fallback shows the wrong hour
  whenever the device's DST state today differs from the show date's.**
  Reported as: the two D.C. shows (1786388421, 1786388443; `shows.state`
  blank, `shows.timezone` null) render 7:00 PM while the stored value is
  23:00 UTC = 6:00 PM Eastern in November, and timezone-known shows render
  6:00 PM correctly. Reproduced in node with `TZ=America/New_York`.
  - **Display path, the bug** — `src/features/admin.js:397`:
    `new Date(new Date(sh.cutoff_at).getTime() - new Date().getTimezoneOffset()*6e4)`.
    `new Date().getTimezoneOffset()` is the device's offset **today** (EDT,
    240), applied to a November instant where the device offset is EST
    (300). 23:00Z − 4h = 19:00. The offset-at-that-instant form,
    `new Date(sh.cutoff_at).getTimezoneOffset()`, gives 18:00.
  - **Write path does NOT share it** — `saveCutoff`, `admin.js:1171`:
    `new Date(input.value).toISOString()`. A `datetime-local` string with
    no zone is parsed as device-local **at that date**, so typing 6:00 PM
    on a November show stores 23:00Z, correct. **But pressing Change cutoff
    without editing re-saves the wrongly displayed 19:00 → 00:00Z the next
    day, a silent one-hour shift.** With a KNOWN timezone both directions
    go through `venueTime.js` (`venueLocalInputValue` / `venueLocalToUTC`)
    and are correct for the date.
  - **Player-facing paths are unaffected, for every show.** `fmtCutoff`
    (`src/core/format.js`) uses `toLocaleString`, which applies the offset
    at the instant: "Nov 20, 6:00 PM EST". `shows.js` renders only the
    countdown; `picks.js` uses `fmtCutoff`.
  - **Scope, stated precisely:** admin panel only, display only, null-
    timezone shows only, and only while the device's DST differs from the
    show date's (each year roughly the second week of October to the first
    Sunday of November, and the matching March window). Today that is
    exactly the two D.C. shows. **Dev's rule until fixed (2026-10-11):
    Change cutoff is off-limits for November and December shows in both
    leagues.** Technically only the two null-timezone shows are exposed;
    the blanket rule is the dev's call and stands.
  - **Fix — APPROVED AS A PLAN 2026-10-11, HELD for the post-first-show
    batch (item 6 of the 🚨 entry's LOCKED list). Not written: it changes
    `admin.js`, so a rebuilt bundle and a deploy, excluded this week.**
    Make the fallback use the device
    zone the same way the known-zone branch uses the venue zone — pass
    `Intl.DateTimeFormat().resolvedOptions().timeZone` to
    `venueLocalInputValue` for display and `venueLocalToUTC` for save, so
    one code path serves both branches and the device-time branch is
    DST-correct by the same mechanism. The one-line alternative
    (`new Date(sh.cutoff_at).getTimezoneOffset()`) fixes display alone and
    leaves two paths. Test: a `test/venueTime.test.mjs` case for a
    November instant with a device zone, plus the round-trip (display →
    save unchanged → same instant). Node honours `TZ` for this, as the
    repro showed — though on an Eastern machine that cannot be
    distinguished from the default, so the test should assert against a
    non-device zone too.
