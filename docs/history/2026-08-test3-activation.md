# 2026-08-14: Test 3 season activation checkpoint

> Extracted verbatim from `CLAUDE.md` at commit 54a5ab8 (2026-10-18), original lines 1868–2043. Nested entries were de-indented to top level; wording is unchanged.
> Historical record — resolved, closed or superseded. Kept for its method and evidence. Not a current instruction.

- **✅ VERIFIED 2026-08-14: Test 3 activated cleanly — the roster fix works
  under a real conflict.** Result of the checkpoint below, which is kept for
  its method. `roster_locked_at = 04:00:04.757Z` (first cron tick after
  midnight Eastern, as expected — `activateSeasons` gates on Eastern date,
  not UTC), 14 rows total.
  - **All 13 hand-added rows kept their original `added_at`**, still
    spanning `08-13 02:55:08.612` → `02:55:23.981`. Nothing was rewritten to
    activation time — the highest-value assertion, and the specific
    regression `ignoreDuplicates` exists to prevent.
  - **The 14th row — the one member not on the roster before activation —
    inserted at `04:00:04.682`, i.e. 0.1s BEFORE `roster_locked_at`.**
    Two claims here, from two different sources, deliberately attributed
    separately: **which** account that was is a QUERY RESULT (direct query,
    2026-08-15 UTC, against `season_rosters` for season 8); that it is an
    unused test account and was left off the roster **deliberately** is the
    **dev's attestation** — no query can establish an account's purpose or
    an intent. Conflating those two is exactly how the wrong account got
    named; see the correction below. The sign matters:
    `activateSeasons` captures `joinedAt`, writes the batch, then stamps, so
    `added_at` preceding the stamp is the correct causal order. A row
    stamped *after* would be the old bug's signature.
  - **What this does NOT prove.** Today's run exercised the SUCCESS path
    under heavy conflict — the write succeeded, so the ordering held and the
    stamp followed it. The error path is still unexercised: no write failed,
    so "on failure, `roster_locked_at` is left null and the next cron run
    retries" has never actually run. That half of the fix remains verified
    only by reading the code. See the Deferred section for a unit test that
    would close it.
  - **This exercised the conflict branch at near-maximum** — 13 of 14 rows
    collided and were skipped, 1 inserted — which is the branch no test
    covers, since a clean fixture produces no conflict. The old bare
    `.insert()` would have aborted the whole batch on the first collision
    and stamped `roster_locked_at` anyway.
- **Method (retained): how the Test 3 activation check was constructed.**
  Resolved — see the VERIFIED entry above. Kept because the reasoning
  generalises to any future activation check. The Test 3 season was
  scheduled to activate
  2026-08-14. Traced the exact code before writing this checkpoint
  (`activateSeasons()`, `supabase/functions/carton-sync/index.ts:338-364`):
  `added_at` (line 349, `joinedAt`) and `roster_locked_at` (line 362) are
  two SEPARATE `new Date().toISOString()` calls in JS, with an awaited
  network round-trip for the roster upsert in between — not the same
  Postgres transaction, so don't check exact equality; allow a tolerance
  (recommend ~60 seconds — generous enough to absorb normal upsert latency,
  tight enough that a different cron run or a manual edit hours/days apart
  still fails the check).
  A second wrinkle: the fix above deliberately preserves a manually
  pre-added row's original, older `added_at` rather than overwriting it
  (`ignoreDuplicates`) — so a legitimately pre-added member's row is
  SUPPOSED to differ from `roster_locked_at`, and that's correct behavior,
  not a bug.
  **Which season id 8 is, since the whole verdict rests on that mapping and
  a bare integer asks a future reader to take it on faith**: it resolved
  from `select id, bracket_id, name, start_date, end_date, roster_locked_at
  from seasons` as `name = 'Test 3'`, `bracket_id = 1`, `start_date =
  end_date = 2026-08-14`, `roster_locked_at = null` — the only unactivated
  season of the three Test seasons on that bracket (ids 5 = "Test" and
  6 = "Test 2" were both already activated, with `roster_locked_at` stamped
  2026-07-30 and 2026-08-06 respectively; there is no slug column on
  `seasons`, `name` is the only human-readable identifier).
  **The roster was deliberately populated by hand on 2026-08-12, ahead of
  activation, so players could vote — which changes what Friday tests, and
  in a useful direction.** Exact state, verified after the manual adds:
  **13 rows, each with its own distinct `added_at`**, spread across 15.4
  seconds from `2026-08-13 02:55:08.612875+00` to `2026-08-13
  02:55:23.981966+00`. (That's UTC — 2026-08-12 ~22:55 Eastern. The rows
  read as Aug 13 in the database even though the work happened on Aug 12
  local; assert against the UTC values, not the local date.) Thirteen
  distinct timestamps rather than one cluster is exactly the signature of
  13 individual `admin_set_season_roster` calls — one per click — not a
  batch.
  **The conflict will be partial, not total, and the difference is
  load-bearing.** Activation's member set is 14: `league_members` where
  `league_id = 1` (bracket 1 is league 1's Official bracket),
  `official_opt_in = true`, `banned = false` → 14 of 14 total members.
  Compared both directions against the roster: **0 roster rows fall outside
  that set**, and **exactly 1 member of the set is not on the roster** — an
  unused test account. **Do not record which one here** — resolve it with
  the not-exists query above when you need it; see the standing rule in
  Conventions.
  So activation will attempt 14 rows against 13 existing ones: 13 conflict
  and are skipped with their original `added_at` preserved, and that 1
  inserts fresh at activation time.

  **⚠️ CORRECTED 2026-08-15 UTC — the paragraph that followed here is now
  HISTORICAL. Do not act on it.** It read: *"That 14th member is
  deliberately left off the roster, and should stay off until after
  2026-08-14 — this is intent, not an oversight to tidy up… Leave it alone
  until the checkpoint is resolved."* **The checkpoint IS resolved**:
  activation inserted that row at `04:00:04.682` exactly as predicted, and
  the account is on the roster now (`official_opt_in: true`,
  `banned: false`, roster total 14 — confirmed by direct query
  2026-08-15 UTC). The reasoning is preserved rather than deleted because it
  still explains *why* a 14th row was expected rather than anomalous — which
  is what makes the VERIFIED entry's "13 conflicts, 1 insert" readable at
  all. It is marked because, left unmarked, it reads as a live instruction
  to maintain a state activation already changed. **The substance of the
  reasoning, still true:** its absence was the only thing giving that run
  any coverage of the insert path; adding it early would have made
  activation 14-of-14 duplicates and silently deleted the insert-path and
  `added_at`-on-fresh-insert coverage while looking like a tidier roster.

  **What caused the correction, because the shape recurs and no existing
  discipline item covers it.** The account's *purpose* — "it's a test
  account, nobody is waiting to vote with it" — was **inferred from its
  absence from the roster**, then written with the same confidence as the
  timestamps beside it, which were **measured**. Only one of those was an
  observation. The inference happened to be correct, but the identical
  reasoning applied to a *different* account produced a wrong answer within
  minutes: a real player who had just submitted a partial sheet was floated
  as "probably the test account" on exactly the same grounds — absence from
  a set they were expected to be in. **Absence is evidence about a set,
  never about intent.** Discipline item 5 covers a count standing in for
  coverage; this is its sibling — an inference standing in for an
  observation. The defense is the same one item 6 prescribes: attribute each
  claim to its source at the moment of writing, as the VERIFIED entry above
  now does explicitly.

  **Friday therefore exercises the conflict branch at near-maximum
  (13 of 14 duplicates), the insert path (1 row), and the
  stamp-only-on-success ordering — all three in one pass**, which is a
  strictly better test than either a clean all-insert run or an
  all-duplicate run would have been.
  **Expected state after activation, as checkable assertions** (run these
  on 2026-08-14, don't eyeball a cluster):
  - **Success**: `roster_locked_at` stamped 2026-08-14; row count is
    **14**; the 13 original rows still carry their original `added_at`
    values inside the `02:55:08.61`–`02:55:23.99` UTC window above; and
    the test account's row carries a fresh `added_at` within ~60s of
    `roster_locked_at`.
  - **Batch errored**: `roster_locked_at` still null after 2026-08-14 —
    meaning the stamp-only-on-success ordering held (good) but the conflict
    branch did not (the thing to investigate).
  - **`ignoreDuplicates` not preserving `added_at`**: any of the 13
    original rows rewritten to the activation timestamp. **This is the
    specific regression the fix exists to prevent, and this run tests it
    directly** — it is the single highest-value assertion in this list.
  - **Batch aborted (the original failure mode)**: row count stays **13**
    — the test account never inserts — **and** `roster_locked_at` stays
    null. Note there is no "rows went missing" signature to look for and
    none is possible: nothing in this path deletes from `season_rosters`
    (the activation write is insert-only, and the only delete lives in
    `admin_set_season_roster`'s remove branch), so the 13 manually-added
    rows survive any activation failure. An abort shows up as *absence of
    the 14th row*, never as loss of the 13.
  **Within the edge function, nothing else writes those rows — checked
  because Test 3 has `start_date = end_date = 2026-08-14` and would
  otherwise activate and complete on the same day.** It can't: activation
  selects `start_date <= today` (`activateSeasons`, index.ts:341) while
  season completion selects `end_date < today` — strictly less than
  (`announcements` block (d), index.ts:504) — so completion for this season
  can't fire until 2026-08-15 at the earliest, and that `lt` vs `lte`
  asymmetry is the only thing separating them. Independently of the timing:
  **completion never touches roster data at all** — it writes only
  `seasons.winner_sent` (index.ts:527), and `season_rosters` is written in
  exactly one place in the entire edge function (the activation upsert,
  index.ts:353; the only other reference, index.ts:693, is `scoreBracket`'s
  read-only roster fetch), with `roster_locked_at` likewise written only by
  activation (index.ts:362).
  **But the edge function is not the only writer, and the other one is
  unguarded**: `admin_set_season_roster` also writes `season_rosters`
  (current live definition — `sql/stage_n_reject_pending_pin_change_writes.sql:223-239`,
  the latest of three re-touches), and it checks auth, league-admin, and
  `must_change_pin` — but **nothing about `roster_locked_at`**. It inserts
  with `added_at = now()` whether or not the season has already activated,
  and it's reachable by clicking (the Seasons panel's "manage roster"
  control, Stage C2b), not just by raw RPC. So a manual roster add *after*
  activation lands outside the cluster and is indistinguishable by
  timestamp from the failure this checkpoint is looking for. **On
  2026-08-14, rule out a post-activation manual add before calling an
  outlier a bug.** Recorded here so nobody re-derives it — and noting the
  shape, since it's the same one discipline item 5 exists for: "nothing
  else writes this" was true of the file examined and false of the system. Was supposed to be
  recorded and checked last session; wasn't — recorded now so it survives
  to whoever's driving after 2026-08-14.
