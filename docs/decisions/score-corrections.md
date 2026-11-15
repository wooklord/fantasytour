# Targeted score corrections: the log action, Stage AA, and the first use

Decision record, binding. Opened 2026-11-15.

> **STATUS: APPROVED 2026-11-15 (the dev's calls), NOT APPLIED.** Stage AA is
> written and tested locally, not applied. The correction is an untracked
> transaction, not run, not even as a dry run. Nothing in the live database has
> changed. On the dev's instruction the outcome is recorded here AFTER the
> apply; until then this file holds the decisions, the state and the open
> questions, so none of it lives only in a conversation.

Standing rule (`CLAUDE.md` → Conventions): no player nickname, no player id, no
pick contents and no score totals in this file. League, bracket and show ids are
fine. Code is cited by function name plus "as of <sha>".

## What this is

One pick on one sheet in Green Eggs Official (league 2, bracket 3) on the
2026-11-14 show (1786388366) is to be changed after cutoff, and that sheet's
score with it: +2 points. The show is not reopened and not re-finalized, and
no other row changes.

## The weight (the dev's call, 2026-11-15, recorded as given)

**A one-time exception, the dev's call,** for a pick changed after cutoff where
the intended song was unambiguous: the catalog holds two near-identical titles
and the sheet named the other one.

**It is NOT a rule.** Whether post-cutoff pick corrections are allowed in
general stays OPEN. Nothing here answers it, and this case is not a precedent
for the next request.

It is also outside the 2026-10-31 policy as written. `setlist-check.md` item 8
covers a Carton data correction that a player raises; this is a pick-entry
correction. The method is borrowed from item 8 (targeted, logged, never
reopen/finalize). The permission is the exception above and nothing else.

## Two errors in the brief, corrected (durability rule 3)

1. **The brief called the 2026-08-14 fix "the precedent to follow" and asked
   how it was done and logged. That fix was never performed.** It is
   decided-deferred (`scoring-rules.md` → "Open items — found 2026-10-30": do
   not correct unless the player raises it). Checked against the database on
   2026-11-15: the verdict is still the one the 2026-08-15 final pass wrote,
   and the stored setlist still lacks the song. "Precedent: the 2026-08-14
   case" in item 8 names the case the POLICY came from, not a performed fix.
   There was no method, no template file, no RPC and no log record to follow:
   **this is the first targeted correction this project has prepared.**
2. **The brief named `C:\Users\kylem\scripts\backup-fantasyeggy.ps1` as the
   backup script. That file does not exist, and neither does the folder.** The
   backup tool is `dump.sh` in the backups folder outside the repo
   (`backups.md`). It was run on 2026-11-15 at 20:01 UTC and completed with
   its row counts printed. The dump before that was 2026-08-16, the day the
   script was written: no scheduled task on the dev's machine runs it (36
   non-Microsoft tasks listed, none names it), the database has one pg_cron
   job (scoring), and the platform lists no backups (`supabase backups list`:
   empty, PITR off). **Dumps are manual, and there have been two.** Reported;
   nothing was changed. The restore path is still untested.

## Decisions locked 2026-11-15 (the dev's calls)

1. **The setlist evidence is accepted, with its gap recorded.** See "How the
   verdict was computed".
2. **The log lives in `admin_audit_log` under the new action `adjust_verdict`,
   and the schema change goes in a tracked stage applied FIRST**, not inside
   the correction. Stage AA
   (`sql/stage_aa_audit_action_adjust_verdict.sql`,
   `test/stageAA.test.mjs`) does one thing: it widens Stage X's check from
   `('remove_account')` to `('remove_account', 'adjust_verdict')`. The
   proposal had the widening inside the correction's transaction; the dev
   chose the stage, so that an untracked data fix carries no DDL and `sql/`
   stays the whole schema. The destination itself was named on 2026-10-31
   (`setlist-check.md` item 7).
3. **Timestamps.** `picks.updated_at` is left at its old value;
   `scores.updated_at` takes `now()`. The rule the dev set: if anything
   compares a pick's time to the cutoff or shows a "saved at", leave the pick's
   timestamp alone, since the log keeps the truth. Readers found (repo as of
   `efaafa3`, live function bodies read 2026-11-15):
   - `picks.updated_at`: `admin_pick_status` returns `max(updated_at)` as
     `last_saved`, and `loadRoster` in `src/features/admin.js` prints it in
     Who's Picked as "n picks · saved <when>". That is a "saved at", so the
     column stays. Nothing compares it to the cutoff. `get_my_picks` returns
     the column and no client code reads it; `submit_picks` writes it; the
     tiebreakers do not use it (`sql/stage_d_tiebreakers.sql` says so).
   - `scores.updated_at`: `get_bracket_scores` returns it and no client code
     reads it; `scoreBracket` in the edge function only writes it;
     `setlistCheck.js` and the replay tool never read it. No view, policy,
     index or trigger mentions either column. With no reader, the time of the
     last write is the honest value, and the old one is kept in the log row.
4. **Apply order:** the backup (done, see above; run it again first if the
   apply is not the same day), Stage AA STEP 0, Stage AA, STEP 2, the dry run,
   the real copy. Each is the dev's to run; nothing is applied without the
   dev's go.
5. **`admin_adjust_verdict`: its build trigger has fired** (item 7: "the first
   real use of the template"). **It is not built now** (the dev's call).

## How the verdict was computed

- **Scorer:** `scorePicks` in `supabase/functions/carton-sync/scoring.js` as of
  `65e989c`, run offline under Node from a scratch script. The deployed copy
  is byte-identical: the function was downloaded on 2026-11-15, and its
  `index.ts` is `829ca6a`'s (the same blob as `b9f3ee6`'s), with no
  `setlistCheck.js` in the bundle. **So deploy A is still not live.**
- **Inputs:** bracket 3's config as stored on 2026-11-15, `league_shows.format`
  (`standard`), a final pass, and the 18 stored `setlist_songs` rows.
  `tools/replay_setlist_check.mjs` did not fit: it fetches The Carton live,
  scores under unit-point synthetic configs and compares hit and reason only.
- **Result:** the flat pick becomes a hit that pays the bracket's flat points,
  reason "played", with no cover or debut bonus and no Perfect row. +2.
- **The gap, stated plainly.** No snapshot of the setlist as Green Eggs'
  finalize saw it exists. Deploy A is not live, so the four setlist-check
  columns are null on every `league_shows` row (there are no hashes to
  disturb, and the correction writes none). `setlist_songs` is shared across
  leagues and rewritten by any league's scoring pass: Green Eggs was finalized
  by hand at 11:51 UTC on 2026-11-15, and the other two leagues' final passes
  ran at 13:00 UTC, 68 minutes later. The stored rows are therefore "as of the
  last pass that saw a change in the five diffed fields", not that finalize.
- **What closes it, accepted by the dev:** (1) the stored rows reproduce all
  19 frozen sheets of this league and show exactly, points and every breakdown
  element; (2) another sheet in the same bracket named the same song in a flat
  slot, and the 11:51 pass froze it as a hit at flat points, "played", no
  suffix. That second one is a direct readout of the finalize pass.
- **The Carton on 2026-11-15, about 19:30 UTC (one GET, comparison only, never
  scored against):** its scoring projection (`projectSetlist`, as of
  `efaafa3`) equals the stored rows'; two footnotes differ, neither holding
  "debut"; it too reproduces 19 of 19. Whether those footnotes arrived after
  finalize or are bug (i) staleness cannot be told without a baseline.
- **Knock-on:** the show's top score in the bracket is unchanged, so the
  show's laurel and the posted Discord winner (the post names only the top
  scorer, `announcements` as of `b9f3ee6`) stay right. Standings and laurels
  are computed on read (`computeStandings` in `src/core/tiebreak.js` as of
  `1080130`, from `get_bracket_scores`); no table stores them and no SQL
  function writes `scores`. The league's Casual bracket has no entries on this
  show, so there is no second row to keep in step.

## The transaction (untracked)

Two copies, real and dry run, in the repo's gitignored `.scratch/` folder.
They name the player, so they are never committed. The DO block is identical in
both but for one constant; the dry run raises on purpose so its before/after
shows in the SQL editor's error panel (the STEP 2B idiom), then `rollback`.

- **Snapshots** (temp tables): all of `scores`, `picks`, `league_shows`,
  `setlist_songs`, `admin_audit_log`, and the per-entry points for the show
  and league.
- **Preconditions, before any write:** Stage AA is in; one player by that name;
  one global admin (the actor); the show is final in the league; the pick row
  is the one described; the new title is in the catalog and not already on
  the sheet; the stored setlist is byte-for-byte the one scored against (an
  md5); one sheet for the player and show in the league; stored points and the
  stored verdict are the ones described; the sheet and the frozen breakdown
  name the same pairs.
- **Writes:** one `picks` row (the song only), one `scores` row (one breakdown
  element replaced in place, points, `updated_at`), one `admin_audit_log` row
  (actor, target, league, and a `detail` holding the pick, verdict and points
  before and after, both timestamps, the why and the how).
- **Guard:** raises unless the only differences from the snapshots, in any
  league or show, are the two target rows and the one new log row; unless the
  pick changed in its song alone; unless the score row changed in one element
  alone, with points equal to the computed total, to the sum of the breakdown
  and to old points plus the element's change.
- **Tested 2026-11-15 on a throwaway local Postgres 18.6**, stub tables built
  from the live column lists and loaded with the real 19 sheets: 63 of 63.
  Stage AA's steps before and after, its rollback, and its refusal to roll
  back once a correction is logged; the dry run three ways with the database
  byte-identical afterwards; 17 deliberate stray writes, each raising and
  persisting nothing; 11 wrong starting states refused; the real copy changing
  exactly the two rows plus the log; a second run refusing. `stageAA.test.mjs`:
  11 of 11 mutations killed. **Not run on the live database (17.6), and not
  through the SQL editor.**
- **Not done by it:** no realtime ping, no Discord post. The player sees the
  score on their next load.

## Open

1. **Are post-cutoff pick corrections allowed in general?** OPEN. See "The
   weight".
2. **`admin_adjust_verdict`.** Trigger fired, not built.
3. **Platform API logs were not read.** The check was asked for; reading the
   CLI's stored login to call the Management API was refused by the session's
   permission layer and was not worked around. Free-plan log retention is
   short, so the 2026-11-15 calls may be gone before anyone looks.
4. **The 2026-11-13 show in Green Eggs was reopened and re-finalized on
   2026-11-15 at 15:13 UTC.** Reported the same day; no decision yet. Per the
   dev: done by a league admin, not a correction the dev approved, and the
   path the 2026-10-31 policy rules out. What the data shows:
   - All 19 score rows were rewritten at 15:13:38–41 UTC and `winner_sent`
     re-stamped at 15:13:41. **A second winner post went out:** the league's
     `discord_ok_at` reads 15:13:44, after the "Scores reopened" post
     `reopenShow` sends.
   - **The first finalize's values are not preserved anywhere readable.**
     `reopenShow` deletes the rows; the last dump was 2026-08-16; the platform
     holds no backups; cron responses carry no points and are kept six hours;
     Postgres logs DDL only. The deleted row versions may still sit in the
     table (its last autovacuum was 2026-11-14 04:25 UTC), but reading them
     needs `pageinspect`, which is not installed and whose raw-page functions
     need a superuser, which the project's role is not. Not attempted.
   - **So whether any score moved is unknown.** What is known: the rows now
     stored equal a replay against the stored setlist and against that day's
     Carton, 19 of 19 both ways; picks were last saved before the cutoff; The
     Carton's row ids show no row added after the next night's show began.
     Bracket config, format and roster keep no history.
   - **The one surviving witness is the first Discord winner post**, which
     names the top scorer(s) and the top score. Compared with the second
     post, it answers whether the show's laurel changed hands.
   - **Who can do this:** the edge actions `reopen` and `finalize`, each
     behind `requireLeagueAdmin` (as of `b9f3ee6`: `_auth_player`, then
     `_is_league_admin_or_global`), so a league admin of that league or
     Global. In the UI: Admin tab → "Shows: cutoffs & finalizing" → Reopen on
     a final row, Finalize on a row past cutoff, for shows of the last seven
     days. Three accounts pass that guard in Green Eggs. A direct request
     with a name and PIN reaches any show, with no seven-day limit.
   - **No record says who called either action.** Neither writes an audit
     row; `admin_audit_log` held one `remove_account` row.
   - **The app itself tells an admin to do it.** `reopenShow`'s confirm text
     and the comment above it in `src/features/admin.js` (as of `7361c72`)
     describe reopen then finalize as the workflow for a Carton correction.
     The 2026-10-31 policy was recorded in this repo and never reached the UI
     or the league admins.
   - **Options put to the dev, none chosen, nothing built:** Reopen limited to
     Global (the edge action and the button); the confirm dialog stating the
     policy and what a reopen destroys; `reopen` and `finalize` writing to
     `admin_audit_log`; `reopenShow` saving the rows it deletes; a refusal to
     reopen a show older than the cron's one-day floor.
5. **Green Eggs is finalized by hand, show after show.** Ten of its eleven
   shows from 2026-10-15 to 2026-11-14 carry a finalize stamp at an hour the
   08:00 ET auto pass never runs; the eleventh, 2026-11-13, lost its first
   stamp to the reopen. Who presses it is not recorded, so the 2026-11-14
   press at 11:51 UTC stays unconfirmed: the data cannot name the caller.
