# Targeted score corrections: the log action, Stage AA, and the first use

Decision record, binding. Opened 2026-11-15.

> **STATUS: APPLIED 2026-11-15.** The dev applied Stage AA and then the
> correction in the Supabase SQL editor; the correction committed at 20:52
> UTC and was verified read-only afterwards ("Outcome"). The items under
> "Open" are open questions and pending follow-ups, **not decisions**, except
> where a row says so: **item 4, the reopen gap, was DECIDED on 2026-11-15
> and is NOT BUILT.**

Standing rule (`CLAUDE.md` → Conventions): no player nickname, no player id, no
pick contents and no score totals in this file. League, bracket and show ids are
fine, and so is the id of a log row. Code is cited by function name plus "as of
<sha>".

## What this is

One pick on one sheet in Green Eggs Official (league 2, bracket 3) on the
2026-11-14 show (1786388366) was changed after cutoff, and that sheet's score
with it: +2 points. The show was not reopened and not re-finalized, and no
other row changed.

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
   **this was the first targeted correction this project has made.**
2. **The brief named `C:\Users\kylem\scripts\backup-fantasyeggy.ps1` as the
   backup script. That file does not exist, and neither does the folder.** The
   backup tool is `dump.sh` in the backups folder outside the repo
   (`backups.md`). It was run on 2026-11-15 at 20:01 UTC, before anything was
   applied, and completed with its row counts printed. What that turned up
   about backups is under "Open".

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
4. **Apply order:** the backup, Stage AA STEP 0, Stage AA, STEP 2, the dry
   run, the real copy, each run by the dev. Followed on 2026-11-15
   ("Outcome").
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
  columns are null on every `league_shows` row (there were no hashes to
  disturb, and the correction wrote none). `setlist_songs` is shared across
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
  show, so there was no second row to keep in step.

## The transaction (untracked)

Two copies, real and dry run, kept in the repo's gitignored `.scratch/` folder
(`2026-11-15-pick-correction/`). They name the player, so they are never
committed. The DO block is identical in both but for one constant; the dry run
raises on purpose so its before/after shows in the SQL editor's error panel
(the STEP 2B idiom), then `rollback`.

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
- **Tested before the apply, 2026-11-15, on a throwaway local Postgres 18.6**
  with stub tables built from the live column lists and loaded with the real
  19 sheets: 63 of 63. Stage AA's steps before and after, its rollback, and
  its refusal to roll back once a correction is logged; the dry run three ways
  with the database byte-identical afterwards; 17 deliberate stray writes,
  each raising and persisting nothing; 11 wrong starting states refused; the
  real copy changing exactly the two rows plus the log; a second run refusing.
  `stageAA.test.mjs`: 11 of 11 mutations killed. Its first run on the live
  database (17.6) and through the SQL editor was the dev's dry run below.

## Outcome (applied 2026-11-15)

**As the dev reported it, run by the dev in the SQL editor, in this order:**

1. The backup: `dump.sh`, 20:01 UTC, completed with row counts.
2. Stage AA STEP 0: 3 of 3 ok. Stage AA: applied. STEP 2: 4 of 4 ok, the
   table holding one `remove_account` row and nothing else.
3. The dry run: `DRY RUN OK`. 19 entries on the show in the league, 1 changed,
   the target; the pick's song old to new with its saved-at unchanged; the
   verdict from not played to played at flat points; +2, the points equal to
   the sum of the breakdown; the bracket's top score for the show the same
   before and after; the show still final. It used log id 4, since identity
   values are not rolled back.
4. The real copy: committed. Log row id 5, `logged_at` 2026-11-15 20:52:32
   UTC, action `adjust_verdict`; the pick, points and verdict before and after
   as expected; the pick's saved-at unchanged; the show final; the four
   setlist-check columns still null.

**Verified afterwards, read-only (20:54 UTC, a session that cannot write):**

- **The pick row:** the new song, the same slot, the same saved-at. The
  sheet's other five picks are untouched.
- **The score row:** one breakdown element differs from before, in place; six
  elements, no bonus row; points equal the sum of the breakdown and the old
  points plus 2; `updated_at` equals the log row's `logged_at`.
- **The show:** final in all three leagues, each league's `winner_sent`
  unchanged, the four setlist-check columns null in each.
- **The other 18 entries on the show:** identical to the read taken at 19:29
  UTC, before anything was applied, in points, every breakdown element,
  `updated_at` and picks. All 18 still carry the 11:51 UTC final-pass time.
- **Table-wide:** exactly one `scores` row has been written since the 20:01
  backup, the target; no `picks` row has been saved since it; `scores`,
  `picks` and `league_shows` hold the row counts the dump printed, and
  `setlist_songs` the count read before the apply. The stored setlist's md5
  and both bracket configs are unchanged.
- **`admin_audit_log`:** ids 3 and 5. Exactly one `adjust_verdict` row, id 5;
  id 4 is absent, used by the dry run. The row's actor is the Global admin,
  its target the player, its league 2; its `detail` holds the pick, the
  verdict and the points before and after and both timestamps. The check
  reads the two-value list, validated.
- **The scorer agrees with what is stored:** `scorePicks` reproduces all 19
  stored rows from the stored setlist, the corrected one included, and every
  sheet's `picks` rows and breakdown name the same pairs. So the daily
  setlist check's re-derivation, when it is built, has nothing to flag here.

**What follows from it:**

- No Discord post and no realtime ping were made. The posted winner is
  unchanged and still right; the player sees the score on their next load.
- Stage AA's STEP 2 now reads AA2.4 false, as its own comment says it will,
  and STEP R can no longer land: the log row holds the new action.
- The log row is readable only in the SQL editor (RLS on, no policy). It is
  the one place that says who and what; the `.scratch/` files are the other.

## Open (questions and pending follow-ups; NOT decisions unless a row says DECIDED)

1. **Are post-cutoff pick corrections allowed in general?** OPEN. See "The
   weight".
2. **`admin_adjust_verdict`.** Its trigger has fired; it is not built.
3. **The 2026-11-13 show in Green Eggs was reopened and re-finalized on
   2026-11-15 at 15:13 UTC.** Per the dev: done by a league admin, not a
   correction the dev approved, and the path the 2026-10-31 policy rules out.
   **Confirmed by the dev on 2026-11-15: it was the same league admin who
   finalized the 2026-11-14 show by hand (item 6).** **STILL OPEN: what
   Carton change prompted it.** The dev is asking that league admin directly.
   **Platform logs are not being pursued for now** (the dev's call,
   2026-11-15; the one attempt to read them, through the CLI's stored login,
   was refused by the session's permission layer and not worked around). What
   the data showed on 2026-11-15:
   - All 19 score rows were rewritten at 15:13:38–41 UTC and `winner_sent`
     re-stamped at 15:13:41. **A second winner post went out:** the league's
     `discord_ok_at` reads 15:13:44, after the "Scores reopened" post
     `reopenShow` sends.
   - **The first finalize's values are not preserved anywhere readable.**
     `reopenShow` deletes the rows; the last dump before it was 2026-08-16;
     the platform holds no backups; cron responses carry no points and are
     kept six hours; Postgres logs DDL only. The deleted row versions may
     still sit in the table (its last autovacuum was 2026-11-14 04:25 UTC),
     but reading them needs `pageinspect`, which is not installed and whose
     raw-page functions need a superuser, which the project's role is not.
     Not attempted.
   - **So whether any score moved is unknown.** What is known: the rows now
     stored equal a replay against the stored setlist and against that day's
     Carton, 19 of 19 both ways; picks were last saved before the cutoff; The
     Carton's row ids show no row added after the next night's show began.
     Bracket config, format and roster keep no history.
   - **A what-if scan, speculative:** of seven single Carton corrections
     tried, five would have moved no score; a "Debut" footnote later corrected
     to a first-time-played cover would have moved one sheet by 2 and left the
     laurel where it is; an encore first entered as part of set 2 would have
     moved four sheets by 3 each and changed the laurel. It says what the
     league admin's answer would imply, not what happened.
   - **The one surviving witness is the first Discord winner post**, which
     names the top scorer(s) and the top score. Compared with the second
     post, it answers whether the show's laurel changed hands.
   - **No record says who called either action.** `reopen` and `finalize`
     write no audit row. The identification above is the dev's, not the
     data's.
4. **Closing the reopen gap. DECIDED 2026-11-15 (the dev's calls), NOT
   BUILT.** Options 1, 3 and 4 are chosen, option 2 follows from option 1,
   option 5 is not chosen. The decision is at the end of this item; the
   paragraphs between were written earlier the same day, before it. The five
   options as they were put:
   1. Limit Reopen to Global, in the edge action and on the button.
   2. Rewrite the Reopen confirm text to state the policy and what a reopen
      destroys.
   3. Log `reopen` and `finalize` to `admin_audit_log`.
   4. Have `reopenShow` save the rows it deletes, so a reopen can be compared
      and undone.
   5. Refuse a reopen on a show older than the cron's one-day floor, unless
      Global.

   **The Reopen confirm text currently tells admins to reopen after a Carton
   correction** ("use this after correcting the setlist on The Carton, then
   Finalize once it's right"; `reopenShow` in `src/features/admin.js` as of
   `7361c72`, and the comment above it says the same). The dev's note: that is
   why it happened. The 2026-10-31 policy was recorded in this repo and never
   reached the UI or the league admins.

   Who can reach the actions today: the edge actions `reopen` and `finalize`,
   each behind `requireLeagueAdmin` (as of `b9f3ee6`: `_auth_player`, then
   `_is_league_admin_or_global`), so a league admin of that league or Global.
   In the UI: Admin tab → "Shows: cutoffs & finalizing" → Reopen on a final
   row, Finalize on a row past cutoff, for shows of the last seven days. Three
   accounts pass that guard in Green Eggs. A direct request with a name and
   PIN reaches any show, with no seven-day limit.

   **Scope question, ANSWERED 2026-11-15 (the dev's call).** A read-only
   survey that day found the reopen-then-finalize remedy still written down
   for two different causes, a Carton correction and a scorer or deploy bug,
   and no record said whether `setlist-check.md` item 8 reached the second.
   The answer, at the weight given: **the 2026-10-31 rule (item 8: Carton
   corrections never go through reopen/finalize; the fix is targeted and
   logged) does NOT cover scorer or deploy bugs, and repairing a scorer or
   deploy bug is the dev's alone (Global).** It is recorded under item 8 as
   "Scope, 2026-11-15".

   **What that answer does not do.** It chooses none of the five options
   above; all five stay open. It changes no code and no copy: Reopen, its
   confirm text and the guard on the edge actions are exactly as they were,
   so a league admin can still reach both actions. It does not say how a
   scorer or deploy bug is to be repaired, only whose repair it is.
   *Superseded in part later the same day: the options have since been chosen
   (the decision below). Still true: no code and no copy has changed.*

   **The survey's nine passages are left as they are** (the dev's call,
   2026-11-15: not to be rewritten yet; per the dev, their rewrite comes with
   the dialog change, which is option 2 in the decision below). Listed here
   so the list does not live only in a conversation; nothing below was
   changed:
   - `src/features/admin.js`: `reopenShow`'s confirm text, and the comment
     above it. The comment cites `CLAUDE.md` for the workflow, and `CLAUDE.md`
     never held that wording.
   - `CLAUDE.md` → "Postgres / Supabase gotchas" → the ranked-choice deploy
     stub ("recovery is …").
   - `scoring-rules.md`, three: the "Already-finalized shows" repair path
     under the `slotDetermined` bullet; "Reopen is the only path back" under
     "Debut detection"; paragraph (b) under "OPEN RULES DECISIONS", which
     stands above its own 2026-10-31 decision.
   - `docs/history/2026-08-ranked-choice-deploy.md`, two: the "Recovery if"
     lines in the RESOLVED bullet, and the one in the VERIFIED bullet.
   - `docs/history/pre-2.0-pending-work.md`: the "Reopen button" bullet, the
     text the `admin.js` comment paraphrases.

   The same wording also sits in code outside that count: the edge function's
   header comment, the comments on `reopenShow` and the "Scores reopened"
   Discord post text (`index.ts`), a comment above `scorePicks`
   (`scoring.js`), and a comment in the unapplied Stage R.

   **DECISION 2026-11-15 (the dev's calls). NOT BUILT.**
   - **Option 1 CHOSEN: Reopen is Global-only.** The edge action refuses
     anyone else, and the button is hidden for non-Global admins.
   - **Option 3 CHOSEN:** reopen and finalize presses write a row to
     `admin_audit_log` (who, when, league, show).
   - **Option 4 CHOSEN:** reopen saves the score rows it deletes before
     deleting them, so a reopen can be compared or undone.
   - **Option 2 follows from option 1:** the confirm text gets rewritten for
     the one person who can still see it.
   - **Option 5 (the age limit): NOT chosen.**
   - **Finalize stays available to league admins;** routine hand finalizes
     are fine.
   - **Wanted live before the 2026-11-20 23:00 UTC cutoff.**
   - **NOT BUILT.** The survey and the change plan come next session,
     review-before-edit. Until it is built and live, "Who can reach the
     actions today" above still describes the app as it runs: a league admin
     can reach Reopen, and nothing logs either press.

   **For next session's survey: facts checked on 2026-11-15 and questions
   they raise. These are notes, not the dev's calls, and nothing in them is
   decided:**
   - `admin_audit_log.action` allows two values, `remove_account` and
     `adjust_verdict`, so option 3 needs new ones. That is a schema change
     (decision 2 at the top put the last one in a tracked stage, applied
     first).
   - The table's `target_id` and `target_name` are NOT NULL and describe a
     player. A reopen or a finalize has a league and a show and no player
     target.
   - Where option 4 keeps the rows it saves is not stated.
   - The live edge function is `829ca6a`'s. `main` carries three undeployed
     edge commits on top of it (`131bfd2` deploy A, `9a4d534` the 3-hour
     reminder, `efaafa3` the catalog sync fix), so a deploy from `main` ships
     all three with this change unless the work is branched from the live
     commit. `discord-routing.md` and `edge-function.md` hold the notes on
     that hotfix branch.
     - **Correction, 2026-11-16.** The note above is left as written; it
       was true on 2026-11-15 and is not now. The live function is
       `hotfix/reminder-catalog` at `0f889a8` (function version 35,
       deployed 2026-11-16): `829ca6a` plus the 3-hour reminder and the
       catalog sync fix, ported by hand. `main` is ahead of live only by
       deploy A's wiring (`131bfd2`), checked line by line that day; the
       one other difference is the `setlistCheck.js` import line, which
       names five exports on `main` and only `mapSongRows` on the branch.
       So a deploy from `main` would now ship deploy A with this change,
       and nothing else. Record: `edge-function.md`, 2026-11-16.
   - The 08:00 ET auto pass (`autoFinalize`) is not a press. Whether it is
     logged is not stated.
   - The "Scores reopened" Discord post text and the nine passages above
     describe the old workflow.
5. **Backups. Follow-up pending.** Found on 2026-11-15, nothing changed:
   - **Nothing schedules `dump.sh`.** No scheduled task on the dev's machine
     names it (36 non-Microsoft tasks listed), the database's one pg_cron job
     is scoring, and nothing failed, because nothing was ever set to run. It
     has been run twice: 2026-08-16, the day it was written, and 2026-11-15.
   - **Its table list predates `admin_audit_log` and the newer tables.** It
     dumps twelve of the twenty tables in `public`. Not dumped:
     `admin_audit_log`, `admin_signup_clears`, `banned_names`,
     `global_banned_names`, `realtime_pings`, `setlist_flags`,
     `sync_flag_clears`, `sync_state`. So the log row of this correction is in
     no backup.
   - **There is no PITR**, and the platform lists no backups
     (`supabase backups list`: empty).
   - The restore path is still untested (`backups.md`).
6. **ANSWERED 2026-11-15, closed: who finalized the 2026-11-14 show by hand
   at 11:51 UTC.** The dev says it was the same league admin who reopened the
   2026-11-13 show (item 3). **It was a routine hand finalize, not a
   problem.** The answer is the dev's; no record names the caller, and it
   covers that one press. The pattern it fits: ten of Green Eggs' eleven
   shows from 2026-10-15 to 2026-11-14 carry a finalize stamp at an hour the
   08:00 ET auto pass never runs, and the eleventh, 2026-11-13, lost its
   first stamp to the reopen. Row kept so the numbering holds.
