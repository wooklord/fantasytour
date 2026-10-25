# Official opt-in default (Stage F)

> Extracted verbatim from `CLAUDE.md` at commit 54a5ab8 (2026-10-18), original lines 2513–2548. Nested entries were de-indented to top level; wording is unchanged.
> Decision record — currently binding. `CLAUDE.md` holds only a pointer stub under the same entry name; this file is the full text and rationale.

- **Official participation is opt-IN**, and the toggle is **locked while a season runs**
  — no opting in mid-season. League admin can override.
  **⚠️ CORRECTION 2026-10-11: the Stage F paragraph below describes a
  change that was WRITTEN but NEVER APPLIED.** The live catalog has
  `column_default = false` on `league_members.official_opt_in` (read via
  `information_schema.columns`, 2026-10-11), and all 18 Green Eggs members
  carry `false`. Whether the Ambassadors backfill ran is moot (all 14 are
  `true`, but they were grandfathered `true` by Stage A anyway). So the
  default is still opt-OUT, exactly the "revisit before the semi-public
  league" state this bullet asked for — by accident, not decision. Same
  class as the Stage Q lesson: a stage file in `sql/` proves it was written,
  never that it ran.
  **✅ DECISION REAFFIRMED 2026-10-12 (dev): Official opt-in defaults to
  TRUE. Stage F stands as the fix and is item (e) of the post-first-show
  batch** (see the 🚨 entry's LOCKED item 6 for the catalog check that
  proves it applied). The "revisit before the semi-public league" question
  below is therefore answered, not reopened: the default is a conscious
  choice now, where before 2026-10-11 the live `false` was an accident.
  **Reversed for beta, Stage F (`sql/stage_f_official_default_optin.sql`):**
  `league_members.official_opt_in` now defaults to `true` (was `false`), and
  every existing row was backfilled to `true`, so `admin_add_league_member`
  (which inserts without specifying the column, relying entirely on the
  default) lands new members opted in automatically — no more flipping the
  flag by hand for every Ambassadors add. This is a beta convenience for a
  closed group the dev adds one-by-one; it does not touch the lock-while-a-
  season-runs rule, `admin_set_season_roster`, or the self-service opt-out
  RPC (`set_official_opt_in` — still correct, but **not actually wired to
  any frontend control**, so today there is no in-app way for a player to
  opt themselves out; only a league admin can remove someone from a running
  season's roster via the admin panel). **Revisit before the ~50-person
  Facebook League launches** — the original opt-in-by-default reasoning
  (participation should be a conscious choice for a pool of semi-strangers,
  not an assumption) still holds there, and stacks with the other
  known-not-scaled-past-Ambassadors gaps: the PIN-guessing surface and the
  lack of self-service PIN management (both noted below), plus the missing
  self-service opt-out UI this note just surfaced.

## Stage F apply decision — LOCKED 2026-10-24

**Apply BOTH statements of `sql/stage_f_official_default_optin.sql` (the
ALTER of the default and the UPDATE backfill), gated on one read-only
check.** The dev runs it; it is not applied from a session.

Reasoning:
- `set_official_opt_in` has no caller anywhere in `src/` and there is no
  opt-out UI, so every existing `false` row is the OLD COLUMN DEFAULT
  landing on an `admin_add_league_member` insert, not a choice anyone made.
  Backfilling them to `true` restores the intent the 2026-10-12
  reaffirmation already locked.
- The live Green Eggs Official season reads the frozen `season_rosters`
  snapshot (`_official_gate`, `sql/stage_c2a_rpcs.sql`), so the backfill
  cannot change who scores in live play. It affects only the live flag,
  which the gate consults solely for seasons not yet activated.

**The gate (ran 2026-10-24, read-only grep of `sql/` and
`supabase/functions/` for any statement writing `official_opt_in`):**
the column default (`stage_a_schema.sql:65`), the Stage A seed (writes
`true`), Stage F itself (writes `true`), and `set_official_opt_in`
(`stage_c1_rpcs.sql:308`, redefined `stage_n_...:232`), which writes
whatever boolean it is passed. Nothing writes a literal `false`. The one
caveat, stated at its weight: `set_official_opt_in` is granted to `anon`,
so a player with a valid name and PIN could have called it with `false` by
hand through the REST endpoint. No UI, no documented instance, no
evidence; recorded so the backfill is not later read as having erased a
choice nobody is known to have made. The edge function only reads the flag
(`index.ts:348`). **Gate passed; the file is to be applied whole, not split.**

Preflight before applying, so the before-count is on record:
`select l.name, count(*) from league_members lm join leagues l on l.id = lm.league_id where lm.official_opt_in = false group by l.name order by l.name;`
Related: `docs/decisions/onboarding.md` decision 5 (Stage F is Batch 2 of
the onboarding sequence).
