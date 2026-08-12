# CLAUDE.md — Fantasy Eggy project playbook

This file is read automatically by Claude Code. It carries the full context of a
project that was built over many sessions in the Claude chat UI (single-file,
paste-based workflow) and is now moving into Claude Code ahead of a large
"2.0" multi-tenant rebuild. Read this whole file before touching anything.

---

## What this is

**Fantasy Eggy** — a fantasy-setlist game for fans of the jam band **Eggy**. Players
predict what songs the band will play in specific "slots" (opener, encore, etc.),
scores are computed automatically from the real setlist after each show, and there
are standings, seasons, an admin panel, and notifications. Think fantasy football,
but for concert setlists.

Sibling app: the "Ambassadors" tour-map PWA (separate project, same developer).

## Current architecture (pre-2.0)

- **Frontend**: split into modules under `src/` (`src/core/` for shared
  infra — state, Supabase client, theme, switcher, session, tiebreak, format,
  layout, realtime, dom; `src/features/` for the tab-level screens — auth,
  shows, picks, standings, admin, settings). `node build.mjs` (esbuild, no
  config beyond that script) bundles `src/main.js` into `app.js` + `app.js.map`
  at the repo root; `index.html` is now a thin ~50-line shell that loads
  `app.js` as a plain `<script src="app.js">` (no `type="module"`,
  no import maps). The old single-file monolith described below in some
  older notes is retired — see Stage C2a. **The bundle is checked into git
  and must be rebuilt (`npm run build` / `node build.mjs`) and committed
  alongside every `src/` change** — GitHub Pages serves whatever `app.js`
  is committed, it does not run a build step itself.
- **Backend**: **Supabase** (Postgres + Row Level Security + Realtime + Edge Functions).
  - Auth is **name + PIN** (no email/magic-link — chosen for reliability on venue
    LTE and for a friendly closed community). Writes go through `SECURITY DEFINER`
    RPCs that validate the PIN server-side; the anon key cannot write tables directly.
  - **Realtime** pushes score/show changes to open apps as toast notifications.
  - **Edge function** `supabase/functions/carton-sync/index.ts` (Deno) polls the
    setlist source, scores picks, and posts announcements.
- **Setlist data source**: The Carton's public Songfish API, `https://thecarton.net/api/v2`
  (no key). Returns `data.data` arrays; venue field names vary (`venuename`/`venue`).
  Debuts/covers come from footnotes / an `isoriginal`-style flag. `is_encore` is
  derived from setnumber/settype. IMPORTANT: closer/opener/etc. are **positional
  inferences** the scorer computes (e.g. closer = last non-encore song), NOT tags
  from the API — this matters for live vs. post-show labeling.
- **Notifications**: two channels — (1) in-app realtime toasts, (2) Discord webhook
  (secret `DISCORD_WEBHOOK`). Discord is broadcast (per-channel), so it can't do the
  "you haven't voted" personalization the in-app toasts do; it names non-voters
  publicly instead.

## Credentials

- Supabase project ref: `zdfhglvjxquvkjyvophz`
- Publishable/anon key: `sb_publishable_qN1goR6-Ss3cErnJJIJdKw_xr5nrFuo`
  — this is PUBLIC by design (it's in the deployed frontend JS). Safe to commit.
- The **service_role / secret key must NEVER** be committed or put in the frontend.
- The current `index.html` has these two constants filled in near the top of its
  `<script>` (`SUPABASE_URL`, `SUPABASE_ANON`).

---

## THE MERCILESS EDITING DISCIPLINE (hard-won — do not skip)

The single-file paste workflow caused real bugs. Even though Claude Code edits files
directly (lower risk), keep these habits:

1. **Assert before you replace.** Before any string replacement in a large file,
   confirm the anchor appears exactly once. A blind find-and-replace once landed a
   patch twice and broke the pick buttons; another time a mid-batch partial write
   shipped. Count first, replace second.
2. **Syntax-check after every edit.** The JS lived inside `index.html`; extract and
   `node --check` it (or lint the split modules once they exist) after each change.
3. **Boot the app in a harness to catch runtime throws.** There were jsdom harnesses
   (`/tmp/harness.js` mobile, `/tmp/harness_desk.js` desktop) that instantiate the
   app with a stubbed Supabase client and confirm it renders without throwing.
   `matchMedia` must be set on `window` in the harness. Recreate equivalents.
4. **Trace critical paths end-to-end after touching them** (tap-Pick → save;
   score update → standings; etc.). A valid-syntax, wrong-scope bug won't be caught
   by a syntax check — only by tracing.

**`test/compare.mjs` and `legacy-index.html` are retired (Stage C2a).** That harness
diffed the current build's rendered DOM against a frozen pre-2.0 monolith, to catch
accidental behavior changes during the `index.html`-splitting refactor — its premise
was "same behavior, different file layout." Stage C2 makes the app deliberately
different (league/bracket switcher, Official gating, bracket-scoped data), so
"identical to the old build" stopped being the thing worth proving; both files were
deleted rather than kept around as a stale "reference" someone could mistake for a
spec of the old flat schema.

**What replaced it: `test/scenario.test.mjs`**, run via `npm test`. Same underlying
mechanism as before (`test/harness.mjs` + `test/fakeSupabase.mjs` stub the Supabase
client and browser globals, then `window.eval()` the real bundled `app.js` through a
scripted user flow, with a `_emit()` hook to fake Realtime pushes) — the only change
is what the run is checked against: fixed expectations instead of a second run.
`test/fixtures.mjs` is the bracket-scoped fixture data (leagues/brackets/
league_members/league_shows/seasons/season_rosters/bracket-scoped scores) the fake
RPC handlers compute real join/gating logic against, not flat pre-2.0 stubs.
`test/scoring.test.mjs` is untouched by any of this — it tests `scoring.js` in
isolation against real Carton setlist fixtures, with no DOM/Supabase dependency.

**Known limitation, still true of the new harness:** it asserts DOM structure and
JS behavior — it is still blind to CSS (computed styles, cascade interactions
between dead and live selectors), external resource loading (fonts, the Supabase CDN
script), and anything in `<head>` that isn't reflected in DOM text. One real bug
already slipped past the old version this way: a dormant `.logo span` CSS rule
(never matched anything pre-split, since `.logo` had no `<span>`) went live and
broke the header title's font styling when a `<span>` was added to that element for
the `APP_NAME` work — a PASS the whole time, because the DOM text was unchanged.
Don't treat a scenario-test PASS as proof a frontend change is visually correct —
it only proves the DOM/JS behavior didn't change. Also worth remembering when
writing fixtures: build cutoff/date fixtures off the real wall clock (`Date.now()`),
not a hardcoded date — a fixed past "now" silently drifts into the past itself and
every show reads as already-locked regardless of what the test intends to exercise
(this bit the C2a rewrite once, caught immediately by the new fixed-expectation
assertions rather than staying invisible the way a diff-only check would have).

**Session-shape blind spot, found the hard way:** every scenario in `test/harness.mjs`
presets `p1` (Wooklord) — `is_league_admin: true` in the fixture — except
`runNonAdminScenario` (added after the incident below). That meant `isCurrentLeagueAdmin()`
was `true` in literally every test ever run for this app, so any bug that only
manifests for a genuine non-admin was structurally invisible to the whole suite, not
just under-covered. This is exactly how a real bug shipped and sat unnoticed until a
non-admin tester hit it live: `core/realtime.js`'s `refreshCurrent()` called
`renderAdmin()` directly instead of the role-aware `renderAdminOrSettings()` dispatcher
on the shared admin/settings tab — for an admin the two calls are equivalent, so it
looked correct in every admin-tested session; for a non-admin backgrounding the app
on Settings, it silently rendered the admin panel (and its admin-gated RPCs, which
then reject) instead. Fixed, and `runNonAdminScenario` (presets `p2`,
`is_league_admin: false`) now locks in both the initial Settings render and the exact
backgrounding/foregrounding regression.

**Other session shapes still not exercised by anything in this harness** — read this
before assuming a change is covered just because the suite is green:
- **A genuine global admin** (`is_global_admin: true`). No fixture player has this set;
  `p1`'s admin status comes entirely from `league_members.is_league_admin`. Right now
  the two produce identical rendering (both satisfy `isCurrentLeagueAdmin()`'s
  OR-condition, and nothing else in `src/` checks `is_global_admin` directly), so
  there's nothing currently divergent to miss — but any future Global-exclusive
  feature (cross-league stats, nuclear boot, the league-creation screen — none of
  which exist in `src/` yet despite being described in the spec) needs a
  global-admin session added to the harness from the day it's built, not after.
- **More than one league.** `renderLeagueSelector()`'s actual dropdown branch
  (`leagueIds.length > 1`) has never run — the fixture has exactly one league
  (Ambassadors), so the function always takes the "hide the selector" early return.
  Once the Facebook League is real, a player or admin in both leagues exercises the
  branch nobody's ever seen render.
- **A player who is NOT opted into Official / not on the season roster, blocked from
  submitting picks for that reason.** `p2`'s `official_opt_in: false` in the fixture
  has never been exercised through an actual login, and separately, the fake
  `can_submit_picks` handler in `harness.mjs` only models the "no season covers this
  show" rejection — it doesn't check `official_opt_in` or `season_rosters` at all. So
  even adding the session wouldn't currently prove the real roster-based rejection
  path works; the fake handler needs the same real-join treatment `get_bracket_scores`
  and `admin_list_members` already get before that's actually covered.

## Postgres / Supabase gotchas learned the hard way

- **pgcrypto lives in the `extensions` schema** on Supabase. Every `SECURITY DEFINER`
  function that uses `gen_salt`/`crypt` must `set search_path = public, extensions`
  or it throws "function gen_salt does not exist".
- **Finalized scores are frozen**: score `breakdown` text is written at score time and
  not recomputed once a show is `final`. So wording changes only affect
  future-scored shows. Display-computed things (like tie handling) fix retroactively;
  stored-at-score-time things don't.
- **The single global config** currently lives in a `game_config` table (id=1). In 2.0
  this becomes per-bracket `brackets.config`.
- **`shows.timezone`** (added via `sql/add_shows_timezone.sql`) holds each venue's
  resolved IANA zone, computed once server-side at sync time by the edge function's
  `resolveVenueTz(state)` (a null-capable sibling of the existing `venueTz`, which
  keeps its old fallback-to-Eastern behavior for computing default cutoffs — a
  different job than persisting a fact). **Null means the state genuinely didn't
  map** — not "assume Eastern." This exists specifically so the admin panel's Shows
  & cutoffs UI can display and edit cutoffs in real venue-local time (state→zone
  lookup was already duplicated once and almost got duplicated a second time into
  the frontend; this column is the single source of truth instead) — see
  `src/core/venueTime.js` for the conversion helpers and `admin.js`'s cutoff row for
  how a null falls back to device-local time with an explicit "timezone unknown"
  caveat, never a silently-guessed zone. Self-heals on the next sync if a venue's
  `state` gets corrected or `STATE_TZ` gains a mapping, same as `permalink`.
  **Adding this column didn't backfill existing rows**: `syncShows` only upserts
  shows inside its rolling 200-show/14-day fetch window — the same bound that
  already limits permalink corrections (below) — so any show that had already
  aged out of that window before this column existed stayed null and will never
  be touched by a normal sync. Fixed once via `sql/backfill_shows_timezone.sql`
  (computes the zone from `state` directly, same mapping, for whatever's still
  null). Worth remembering for any *future* column added to `shows` the same
  way: the fix needs its own one-shot backfill, adding the column alone won't
  reach shows already outside the window.
- **Realtime only pushes tables in the `supabase_realtime` publication**
  (currently `shows`, `seasons`, `setlist_songs`, `scores`, `league_shows` —
  adding another table requires `alter publication supabase_realtime add
  table <t>`) — **and subscribing to a table that ISN'T in it silently kills
  postgres_changes delivery for every OTHER binding on the same channel,
  not just that one.** `realtime.js` puts all four of its postgres_changes
  subscriptions (`setlist_songs`, `league_shows`, `seasons`, `scores`) on
  one shared channel (`live-${bracketId}`). `scores` and `league_shows`
  were silently missing from the publication (dropped or never re-added
  during Stage A's schema rebuild) — the actual, confirmed bug wasn't just
  "those two toasts don't fire," it was that the whole shared channel's
  postgres_changes registration failed, so `setlist_songs`'s song-by-song
  toasts and `seasons`'s winner toasts died too, despite both of those
  tables being correctly configured the entire time.
  **The channel still reports `SUBSCRIBED` when this happens** — that
  status only reflects the channel/socket join succeeding, not whether the
  postgres_changes registration behind it actually worked, so nothing in
  the client-visible state indicates a problem. Confirmed by direct
  isolation, not inference: an identical 4-binding channel reproduced the
  dead behavior, a channel with only the 2 valid bindings (of the same 4)
  delivered cleanly, and a single-binding channel worked alone too — the
  invalid bindings, not anything about `setlist_songs`/`seasons`
  themselves, were the cause. `subscribeRealtime()` now warns
  (`console.warn`) whenever the channel reaches any status other than
  `SUBSCRIBED`, since that's the only client-visible signal available —
  the status itself can't reveal a poisoned-channel case like this one.
  **Publication membership and RLS are two independent gates, in series —
  both must pass, and each fails differently.** A table absent from the
  publication isn't realtime-eligible at all (this is what poisons the
  shared channel above). A table that IS in the publication but has no
  permitting RLS policy registers fine — the channel doesn't break — but
  delivers **nothing at all** for that table, not an empty or redacted
  payload, verified directly (added `scores` to the publication alone,
  subscribed an anon-key client with no SELECT policy on the table, forced
  a real value change, zero events arrived). This is why fixing the
  publication gap didn't require touching RLS: `scores`/`league_shows`
  still have zero public SELECT policies by Stage A's original design
  (scoped reads go through RPCs, not RLS — see below), so their own
  realtime toasts remain genuinely non-functional even after this fix —
  intentionally; only the collateral damage to the other two tables'
  delivery was the bug.
- **`league_members.banned` is vestigial as of Stage C1.** League boot
  (`admin_league_boot`) hard-deletes the `league_members` row (keeping picks/scores
  frozen per the season-roster rule) and separately inserts into that league's
  `banned_names`, which is what `admin_add_league_member` actually checks. Nothing
  in Stage C1 sets or reads the `banned` column — don't assume it's the enforcement
  mechanism if you see it later; it's leftover from the pre-2.0 flat schema.
- **Standings/scores/seasons/schedule reads are RPCs, built in Stage C2a**
  (`sql/stage_c2a_rpcs.sql`): `get_bracket_scores` (authenticated + membership-
  gated — cross-league visibility is Global-admin-only, so this isn't public
  like the others), `get_league_shows`, `get_bracket_seasons` (both public, no
  auth — schedule/season date ranges aren't per-player), plus `can_submit_picks`
  (the shared Official-eligibility check, also backing `submit_picks` itself via
  an internal `_official_gate` helper — one implementation, not a client-side
  copy that could drift out of sync). Stage A left no public select policy on
  `scores`/`seasons`/`season_rosters`/`league_shows`/`picks`/`league_members`
  (intentional — scoped reads go through RPCs, not RLS), so before these existed
  those direct reads returned nothing at all.
- **`reopen`/`cutoff_changed`/`finalize` are name/PIN-authenticated** edge-function
  actions (`carton-sync`), not SQL RPCs. Each verifies the caller via `_auth_player`
  + `_is_league_admin_or_global` (same guard the SQL RPCs use) before doing
  anything. This closed a real hole: those two actions previously took only
  `{league_id, show_id}` with no auth at all, so anyone holding the public anon
  key could wipe a league's scores or spam a fake cutoff notice. There is
  deliberately no `admin_reopen_show` SQL RPC and no `admin_set_show_status` RPC —
  the edge function's authenticated actions are the only path for these
  transitions now.
- **`_auth_player`/`_is_league_admin_or_global`/`_official_gate` had Postgres's
  default `PUBLIC` execute grant** (every new function gets it unless explicitly
  revoked, and nothing in this codebase's history ever had). `_auth_player`
  returns the full `players` row including `pin_hash`, so it was directly
  callable via `/rpc/_auth_player` by anyone holding the anon key — fixed in
  `sql/stage_c2a_rpcs.sql` with explicit `revoke ... from public`. Impact was
  limited (it requires the correct name **and** PIN to return anything, so this
  could only leak an account's own hash back to someone who already fully
  controls it), but it's not what the `service_role`-only grant was supposed to
  mean — check for this same gap on any future internal-only helper.
- **Case-insensitive login was never actually the bug — `_auth_player` has
  compared on `lower(name)` since the original schema.sql.** A real player
  ended up with duplicate accounts (`Carmanjesse` / `CARMANJESSE`) and
  couldn't reliably log into either, which read as "login is case-sensitive."
  It isn't, and never was. The actual defect: `players.name` had a plain
  (case-sensitive) `unique` constraint, so `register_player`'s duplicate
  check — which relies entirely on that constraint's `unique_violation` — let
  a case-variant of an existing name insert as a second row instead of
  failing. Once two rows share a lowered name, `_auth_player`'s
  `select ... into pl from players where lower(name) = lower(trim(p_name))`
  doesn't error on the extra match (PL/pgSQL's `SELECT INTO` silently keeps
  the first row returned and discards the rest, no `STRICT`) — so login
  becomes nondeterministic against whichever row's PIN gets checked, not
  literally case-sensitive. Fixed in `sql/stage_e_case_insensitive_auth.sql`
  by replacing the constraint with a case-insensitive unique index on
  `lower(name)`: once at most one row can exist per lowered name, the
  existing `lower(name)` comparisons in `_auth_player` (and the existing
  `lower(...)` handling already correct in both `banned_names` and
  `global_banned_names`) are correct on their own — no query logic changed,
  only the constraint that was supposed to make duplicates impossible.
- **Standings tiebreaker ranking uses competition ranking (rank += group
  size), which makes rank 2 mathematically unreachable whenever exactly two
  players share rank 1** — the next occupied rank is always 3, never 2
  (`src/core/tiebreak.js`'s `rankStandings`). Non-obvious and worth having
  written down: `src/features/standings.js`'s podium-arrangement code has to
  pull a 2-way tie's "runner-up" (the player centered between the two
  elevated golds) from whoever holds rank 3, not rank 2 — a literal `silver`
  group is always empty in that shape, by construction, not by bug. The
  medal color rendered there still just follows the player's real resolved
  rank (bronze in practice) — nothing is hardcoded to display as "silver."
- **Open question, not yet addressed: PIN-guessing surface at scale.** `login`
  is a public, unrated RPC endpoint that accepts a name + a 4–8 digit PIN, and
  nothing rate-limits guesses against it. Fine at today's scale (~10
  Ambassadors), but worth thinking through deliberately before the ~50-person
  Facebook league joins — a bigger, less-trusted pool. Not solved in Stage C2a.
- **Resolved (Session 4): both halves of decision 3 now exist.** A
  league/global admin can run `admin_reset_player_pin`
  (`sql/stage_l_admin_pin_reset.sql`) to server-generate a new PIN and force
  the target to set a real one on next login (`must_change_pin`,
  `sql/stage_k_pin_management.sql`, `renderForceChangePin()` in `auth.js`).
  Separately, a player can voluntarily change their own PIN any time via a
  "Change PIN" form in `settingsPanelHtml()` (`settings.js`'s
  `changeOwnPin()`), calling the same `change_own_pin` RPC the forced flow
  uses — current PIN required and verified server-side (`_auth_player`
  raises before any write if it's wrong), so a live session on a shared
  device can't be used to lock the owner out. This was initially shipped
  admin-reset-only, with self-service deferred as a "follow-up" — corrected
  same session, before the SQL was run: the admin reset was always meant as
  the *fallback*, not the only path, so a player without admin access had no
  real recovery until this landed. The "only recovery is raw SQL against
  `pin_hash`" framing of this bullet is fully retired now, not just half of it.
- **Reveal-once secrets (the PIN reset's `new_pin`) transit through whatever
  request/response logging Supabase's platform does, if any — outside this
  app's control, but a real property worth having written down rather than
  assumed away.** `admin_reset_player_pin` never writes the plaintext PIN to
  any table or application log — it exists only as a `plpgsql` local
  variable and the single RPC response that returns it once, matching the
  "admin never sees/chooses it, relayed once" requirement. But if
  project-level API/request logging is ever enabled on the Supabase project
  (not something this codebase controls or has audited), that response body
  — like any RPC response containing a secret — would transit through it the
  same way. This isn't specific to a coding mistake here; it's an inherent
  property of any "reveal a secret once via an RPC response" pattern, and
  applies equally to a future self-service forgot-PIN flow if one is ever
  built the same way. Worth a one-time check of the project's logging
  settings before this matters at real scale, not something to re-derive
  from a chat transcript later.
- **Fixed: auth rejections from `reopen`/`cutoff_changed`/`finalize` used to all
  return HTTP 500**, indistinguishable from a genuine server bug (the
  handler's single `catch` turned "wrong PIN," "not authorized," and a real
  error into the same generic 500). `requireLeagueAdmin` now throws tagged
  `AuthError`/`ForbiddenError` (401/403 respectively), and the router's catch
  reads `.status` off the thrown error instead of hardcoding 500 — a real
  server error still falls through to 500 unchanged. Verified live against
  the deployed function, not just the source: a bad-credentials call now
  returns 401. This was already flagged here as a known gap before it was
  fixed; leaving this note rather than deleting it, since "was this ever
  actually broken" is exactly the kind of thing this file exists to answer
  without re-deriving it.
- **`songs_cache.times_played`/`last_played` have been silently dead since
  they were written — The Carton's `/songs.json` never returns either
  field.** `syncSongs()` in `index.ts` maps `r.times_played`/`r.last_played`
  straight from the API response, but the live response shape is only
  `{id, name, slug, isoriginal, original_artist, created_at, updated_at}` —
  confirmed directly against the live API, and separately confirmed every
  row in the live `songs_cache` table has both columns `null`, with no
  exceptions. This isn't a regression; it's been null since the sync code
  was written, because the API was never returning what the code assumed.
  No per-song detail endpoint or stats param exposes this data either — it
  isn't reachable as a simple field read at all. **Any feature that wants a
  real play count or last-played date (recency-weighted scoring, "songs
  due" displays, anything like it) is unbuildable today without first
  backfilling full setlist history** (`setlist_songs` only ever holds the
  rolling sync window, nowhere near full history) and switching these two
  columns to hold app-computed values instead of API-sourced ones. See
  "Alternate scoring modes" below for the one concrete case this blocks
  today.
- **A silent multi-row-insert failure turned "activation didn't run" into a
  real, months-long support burden — fixed, but the general shape is worth
  watching for elsewhere.** `activateSeasons()` (`supabase/functions/
  carton-sync/index.ts`) writes an Official season's frozen roster with a
  plain `.insert(rows)` — no `onConflict`, no error check — immediately
  followed, unconditionally, by `seasons.roster_locked_at = now()`. `
  season_rosters`' primary key is `(season_id, player_id)`; if even ONE row
  in that batch already existed (e.g. an admin manually pre-added a player
  to that season's roster via `admin_set_season_roster` before the season's
  start date arrived), Postgres aborts the entire multi-row `INSERT` on the
  conflict — but the very next line stamped `roster_locked_at` anyway,
  regardless of whether the insert wrote 40 rows or zero. The season then
  reads as "activated" forever (the `.is("roster_locked_at", null)` filter
  never revisits it), with a roster that's missing everyone except whatever
  was already there. **Confirmed against real data**, not just traced in
  the abstract: season 6 ("Test 2") shows every `season_rosters.added_at`
  clustered Aug 2–5, while `roster_locked_at` is Aug 6 — the automatic batch
  wrote nothing at all that day, silently. This is almost certainly the
  actual reason behind a recurring pattern of manually re-adding league
  members to season rosters via direct SQL, which had originally looked
  like ordinary mid-season joins (a real, separate, and expected gap — see
  the Frozen season roster decision below) but for at least this season
  wasn't that. One real player (a since-unused test account) sat out
  Official for the whole season as a direct result — caught before any
  Facebook League member hit the same thing. **Fixed**: the insert is now
  `.upsert(rows, { onConflict: "season_id,player_id", ignoreDuplicates: true
  })` (skips rows that already exist rather than aborting the batch, and
  leaves a manual pre-add's own `added_at` untouched rather than
  overwriting it), and `roster_locked_at` is stamped **only** if that write
  actually succeeded — on error the season is left with `roster_locked_at`
  still `null` so the next cron run retries it, the failure is
  `console.error`-logged, and it's returned in `scoreShows()`'s response
  (`season_activation_failures`) instead of being invisible. Verified live:
  the redeployed function's response now carries a `season_activation_
  failures` key that never existed before. **The general shape to keep
  watching for**: an unguarded multi-row write with no conflict handling
  and no error check, followed immediately by an unconditional "mark this
  done" write with no relationship to whether the first one actually
  succeeded. Scanned the rest of this file for the same pattern when this
  was found — every other batch write already either uses `.upsert()` with
  an explicit `onConflict` (`songs_cache`, `setlist_songs`, `scores`,
  `realtime_pings`) or explicitly checks `error` and throws (`syncSongs`),
  and the `remind_sent`/`lock_sent`/`winner_sent` announcement stamps that
  *do* follow a "best-effort action, then stamp regardless" shape are
  intentional there — a dead Discord webhook correctly shouldn't retry-storm
  forever, unlike a roster real players get scored against. Nothing else in
  the file currently matches the dangerous version of this shape.

---

## Frontend/CSS gotchas learned the hard way

- **`.sheet` (the pick sheet paper card) is theme-invariant — always cream
  paper with dark ink, regardless of which app theme is active.**
  `--paper`/`--paper-ink`/`--paper-ink-soft` are the tokens built for it;
  the app's own `--cream`/`--cream-dim`/`--panel`/`--panel2`/`--line`/`--pit`/
  `--indigo` all flip between light and dark theme and are wrong the
  instant they're used on anything sitting on the paper. This has broken
  three different ways so far, always the same root cause — an app-wide
  class used where a paper-scoped one was needed:
  - The ineligible-reason text originally used `--ink` (a theme-flipping
    variable that, despite the name, is repurposed as light theme's
    *foreground* color) — cream-on-cream in light theme. Fixed with
    `--paper-ink`.
  - A "numbers are points per slot" legend line used the app-wide `.muted`
    class (`color:var(--cream-dim)`) — ~1.56:1 contrast in dark theme,
    since dark theme's `--cream-dim` is a pale grey that nearly matches
    the paper's own lightness. Fixed with an inline `--paper-ink-soft` style.
  - `renderIneligible`'s "Switch to Casual" button used the shared
    `.btn.ghost` class (`--panel2`/`--cream`/`--line2`) — in light theme,
    `--panel2` is nearly the same pale cream as the paper, so the button
    read as barely-there against its own card even though its own text
    stayed technically legible. **This is a different failure shape than
    the first two**: a *component* blending into its background, not
    *text* vanishing into it — because the button supplies its own opaque
    fill, the text-on-fill contrast was never the problem, the
    component's boundary against the paper was. Fixed with a
    `.sheet .btn` override using `--paper-ink`.
  The pattern to watch for: it's not just text-color classes that break
  this way — **any app-wide component class** (buttons, pills, badges,
  whatever gets added next) breaks the instant it's dropped inside
  `.sheet`, just via a different visual symptom depending on whether the
  component supplies its own background or inherits the paper's. Before
  adding anything to `.sheet`, check whether its classes reference
  `--cream*`/`--panel*`/`--line*`/`--pit`/`--indigo` anywhere in their
  CSS — if so, it needs paper tokens or a `.sheet`-scoped override, not a
  pass, and check the result in an actual browser in light theme, not by
  reading the values.
- **The boxed podium row (`standings.js`) is width-sensitive in a way that
  breaks only inside a specific window-width band, not "on mobile" or "on
  desktop"** — the kind of bug that gets reported as random/flaky rather
  than traced to a cause, so the arithmetic that makes it obvious is worth
  keeping written down rather than re-derived next time trophy sizing
  changes. The row must never wrap (a wrap can put gold below a lower
  tier, breaking `arrangePodium`'s arrangement), and whether it wraps is a
  function of BOTH the icon px size (`bigPx`/`smallPx`) AND `.podium`'s
  gap (styles.css) against whatever container it's actually sitting in —
  three sizing tiers exist today because that available width is not the
  same thing at every breakpoint:
  - Phone, `<=420px` width: 96/68px icons, 8px gap (available width ~258px
    at a real 324px phone).
  - Desktop, `901-1279px` viewport width: 83/58px icons, 8px gap.
  - Desktop, `>=1280px` viewport width: 118/82px icons, 28px gap
    (unchanged from before this note existed).
  The middle tier exists because desktop's OWN narrowest real width
  (901px, the mobile/desktop breakpoint) is a genuinely separate
  constraint from phone's, not a smaller version of the same one: the
  podium sits inside `#cols`' grid column there, not `.wrap`, and at
  901px that column's available width is 224px. The pre-fix icon sizing
  (118/82) needed 318px of icon ALONE at that width — 94px over, before
  any gap is even added — which is the concrete reason a bigger gap
  can't be the fix on desktop the way it is on phone: no gap value
  subtracts a negative number. Verified directly (not just by this
  arithmetic) that the wrap actually spans the whole 901-1279px range,
  not just the instant at the breakpoint, and that 1280px+ has real
  margin (344px available vs 338px needed) and needs no change. Below
  901px desktop's grid never renders at all (`isDesktop()` in
  `core/dom.js` is `min-width:901px`) — that's phone/tablet's `.wrap`
  instead, covered by the first tier.

---

## Feature set frozen at the start of 2.0 (historical snapshot — NOT current)

**This section is not maintained and does not describe the app's current
behavior.** It's a frozen snapshot of the pre-2.0 feature set, written once
before the rebuild began, and every rebuild stage since has moved the actual
UI further away from it without this section being updated to match. It has
already sent work down the wrong path four times now: it described a
collapsible sidebar that was never built; an admin show-row layout that (in
an earlier draft) only ever existed in a chat message, never in the repo;
and, separately from this section's own text, a personal task list compiled
from conversation memory once again claimed a desktop sidebar mockup
("mock2") had been chosen but never committed, with "the rejected 3-column
layout" implied to be a mistake still shipping. Re-verified directly
(`git log --all -S"sidebar"`, `-S"mock2"`, `-S"collapse"` across every
commit's diffs): zero matches, ever — `-S"mock2"` in particular matches
nothing at all. The 3-column grid (`e7fa3ef`, still live in
`src/core/layout.js`) is the only desktop layout that was ever built; it
isn't a rejected fallback, it's the only thing that exists. A fourth instance
turned up in the "Known pending work" section, not here — the slot-labels
bullet describing per-song setlist labels and opener/set2_opener live-toast
tags that were never actually built, only ever planned (see that bullet,
corrected). **The mechanism is the same whether the false claim is about a
past decision or a feature's current status**: a plan or possibility gets
written down — in a chat message, a personal task list, a "known pending
work" bullet — and later gets read back as if it already existed, because
nothing forced a check against the actual repo in between. Treat any
specific claim below — exact wording, layout details, which widget does
what, or whether a described feature is actually live — as unverified until
you've actually read the relevant source (`src/features/*.js`,
`src/core/*.js`) or checked `git log`/`git blame` on it. For what's actually
shipped in 2.0, the "THE 2.0 REBUILD" section below tracks each stage
explicitly as done or not-started — that's the current source of truth,
this isn't.

Slot types (opener, set1_closer, set2_opener, closer, encore, show_closer,
second_song, **cover_pick** [repeatable, catalog-restricted to covers]) + an
**"Any Debut" wildcard** (any slot, hits if any debut is played). Flat picks,
partial credit, perfect-sheet bonus, cover/debut bonuses. Per-show venue-local
cutoffs (state→IANA tz map, DST-aware). Admin: master voting override
(auto/locked/open), "who's picked" roster, players panel with boot + per-league
ban + collapsible ban list, seasons (named date ranges), per-show 1set/2set format
toggle, finalize + (planned) reopen. Show lifecycle open→locked→live→complete.
Standings with podium (top-3 trophies, gold/silver/bronze **eggs** inside the
wreaths), single Score column (season pts, or career when "All time"), season
selector, nerd stats (shows/avg/high/wins). Draft persistence (pick sheets save to
localStorage every keystroke, restore on return, never wiped by foreground refresh).
3-state theme (auto-follow-phone / light / dark). Desktop is a static, non-collapsible
3-column grid (Standings / Shows / Admin, each showing full content — confirmed by
reading the actual source and git history during Stage C2a; there's no collapse
affordance or top-3-trimmed variant anywhere in the codebase's history, despite an
earlier version of this doc describing one); bottom-tab single-view on mobile. Tie handling shows
co-winners everywhere ("X & Y tie"). App icon = green laurel wreath (halo on
favicon/small badges only, not the header). Winner "trophy" = wreath over a laurel
pile; podium version has the medal egg inside.

## Known pending work (was queued in chat; verify against actual code state)

- **v6 edge function batch** ("carton-sync-v6"): Cover Pick slot type + Any Debut
  wildcard scoring; "slot not played" wording; tie-fix. Was HELD from deploy while a
  show's picks were locked. Deploy edge fn first, then frontend.
- **Reopen button** (un-finalize a show so corrected Carton data re-scores): **built**
  as the edge function's `reopen` action (Stage C1) — name/PIN-authenticated, wipes
  that league's scores for the show, resets `league_shows.status = 'live'` and
  `winner_sent = null` so the corrected winner re-announces, and fires a "scores
  reopened" Discord notice. Pairs with "correct The Carton before finalizing"
  workflow (a friend of the dev can edit setlists on The Carton). Frontend wiring is
  **also done** — a "Reopen" button in admin.js's Shows & cutoffs panel, next to
  Finalize on any show with `status === 'final'`; smoke-tested against the real
  Boston 7/31 show (see the closer-family scoring fix note above). **`cutoff_changed`
  is wired too now (Session 1, commit `2816d66`)** — `admin.js`'s `saveCutoff()`
  fires the edge action (fire-and-forget, `.catch(() => {})` so a failed Discord
  notice can't read as a failed cutoff save) right after `admin_set_cutoff`
  succeeds. All three authenticated edge actions (`reopen`/`cutoff_changed`/
  `finalize`) now have a real frontend caller — none is orphaned anymore.
- **Slot labels in setlists & notifications — a fourth false-memory instance (see
  the note at the top of this section), corrected against the source.** This
  bullet used to describe two things as current behavior that were never actually
  built:
  1. "Setlist view shows all slot labels ('Laurel — Opener')" — not true.
     `picks.js`'s `renderShowDetail` renders position, song name, a segue arrow,
     and (since Session 2) a debut tag per song. There is no per-song slot label
     anywhere in that view, and no trace in git history that there ever was.
  2. "Live toasts tag opener, set2_opener, encore + debut" — only half true.
     `realtime.js`'s live song toast tags `(encore)` and `— DEBUT 🥚` (the debut
     half shipped Session 2, exactly as planned). There is no opener or
     set2_opener tag anywhere in that toast string, confirmed directly against
     the current code.
  **What's actually true**: debut tagging is real, in both spots this bullet
  always described, mirroring the existing `is_encore` pattern. Plain footnote
  trivia is descoped, not planned, and stays that way.
  **Not started, if still wanted**: per-song slot labels in the setlist view;
  opener/set2_opener tags in the live toast. Neither exists today — don't assume
  either from an older reading of this bullet.
- **Discord notification logic rework**: broadcast (not personal) + per-league in
  2.0. Still needs a design pass for the bigger pieces (public non-voter shaming
  vs. neutral counts; dedupe with in-app toasts; Discord roles) — but **per-league
  webhooks are further along than this bullet used to imply**: `notifyLeague()`
  (`index.ts`) already resolves a `DISCORD_WEBHOOK_<LEAGUENAME>` env var per
  league, falling back to the single global `DISCORD_WEBHOOK` only if that named
  one isn't set. No DB column, no admin UI — but the routing mechanism already
  exists. A second league's notifications landing in the first league's channel
  is a missing *secret*, not missing code.
- **Season game-numbering cap, deliberately deferred**: `shows.js`'s per-show "Game
  N" circle (chronological position within the season) is computed only from what
  `renderShows()` already fetches for display — unbounded future + last 2 days,
  plus the 12 most-recent past shows (the `.limit(12)` on the `past` query). A
  season with more than 12 already-played shows would get this **wrong, not
  missing**: the earliest shows age out of that 12-show window and drop out of the
  fetch entirely, so the shows that DO come through get renumbered from 1 as if the
  dropped ones never existed (a season's real Game 4 would render as "Game 1" once
  Games 1-3 fall out of the window) — every visible show still gets a number, it's
  just shifted low by however many earlier shows are missing. Not fixing this now:
  no season has come close to 12 already-played shows at this scale, and the
  interim fix if one ever does is just bumping `.limit(12)` a bit to cover it. A
  real fix means separating the fetch bound from the render bound — that one `12`
  currently does both jobs (how many past shows the Recent panel displays, AND the
  universe of shows game-numbering counts from), so a display-driven bump for UX
  reasons silently changes numbering correctness too, and vice versa.

---

## THE 2.0 REBUILD (the big upcoming work)

Full spec in `docs/MULTITENANT_SPEC.md`. Summary:

**Three levels: Global → League → Bracket.**
- **Global** (super-admin / the dev): creates leagues, appoints league admins, owns
  the shared show list + Carton sync, sees cross-league global stats (Global-only).
  This app is Eggy-specific; a different band = a fork of the whole app, not a tenant.
- **League** (e.g. *Ambassadors*, *Facebook League*): a discrete community/player pool.
  Has admins. Contains exactly 2 brackets. Sets its own cutoffs. Boots/bans within itself.
- **Bracket** (*Casual* / *Official*): parallel competitions, each with own rules and
  champion. **Casual has NO seasons** (perpetual tally). **Official has seasons** +
  the opt-out mechanic.

**Key decisions (all locked):**
- **One global player identity** (name+PIN app-wide). Players hold per-league
  memberships. Enables global stats (e.g. total shows voted across leagues).
- **Official participation is opt-IN**, and the toggle is **locked while a season runs**
  — no opting in mid-season. League admin can override.
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
- **Frozen season roster** (`season_rosters`): when an Official season starts, the set
  of opted-in members is snapshotted; scoring reads the snapshot, NOT the live flag.
  Frozen in both directions (opting out / getting booted mid-season leaves you on the
  board, frozen). This makes the "no mid-season change" rule structurally unbreakable.
  Admin override edits the roster explicitly.
- **An Official bracket with no season covering a show's date scores nobody for
  that show — signed off, not a bug.** Correct given Official is discrete seasons
  and Casual is the perpetual tally; the Stage C admin warning (below) is the
  mitigation for "someone forgot to create a season," not a scoring change.
- **Global is a SUPERSET of league admin**: every league-scoped power/read uses one
  shared guard `is_league_admin(league) OR is_global_admin`, so Global can act inside
  or see any league (to fix a fumbling league admin). The ONLY Global-exclusive power
  is the account-level nuclear boot (delete a player everywhere + optional app-wide
  name ban).
- **Show list is fully global/shared** (one sync). Cutoffs, format, status, and
  announcement flags are **per-league** (a `league_shows` overlay table). Setlists
  stay global (fetched once per show); scoring runs **per-bracket** against the shared
  setlist.
- **Scoped reads via RPCs** (not RLS) for anything sensitive; public RLS read only on
  truly-global tables (shows, songs_cache, setlist_songs, league names, bracket config).
- **Scale is small** (~10 Ambassadors + ~50 FB = 2x current). No pagination or
  public-registration hardening needed. FB league's 2 runners verify signups manually
  via FB comments; join = admin-adds-player.

**Launch reset (agreed):** beta players know scores get wiped at launch. The wipe
keeps player accounts (names+PINs) but wipes all gameplay (picks, scores, seasons,
setlist data) and keeps the song catalog. This collapses the migration — no delicate
preservation. A **maintenance window is acceptable** (app goes dark between stages),
so NO compatibility-view scaffolding is needed.

**Stage A is already written**: `sql/stage_a_schema.sql` — one file that supersedes
`schema.sql` + all `add_*.sql`. It builds the tenancy tables, does the account-
preserving wipe, and seeds the "Ambassadors" league with Casual + Official brackets,
moving all current players in (grandfathered opt_in=true). Has a verification query
block at the bottom. RUN IT in a quiet window, snapshot first, then check the counts.

**Stage A has been run.** Verification initially showed `seasons = 1` instead of 0:
Section 3's `create table if not exists seasons` silently no-op'd because `seasons`
already existed pre-2.0 (from `add_seasons.sql`), so `bracket_id`/`roster_locked_at`
never got added and the old beta season row survived. Corrected with the one-shot
`sql/stage_a_fix_seasons.sql` (adds the missing columns, wipes `seasons` +
`season_rosters`, sets `bracket_id not null`) — already run against the live
database, don't run it again. `stage_a_schema.sql` itself is fixed for any future
run (drop-and-recreate `seasons`, matching picks/scores).

**Build sequence from here:**
1. **Done.** (Claude Code first jobs, BEFORE 2.0) Reorganize repo; split
   `index.html` into modules WITH a build step; verify GitHub Pages deploy
   still works; recreate the test harnesses. Get git history going. — see
   the Frontend bullet under "Current architecture" above for the resulting
   shape (`src/`, `build.mjs` → `app.js`).
2. **Stage A** — run `sql/stage_a_schema.sql`, verify counts. App goes dark here.
3. **Stage B** — edge function v7: global sync, per-league `league_shows` overlays
   with auto-defaulted cutoffs, the **season-activation step** that writes the frozen
   roster, and the scoring rewrite (one setlist fetch → each bracket under its own
   config; Official reads the roster). Fold in: v6 Cover Pick/wildcard, reopen +
   notification + winner_sent reset, slot labels, debut toast, the Discord
   broadcast/per-league notification rework.
3. **Stage C** — a full RPC rewrite in SQL (every function reworked for the
   Global/League/Bracket model — see design notes below), plus the frontend:
   league/bracket switcher, every screen scoped to current bracket, league-admin
   panel, Global-admin screen (create leagues, appoint admins, cross-league stats,
   nuclear boot). Carry over the cleaner admin show-row layout — **done in C2a**:
   `.arow`/`.arow-head`/`.cutoff-in`/`.arow-btns` (stacked date+venue / cutoff
   input / buttons, each row wrapping independently), replacing the shared
   `.showrow` single-line flex row that was overlapping buttons with venue
   text once too many controls got packed into it. (Despite the phrasing here
   suggesting this already existed somewhere — it didn't: git history has zero
   trace of `.arow` ever existing before C2a. Same false-memory pattern as the
   "collapsible sidebar" note elsewhere in this file; the fix was real, the
   prior existence wasn't.)
4. App back up; smoke-test **Ambassadors ▸ Official** + empty **Casual**.
5. Create the **Facebook League** via the Global screen, appoint its 2 admins (need to
   know who they are + whether they have beta accounts), they add ~50 players.

### Stage B design notes (scoring / edge function)

- **Relabel the closer slot to "Set 2 Closer"** — display label only; the slot key
  stays `closer` so existing picks/configs don't break. Rationale: "closer" read
  ambiguously next to "show closer." Final vocabulary: **Set 1 Closer** (last of set
  1) / **Set 2 Closer** (last before encore) / **Show Closer** (final song of the
  night, encore included). Keep all three — a wide array of bets is intentional.
- **Scoring is fresh-off-the-current-snapshot, not merged against history (fixed
  after a real incident).** The original design scored every pass, then kept
  whichever of {this pass, the row already in `scores`} had more points — meant to
  let a wrong-slot partial upgrade to a full match on replay (sandwiches: A > B >
  A). In production (Boston, Citizens House of Blues, 2026-07-31) this instead
  froze a wrong result permanently: a live pass caught Shatter as the apparent
  Set 2 Closer from a 5-song snapshot (`+2 closer — exact`), and once the real
  closer (Voice of Them All, two songs later) appeared, every later pass —
  including finalize's own closing pass — recomputed the correct, lower value but
  lost to the stale higher one already in the DB. Fixed in `scoring.js`/`index.ts`:
  the merge-against-persisted-row is gone. Every pass scores fresh off the full
  current `setlist_songs` snapshot, which is monotonic for every slot type except
  the closer family (a fresh pass never needs "history" — `encore`/`cover_call`/
  `debut_call`/`second_song` already check "any appearance so far," so a later
  reprise upgrades automatically with no merge needed at all). Sandwiches (A > B >
  A) are still handled correctly this way — confirmed by `test/scoring.test.mjs`
  fixtures pulled from real shows with genuine sandwiches (Rocking The Docks,
  GratefulFest, Levitt Pavilion).
- **`slotDetermined` — Set 1 Closer / Set 2 Closer / Show Closer only score once
  there's real evidence the relevant set/show is over** (this is the
  `slotNotYetDetermined` gap this file used to flag as "not yet built" — it's
  built now, in `deriveSlotFacts`). Each resolves as early as the data allows,
  not just at finalize — the near-real-time requirement matters here since a
  show can go for hours before an admin manually finalizes it or `autoFinalize`
  fires the next morning:
  - **Set 1 Closer**: determined the instant anything plays after set 1 — a set 2
    song, or (if the show skips set 2 entirely) the encore starting.
  - **Set 2 Closer** (`closer` slot key; display label "Set 2 Closer"): determined
    the instant the encore starts — a second encore break doesn't change who
    closed the last set.
  - **Show Closer**: no reliable in-show signal exists (another encore break is
    always possible until the show truly ends) — resolves only at finalize
    (`isFinal` passed into `deriveSlotFacts`/`scorePicks`).
  Until determined, a picked song that's already played scores **consolation
  credit** (partial points, if `cfg.partial_credit` is on) with reason `"played —
  slot undetermined"` — never a premature exact or wrong-slot verdict. This also
  aligns scoring with the already-existing toast rule (closers never named live,
  only after the fact) — before this fix, scoring was quietly ahead of what
  toasts were willing to claim. Player-facing copy: `picks.js`'s show-detail view
  surfaces "Closer-type picks show off-slot points (if enabled) until the encore
  starts (or the show ends) — full points lock in once determined." directly
  under the Scores header, but only when a visible breakdown row is actually in
  that state — deliberately not shown as permanent boilerplate.
  - **`slotImpossible` is untouched and still means only** "this slot doesn't
    structurally exist for this show" (no set 2 at a one-setter, no encore at
    all) — correct as-is, don't fold `slotDetermined` into it. Note this doesn't
    fix the same not-yet-vs-impossible ambiguity for the plain `encore` slot type
    itself (picking a song for the Encore slot before any encore has happened
    reads as `slotImpossible.encore === true`, i.e. "no encore this show," when
    it may just not have happened yet) — out of scope for this pass, since
    `encore` isn't positional the way the three closers are and a wrong-slot
    label there is far lower-stakes; revisit if it causes real confusion.
  - **Already-finalized shows may still carry the old bug's frozen results** —
    the fix only changes scoring going forward. Repair path: `reopen` (wipes that
    league's `scores` for the show, flips `league_shows.status` back to `live`)
    then `finalize` (re-scores clean under the corrected logic, since post-fix
    the only pass that ever freezes a closer-family slot is the finalize pass
    itself). **Boston 7/31 has been repaired** — reopened + finalized via the
    admin panel's Reopen button (built and smoke-tested against this real
    show), `winner_sent` now carries a fresh timestamp from the corrected
    scoring pass instead of the original frozen-bug result.
- **Duplicates stay OFF by default.** Add a warning tooltip on that admin toggle
  noting the consequence: with duplicates allowed, on a one-song encore a song picked
  for both Encore and Show Closer scores both slots — usually a free double.
- **Cutoff-changed notification** — when a league admin changes a show's cutoff, post
  to that league's Discord channel. Per-league (reads `league_shows`); build as part
  of the broader broadcast/per-league notification rework, not before.
- **`sync_shows` must map `permalink`** from the `/shows.json` response into the
  `shows.permalink` column, and the upsert must UPDATE existing rows, not
  insert-and-ignore-on-conflict — the slug embeds the venue name, so a corrected
  venue name regenerates the slug and a stale permalink would 404.

### Stage C design notes (frontend)

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
- **Admin tooltips on the config screens — still open, scope narrower than
  written.** Slot definitions on the admin side needed no work, per the bullet
  above. What's still missing is explanatory copy for the *rule mechanics* a game
  runner controls but didn't design: partial credit, perfect-sheet bonus,
  wildcards, the duplicates warning above, the best-result-across-replays rule,
  master override, format toggle, and (in 2.0) the Official opt-out mechanic.
  Important because 2.0 delegates leagues to admins who didn't build the game.
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

### 2.0 REBUILD roadmap (verified against the repo, sessions ordered)

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
4. **scores/league_shows realtime toasts: build a ping table (not a public RLS
   policy, not polling) — built (Session 3).** This app has no per-request
   identity — players authenticate via a name+PIN RPC, not Supabase Auth, so
   every request shares one anon key regardless of which player is "logged in"
   client-side. A public RLS policy on `scores`/`league_shows` would expose
   every score in every league to anyone holding that key, undoing
   `get_bracket_scores`'s membership gate — ruled out on that evidence, not
   preference.

   **What shipped**, matching the design above exactly: a `realtime_pings`
   table (`sql/stage_j_realtime_ping.sql`) carrying only `{league_id, show_id,
   updated_at}` — no `bracket_id`, no counts, no deltas, nothing inferable.
   Written by the edge function's new `pingRealtime()` helper
   (`supabase/functions/carton-sync/index.ts`), called once per real change —
   inside `announcements()` right after each `remind_sent`/`lock_sent`/
   `winner_sent` stamp, inside `scoreShow()`'s per-league-show loop only when
   a bracket actually had a score write (`scoreBracket`'s existing
   `score_writes` diff count) or a status flip to `live`, and inside
   `reopenShow()`. Not a trigger — deliberately called from application code
   at each of those points, so a quiet cron tick with nothing new doesn't
   write (and doesn't fire a client refetch) at all. Both gates are on: added
   to the `supabase_realtime` publication AND given a public SELECT policy
   (`create policy "pub realtime_pings" ... for select using (true)`) — the
   SQL file's own verification section checks each independently, since they
   fail differently and silently (see the publication/RLS gotcha above).

   On its own dedicated channel (`ping-${leagueId}` in `realtime.js`),
   separate from the existing `live-${bracketId}` channel — so a future
   misconfiguration on this table can't repeat the channel-poisoning bug.
   `handlePing()` is the client-side consumer: on any ping, it refetches
   `get_league_shows` (for the remind/lock/winner freshness check) and
   `get_bracket_scores` (for the winner toast and the player's own "you're at
   N pts" toast) — one `get_bracket_scores` call covers both toasts, where the
   two dead bindings it replaced used to fetch separately. Real score/show
   data never crosses the public ping channel; the ping only ever says
   "something changed here, go refetch."

   **The two now-dead bindings this replaces (`league_shows` UPDATE and
   `scores` `*` on the shared channel) are gone, not just superseded** —
   they never delivered anything (no public RLS policy on either table, by
   design) and would have been confusing dead weight sitting next to the
   working ping-driven logic. The shared channel now carries only the two
   bindings that were ever real: `setlist_songs` INSERT and `seasons`
   UPDATE.

   **Verified two ways**, per the exact failure mode that already cost a
   debugging session once (the original channel-poisoning bug): (1) the SQL
   file's publication-membership check and RLS-policy check are two separate
   queries, not one "looks subscribed" check — each gate fails differently
   and silently, so only checking one proves nothing about the other. (2)
   `test/harness.mjs`'s realtime block now emits `setlist_songs` and
   `seasons` events (previously never exercised by anything in this harness
   at all — a gap, not a regression) alongside the new `realtime_pings`
   emits, so adding a fifth thing to subscribe to is checked against ALL
   five bindings together, not the new one in isolation.
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
- **Session 4 — auth + Global console: code complete (steps 1-5, plus
  self-service PIN change pulled forward from step 6's original scope — see
  below), SQL not yet run against the live database — that's the dev's next
  action, not done yet.** Ran in the manual-approval mode this bullet used to
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
- **Session 5 — Facebook League launch:** create the league + appoint its two
  admins through the real console this time, provision one Discord webhook
  secret, smoke-test. Blocked on the two admins being named and confirmed.

**Dropped entirely:** the desktop sidebar/"mock2" claim — never existed, see the
false-memory note above.

**Deferred with an explicit revisit trigger, not dropped:** cross-league global
stats (revisit past 2-3 leagues); the per-league webhook DB+UI (revisit if
env-var management gets painful, or the Global console expands); the
notification-preference toggle (no strong trigger, pick up whenever wanted);
game numbering past 12 shows (revisit only if a season actually gets there).

### Alternate scoring modes (designed, not scheduled)

Two slot-independent scoring modes were designed on request — no opener/closer/
encore positional matching, a pick either gets played or it doesn't. Neither is
scheduled for a session; both stay here until that changes.

**Module A — last-played weighting (risk/reward).** Points scale with how long a
song's been dormant; a deep cut pays far more than a staple played last week.

- **Data dependency, checked directly:** the hoped-for shortcut doesn't exist —
  see the `songs_cache.times_played`/`last_played` dead-columns gotcha above. The
  data IS reachable, just not for free: a one-time full-history backfill (same
  approach already proven fetching the 609-show cache for the slot-predictability
  analysis) plus repurposing those two columns to hold app-computed values,
  refreshed on the existing sync cadence.
- **Scaling curve, computed against 5,396 real repeat-gap observations from that
  cache:** median gap 5 shows, p90 35, p99 201, max 534 — a 1:1 linear score
  would let a handful of extreme one-off covers dominate a season. Fixed bands
  (1-6) were rejected — they just trade the current 2-value tie problem for a
  smaller 6-value version of the same thing. Recommended instead: a capped curve,
  `points = clamp(round(1.2 × √gap), 1, 12)` — 12 distinct values across those
  same 5,396 observations, ~3% landing at the cap (a normal tail bucket, not a
  flaw).
- **Never-played songs:** score at the same max/cap value real gaps beyond ~100
  shows already saturate into — no special-case exclusion needed, a never-played
  song is definitionally the rarest possible pick. **Any Debut wildcard
  interaction:** since a debut already scores at this mode's max value
  automatically, the existing debut bonus becomes redundant specifically within
  this mode — stack it anyway or suppress it when this mode is active, not
  decided yet.
- **Lock timing:** recommended locked at cutoff, matching every other pick in
  this app — keeps "what you saw when you picked" equal to "what you got,"
  which legibility needs anyway. Locking at individual submission instead is
  simpler to build but creates a fairness skew (early vs. last-minute submitters
  could see different numbers for the same song purely from timing).
- **Legibility cost:** cheap at runtime — once a gap value exists on
  `songs_cache`, the curve math is trivial and can run client-side live in the
  autocomplete. The real cost is entirely the data-layer backfill above, not the
  display.

**Module B — ranked choice.** N picks, each assigned a value from a fixed
ladder (e.g. 5/4/3/2/1); hits pay their assigned rank, summed.

- Fewer than N picks: not decided — leaning top-ranks-only (3 of 5 uses 5/4/3)
  over free assignment, since free assignment adds real UI complexity
  (duplicate-value prevention) for an unclear benefit.
- Ladder: recommended configurable per bracket, not fixed — costs nothing extra
  once the mode-field architecture below exists at all.
- Multiple hits sum their assigned ranks — confirmed, the only sensible
  behavior, no further design needed.

**Architecture: a `mode` field on the existing `brackets.config`, not a parallel
system.** Brackets already carry fully independent config (Casual could run
ranked-choice while Official runs slots for free, once this exists) — a mode
field is the natural extension of a pattern already in place, not new
architecture. Existing brackets simply never set `mode` and keep today's exact
behavior; zero migration required. Sizing: config schema is small; the scoring
engine needs a branch in `scorePicks()` but each new mode's logic is actually
*simpler* than today's slot logic (no exact-vs-wrong-slot distinction); the
pick-sheet rendering change is the biggest piece — genuinely new territory, N
generic song-pick inputs instead of named-slot inputs, plus Module A's live
potential-points readout and Module B's rank-assignment UI. **Overall bigger
than any single session in the current roadmap — realistically 2-3 sessions on
its own.** A new-mode test-harness fixture needs to exist before either mode
ships, not be retrofitted after — this project has already shipped one real bug
from exactly that kind of fixture gap (see the global-admin fixture note above).

**If Module A ships, the current argument about slot point values becomes moot
for any bracket running that mode** — there are no slots to price under a
slot-independent scoring system. The slot-value work already done (the A/B/C/D
system comparison, the entropy-based predictability analysis) stays relevant
only for brackets that keep running the positional model.

---

## Conventions

Instance-specific values (name, branding, default slots, data source) live in
named constants (`src/core/config.js` for frontend; a top-of-file constant in
the edge function/SQL seed) rather than hardcoded inline.

## Deploy model

- Frontend: `node build.mjs` (or `npm run build`) to rebuild `app.js`/`app.js.map`
  from `src/`, commit the bundle alongside the source change, then push → GitHub
  Pages serves whatever's committed. There is no CI build step — a `src/` edit
  that isn't rebuilt+committed silently ships stale behavior.
- Edge function: deploy via the Supabase CLI (`supabase`, v2.x) — install and
  authenticate it if it isn't already, on whatever machine you're working from.
  Project ref is `zdfhglvjxquvkjyvophz` (matches Credentials above; `supabase
  projects list` confirms it once authenticated). Deploy with:
  `supabase functions deploy carton-sync --project-ref zdfhglvjxquvkjyvophz`
  (the `--project-ref` is redundant once linked, but explicit is safer than
  relying on link state). A "WARNING: Docker is not running" line is harmless —
  the CLI falls back to uploading source directly instead of bundling in a
  container; the deploy still succeeds and the printed `dashboard_url` /
  `"message":"Deployed Functions."` confirms it.
- SQL: run in the Supabase SQL editor (or via `supabase db` tooling).
- Cron: the scoring function runs on a schedule; the schedule SQL embeds the anon key
  in an Authorization header — if the key ever rotates, the cron header needs updating
  too (two places: frontend constants + cron header).
- **Local preview: `npm run dev`** (rebuilds via `build.mjs` then serves via
  `serve.mjs`) — one command, so there's no separate "did I rebuild?" step and no
  way to be looking at a stale `app.js`. Fixed at `http://localhost:8080/`,
  always with `Cache-Control: no-store` (and `Pragma`/`Expires` to match) on
  every response, no flag to remember. Prints the LAN URL too (`http://<your
  IP>:8080/`) for checking on a phone on the same network. Before starting a
  second one, check whether it's already running: `netstat -ano | findstr :8080`
  — `serve.mjs` also fails loudly with that exact command if the port's taken,
  instead of a second server silently coming up alongside a stale one (this
  project has accumulated stray preview servers, and once eight orphaned Claude
  Code processes, from exactly that). Stop a stale one with
  `powershell -Command "Stop-Process -Id <pid> -Force"`.
  **On mobile, open a new private/incognito tab, not an existing regular one** —
  a tab that was already open (or opened earlier in the session) can keep
  showing an old bundle even though the server itself is never caching; a fresh
  private tab guarantees the load actually hits the server.

## Tone / working style the dev prefers

Direct, honest about tradeoffs and limitations, no false reassurance. Flags the
non-obvious consequence of a change. Doesn't over-engineer for hypotheticals. Willing
to push back on a design smell. Values getting the data model right over shipping fast.
