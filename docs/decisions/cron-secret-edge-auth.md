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
