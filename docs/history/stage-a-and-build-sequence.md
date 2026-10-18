# Launch reset, Stage A and the original 2.0 build sequence

> Extracted verbatim from `CLAUDE.md` at commit 54a5ab8 (2026-10-18), original lines 2573–2623. Nested entries were de-indented to top level; wording is unchanged.
> Historical record — resolved, closed or superseded. Kept for its method and evidence. Not a current instruction.

**Launch reset (agreed):** beta players know scores get wiped at launch. The wipe
keeps player accounts (names+PINs) but wipes all gameplay (picks, scores, seasons,
setlist data) and keeps the song catalog. This collapses the migration — no delicate
preservation. A **maintenance window is acceptable** (app goes dark between stages),
so NO compatibility-view scaffolding is needed.

**Stage A is already written**: `sql/stage_a_schema.sql` — one file that supersedes
`schema.sql` + all `add_*.sql`. It builds the tenancy tables, does the account-
preserving wipe, and seeds the "Ambassadors" league with Casual + Official brackets,
moving all current players in (grandfathered opt_in=true). Has a verification query
block at the bottom. RUN IT in a quiet window, snapshot first, then check the counts.

**Stage A has been run.** Verification initially showed `seasons = 1` instead of 0:
Section 3's `create table if not exists seasons` silently no-op'd because `seasons`
already existed pre-2.0 (from `add_seasons.sql`), so `bracket_id`/`roster_locked_at`
never got added and the old beta season row survived. Corrected with the one-shot
`sql/stage_a_fix_seasons.sql` (adds the missing columns, wipes `seasons` +
`season_rosters`, sets `bracket_id not null`) — already run against the live
database, don't run it again. `stage_a_schema.sql` itself is fixed for any future
run (drop-and-recreate `seasons`, matching picks/scores).

**Build sequence from here:**
1. **Done.** (Claude Code first jobs, BEFORE 2.0) Reorganize repo; split
   `index.html` into modules WITH a build step; verify GitHub Pages deploy
   still works; recreate the test harnesses. Get git history going. — see
   the Frontend bullet under "Current architecture" above for the resulting
   shape (`src/`, `build.mjs` → `app.js`).
2. **Stage A** — run `sql/stage_a_schema.sql`, verify counts. App goes dark here.
3. **Stage B** — edge function v7: global sync, per-league `league_shows` overlays
   with auto-defaulted cutoffs, the **season-activation step** that writes the frozen
   roster, and the scoring rewrite (one setlist fetch → each bracket under its own
   config; Official reads the roster). Fold in: v6 Cover Pick/wildcard, reopen +
   notification + winner_sent reset, slot labels, debut toast, the Discord
   broadcast/per-league notification rework.
3. **Stage C** — a full RPC rewrite in SQL (every function reworked for the
   Global/League/Bracket model — see design notes below), plus the frontend:
   league/bracket switcher, every screen scoped to current bracket, league-admin
   panel, Global-admin screen (create leagues, appoint admins, cross-league stats,
   nuclear boot). Carry over the cleaner admin show-row layout — **done in C2a**:
   `.arow`/`.arow-head`/`.cutoff-in`/`.arow-btns` (stacked date+venue / cutoff
   input / buttons, each row wrapping independently), replacing the shared
   `.showrow` single-line flex row that was overlapping buttons with venue
   text once too many controls got packed into it. (Despite the phrasing here
   suggesting this already existed somewhere — it didn't: git history has zero
   trace of `.arow` ever existing before C2a. Same false-memory pattern as the
   "collapsible sidebar" note elsewhere in this file; the fix was real, the
   prior existence wasn't.)
4. App back up; smoke-test **Ambassadors ▸ Official** + empty **Casual**.
5. Create the **Facebook League** via the Global screen, appoint its 2 admins (need to
   know who they are + whether they have beta accounts), they add ~50 players.
