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
