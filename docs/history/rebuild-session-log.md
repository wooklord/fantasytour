# 2.0 rebuild roadmap: resolved decisions and session log

> Extracted verbatim from `CLAUDE.md` at commit 54a5ab8 (2026-10-18), original lines 2906–2928, 2984–3124. Nested entries were de-indented to top level; wording is unchanged.
> Historical record — resolved, closed or superseded. Kept for its method and evidence. Not a current instruction.

A personal task list compiled from conversation memory across sessions was checked
directly against the repo before any ordering happened — this project has already
hit the pattern of discussed-but-uncommitted work surviving as false memory, and
finished work surviving as "pending," twice (see the false-memory note earlier in
this file). Full verification detail lives in the plan file this was written from;
this is the condensed, durable record so the roadmap survives a context boundary.

**Resolved decisions:**
1. **Global console: minimal build only** — create league, appoint league admin,
   Global-scoped PIN reset. Deliberately no cross-league stats (nobody's asked for
   it, and it's a direct query away at two leagues).
2. **Per-league Discord webhooks: keep the env-var stopgap.** Not a blocker for a
   second league — see the corrected note above. A DB-column + admin-UI version
   stays deferred, folded conceptually into the Global console if that ever
   expands.
3. **Forgot-PIN: self-service change + an admin reset button**, with two hard
   requirements — the admin never sees/chooses the new PIN (server-generated,
   returned once for relay, never stored/logged in plaintext), and the relayed PIN
   forces a change on next login (new schema flag + a forced login interstitial —
   no precedent for this exists in the app today, size it generously). Guard:
   league admins reset only within their own league; Global resets anyone — reuses
   the existing `is_league_admin(league) OR is_global_admin` pattern, no new
   authorization architecture.

---

5. **Notification-preference toggle: deferred, confirmed separate work** from the
   toast fix above — the toast fix is a Supabase publication/config change with no
   `realtime.js` diff; a mute toggle needs new schema, a new RPC, and new
   `settings.js` UI that doesn't exist today. No shared surface worth bundling on.

**Session order** (dependency- and shared-surface-driven, not priority-driven):
- **Step 0, before Session 1:** this section itself, committed first, specifically
  so the roadmap can't be lost across a context boundary the way the work it
  describes already was once.
- **Session 1 — admin edge-action wiring: done** (commit `2816d66`). `cutoff_changed`
  is wired into `saveCutoff()`; the 500-vs-401/403 auth status codes are fixed and
  verified live against the deployed function (see the "Fixed" gotcha above).
- **Session 2 — pick-sheet & setlist surface: done, but not as planned above**
  (commits `2102a7b`, `8889bdc`). The debut GUI flag shipped exactly as described —
  same `is_encore` pattern, in both `realtime.js`'s live song toast and
  `picks.js`'s setlist view. The C2c tap-affordance tooltips did NOT ship as
  planned: the "ⓘ" was built, then removed one commit later for looking visually
  cluttered, and replaced with a different mechanism — "The Rules" card (see the
  rewritten tooltip bullet above), whose auto-generated half shipped in the same
  session. Its admin-authored custom-rules half followed as separate, unnumbered
  follow-up work (not part of the Session 1–5 batches below) — also now built, see
  the same bullet for the soft-cap numbers.
- **Session 3 — the ping table (decision 4): done** (commit `60f9372`; SQL
  deployed, edge function deployed, frontend pushed and confirmed live —
  all three legs of the deploy order actually completed, not just
  committed). See decision 4 above for what actually shipped —
  `realtime_pings`, `pingRealtime()` in the edge function, its own
  dedicated channel and `handlePing()` in `realtime.js`, and the two
  now-dead direct bindings removed rather than left in place.
- **Session 4 — auth + Global console: DONE, code and SQL both. ✅ Stages
  k/l/m/n verified live 2026-08-16** (steps 1-5, plus self-service PIN
  change pulled forward from step 6's original scope — see below).
  **This bullet read "SQL not yet run against the live database — that's
  the dev's next action, not done yet" until 2026-08-16; that was stale,
  and it mattered — it made the Global console look unusable and would
  have sent a Session 5 prep down a re-run path.** How it was verified,
  since "is this deployed" recurs: POST each RPC over the REST API with
  its EXACT parameter set and a deliberately wrong name/PIN.
  `global_find_players` (stage_m) and `change_own_pin` (stage_k) both
  returned `P0001 "Wrong name or PIN"` — i.e. they exist, are granted to
  anon, and reached `_auth_player` — where a missing function returns
  `PGRST202` instead. Stage_n rewrites bodies only, so it has no probeable
  signature; it's covered transitively, since stage_o applied cleanly on
  2026-08-14 and its `submit_picks` body calls
  `_reject_if_must_change_pin`, which would have failed to create had
  stage_l's helper been absent.
  - **The probe has one trap worth recording, because the first attempt
    hit it and read as "nothing is deployed."** PostgREST resolves an RPC
    by the exact set of argument names in the body, so sending a UNION of
    parameters across several functions matches NOTHING and returns
    `PGRST202` for every one of them — including functions that certainly
    exist (`my_leagues` returned PGRST202 that way). A `PGRST202` is only
    evidence of absence when the argument set exactly matches the
    function's own signature. Probe one function at a time.
  Ran in the manual-approval mode this bullet used to
  only describe: every SQL file was reviewed individually before the next
  was written, and two follow-up gaps the dev caught in review (the
  server-side bypass below, and the platform-logging caveat now in the
  Postgres gotchas section above) got fixed before this landed, not after.
  What shipped, in the order actually built:
  1. `runGlobalAdminScenario` (`test/harness.mjs`/`test/fixtures.mjs`) — a
     genuine `is_global_admin:true` session (`p4`), closing the exact blind
     spot this bullet used to warn about: every scenario before this one
     ran through the league-admin branch of `isCurrentLeagueAdmin()`, never
     the global-admin one.
  2. `must_change_pin` (`sql/stage_k_pin_management.sql`) + the forced
     interstitial (`renderForceChangePin()`/`submitForcedPinChange()` in
     `auth.js`, gated in `session.js`'s `boot()`).
  3. The shared reset RPC, `admin_reset_player_pin`
     (`sql/stage_l_admin_pin_reset.sql`) — reuses
     `_is_league_admin_or_global` per the locked design, plus an added
     target-membership check (the shared guard alone only proves the
     *caller* admins the league, not that the *target* is in it).
  4. The "Reset PIN" button in `admin.js`'s Members panel, wired only after
     2 and 3 were verified — the non-negotiable ordering held.
  5. The Global console: **not** a new nav tab — folded into Admin as one
     more `collapsible()` section gated on `is_global_admin` (a deliberate
     call, not the default; a real tab would have touched `index.html`'s
     nav, `layout.js`'s 3-column grid, and `dom.js`'s `$()` redirect logic
     for a screen used a handful of times a year). Wires up
     `global_create_league`/`global_appoint_league_admin` (which existed
     since Stage C1 with zero callers until now) plus one new RPC,
     `global_find_players` (`sql/stage_m_global_console.sql`) — needed
     because `admin_find_players` is league-scoped and excludes existing
     members, backwards for "promote someone already in the league."
  - **A real gap caught in review, fixed before commit, not after:**
    `must_change_pin` was, as first built, enforced only client-side —
    `boot()`'s gate is UI routing, not an authorization boundary, and
    nothing server-side stopped a relayed-but-not-yet-changed PIN from
    authenticating to every other RPC, including `submit_picks`. Closed in
    `sql/stage_n_reject_pending_pin_change_writes.sql`: a shared
    `_reject_if_must_change_pin(pl)` helper (defined in `stage_l`, called
    from every WRITE rpc immediately after `_auth_player`, reads left
    ungated on purpose) — 14 already-shipped write RPCs re-touched
    body-only (same idiom as `stage_d` re-touching `admin_set_season_roster`
    or `stage_c2a` re-touching `submit_picks`), each verified by mechanical
    diff against its live body to differ by exactly the one added line and
    nothing else. `login`/`change_own_pin` are the only two functions that
    must never call it — they're the only way out of the state it enforces.
  - **Run order is now `k → l → m → n`**, not the originally-planned
    `k → l → m` — `n` didn't exist until the review above surfaced the gap
    it fixes, and it depends on `l`'s helper.
  - **Self-service PIN change was initially deferred, then corrected back
    in before the SQL was run**: it was half of decision 3, not an optional
    extra — as first shipped, every PIN change routed through an admin,
    which was supposed to be the fallback path, not the only one. A "Change
    PIN" form now lives in `settingsPanelHtml()` (`changeOwnPin()`,
    `settings.js`), calling the same `change_own_pin` RPC the forced
    interstitial uses. **Login rate-limiting and the Official opt-in-default
    revisit stay genuinely deferred** — each gets its own follow-up session,
    see the two gotcha bullets above for why they weren't folded in here.
- **⚠️ 2026-10-11: the league created here ("Green Eggs") had NO
  `league_shows` rows for two months — no cutoffs, no picks, no scoring.
  See the 🚨 entry at the top of Postgres/Supabase gotchas before touching
  anything else about this league.**
- **Session 5 — Facebook League launch: PARTIALLY DONE 2026-08-16.** The
  league was created via the real Global console and the dev appointed
  himself to it; **no season, no other admin appointments, and the Discord
  webhook secret deliberately skipped** (nobody is in that channel yet, so
  misrouted announcements are noise nobody hears — see the accepted-risk
  record in `docs/session5_plan.md`). Remaining: appoint the two league
  admins, provision the webhook secret, smoke-test. **Appointing the two
  admins is now gated on the admin-tab reorg** (see below), at the dev's
  call — the panel is being reorganised before anyone who didn't build it
  is handed it.
  **See the PRE-SESSION-5 GATE immediately below — do not start the
  remaining work without walking that list.**
  - **🚨 Brief both admins on the reload requirement before they add a
    single player.** Every player added to a league must fully close and
    reopen the app before the league appears — nothing refreshes
    `state.leagues` in the background, and foregrounding the app runs a
    refresh that pointedly does *not* fix it. This will be the most common
    support question during recruitment and is invisible from the admin
    side. Full trace in "Multi-league switcher behavior" above.
  - Note the dev appointing himself set `is_league_admin = true` on his own
    row — **that is the only in-app way to join a league you aren't already
    in**, since the Members panel's add is hardcoded to
    `state.currentLeagueId` and the switcher can't reach a league
    `my_leagues` doesn't return. Not the same thing as the deferred
    appointments of the two outside admins.
