# 2026-10-15 — Wild Mountain Honey footnote change and the 2-point swing

> Historical record, written 2026-10-18 from a read-only investigation. `CLAUDE.md` holds a one-line pointer under the Stage B scoring-rules stub; the mechanics it exposed are recorded in `docs/decisions/scoring-rules.md` ("Debut detection — how it actually works" and "Known bugs — found 2026-10-18"). No player nicknames here, per the standing rule in Conventions.

## What happened

- **Show:** 1786387666, Buffalo Iron Works, 2026-10-15, cutoff 22:00Z, format `standard`, both leagues on the schedule.
- **The Carton edit:** the footnote on set 1 song 6, "Wild Mountain Honey", was changed after the show from `Debut` (with `isoriginal = 1`) to `FTP, Steve Miller Band cover` (with `isoriginal = 0`). Confirmed 2026-10-18 by reading the live `/setlists/showdate/2026-10-15.json` response and comparing it to the stored `setlist_songs` row, which still reads `footnote = "Debut", is_cover = false` (see bug (i) in `scoring-rules.md` for why the stored row never updated).
- **Effect on scoring:** debut detection is `/debut/i` over the footnote, so the song stopped counting as a debut and the show went from "has a debut" to "no debut this show". "FTP" matches nothing.
- **Who it reached:** exactly one pick in the whole show — one Green Eggs Official player's flat pick 1, the "Any Debut" wildcard, in bracket 3 (Green Eggs Official, slots mode, `flat_points` 2, `bonuses.debut` 10, `wildcards.debut` true).
  - **Before:** the wildcard paid `flat_points` = **2** ("a debut was played"). The 10-point debut bonus was never in play — it attaches only to a pick that names the actual song, and nobody in any bracket picked Wild Mountain Honey.
  - **After:** the wildcard paid **0** ("no debut this show"), which is what the frozen `scores.breakdown` now holds. The player's other five picks were all "not played", so the row total went from 2 to 0.
  - **Swing: 2 points, from the Any Debut wildcard.** Had the player named the song in a flat slot instead, the swing would have been 12 (2 + 10).
- **Nobody else affected.** No other pick in any of the four brackets named the song or the wildcard. The cover flip (`is_cover` false → true) reached nobody either: no `cover1` pick named the song and `bonuses.cover` is 0 in every bracket. Both Ambassadors brackets run ranked choice, where debuts and wildcards are suppressed at code level.

## Timing — caught by live rescoring, not by a post-finalize rescore

- League 2 (Green Eggs) was finalized **manually** at 2026-10-16 04:10:22Z (00:10 ET; `winner_sent` on its `league_shows` row). League 1 auto-finalized at 12:00:02Z (8 AM ET).
- The player's `scores` row was written at 04:10:21Z — the manual finalize's closing pass — with the "no debut" breakdown already in it. So The Carton's edit landed **between the row's first sync during the show and 00:10 ET**, while the show was still `live` and the cron was rescoring it every minute against the live Carton fetch. The finalize pass then froze that result.
- Had the edit come after 04:10Z, nothing would have moved: finalized shows are excluded from scoring (`eligibleLeagueShows`, `index.ts:372-376`), and only Reopen brings a league back.
- **The exact minute is not recoverable from the database.** `scores.updated_at` on every row in brackets 3 and 4 sits inside the 04:10:18–22Z finalize window, and both of bracket 2's rows sit at 12:00:01–02Z — every row is rewritten on every pass (bug (ii) in `scoring-rules.md`), so `updated_at` records the last pass, never the last change. The Supabase function logs for the cron are the only other place, within their retention window.

## Read path used, so the next investigation can reuse or avoid it

- Public reads with the anon key: `shows`, `setlist_songs`, `brackets` (config), and the `get_league_shows` RPC for both leagues. The live Carton setlist was fetched directly.
- `scores` and `picks` are not anon-readable. The Supabase dashboard was signed out, so the SQL-editor path (`monaco.setValue`, Tooling notes) was unavailable; the rows were read with `psql` using the connection string in the out-of-repo backups folder, with `set default_transaction_read_only = on` issued first so the session could not write. Every statement was a `select`; player names were replaced with role labels in the query itself and never printed. Same path the 2026-10-11 overlay investigation used.

## What it leaves open

The two rules questions — whether a cover's first performance ("FTP") should count as a debut, and whether finalized scores should move on Carton corrections — are recorded as undecided under "OPEN RULES DECISIONS" in `docs/decisions/scoring-rules.md`, for the admins to weigh in on.
