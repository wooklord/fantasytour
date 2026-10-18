# Dated deadlines: closed rows

> Extracted verbatim from `CLAUDE.md` at commit 54a5ab8 (2026-10-18), original lines 3134–3138, 3140–3158. Nested entries were de-indented to top level; wording is unchanged.
> Historical record — resolved, closed or superseded. Kept for its method and evidence. Not a current instruction.

| Date | Status | Item | Full bullet |
|---|---|---|---|
| **2026-08-14** | ✅ **DONE** | **Ranked-choice deploy batch** — carton-sync deployed, Stage O applied, verified end to end (ranked save accepted, duplicate rejected, slots-mode save unaffected) | "✅ RESOLVED 2026-08-14 — ranked-choice deploy batch…" in Postgres/Supabase gotchas |
| **2026-08-14** | ✅ **DONE** | **Test 3 roster check** — activated 04:00:04Z, 14 rows, all 13 originals kept their timestamps, the new row landed 0.1s before the stamp | "✅ VERIFIED 2026-08-14: Test 3 activated cleanly…" in Postgres/Supabase gotchas |
| **2026-10-14** | ✅ **DONE 2026-10-11** | **Green Eggs' first season starts — its 16 upcoming shows must have `league_shows` rows (with cutoffs) before then.** "Sync shows" pressed ~17:00Z after the read-only pre-sync check; verified: 16 rows, 0 null cutoffs, all `upcoming`, all flags null, cutoffs identical to league 1's for the same 16 shows; league 1 still 37 rows and unchanged; cron still "no eligible shows" | "🚨 FOUND 2026-10-11 — A NEW LEAGUE GETS ZERO `league_shows` ROWS" at the top of Postgres/Supabase gotchas |
| **2026-08-14** (checked 2026-08-15) | ✅ **DONE** | **First production run of `scoreRankedPicks`** — Casual, show `1765912122`, finalized 12:00:04Z. All five checks pass: ladder values per row (`rank1` paid 6, not 1), no Any Debut row, perfect-sheet correctly withheld, totals reconcile. Rank ordering passes but is verified by test only — see the caveat, it is not a pending task | "✅ VERIFIED 2026-08-15 — FIRST PRODUCTION RUN OF `scoreRankedPicks`…" in Postgres/Supabase gotchas |

**Every 2026-08-14 item closed.** The ranked-choice deploy batch met its hard
showtime cutoff (deployed and applied, verified end to end); the Test 3
roster check was verified at `04:00:04Z`; and the first production run of
`scoreRankedPicks` — added the evening of 2026-08-14, after the other two
closed, and unresolvable until the show actually scored — was checked against
`scores.breakdown` on 2026-08-15 and passed every check. Read the Status
column for what is currently outstanding rather than trusting this paragraph,
which describes one day's batch and will not be rewritten when the next dated
item is added.

One thing carried forward rather than closed, deliberately **not** logged as
an open item: the rank-ordering check is verified by the scenario suite and
cannot realistically be verified in production, because it needs stored row
order to differ from rank order and nothing in the pipeline produces that.
See the caveat inside the VERIFIED bullet — it is a permanent property, not
an outstanding task, and re-opening it as one would be re-deriving a
conclusion already reached.
