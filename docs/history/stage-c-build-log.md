# Stage C design notes and build log

> Extracted verbatim from `CLAUDE.md` at commit 54a5ab8 (2026-10-18), original lines 2705–2873, 2881–2903. Nested entries were de-indented to top level; wording is unchanged.
> Historical record — resolved, closed or superseded. Kept for its method and evidence. Not a current instruction.

- **Scope correction: Stage C requires a full RPC rewrite in SQL, not just
  frontend work.** Every function needs reworking for the Global/League/Bracket
  model, guarded by the shared `is_league_admin(league) OR is_global_admin` check
  from spec §3. This was not previously scoped and is a substantial addition —
  Stage A only created tables and RLS, no functions, so every RPC from
  `schema.sql`/`add_*.sql` is still live against the old flat schema today.
  **Split into C1 (SQL, `sql/stage_c1_rpcs.sql`) and C2 (frontend)** — C1 fully
  done and run before C2 starts, since the frontend can't be tested against RPCs
  that don't exist yet.
- **Stage C1 is done (SQL written; run + smoke-tested by the dev).** Notable
  decisions baked into `sql/stage_c1_rpcs.sql`, not otherwise obvious from the
  spec:
  - League boot (`admin_league_boot`) is a hard delete of the `league_members`
    row only — picks/scores untouched. Ban is a separate `banned_names` insert,
    checked by the new `admin_add_league_member` RPC (necessary infra: without
    it, `global_create_league` + `global_appoint_league_admin` produce a league
    nobody can join). See the `league_members.banned` gotcha above.
  - `get_show_picks`/`admin_pick_status` join `players` directly for names
    (never gated on `league_members` still existing), so a booted player's
    frozen historical line still displays correctly.
  - `admin_set_show_status` was dropped outright, not carried forward or
    replaced — see the edge-function gotcha above for why.
  - `global_boot_player` is the only Global-exclusive nuclear boot (deletes the
    player account everywhere, cascading picks/scores/memberships via existing
    FKs); it's structurally distinct from league boot, not a superset built on
    top of it.
- **Stage C2a is done** — SQL (`sql/stage_c2a_rpcs.sql`, run + smoke-tested) and
  the frontend plumbing that brings the app back online: the league/bracket
  switcher (`src/core/switcher.js`, new `state.leagues`/`currentLeagueId`/
  `currentBracketId`), the shows+`league_shows` merge helper
  (`src/core/leagueShows.js` — `showState()` silently treated every show as
  perpetually un-open without it, since Stage A moved `cutoff_at`/`status`/
  `format` off `shows`), every RPC call site updated to Stage C1/C2a signatures,
  `admin_league_boot`/edge-function `finalize` replacing the two dropped RPCs,
  `realtime.js` rebuilt as a teardown-and-rebuildable per-bracket subscription,
  and the test harness rewrite noted above. C2b (admin surfaces) and C2c
  (polish) were separate, not-yet-started phases — C2b is now done (below);
  C2c remains not started.
  - The season editor is deliberately **not** bracket-switcher-scoped: it always
    resolves the current league's Official bracket id directly
    (`officialBracketId()` in `admin.js`), not `state.currentBracketId` — an
    admin looking at Casual still needs to manage Official's seasons, and
    seasons only ever belong to Official.
  - Pick-sheet drafts are now keyed by bracket too
    (`ft_draft_${sessionId}_${bracketId}_${showId}`) — the old key would have
    silently shown one bracket's in-progress draft inside the other's sheet.
- **Stage C2b is done** — member management admin surface, prompted by a real
  onboarding gap: a new player registered, hit "not in a league yet," and had
  to be added by hand via a raw RPC call because no admin UI for it existed.
  New SQL (`sql/stage_c2b_member_mgmt.sql`, run + smoke-tested): three
  admin-gated read RPCs — `admin_list_members` (replaces the C2a-era Players
  panel's app-wide `players_public` read, which listed every registered
  player regardless of league membership and let Boot fire against people
  who weren't actually in the league; this is also what restores the ★
  admin-badge marker C2a had dropped, since it carries `is_league_admin`
  again), `admin_find_players` (name-prefix search, min 2 chars enforced
  server-side, capped at 8 rows, excludes existing members — the discovery
  mechanism for "add a member"; accepted privacy tradeoff: a capped prefix
  search still allows slow enumeration by an admin iterating letters, judged
  acceptable given the small admin-adds-you trust model this app already
  runs on), and `admin_list_season_roster` (feeds the season opt-in-override
  UI; the mutation, `admin_set_season_roster`, already existed from Stage
  C1). All wired into `admin.js`'s renamed Members panel (`loadMembers`,
  `searchMembers`/`addMember`) and a per-season "manage roster" control in
  the Seasons panel (`toggleRoster`/`setRosterMember`). `admin_league_boot`
  and `admin_list_bans`/`admin_unban` needed no changes — both were already
  correctly wired to the league-scoped RPCs by Stage C1/C2a, confirm-text
  included.
  - Onboarding dead end fixed alongside this: `renderNoLeague()` in
    `src/core/session.js` now lists real league names (a free read off the
    public `leagues` table) instead of just "ask a league admin" with no way
    to know who that is. A fuller request-to-join flow was considered and
    deliberately not built — join-approval is already entirely admin-driven
    by design (FB league admins manually verify signups via Facebook
    comments), so a parallel request-queue would duplicate
    `admin_add_league_member` for no real gain at this scale.
- **The Global console never got a stage number, unlike C2a/C2b/C2c, and is
  genuinely not started.** Easy to misfile as part of C2b (member management)
  since both are "admin surfaces," but they're different scopes — C2b is
  entirely league-scoped. The screen described in the original build sequence
  ("Global-admin screen: create leagues, appoint admins, cross-league stats,
  nuclear boot") has no frontend counterpart anywhere in `src/`:
  `global_create_league`, `global_appoint_league_admin`, and
  `global_boot_player` exist only as SQL functions in `sql/stage_c1_rpcs.sql`,
  with zero callers. Today, creating a league or appointing its admin means
  invoking these directly in the Supabase SQL editor. See the "2.0 REBUILD
  roadmap" section below for the minimal-build decision (create league,
  appoint admin, Global-scoped PIN reset — deliberately not cross-league
  stats).
- **Official gating must BLOCK pick submission, not silently skip scoring —
  built.** `sql/stage_c2a_rpcs.sql`'s `_official_gate` (called by both
  `can_submit_picks` and `submit_picks`, one implementation) does both cases
  exactly as specified: checked against the SHOW's date, not today's
  (`_official_gate`'s `sh.showdate between start_date and end_date`, not
  `current_date`); falls back to the live `official_opt_in` flag only when
  `roster_locked_at is null` (season not yet activated), otherwise checks
  `season_rosters`. `submit_picks` raises on `not gate.ok` — a real block, not a
  silent skip. Frontend: `picks.js`'s `openShow()` calls `can_submit_picks` first
  and renders `renderIneligible(show, gate.reason)` instead of the pick sheet
  when blocked, pointing at Casual. Casual is unaffected (`_official_gate`
  returns `ok:true` immediately for any non-official bracket).
- **Admin warning: no season covering upcoming shows — built.** `admin.js`'s
  Seasons panel shows a warning (compact M/D dates, no cap on the list) for any
  upcoming show the Official bracket's seasons don't cover, rendered outside
  that panel's collapsible body so it's visible even when the section itself is
  collapsed. Since submission is blocked (not silently unscored) in that case,
  forgetting to create a season closes Official entirely — this warning is the
  mitigation.
- **Opt-in override — built, but one detail below has since changed.**
  `admin_set_season_roster` (Stage C1, re-touched by Stage D) lets a league
  admin add or remove any player from a running Official season's
  `season_rosters` directly — no check against `official_opt_in` at all, so
  this does cover someone who opted out before activation, as specified.
  Removal is confirmed to only stop future accrual, not touch history: the
  edge function's `scoreBracket` re-derives `allowedPlayerIds` from
  `season_rosters` fresh on every pass and only upserts scores for players
  currently in that set — there's no code path that deletes or rewrites a
  removed player's already-written `scores` rows, so past points stay frozen
  exactly as designed. **The "no audit trail" half of this note is now
  false** — `sql/stage_d_tiebreakers.sql` added `season_rosters.added_at`,
  stamped on every insert (both this override and the season-activation
  snapshot), built for a different reason (the "fewest zeros" tiebreaker
  needs a mid-season add's join date to scope zeros correctly) but a real
  timestamp regardless. "No standings indicator for it" is still true,
  though — `added_at` is only ever consumed as a scoring input
  (`rosterJoinDates` in `standings.js`), never rendered anywhere a player or
  admin would see it directly.
- **Player tooltips on pick-sheet slots — superseded by "The Rules" card, not the
  tap-affordance this bullet used to describe.** The plan here used to be: replace
  the pick sheet's `title=` attribute (useless on a touch device — no hover,
  long-press doesn't reliably surface it) with a tappable "ⓘ" next to each slot
  label. **That "ⓘ" was actually built (Session 2, commit `2102a7b`), then removed
  one commit later (`8889bdc`)** — it read as visually cluttering the slot labels,
  and was scrapped rather than iterated on. If you're reading an older copy of this
  note or working from memory: don't rebuild it, it was tried and rejected on
  sight, not abandoned half-finished.

  **What shipped instead: "The Rules" card.** A second `.sheet`-styled paper card
  renders below the pick sheet in `renderPickSheet()` (`src/features/picks.js`) —
  same cream-stock/tape/shadow treatment, but with its own fixed tape
  rotation/offset and card tilt (`.rules-sheet` overrides in `styles.css`) so it
  reads as a second sheet taped up separately by the same hand, not the pick
  sheet's own tape rendered twice. Two parts, both now built:
  1. **Auto-generated slot definitions — built.** One row per distinct label, read
     straight from `SLOT_TOOLTIPS` via the same `slotDefs()` the pick sheet itself
     renders from, so the card can't drift out of sync with whatever slots this
     bracket's config actually has active. A repeated slot type (two Cover Pick
     slots, say) or several flat picks collapse into a single row rather than
     repeating identical tooltip text. The points-per-slot note that used to sit
     under the pick-sheet inputs moved here too.
  2. **Admin-authored custom rules — built.** `custom_rules: string[]` on
     `brackets.config` (bracket-wide, same object `admin_update_config` already
     writes for `slots`/`bonuses`/etc. — not per-format the way `slots`/`oneset`
     are). Editable as repeatable rows in `admin.js`'s new "House rules"
     collapsible (`customRuleRow()`/`addCustomRule()`/`readCustomRules()`),
     positioned ahead of the two format-specific Game rules sections since this
     list applies to both. Soft cap: **10 rules, 140 characters each** — the
     `+ add rule` button disables itself at 10 rows (`checkRuleCap()`) rather than
     letting a save fail past the limit; `readCustomRules()` still re-slices
     defensively on read in case a value ever gets in past the input's own
     `maxlength`. Renders on the player-facing card as a "House rules" divider
     (reusing the same `.divider` style as the pick sheet's "Anywhere in the
     show" section) followed by a plain bullet list — omitted entirely, divider
     included, when the admin hasn't written any.

  Admin-side tooltips needed no equivalent fix and never did: `admin.js`'s
  `adminSlotRow()` already bakes `SLOT_TOOLTIPS` text directly into each
  `<option>`'s own visible label (confirmed in the source) — a different,
  already-working mechanism, not the same `title=` stopgap the player side had.

---

- **Standings default season selection — built.** `src/features/standings.js`'s
  `renderBoard()` implements this priority order:
  1. If a season is currently active (today inside its date range) → default to
     that season.
  2. Else if a season ended within the last 7 days → default to that just-finished
     season (grace period, so people can savor the result).
  3. Else → default to All time.
  If a new season starts during another's grace period, the new active season wins
  (checked first, so it always beats the grace-period branch). Replaced the old
  fallback-to-most-recently-created-season behavior, which left stale finished
  boards showing indefinitely between tours. In 2.0 this rule generalizes for
  free: Casual has no seasons, so it always lands on All time, which is correct
  since Casual is a perpetual tally. Covered by a regression check in
  `test/scenario.test.mjs`.
- **`players_public` no longer carries admin status — moot, not just done.**
  This bullet described a migration TODO for `loadPlayers()`, which read
  `p.is_admin` off `players_public` to show the ★ marker. That function no
  longer exists anywhere in `src/` (confirmed — zero matches for either
  `loadPlayers` or `is_admin`) — it wasn't migrated, it was replaced outright
  by Stage C2b's `admin_list_members`/`loadMembers()` (see that bullet above),
  which gets `is_league_admin` from `league_members` directly, exactly the
  source this note called for. Nothing left to do here.
