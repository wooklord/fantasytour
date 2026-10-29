# Unauthenticated edge actions: the CRON_SECRET dual-path decision

> Extracted verbatim from `CLAUDE.md` at commit 54a5ab8 (2026-10-18), original lines 3326–3428. Nested entries were de-indented to top level; wording is unchanged.
> Decision record — currently binding. `CLAUDE.md` holds only a pointer stub under the same entry name; this file is the full text and rationale.

**DECIDED 2026-08-17, NOT STARTED: `sync_shows`, `sync_songs` and `score` on
the carton-sync edge function are COMPLETELY UNAUTHENTICATED — anyone can
trigger cross-league scoring runs, season activations and Discord posts.**
The shape of the fix is settled; only the implementation is outstanding.
- **DECISION: dual path, and KEEP the three buttons.** A shared secret in
  the request, the cron's header block gains one line, `runEdge` sends it,
  and the Data section stays as-is (hidden from league admins, visible to
  global). **The buttons were explicitly kept** — the dev has used "Run
  scoring now" during an incident, and waiting on the cron with no override
  is worse than the abuse risk being closed.
- **HONEST SCOPE, per the dev: shipping the secret in the bundle means it
  is not a secret from anyone who reads the bundle.** This closes the
  trivially-discoverable-endpoint case, not a determined attacker. Recorded
  so nobody later mistakes it for real authentication.
- **VARIANT worth considering at implementation time, no extra work:** the
  browser path does not need the secret at all. `runEdge` can send
  `p_name`/`p_pin` from the session the way `finalize`/`reopen`/
  `cutoff_changed` already do, leaving the secret exclusively to the cron.
  `_auth_player` and `_is_league_admin_or_global` are already in the file.
  That removes the bundle-secret weakness above entirely and makes the UI
  path a real auth boundary rather than a speed bump.
- **REJECTED: dropping the buttons and going cron-only.** Considered, and
  it does not work as-is — "manual overrides for jobs the cron runs every
  minute" is true of `score` ONLY. See the cron findings below: nothing
  schedules `sync_shows` or `sync_songs`, so dropping those buttons removes
  the app's only way to acquire new shows or refresh the song catalog.
  (Scheduling `sync_shows` would make the cron-only version viable and is
  independently worth doing — see the zero-overlay finding — but it is a
  separate change and does not replace this decision.)
- **SCOPE ADDED 2026-10-11, HELD: schedule `sync_shows` hourly on the cron,
  AFTER the first Green Eggs show has scored cleanly.** Same change, not a
  separate one: the cron SQL is being touched anyway for the secret header,
  and an hourly `sync_shows` is what makes the "Sync shows" button a
  convenience instead of the only way a new show or a new league ever gets
  overlay rows (Green Eggs ran two months with none — see the 🚨 entry in
  Postgres/Supabase gotchas). Stage R seeds a league at creation; this
  covers shows that appear afterwards. **Do not implement or schedule
  before that first clean score** — the dev's explicit hold, so a scoring
  problem on opening night is never confounded with a cron change.
  **⚠️ SUPERSEDED 2026-10-25 by the daily in-tick show sync below (dev's
  call, settled in Chat).** The hourly cron-scheduled `sync_shows` will
  NOT be built. Reason: the daily sync runs the same acquisition path
  (new shows and overlay rows) once a day, which covers the need this
  item existed for; it halves Carton traffic against an hourly schedule;
  and it needs no cron SQL change, so the out-of-repo cron stays `score`
  only and the dev's hold on cron changes is never tested. The "Sync
  shows" button stays as the manual override. The `CRON_SECRET` dual-path
  decision above is untouched by this; it just no longer carries a
  sync_shows schedule with it.
- **LOCKED 2026-10-25 — daily in-tick show sync (new shows AND changes
  to existing ones). Settled in Chat the same day; its own batch, plan
  pending approval.** Trigger: a Suwannee date change was missed — the
  app kept the old date while The Carton had moved the show (root cause
  in the survey findings below). Guardrails locked first (same day):
  never modify a finalized show; never delete a show that disappears from
  Carton — surface it to admins; a date change posts the existing
  "cutoff changed" notification, not a new one.
  1. **Runs inside the existing `score` action, AFTER scoring, once per
     day, stamp-gated**, on the first tick after 09:00 America/New_York —
     the same Eastern gating `activateSeasons` uses. Wrapped so a Carton
     failure cannot reach the scoring path (scoring has already run; the
     sync's own errors are caught and logged, never thrown). **No new
     action, no cron SQL change.** This is what supersedes the hourly
     item above. The "Sync shows" button remains the manual override and
     runs the same code.
  2. **`syncShows` gains a diff step over the same newest-200 window:**
     per Carton `show_id`, compare `showdate`, `venue`, `city`, `state`
     against the stored row. **"Finalized" means ANY league has the show
     `final`**; a finalized show's global row is never updated, only
     flagged (shows are global, status is per league — the conservative
     reading is the only safe one).
  3. **New column `league_shows.cutoff_set_by_admin boolean`** — the table
     that holds `cutoff_at` — written `true` by `admin_set_cutoff`, in a
     new SQL stage (next letter after T). On a date change: a **derived**
     cutoff recomputes to the new date's default (6 PM venue-local), posts
     the existing cutoff-changed message per league, and resets
     `remind_sent`/`lock_sent` when the new cutoff is in the future (or
     the reminder and lock would never fire for the moved show); an
     **admin-set** cutoff stays and the show is flagged. **Rows predating
     the flag are derived iff the stored value equals the OLD date's
     default** — compared against the old date, never the new one.
  4. **An in-window id Carton no longer returns, dated today or later, is
     flagged, never deleted.** A re-create under a new id surfaces as
     "new" plus "vanished" together, so an admin sees the pair.
  5. **New nullable `shows.sync_flag text`**, rendered as a notice in the
     admin Shows section and cleared by an admin; a Discord post only
     where a league hook exists. Known, separate: Green Eggs posts
     currently route to the Ambassadors channel (`discord-routing.md`), so
     Ambassadors itself hears nothing until that item is done. **⚠️
     CORRECTED 2026-10-28 (dev's information): Green Eggs' posts reach
     Green Eggs' Discord, through the webhook built for Ambassadors.
     Ambassadors still hears nothing; it has no working channel.**
  6. **Recorded, NOT in scope of this batch:** `scoreShow`'s fallback to
     every setlist row for that date when the show id matches nothing;
     `cutoffChanged()` having no dedupe stamp.
  **BUILT 2026-10-26 — committed locally, NOT pushed; Stage U NOT applied;
  edge function NOT deployed (build order in the plan file).** What
  landed: `supabase/functions/carton-sync/showSync.js` (`dailyGateDue`,
  `diffShows`, `cutoffPlan`, `appendFlag`); `index.ts` (gate + stamps at
  the end of `scoreShows` on BOTH return paths — "no eligible shows" is the
  normal tick — in its own try/catch, reported as `daily_sync` in the
  response; `syncShows` now diffs, flags, moves derived cutoffs and stamps
  `ran_at`; `cutoffChangedMessage` factored out so the button and the sync
  share one wording); `sql/stage_u_show_sync.sql`; the admin notice +
  Clear (`clearSyncFlag`); `test/showSync.test.mjs` wired into `npm test`;
  `runSyncFlagScenario` in the harness. Deno type-check clean. Seven
  mutations, all caught: gate hour (1 check), finalIds check dropped (6),
  old default computed from the NEW date (5), vanished floor dropped (4),
  unchanged-row skip dropped (3), notice rendered unconditionally (3 per
  mode), Clear without the RPC (2 per mode). **Build-time calls beyond the
  plan — recorded so they are not later mistaken for Chat decisions:**
  (a) `diffShows` also returns `inserts`, so the whole write-set comes from
  the pure module; (b) `permalink`/`timezone` are "carried" fields: a
  non-final row is rewritten when only they differ (keeping today's
  self-healing refresh, which the plan's restriction would have silently
  dropped), a final row never is, and neither flags nor posts; (c) a null
  `cutoff_at` with a null flag is derived, not admin-set; (d) a recompute
  and the NULL-refill both write `cutoff_set_by_admin = false`, so a run
  that crashed mid-way retries identically, and overlay writes precede the
  shows upsert so a crash leaves the OLD date for the next run to re-find;
  (e) a newly recorded flag note ALSO posts to Discord — every league,
  first record only — because decision 5 says so even though the plan's
  step 3 did not list it; (f) an empty Carton page throws (abort, 30-min
  backoff) rather than flagging every upcoming show as vanished; (g) the
  gate formats the hour with `hourCycle: "h23"` rather than `hour12:false`
  (some ICU builds print midnight as "24", and 24 ≥ 9); (h) Stage R's
  INSERT now seeds the column itself, with a header note, rather than a
  note alone; (i) `admin_clear_sync_flag` logs nothing and returns
  `cleared:false` on an already-null flag, and `sync_flag_clears.cleared_by`
  is `on delete set null` because `global_boot_player` deletes `players`
  rows; (j) the counts gain `created`, and `flagged` counts notes newly
  recorded this run, not the diff's total. **Observed, not changed,
  mentioned once:** a date moved from the past into the future leaves an
  overlay already at `status = 'live'` as live; nothing resets it to
  upcoming. No decision was taken on it.
  **Observed 2026-10-26, not changed:** the admin Shows section lists shows
  from 7 days back (`renderAdmin`, `src/features/admin.js`) while the sync
  window reaches 14, so a flag on a show 8–14 days old is in the database
  but not in the panel; `select id, showdate, venue, sync_flag from shows
  where sync_flag is not null` is the authoritative view. Widening the
  panel to 14 days is a candidate for a later batch, not a decision.
  **BUILD PLAN — approved in Chat 2026-10-25, build starts 2026-10-26:
  `docs/show_sync_plan.md`** (full plan, the two approval decisions —
  `syncSongs` stays out of the daily run; `admin_clear_sync_flag` is any
  league admin or global, allow-plus-log — and the strict build order:
  Stage U applied by the dev → edge-function deploy → client push). The
  brief below is the pre-approval sketch, kept for the record:
  - Pure module `supabase/functions/carton-sync/showSync.js` (no Supabase
    client, same isolation as `scoring.js`) holding `dailyGateDue({ranAt,
    attemptedAt, now})`, `diffShows({incoming, existing, finalIds, today})`
    → {updates, flags, vanished}, and `cutoffPlan({overlay, oldShow,
    newShow, defaultOf, now})`; `index.ts` fetches, calls, applies.
  - Gate: Eastern hour ≥ 9, no `ran_at` on today's Eastern date, no
    `attempted_at` in the last 30 min; `attempted_at` stamped before the
    Carton call, `ran_at` only after success. Runs at the END of
    `scoreShows`, own try/catch, never throws; skipped on a live-burst
    tick (runs the next minute). The Sync shows button runs the same code
    and also stamps `ran_at`.
  - Stage U SQL: `league_shows.cutoff_set_by_admin boolean` (nullable;
    null = predates the flag; `admin_set_cutoff` sets true; sync inserts
    set false; Stage R's unapplied seed to set false), `shows.sync_flag
    text`, table `sync_state(key pk, ran_at, attempted_at, note)` (RLS on,
    no policies, anon/authenticated revoked), RPC `admin_clear_sync_flag`.
    No backfill. Apply Stage U BEFORE deploying the function.
  - Flags append with a separator and never re-add a note already
    present; a re-create pair (new id, same date+venue) is named in the
    vanished note. Derived-cutoff changes reuse the `cutoffChanged`
    message builder (factored out) and `pingRealtime` per league row.
  - Admin Shows section: a `.noticebox` per flagged show with a Clear
    button (`clearSyncFlag` on `window`); `fetchShows` already selects
    every column.
  - Tests: new `test/showSync.test.mjs` (plain Node, wired into `npm
    test`) — derived cutoff moves + stamps reset + one post per league;
    admin-set stays + flag; null-flag equal/unequal to the OLD default;
    any-league-final → no update + flag; vanished → flag, no delete, pair
    named; empty set → zero writes/posts; gate cases with injected `now`
    (08:59, 09:00, ran today, ran yesterday, failed 10/31 min ago, a DST
    day). Harness: flagged fixture renders the notice, clear removes it,
    no flags → no notice.
  **Open before build (dev's call):** (1) should the daily run also call
  `syncSongs`? Plan assumes NO (not in the locked list). (2) should
  `admin_clear_sync_flag` require global admin? Plan assumes any league
  admin, since the show is global.
  **Survey findings 2026-10-25 (read-only, `index.ts` as committed):**
  nothing runs `sync_shows` automatically — the cron body is `score` only,
  the button is the sole caller. `syncShows` keys on the Carton `show_id`
  (= `shows.id`) and its upsert DOES overwrite `showdate`/`venue`/`city`/
  `state`/`permalink`/`timezone` on an existing row, within its newest-200
  / 14-days-back window — but the per-league `cutoff_at` refill is
  NULL-only, so a moved date leaves every league's cutoff on the OLD date,
  and nothing compares, logs, notifies or resets `remind_sent`/`lock_sent`.
  `cutoffChanged()` posts to Discord only (no in-app ping), has no dedupe
  stamp, and fires only from `saveCutoff`. A derived cutoff is NOT
  distinguishable from an admin-set one (no flag; only a comparison with
  `default_show_cutoff`). A show missing from Carton is never noticed.
  `scoreShow` fetches the setlist BY `shows.showdate`, with a fallback to
  every row for that date — so a stale date also fetches the wrong
  setlist. No write path checks `status = 'final'`. Design options and
  tradeoffs were given in Chat the same day; decided as the LOCKED list
  above.
- **PRIORITY: below gate items #1 (login rate-limiting) and #2 (`ft_session`
  plaintext PIN).** Those yield account and admin takeover — persistent,
  silent, targeted. This one yields availability degradation only: no data
  exposure (responses carry counts and ids), no persistence, no privilege
  gained. It is NOT a Pre-Session-5 gate item and does not block the
  Facebook League launch. It has the best effort-to-risk ratio on the list,
  so do it opportunistically ahead of the bigger security work purely
  because it is cheap.
Distinct from the three authenticated actions beside them: `reopen`,
`cutoff_changed` and `finalize` each call `requireLeagueAdmin`. These three
call nothing.
- **Verified, not inferred.** There is no auth check of any kind in
  `index.ts` for them — the only `Deno.env.get` calls in the file are
  `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and the Discord webhooks.
  There is **no `supabase/config.toml` in the repo**, so `verify_jwt` is
  not pinned in version control and its state is dashboard-only. Probed
  live: with **no key at all** the endpoint returns HTTP 500 carrying our
  own router's `{"ok":false,"error":...}` body — i.e. the request reached
  our code rather than being rejected by the gateway.
- **The router defaults unknown actions to scoring.** `else out = await
  scoreShows()`, and the body parse falls back to `{action:"score"}`. So a
  malformed or unrecognised POST runs a full scoring pass. Confirmed by
  accident while probing — an invalid action returned 200 having actually
  scored. **Do not probe this endpoint casually; there is no dry-run.**
- **The function runs as `SUPABASE_SERVICE_ROLE_KEY`**, bypassing RLS, which
  is why one call writes across every league.
- **What is NOT at risk, checked rather than assumed:** Discord spam is well
  guarded. `announcements()` filters on `.is("remind_sent", null)` /
  `lock_sent` / `winner_sent` and stamps after posting; song-by-song posts
  diff against `prevSet`; `notifyLeague` early-returns on an empty message.
  Repeated calls do not duplicate announcements. Responses carry only counts
  and ids — no player data. Scoring races converge (values are recomputed
  deterministically, the roster write is `ignoreDuplicates`, the stamp is
  idempotent).
- **The real risk is THIRD-PARTY rate limiting.** Every scoring pass on a
  live show hits The Carton's API, `BURST_POLLS` makes several per
  invocation, `sync_shows` pulls 200 shows and `sync_songs` the whole
  catalog. The Carton is a free keyless public API the entire app depends
  on — getting throttled or blocked there is an outage that cannot be fixed
  from this side. Secondary: Supabase invocation quota.
- **THE OBVIOUS FIX DOES NOT WORK, so don't reach for it: you cannot add
  `requireLeagueAdmin` to these.** They are unauthenticated *because the
  cron invokes them* and the cron has no player identity. Gating on
  name/PIN would silently stop all scheduled scoring. Equally, the admin
  buttons cannot carry a shared secret — the frontend ships to browsers, so
  embedding one republishes it.
- **The shape that works is a dual path:** accept EITHER a `CRON_SECRET`
  env value OR valid name/PIN with a global-admin check, with `runEdge`
  sending credentials the way `finalize` already does (`_auth_player` and
  `_is_league_admin_or_global` are already in the file). Cost is small in
  code — **but it needs a cron SQL update, and the cron schedule is NOT in
  this repo.** It lives in the database (pg_cron/pg_net), the same
  out-of-repo place that already holds the anon key in its Authorization
  header. That makes a third thing to keep in sync, and a botched update
  stops all scoring silently.
- **Mitigation already in place is presentation only:** the Data section is
  hidden from non-global admins as of 2026-08-17. That removes the
  affordance, NOT the capability — `runEdge` is on `window`, and the
  endpoint answers anyone holding the publishable key. Do not mistake the
  hidden section for a fix.
- Same class as Pre-Session-5 gate item #1 (login rate-limiting) — a public
  endpoint with no throttle — but much smaller work, and the abuse here
  costs availability rather than accounts.
