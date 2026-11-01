# 2026-10-31 — Read-only survey for decision (2), the late-Carton-edit guard
> Purpose: ground truth for the Chat design that became `docs/decisions/setlist-check.md`, a guard against Carton edits after a show goes final. Read-only (no code, SQL, deploy or data changed); the report follows verbatim with the session scratchpad path redacted to <session scratchpad>; the prototype scripts it names are preserved untracked in .scratch/setlist-check-2026-10-31/. Source of the "Corrected 2026-10-31 (survey)" lines in docs/decisions/scoring-rules.md.

Survey complete. Report follows; every count is tagged, no player identifiers or pick contents appear, and no database connection was opened today (the env var is unset in the process, User, and Machine scopes, so DB counts come from the saved 2026-10-31 query output or are marked unknown).

**0. VERIFY THE PREMISES**

0a. Cited lines, all stale by +10 since `bb2dea4` (2026-10-31 14:42, Part 1 added 10 lines above them; verified with `git show a949ba3:…index.ts`, where 537/541-543/909/960 match the premise text).
- :537 → now `index.ts:547`. `eligibleLeagueShows()` selects `league_shows` with `status != 'final'`, cutoff set and passed. A final row is never selected, so the cron never refetches or rescores that league's copy. [code supabase/functions/carton-sync/index.ts:545-557]
- :541-543 → now :551-553. `floor` = (now − 24 h) as a UTC date string; the `shows` lookup is `.gte("showdate", floor)`, and :555 drops rows whose show fell outside it. A reopened row on an older show is therefore not rescored by the cron. Note the floor is a UTC date, not Eastern. The manual "Run scoring now" button takes the same path (`admin.js:519` → `index.ts:989`). [code]
- :909 → now :919. `scores.delete().eq("show_id", showId).in("bracket_id", bracketIds)` where `bracketIds` is every bracket of the calling league (:912-913). Reopen acts on EVERY bracket of ONE league; the other league's scores and status are untouched (:921-922 flips one `(league_id, show_id)` row). [code]
- :960 → now :970. `finalizeShow` calls `scoreShow(show, [lsRow], true)` with no date floor, then writes `status='final'` (:971-972). This is the only path that rescores a reopened show older than yesterday. [code]

0b. Where "final" lives.
- `league_shows.status` text, values `upcoming | live | final`, PK `(league_id, show_id)`: per show per LEAGUE, never per bracket. Both brackets of a league score under one row (`index.ts:829-852`). [code sql/stage_a_schema.sql:81-91]
- No `finalized_at`. Proxies: `league_shows.winner_sent`, stamped by announcements (c) within a minute of the flip (`index.ts:641-672`) and nulled by reopen (:921); `scores.updated_at`, which is the last pass (bug ii, `docs/decisions/scoring-rules.md:353-371`) and for a final show equals the final pass. [code]
- Writers: `autoFinalize` (`index.ts:571-583`: after 8 AM ET, every eligible row whose show is dated before today; before 8 AM, before yesterday) and the manual `finalize` action (:963-975; `src/features/admin.js:1394-1400`, league = `state.currentLeagueId`). `admin_set_show_status` was dropped (`sql/stage_c1_rpcs.sql:335-341`). Unapplied Stage R would seed `'final'` on league creation (`sql/stage_r_seed_league_shows_on_create.sql:135-139`). [code]
- Why Green Eggs finalized first: no per-league delay or cutoff setting exists; the gap is manual finalize vs the 8 AM auto pass. From the saved 2026-10-31 output, L2 `winner_sent` on 10-15/16/17/18/19/21 sits at 00:10–05:02 local (manual, post-midnight) and L1 at 08:00:01–08:00:04 (auto) on every one of them; 10-23 is reversed (L1 08:00 that morning, L2 20:23). [inferred] `docs/history/2026-10-15-wild-mountain-honey-footnote.md:18` records the same for 10-15 (04:10:22Z manual vs 12:00:02Z auto). [doc]

0c. Stored setlist rows.
- `setlist_songs(show_id, position, setnumber, is_encore, songname, is_cover, footnote, segue)`, PK `(show_id, position)`. No league column ("stays GLOBAL (keyed by show only)" `sql/stage_a_schema.sql:147`). No `inserted_at`/`updated_at`. [code sql/archive/schema.sql:43-52; sql/add_setlist_songs_segue.sql:8]
- Carton `uniqueid` is not stored: the mapped row at `index.ts:750-770` carries only those eight fields; the Carton row has 42 fields (list in §6b). [code]
- Stage U sync touches `shows` (showdate/venue/city/state/permalink/timezone/sync_flag) and `league_shows` cutoff columns only; zero references to `setlist_songs` in `syncShows` (`index.ts:233-440`). The ONLY writer of `setlist_songs` is `scoreShow` (:774-787), diffing position/songname/setnumber/is_encore/segue, never footnote/is_cover (bug i). [code]

0d. The 2026-10-31 re-derivation.
- Path: untracked, outside the repo, still present: `<session scratchpad>` holding `compare.ps1, uid.ps1, analyze.mjs, verdicts.mjs, verdicts2.mjs, official_check.mjs, q_overview.sql, q_anon.sql, q_allshows.sql, q_followup.sql, q_nostored.sql, carton_raw.json, stored.json, results.json, db_overview.json, db_anon.json, db_allshows.json` (13:19–13:28 local). `db_anon.json` holds anonymized pick data and was not opened.
- What it compared: `compare.ps1` reads `shows` and `setlist_songs` over anon REST for every 2026 show, one Carton GET `/setlists/showdate/<date>.json` per date (28), and diffs per position: songname (case-sensitive), setnumber, is_encore, segue, presence; not footnote/is_cover. `analyze.mjs` §E adds footnote/is_cover/debut-tag drift aligned by order; §D checks frozen breakdown rows against the Carton song set. `verdicts.mjs` takes every distinct `(show, bracket, slot, songname, hit, points, reason)` group of `scores.breakdown` elements with multiplicity `n` (`q_allshows.sql:14-18`), re-scores a one-pick sheet with `scorePicks` under TODAY'S `brackets.config` and the league's `league_shows.format`, `deriveSlotFacts(songs, true)`, and compares `hit` and `reason` after stripping " (no partial credit)" and " +cover"/" +debut"; points are not compared. `verdicts2.mjs` re-derives the slot-keyed rows of brackets 2 and 4 (ranked today) under a synthetic slots config. `uid.ps1` brackets the inserted row by uniqueid. `official_check.mjs` rescores bracket 1 with and without the inserted song.
- Scorer: imports the repo working-tree `scoring.js` by `file://` URL (`verdicts.mjs:4`). `scoring.js` last changed `65e989c` 2026-08-15, untouched by `bb2dea4`, working tree identical to HEAD; the deployed copy was `cmp`-identical on 10-28 and 10-31 (`docs/decisions/discord-routing.md:101-103, :202`). Repo copy = deployed. [code/doc]
- DB reads were SQL-editor responses (`rows[0].result` shape), not psql. [inferred]
- Carton GETs: 28 (`compare.ps1`) + 1 `/setlists/showyear/2026.json` + 17 `/setlists/uniqueid/<id>.json` (`uid.ps1:8, :20-22`) = 46. The node scripts ran offline from `carton_raw.json`.
- Runtime: not logged. File timestamps bound `compare.ps1` at ≤11 s (written 13:19:39, outputs 13:19:50); the whole pass ran 13:19 → 13:28.
- Result, re-run today against the saved inputs (read-only): 1,657 rows compared, 1,634 unchanged, 23 differ, 1 hit flip. The 22 non-flip differences are all slot-keyed rows in brackets 2 and 4 re-derived under those brackets' CURRENT ranked_choice config (reason "encore — exact" / "played, wrong slot" → "played"); `verdicts2.mjs` re-derives those 204 rows under slot rules and finds 204/204 unchanged. So "one change" is one hit flip; the doc's "only this one changes" (`scoring-rules.md:399-402`) omits the 22 mode artifacts.
- The one change: show 2026-08-14, bracket 2 (Ambassadors Casual), `hit` false→true and `reason` "not played"→"played". Points were not compared (the doc says 2 short).

**1. SCOPE INPUTS**

Source for every count here: the saved 2026-10-31 13:25 query output, which covers only 2026 shows that HAVE a stored setlist (`q_allshows.sql:1-4`). All tagged [inferred]; no [db] reads today.

1a.
- Shows with a stored setlist: 17 (2026-07-30 → 2026-10-23). `league_shows` rows on them: 24, all `final`: L1 17, L2 7.
- Final per bracket (status is per league): b1, b2 17 shows; b3, b4 7 shows.
- `scores` rows: b1 79 (9 shows), b2 34 (12), b3 166 (7), b4 13 (6) = 292.
- Verdict rows (breakdown elements excluding bonus): b1 428, b2 204, b3 947, b4 78 = 1,657. Bonus rows: 0.
- Oldest final show: 2026-07-30. Final shows dated ≥ 2026-10-01: 7.
- Past 2026 shows with NO stored setlist: 11 (07-04 → 07-26, pre-launch). Their `league_shows` status: unknown (`q_nostored.sql` output was not saved).
- Seasons per bracket, shows per season, closed vs active: unknown. Statements that resolve it:
```sql
select s.id, s.bracket_id, s.name, s.start_date, s.end_date, s.roster_locked_at, s.winner_sent,
       (select count(*) from shows sh where sh.showdate between s.start_date and s.end_date) as shows
from seasons s order by s.bracket_id, s.start_date;
select ls.league_id, ls.status, count(*) from league_shows ls join shows sh on sh.id = ls.show_id
where sh.showdate <= current_date group by 1, 2;
select bracket_id, count(*) from scores group by 1;
select s.bracket_id, count(*) from scores s, jsonb_array_elements(s.breakdown) e
where e->>'slot' <> 'bonus' group by 1;
```

1b. Everything is derived on read. `get_bracket_scores` returns raw `scores` rows (`sql/stage_c2a_fix_ambiguous_player_id.sql:25-44`); `computeStandings` sums career/scoped/shows/high/wins (laurels)/zeros client-side (`src/core/tiebreak.js:55-101`); ranks and ties at `src/features/standings.js:236-260`; stats columns at `src/core/stats.js:24-31`. The only stored items are stamps: `seasons.winner_sent` and `league_shows.winner_sent` mean "announced", not a stored winner (`index.ts:669, :700`). The Discord winner and podium text is computed at post time from `scores` (:657-663, :688-696) and never re-evaluated. A corrected `scores` row therefore reaches every in-app total on the next fetch; already-posted Discord results do not change. [code]

1c. No lock anywhere. Scoring picks the season by show date alone (`index.ts:867-870`). `admin_update_config` has no season check (`sql/stage_v_ranked_ladder_gate.sql:39-47` gates only the ladder). The only "season running" check is the opt-in lock (`sql/stage_n_reject_pending_pin_change_writes.sql:228-230`), which governs picks, not scores. `computeStandings` skips non-final rows (`tiebreak.js:68`); the champion post needs every show final (`index.ts:687`). Nothing refuses reopen or finalize on a closed season. [code]

1d. Read live, never snapshotted. `brackets.select("*")` at `index.ts:830`, `cfg = bracket.config` at :859, `scorePicks({cfg, format: lsRow.format})` at :894-896; `scoring.js:215-228` reads mode/slots/flat/partial/bonuses from it. `seasons` has no config column (`sql/stage_a_schema.sql:102-110`, `sql/stage_a_fix_seasons.sql:9-11`, no later alter). `league_shows.format` is the only per-(league, show) scoring input. [code]
Ambassadors Official test: bracket 1 today is slots mode, opener/closer/encore 5, cover1 (cover_pick) 3, partial 1, flat 2×2, bonuses debut 10 / perfect 10, oneset opener/closer 5, cover1 3 (saved config, 10-31) [inferred]. Its 79 frozen rows (9 shows, 07-30 → 09-04) re-derived under today's config produced 0 hit or reason differences (no b1 line in the `verdicts.mjs` output) [inferred]. Points would move: cover1 5→3 (`scoring-rules.md:419, :431-432`) [doc]. The 2026-10-26 restore returned b1 to its ORIGINAL slots mode (`docs/history/2026-10-26-empty-ranked-ladder.md:38`); no b1 scores were written during the empty-ladder interval (no b1 score writes after 09-04) [inferred], so no b1 row was ever scored under ranked.

**2. WHAT IS COMPARABLE**

2a. `scores(bracket_id, player_id, show_id, points int, breakdown jsonb, updated_at)`, PK `(player_id, bracket_id, show_id)` [code sql/stage_a_schema.sql:137-145]. Breakdown element `{slot, songname, hit, points, reason}` (`scoring.js:174-179, :238, :274`); bonus element `{slot:"bonus", songname:"Perfect", hit:true, points, reason:"every pick hit"}` (:198, :280). No matched-song field, no setlist position, no config version, no per-element timestamp.
- `slot`: pick key, config-independent; whether it counts as a slot depends on config (`p.slot in slotPoints` :234, with `sect` chosen by format :221).
- `songname`: pick text, config-independent.
- `hit`: config-independent in both modes. Every true branch requires the song in `played`, or `anyDebut` for the wildcard (:235-236, :245-248, :255-256, :258-259; ranked :173). It depends on the setlist, `norm()`, and nothing in config.
- `reason`: config-dependent (mode; `slotType` mapping :227, :241; partial-credit suffix :249-250, :263-264; bonus suffixes :271-272) and `isFinal`-dependent ("played — slot undetermined" :245-250).
- `points`: config-dependent (slot points, flat_points, partial_points, bonuses, ladder).
- bonus element: `cfg.bonuses.perfect` plus count (slots :277-281) or coverage (ranked :193-199).
- `scores.points`: the sum, config-dependent. `updated_at`: last pass (bug ii).

2b. Scoring inputs from Carton [code index.ts:744-770; scoring.js:21-85]: `position` (sort :749 → opener :33, second_song :45, show_closer :44, set closers :34, :40); `setnumber` (set grouping :27-32; `is_encore` via `/e/i` :754); `settype` (`/encore/i` :754); `songname|song` (`norm` :7-9, :35-47); `isoriginal` → `is_cover` (:756; `scoring.js:46, :55, :253, :271`); `footnote` + `footnotes[]` joined "; " (:757-758) → `/debut/i` at `scoring.js:47, :56, :83, :272` (and `index.ts:811` for the Discord tag). Exact strings recognized: none. The only pattern is the regex `/debut/i`; cover is never read from the footnote; "FTP" matches nothing (`scoring-rules.md:283-286`). Display-only: `transition` → `segue` (:759-769), zero references in `scoring.js`; a segue change cannot alter any slot assignment. One more input: the show-id filter with fallback to every row at that date (:745-746); 09-18 has two Carton shows at the date (14 raw rows, 2 ids in the saved results) [inferred].

2c. Still open: `sql/stage_o_ranked_submit_picks.sql:66` ("NOT changed here, deliberately"), `docs/module_b_ranked_choice_plan.md:977-992`; the live `submit_picks` compares `lower(item->>'songname')` (`stage_o:184-189`). The scorer's hit is `played.has(norm(p.songname))` (`scoring.js:243, :173`). A Carton rename flips a hit only if `norm()` of the new name differs from `norm()` of the pick: a spelling or word change flips; case, punctuation, diacritics and whitespace (the 07-30 trailing space) do not, since `norm` trims and collapses. The lower()/norm() gap matters only at save time (two near-duplicate picks both saved and both paid). [code]

2d. Stage U compares `showdate, venue, city, state` (locked) and carries `permalink, timezone` (`showSync.js:59-65, :96-122`). Flag notes: "Carton changed <field> (old → new); not applied — finalized in N league(s)" (:113); "Carton no longer returns this show (…); not deleted" (:135-137); "date moved …; <league>'s admin-set cutoff left at … — review" (:197). Stored in `shows.sync_flag` text, notes joined " · " with dedupe (`showSync.js:148-154`; `index.ts:310-317, :370-373`). Displayed at `src/features/admin.js:422-423` as `.noticebox.sync-flag` under the show row with a Clear button → `admin_clear_sync_flag(p_name, p_pin, p_show_id)`: any league admin or global, logs to `sync_flag_clears`, then nulls (`sql/stage_u_show_sync.sql:95-116`). Also posted to EVERY league's Discord on first record (`index.ts:374-378`). No acknowledge-without-clear, no snooze, no badge. [code]

**3. SURFACING**

3a. `docs/decisions/discord-routing.md:85-86`: "**D6, as recommended: one hint at a time.** The Discord hint never shows while the install bar or the welcome card is on screen." Not in code yet (Part 2). The install bar and welcome card live at `src/features/shows.js:102, :312-313` and `src/core/install.js`. No other file states the rule. [doc]

3b. Part 1 (built, live `bb2dea4` 2026-10-31; `discord-routing.md:126-135, :164-218`): edge only. `discord.js` resolves the league's own secret with no fallback (:42-46), sets the author name and `allowed_mentions: {parse: []}` (:59-65), sorts the HTTP status into ok/failed (:74-80), and `index.ts:94-105` logs a failure to console. Part 2 = Stage Y (`:253-308`, not built): `leagues.discord_status / discord_checked_at / discord_ok_at`, a daily webhook GET inside `dailyGateDue`, every post records its result, `my_leagues.discord_live`, a client hint bar and Settings switch. Admin-only destination: none exists and none is planned; the word "admin" appears once in the file, for the cutoff-changed post (:119); every post resolves to the league's single webhook (`index.ts:96`). The per-league webhooks are player-facing: the reminder names non-voters (:610-612), the lock post says "Boards are live in the app" (:632), winners and podiums are by nickname (:662-667, :695-697), and the sync flag goes to the same channel (:377). [code/doc]

3c. RPC `admin_list_unaffiliated_players(p_name, p_pin, p_league_id)` returns up to 50 rows newest-first with `created_at, has_played, cleared_at` (`sql/stage_x_signup_clear_and_remove.sql:91-112`). The count is client-side: `countRecent` (`src/core/signups.js:41-44`, cap → "50+" :46) with `NEW_SIGNUP_DAYS = 14` and `SIGNUP_SNOOZE_DAYS = 7` (`src/core/config.js:39, :45`). Calls: on load (`src/core/session.js:181` → `src/core/switcher.js:110-112`, only on mobile off the admin tab; otherwise the admin panel's `loadUnaffiliated` at `admin.js:561, :610-620` sets it), on every foreground (`src/core/realtime.js:110-116`), and on each admin-panel render. No polling. Snooze is server-side and per ADMIN: `admin_signup_clears(player_id pk, cleared_at)` (`stage_x:56-61`), written by `admin_clear_new_signups` (:115-128), returned on every row, applied client-side (`signups.js:30-38`). Gate: `isCurrentLeagueAdmin()` (`switcher.js:94-95`). Reusable: the shape (list RPC + client count + per-admin clear stamp) and the pill renderer (`switcher.js:113-119` via `renderHeaderChrome` :76-80). Not reusable as-is: the count is a `created_at` window, and the snooze keys on the admin, not on the item. [code]

3d. Only `admin.js:417-427`: a per-show notice inside the collapsible Shows section. Nothing on the tab, no count, nothing in Who's Picked or Members. Source is the public `shows` select (`src/core/leagueShows.js:12`). [code]

**4. CORRECTION**

4a. None. `scores` is written only by the edge function: upsert `index.ts:899-902`, delete :919. No SQL RPC writes `scores` (reads at `stage_c2a*`:40/68, existence at `stage_x:83`; the only insert is inside Stage X's rolled-back smoke test, :359). Admin UI: Reopen and Finalize (`admin.js:436-437, :1394-1420`), "Run scoring now" (:519, global only). `scoring-rules.md:303-306`: "There is no per-player or per-song correction." [code/doc]

4b. `sync_flag_clears(id identity pk, show_id → shows on delete cascade, cleared_by uuid → players on delete set null, cleared_at default now(), note text)` (`stage_u:82-90`). `admin_audit_log(id, logged_at, action check in ('remove_account'), actor_id uuid, actor_name, league_id, target_id uuid, target_name, target_created_at, detail jsonb)`, no foreign keys (`stage_x:64-77`), written only by `admin_remove_unplayed_account` (:151-152). PIN resets are NOT logged: `stage_x:45-46` ("resets and boots stay unlogged"), `stage_l_admin_pin_reset.sql` creates no table, commit `e319949` ("CORRECTION: no PIN-reset log exists"). Both tables have RLS on, no policies, anon/authenticated revoked: SQL-editor-only. [code]

4c. Changing one breakdown element's points by SQL:
- `scores.breakdown` element (`points`, and `hit`/`reason` if they are wrong too): stored, edit explicitly.
- `scores.points`: stored sum, must be edited in the same statement. Nothing recomputes it: the edge rewrites only on a scoring pass, which a final show never gets.
- `scores.updated_at`: stored, meaningless (bug ii).
- Per-show totals: these ARE `scores.points`.
- Season totals, all-time, avg, high, laurels, zeros, ranks, ties: derived on every board load (`tiebreak.js:55-101`). Nothing to do.
- Discord show-winner and season-champion posts: already sent, `winner_sent` stamped (`index.ts:669, :700`), never re-evaluated. A corrected result would need a manual post.
- Realtime: SQL writes do not touch `realtime_pings` (only the edge does, :117-126); open clients refresh on foreground (`realtime.js:110-116`) or reload.
- `_account_has_played`: existence only (`stage_x:80-86`).
- No cache tables. `test2-scoring-comparison.html` is a static historical file.

4d. Only in docs and git: `scoring-rules.md:373-428`, `docs/decisions/deferred.md:69-77`, commits `53d9867, 038264f, 792e48e, a949ba3`. `shows.sync_flag` for the 08-14 show was empty on 10-31 [inferred], and the sync cannot flag setlist content (§0c). No DB marker exists. [code/doc]

**5. SCHEMA AND NAMING**

5a. Migrations are flat files in `sql/`; there is no `supabase/migrations` (`supabase/` holds only `functions`). Stage files: `stage_a_fix_closer_label, stage_a_fix_seasons, stage_a_schema, stage_c1_rpcs, stage_c1_smoke_test, stage_c2a_fix_ambiguous_player_id, stage_c2a_rpcs, stage_c2a_smoke_test, stage_c2b_member_mgmt, stage_d_tiebreakers, stage_e_case_insensitive_auth, stage_f_official_default_optin, stage_g_pick_counts, stage_h_season_roster_names, stage_i_pick_status_alpha, stage_j_realtime_ping, stage_k_pin_management, stage_l_admin_pin_reset, stage_m_global_console, stage_n_reject_pending_pin_change_writes, stage_o_ranked_submit_picks, stage_p1_get_show_picks_membership, stage_p2_drop_legacy_get_show_picks, stage_q_unaffiliated_players, stage_r_seed_league_shows_on_create` (not applied), `stage_s_league_config, stage_t_name_length_cap, stage_u_show_sync, stage_v_ranked_ladder_gate, stage_w_vet_first_fast_path, stage_x_signup_clear_and_remove`; plus non-stage `add_setlist_songs_segue, add_shows_timezone, backfill_shows_timezone, fix_realtime_publication` and `sql/archive/`. Applied by pasting into the Supabase SQL editor with the footer run separately (`CLAUDE.md` "SQL: run in the Supabase SQL editor"; `stage_u:4-5`; `docs/show_sync_plan.md:35-36`). Stage Y reserved at `discord-routing.md:255-258` (commit `af56f96`), pointed at from `CLAUDE.md:216` and `onboarding.md:3`. Nothing in the database keys on the letter: no `schema_versions` or catalog table. Letter-keyed in the repo: file names, `test/stageW.test.mjs` and `test/stageX.test.mjs` read their SQL file by name (`stageX.test.mjs:22-23`), and `discord-routing.md:265-266` plans `test/stageY.test.mjs`. Z is unused: no `stage_y` or `stage_z` file exists, and "Z as of this writing" (:257-258) still holds. [code/doc]

**6. COST**

6a. Endpoints: `/shows.json?order_by=showdate&direction=desc&limit=200` (`index.ts:258`) and `/shows.json?show_tag=festival&order_by=showdate&direction=desc&limit=100` (:384): 2 Carton GETs per run, the festival call wrapped in try/catch. Gate: the `sync_state` row `daily_show_sync` (`ran_at, attempted_at, note`; `stage_u:68-79`) read by `dailyGateDue` (`showSync.js:38-54`: ET hour ≥ 9, no `ran_at` on today's ET date, `attempted_at` older than 30 min). `attempted_at` is stamped before the fetch (`index.ts:457-459`), `ran_at` only after every write (:436-437). A DB column, not memory. Skipped on live-burst ticks (:452, :734). The manual Sync shows button runs the same function and stamps `ran_at` (:224-226). Runtime is not logged; `note` holds counts only (:437). [code]

6b. Single show: `/setlists/showdate/<date>.json` (`index.ts:744`), which returns every show at that date (filtered at :745). Bulk: `/setlists/showyear/<yyyy>.json` and `/setlists/uniqueid/<id>.json` exist and work (`uid.ps1:8, :22`); the app does not use them. Payload, compact JSON from the saved 28 date fetches [inferred]:

| metric | value |
|---|---|
| bytes per date fetch | 4.2 KB min, 13.0 KB median, 23.2 KB max |
| rows per date | 5 to 27, 377 total |
| bytes per row | ≈0.85 KB, 42 fields |

Row fields: artist, artist_id, city, country, css_class, footnote, footnotes, isjam, isjamchart, isoriginal, isrecommended, isreprise, isverified, jamchart_notes, opener, original_artist, permalink, position, setnumber, settype, set_label, showdate, shownotes, showorder, showtime, showtitle, showyear, show_id, slug, songname, song_id, soundcheck, state, timezone, tourname, tour_id, tracktime, transition, transition_id, uniqueid, venuename, venue_id. None is a timestamp. The year-bulk payload size was not saved.

6c. Cron is every minute, `* * * * *`, defined in the database and not in the repo (`CLAUDE.md:40`; `docs/session5_plan.md:255`; `docs/decisions/cron-secret-edge-auth.md:256-260`). Idle tick: `activateSeasons` 1 select (:513-514), `eligibleLeagueShows` twice (:546-548, via :573 and :710), announcements 4 selects (:594, :620, :641, :676), `sync_state` 1 select (:454): at least 7 PostgREST queries, 0 Carton calls, 1,440 invocations a day. An eligible non-live show adds 1 Carton GET per show per tick; the live window runs 3 polls with 18 s gaps (:42-43, :721-724), about 36 s wall. Timing logs: none in the repo; cron responses (status and JSON body, no timing) sit in `net._http_response` (commit `b729076`). Runtime limit: `show_sync_plan.md:102-103` says "free-tier wall-clock budget is the one real limit" and no doc records a number. [code/doc]

6d. Arithmetic from §1a (final shows with stored setlists, one date each):
- (a) every final show: 17 GETs/day by date, or 1 GET/day via `/setlists/showyear/2026.json`. The whole 2026 past-show table is 28 dates.
- (b) last 30 days: 7 GETs/day.
- (c) active seasons: unknown (seasons not read). Formula: the sum over active Official seasons of final shows inside `[start_date, end_date]`; Casual has no seasons, so (c) excludes Casual entirely.
Each date GET is about 13 KB median.

**7. PREMISES THAT WERE WRONG OR STALE, AND UNKNOWNS**

Wrong or stale:
1. The four line numbers are stale by +10 since `bb2dea4`: 537 → 547, 541-543 → 551-553, 909 → 919, 960 → 970.
2. "Reopen wipes every bracket's scores for that show": every bracket of the calling LEAGUE only (:912-919). The other league's scores and status are untouched.
3. "Found one change": one HIT flip. The raw comparison shows 23 differing (hit, reason) pairs; 22 are mode artifacts in brackets 2 and 4 (ranked today), which a second script showed unchanged under slot rules. The doc's "only this one changes" is exact for `hit` and true for `reason` only through `verdicts2.mjs`.
4. "Audit log table(s) used for PIN resets": none. PIN resets are unlogged (`stage_x:45-46`, commit `e319949`).
5. "Carton edits after final: name fix on 07-30; segue change on 10-15": both are stored-vs-Carton drift with no scoring effect. 07-30 is a trailing space (norm-equal), 10-15 is a segue flag (display-only). Only the 08-14 insert is scoring-relevant. Their timing is inferred from the diff alone: songname and segue ARE in the live-pass diff, so a mismatch implies the change post-dates the last pass. No timestamp proves it.
6. "Daily show sync … once a day after 09:00 Eastern": also skipped on live-burst ticks, retried every 30 min after a failure, and a manual Sync shows counts as that day's run. It flags show METADATA only and never looks at setlist content.
7. "Stored setlist rows are shared across leagues": correct, with a consequence the premise leaves out. They are written only by scoring passes, so a show final in BOTH leagues never updates them, while a show final in one league keeps updating them until the other league finalizes. That is the window the 3 to 9 hour gap opens.
8. "uniqueid looks like an insert sequence": consistent with `uid.ps1`'s bracketing, but inferred, not proven. "No timestamps": confirmed from the 42-field row.
9. "Pre-restore shows" for Ambassadors Official: the 10-26 restore returned bracket 1 to its original slots mode; every frozen b1 row (last scored 09-04) was scored in slots mode, and the empty-ladder interval produced no b1 scores.

Unknowns, each with the read-only step that resolves it:
- Seasons (count, dates, active vs closed, shows per season): the `seasons` SELECT in §1a over psql read-only, or the no-auth RPC `get_bracket_seasons(p_bracket_id)` (`sql/stage_c2a_rpcs.sql:85-92`).
- `league_shows` status for the 11 pre-launch 2026 shows and any pre-2026 shows, and whether any `scores` rows exist on shows with no stored setlist: `q_nostored.sql` in the scratch folder, re-run.
- Year-bulk payload size: one `Invoke-RestMethod` of `/setlists/showyear/2026.json` and measure, or read its Content-Length header.
- Edge function wall-clock per tick: the Supabase function logs or metrics page (not in the repo), or bound it from `cron.job_run_details` start/end times (`select … from cron.job_run_details order by start_time desc limit 20`).
- Why L1's 10-23 row auto-finalized at 08:00 on 10-23 given the date rule at :572-576: implies the stored showdate was then earlier; `shows` keeps no history and Stage U (applied 10-26) post-dates the event. Unresolvable read-only.
- The Official cover1 5→3 change date: `brackets` has no `updated_at` (`stage_a:29-37`) and no config history exists. Unresolvable from the database.
- The second 09-18 Carton show absent from `shows`: `select count(*) from shows where id = 1789753018` (expected 0).
