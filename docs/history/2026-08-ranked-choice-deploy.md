# 2026-08-14/15: ranked-choice deploy batch and first production run

> Extracted verbatim from `CLAUDE.md` at commit 54a5ab8 (2026-10-18), original lines 1374–1650. Nested entries were de-indented to top level; wording is unchanged.
> Historical record — resolved, closed or superseded. Kept for its method and evidence. Not a current instruction.

- **✅ RESOLVED 2026-08-14 — ranked-choice deploy batch is complete and
  verified end to end. No action outstanding.** Kept rather than deleted
  because the failure mode it describes is the thing to check first if
  ranked scores ever look wrong.
  - **What was done**: `supabase functions deploy carton-sync
    --project-ref zdfhglvjxquvkjyvophz`, then
    `sql/stage_o_ranked_submit_picks.sql`. In that order, deliberately —
    deploying the scorer first is inert (`submit_picks` still rejected rank
    slots, so no ranked picks could exist for the new path to see, and
    slots-mode output is byte-identical), whereas applying Stage O first
    would have let ranked picks accumulate against a scorer that scored
    them wrong.
  - **Deploy verified against the real condition, not a proxy**: the
    deployed source was pulled back with `supabase functions download` and
    diffed — byte-identical to the committed files, with
    `scoreRankedPicks` and the mode dispatch present. (An earlier plan to
    check for `season_activation_failures` in the response would NOT have
    worked: that key was introduced by the *previous* deploy and was
    already live, so it discriminates the wrong thing. Also note
    `supabase functions invoke` does not exist in CLI 2.109.1 — call the
    function over HTTP the way the cron does.)
  - **Verified end to end against the live database**, all three paths:
    a ranked save accepted (`rank1` = "Graceless" written, where the same
    call previously raised `Invalid slot: rank1`); the duplicate guard
    fired on a second "Graceless"; and a slots-mode Official save landed
    normally, confirming that path is unaffected.
  - **The hazard this entry originally recorded** (kept for diagnosis): a
    deployed scorer with no mode dispatch treats `rank1` as an unknown slot
    and falls through to the flat-pick branch, so **every hit pays
    `flat_points` (1) instead of its ladder value** — three hits scoring 3
    instead of 15, with no error raised and nothing visibly wrong. If
    ranked scores ever come out suspiciously uniform and low, check whether
    the deployed `scoring.js` actually contains `scoreRankedPicks` before
    looking anywhere else.
  - **Recovery if that ever happens**: `reopen` the show (wipes that
    league's scores, resets status to live), fix the deploy, then finalize
    again. Same repair path as the Boston 7/31 incident.
  - (`RANKED_CHOICE_ENABLED` was a third batch step until 2026-08-13, when
    it was set `true` and committed. It existed to stop a bracket being
    switched to a mode the live scorer doesn't run — Casual is already
    switched, deliberately, so the gate had nothing left to guard. Plain
    feature flag now.)
  - **The show**: 2026-08-14, The Pines Music Park, cutoff
    `2026-08-15T03:00:00Z`. (This line read "cutoff `23:00 UTC`" until
    2026-08-14; corrected against the live `league_shows` row. 23:00 was
    Eastern, not UTC — the real cutoff is 03:00 UTC the following day, i.e.
    23:00 ET / 22:00 at the venue, which is Central. Nothing downstream
    depended on the wrong value, but the ranked-run check below is timed
    off it, so it's fixed rather than annotated in place.)
    Nothing scores until it goes live (a show only scores once setlist rows
    appear or it's finalized), so this could sit overnight — the deadline is
    showtime, not the cron, which runs every minute regardless.
  - **What happens if the show goes live first**: the deployed scorer has no
    mode dispatch, so `"rank1" in slotPoints` is false and every rank-keyed
    pick falls through to the flat-pick branch — **each hit pays
    `flat_points` (1) instead of its ladder value.** For Casual's ladder
    `[6,5,4,3,2,1]`, three hits score 3 instead of 15. No error is raised
    and nothing looks wrong: plausible numbers, silently incorrect.
  - **Verified empirically against the deployed blob, not inferred** —
    extracted `scoring.js` at `1dec497` (the last commit touching it before
    the ranked work, and the build CLAUDE.md records as deployed) and ran
    Casual's real config plus rank-keyed picks through it. Output:
    `rank1 1 played / rank2 1 played / rank3 1 played`, total 3.
  - **Recovery if it does happen**: `reopen` the show (wipes that league's
    scores and resets status to live), complete the deploy batch, then
    finalize again — the corrected scorer re-scores from the setlist. Same
    repair path as the Boston 7/31 incident.
  - **Fastest mitigation if the batch can't be finished in time**: flip
    Casual's `config.mode` back to `"slots"`. The slots-mode config is fully
    intact underneath (`slots` still has 3 entries, `flat_picks` still 3) —
    only `mode` was changed. But note the 6 picks for that show were re-keyed
    from `opener`/`closer`/`encore`/`flat1-3` to `rank1..rank6` on
    2026-08-13, so reverting the mode alone leaves them unreadable by slot
    mode; they'd need re-keying back too.
  - This was the **second** item with a 2026-08-14 deadline, alongside the
    Test 3 roster check immediately below. Both landed that day and both are
    closed — see the DATED DEADLINES table. **A third 2026-08-14 item opened
    the same evening and is still open: the first-production-run check
    immediately below.**
- **✅ VERIFIED 2026-08-15 — FIRST PRODUCTION RUN OF `scoreRankedPicks` IS
  CORRECT. Show finalized 12:00:04Z; all five checks pass; no reopen needed.**
  Read from `scores.breakdown` directly, not inferred by comparing picks
  against the setlist. **3 players, 18 breakdown rows (3 × 6 — all three
  submitted complete sheets), 5 hits, 17 points across the bracket.**
  1. **Ladder values, per row — PASS, decisively.** Hits paid `rank1→6,
     rank2→5, rank4→3, rank5→2, rank6→1`: five hits, five *different*
     payouts, each its own rung. The flat-fallback signature would have been
     five rows all paying 1, so **`rank1` paying 6 is the specific
     observation that rules it out.**
  2. **Row order — PASS, but see the caveat below; it proves less than it
     looks.**
  3. **No "Any Debut" row — PASS.** Zero across all 18 rows; in fact zero
     non-`rank` rows of any kind. The mode dispatch suppressed the wildcard
     even though `wildcards.debut` is still `true` in Casual's live config,
     which is exactly why this (and not the absent cover/debut bonus lines,
     both configured 0) is the real dispatch tell.
  4. **Perfect sheet — PASS, correctly did NOT fire.** Zero bonus rows, and
     correctly so: the gate needs all six ranks filled AND every one hit,
     while the best sheet had 3 of 6. Confirmed from `breakdown` plus
     per-player hit counts rather than from the setlist.
  5. **Totals — PASS.** `scores.points` equals `sum(breakdown[].points)` for
     all three players (14 / 2 / 1), and those reconcile to the ladder:
     6+5+3, 2, 1.
  - **⚠️ CHECK 2 IS VERIFIED BY TEST, UNVERIFIED IN PRODUCTION — AND THAT IS
    LIKELY PERMANENT, NOT PENDING. Do not log it as an outstanding task.**
    All three players' rows were *stored* in `rank1..rank6` order, so DB
    order and rank order coincided and the run cannot distinguish a working
    sorter from no sorter at all: `breakdownSlotInfo`'s ranked branch could
    have been deleted entirely and the output would be identical.
    - **What would settle it: a show where stored row order differs from
      rank order.** That cannot be arranged — `scoreBracket` fetches picks
      with no `ORDER BY` (`index.ts:697`), so row order is whatever Postgres
      returns, which in practice follows insertion order, which follows
      sheet order. **It may simply never occur naturally.** Waiting for it
      is not a plan.
    - **The scenario suite covers it deliberately, for exactly this reason.**
      `test/fixtures.mjs:204-208` stores the scored show's breakdown rows
      shuffled — `rank3, rank1, rank5, rank2, rank4` — precisely because
      production wouldn't. Verified by mutation 2026-08-15: returning
      `{ order: [], label }` from that branch fails `frozen breakdown
      displays ranks in rank order, not stored order` in both modes, with
      the failure detail showing the shuffle leaking through as
      `["Rank 3","Rank 1","Rank 5","Rank 2","Rank 4"]`. The branch demonstrably
      works; only the *production* evidence is unavailable.
  - **Participation observation, not a correctness one: only 3 of Casual's
    members submitted at all.** First real data on whether ranked choice is
    something people actually fill in, and worth watching rather than acting
    on — one show, and the same evening carried a format toggle, an orphaned-
    pick incident and a mid-evening levelling, none of which make it a clean
    baseline. Note the three who did submit all filed **complete 6-row
    sheets**, so the partial-sheet case flagged as most likely to surprise
    never arose in production; it remains covered only by the scenario suite.
  - Original entry follows, kept for its method — the identifiers, the
    diagnostic tells and the recovery path are what made the check runnable
    months later without re-derivation. Written 2026-08-14 ~21:15Z, before
    the show, while the dev was at it and not thinking about this.
  - **Resolved identifiers, so nothing has to be re-derived under time
    pressure**: show id `1765912122` (`showdate 2026-08-14`, venue
    `The Pines Music Park`, `Eau Claire`/`WI`, `timezone America/Chicago`);
    Casual is bracket id `2`, league id `1`; `league_shows.cutoff_at` =
    `2026-08-15T03:00:00Z`; `league_shows.format` = **`one_set`** — **set by
    hand by the dev minutes before this entry was written; the show was
    `standard` until then.** Recorded as provenance, not trivia: "tonight
    happens to be a one-set show" and "the format was toggled immediately
    before the check was written" license different conclusions if something
    looks wrong. The first invites treating one-set as a given; the second
    makes the toggle the first thing to suspect. It also has a real
    consequence for the OTHER bracket on this show — see the Official
    orphaned-slots bullet immediately below, which this toggle created. Live
    Casual config at write time: `mode: "ranked_choice"`,
    `ranked.ladder: [6,5,4,3,2,1]`, `bonuses.perfect: 10`,
    `bonuses.cover: 0`, `bonuses.debut: 0`, `wildcards.debut: true`,
    `allow_duplicates: false`, `partial_credit: true`.
  - **The checks, and what each one actually discriminates.** Listed with
    their tells because two of the five look diagnostic and aren't:
    1. **Breakdown rows pay ladder values (6/5/4/3/2/1), not 1s.** A hit
       paying `1` where the ladder says `6` is the flat-pick-fallback
       signature — the deployed scorer isn't dispatching on mode. **Read
       this per-row, not as "is there a 1 anywhere"**: Rank 6 legitimately
       pays 1, so a lone 1 on Rank 6 is correct. The tell is **Rank 1
       paying 1**, or every hit paying the same value regardless of rank.
       Misses pay 0 in both modes, so only HIT rows carry any signal here.
    2. **Rows display Rank 1..N in order, not DB order.** This is a
       **render-time** property, not a stored one — `scoreRankedPicks`
       emits rows in whatever order `picks` came back from Postgres, and
       `breakdownSlotInfo()`'s ranked branch (`src/features/picks.js:104`)
       is what supplies the order at display time. So this check tests the
       frontend, not the scorer, and it reads `state.cfg` live: it would
       silently regress if Casual's `mode` were ever flipped back to
       `slots` with ranked rows still stored. The perfect-sheet `bonus` row
       isn't in the order list and correctly sorts last.
    3. **No "Any Debut" row anywhere in a ranked breakdown.** This one is
       the real mode-dispatch tell of the three bonus-related checks,
       because **`wildcards.debut` is still `true` in Casual's live
       config** — it's suppressed at code level by the ranked branch
       (`scorePicks`, `scoring.js:220`), not by config. If mode dispatch
       fails, the wildcard comes back. **By contrast, "no cover/debut bonus
       lines" proves nothing tonight**: `bonuses.cover` and `bonuses.debut`
       are both already `0` in Casual's config, so those lines would be
       absent even from a fully broken slots-mode fallback. Don't read
       their absence as evidence the mode dispatched.
    4. **Perfect sheet (10 pts) only if every rank was filled AND hit.**
       Gate is coverage of the distinct positions `rank1..rank6`, not a
       pick count, and the hit test is scoped to in-ladder rows only — so a
       stale out-of-ladder row can't block it, and a 3-pick sheet that goes
       3-for-3 must NOT collect it.
    5. **Total = sum of hit ladder values + perfect-sheet if earned.**
  - **`format` is `one_set` tonight, and that must NOT change anything.**
    Ranked mode ignores the `oneset` config section entirely (locked
    decision 3: fixed row count regardless of show format; the ladder lives
    at config top level). Verified in the source at write time — both
    `slotDefs()` (`picks.js:150`) and `breakdownSlotInfo()` (`picks.js:104`)
    return from the ranked branch *before* the
    `format === "one_set" ? cfg.oneset : cfg` selection, and `scorePicks`
    dispatches to `scoreRankedPicks` before any format logic. Worth
    knowing because Casual's `oneset` section still carries a stale 3-slot
    slots-mode config: if a 3-row sheet or opener/cover-shaped breakdown
    rows appear tonight, that section leaking through is the thing to look
    at first.
  - **Recovery if any of it is wrong**: unchanged from the batch above —
    `reopen` the show (wipes that league's scores, resets status to `live`),
    fix, `finalize` again.
  - **✅ ANSWERED 2026-08-15 — 3 Casual sheets, all complete, none partial.**
    Read after cutoff via the anon path described below (`get_show_picks`,
    `p_bracket_id: 2`), exactly as the method anticipated. All three players
    hold 6 rows, and the distinct slot keys across all 18 rows are exactly
    `rank1..rank6` — so this is the coverage check the bullet below insists
    on, not a row count that happens to equal 6: no stale pre-rekey
    `opener`/`flat*` key survives anywhere in the bracket, and every rank
    position is filled for every player. Official (bracket 1) read the same
    way at the same time: 8 players, 31 rows, keys exactly
    `closer/cover1/flat1/opener` — confirming the orphan deletion held (no
    `encore`/`flat2` anywhere) — with seven players at 4 rows and one at 3,
    i.e. one genuinely partial sheet.
    **What this does NOT establish: the five ladder/ordering/bonus checks
    above are still unverified** — those need `scores.breakdown`, which is
    not anon-readable. Only the sheet-shape question is closed here.
  - **Perfect-sheet bonus: did NOT fire, either bracket, 2026-08-15.**
    Established from public data rather than `scores`: every sheet's picks
    were compared against this show's 15 `setlist_songs` rows, and **zero
    sheets in either bracket had all of their picks played at all.** That is
    a strictly weaker condition than the bonus requires (in both modes the
    bonus needs every row to hit, and in slot mode `hit` is true even for a
    played-but-wrong-slot pick), so zero all-played sheets proves zero
    perfects without needing to read a single breakdown row.
  - **Original entry, superseded by the two above — kept for the method,
    which is still the right one for any future show.** Could not be read at
    write time: `get_show_picks` is the only public (anon-grantable) pick
    read and it returns nothing until `now() >= cutoff_at`, which was still
    ~5h45m out; `picks` has no public SELECT policy by design. Both
    confirmed empty by direct call, not assumed.
    - **⛔ THE ANON-KEY PATH DESCRIBED HERE NO LONGER WORKS — Stage P,
      2026-08-16.** This paragraph used to end: *"After 03:00Z the anon key
      can count it — `rpc/get_show_picks` with
      `{"p_bracket_id":2,"p_show_id":1765912122}`."* That call now fails:
      `sql/stage_p_get_show_picks_membership.sql` gave `get_show_picks` a
      `(p_name, p_pin, p_bracket_id, p_show_id)` signature, an
      `_auth_player` + league-membership gate, and dropped `player_id` from
      the payload in favour of a server-computed `is_mine`. **Losing this
      diagnostic was a known, accepted cost of closing gate item #7, not an
      oversight** — but the instructions are corrected here rather than
      left describing something that silently 404s.
    - **What replaces it**, in order of convenience: `admin_pick_status`
      (name/PIN, league admin — returns `picks_count` + `last_saved` per
      player, which answers the "did everyone submit" question directly);
      the Supabase SQL editor; or `get_show_picks` itself with real
      credentials, which still works and still reveals only after cutoff.
    - **Do NOT read a `PGRST202` from the old two-argument call as "the
      function is missing."** PostgREST resolves an RPC by the exact set of
      argument names in the body, so the old payload matches nothing now.
      That is a signature mismatch, not an absent function.
    - **Count distinct rank positions per player, NOT `count(*)`** —
      discipline item 5, and this is the exact shape it warns about. A
      player with 6 rows is not necessarily a full sheet: these picks were
      re-keyed from slot keys to `rank1..rank6` on 2026-08-13, so a stale
      `opener`/`flat2` row left behind would inflate a count while leaving
      a real rank position unfilled — and `scoreRankedPicks` scores exactly
      the coverage condition, not the count, so a count-based expectation
      would disagree with the scorer precisely in the partial-sheet case
      the dev flagged as most likely to surprise. Group by
      `slot in ('rank1'..'rank6')` and list which are missing.
  - **Casual's stored picks cannot have been disturbed by the format toggle
    — structural, but NOT empirically confirmed, and the difference
    matters.** `admin_set_show_format`
    (`sql/stage_n_reject_pending_pin_change_writes.sql`) is a single
    `update league_shows set format = ...` — it does not read or write
    `picks` in any branch, so no `updated_at` can have moved through that
    path. Ranked mode is separately format-independent at all three layers
    that could care: `submit_picks`'s ranked branch derives `valid_slots`
    from `cfg->'ranked'->'ladder'` and never reads `ls.format`,
    `slotDefs()`/`breakdownSlotInfo()` return before the
    `one_set ? cfg.oneset : cfg` selection, and `scorePicks` dispatches to
    `scoreRankedPicks` ahead of any format logic. **What was NOT done: the
    timestamps were not actually read.** Public pick reads are cutoff-gated
    (below) and `picks` has no public SELECT policy, so "unchanged" here is
    an argument from the only writer in that path, not an observation. If
    that distinction ever matters, read `updated_at` directly.
