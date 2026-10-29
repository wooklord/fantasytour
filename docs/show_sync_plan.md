# BUILD PLAN — approved in Chat 2026-10-25, build starts 2026-10-26

> **STATUS 2026-10-26 — BUILT and committed locally. NOT pushed. Stage U
> NOT applied. Edge function NOT deployed.** The next step is the dev's,
> in the strict order below: apply `sql/stage_u_show_sync.sql` and run its
> verification footer (steps 1–8; 9 optional), then
> `supabase functions deploy carton-sync --project-ref zdfhglvjxquvkjyvophz`,
> then `git push`. Everything the build added beyond this file, and the
> mutation results, are recorded under "BUILT 2026-10-26" in
> `docs/decisions/cron-secret-edge-auth.md`. No question is open from the
> build itself.

Daily in-tick show sync: new shows AND changes to existing ones, from The
Carton. Decision record (binding, six locked items plus the survey
findings): `docs/decisions/cron-secret-edge-auth.md` → "LOCKED 2026-10-25 —
daily in-tick show sync". This file is the build plan only; if the two ever
disagree, the decision record wins and this file is wrong.

Sibling plan file: `docs/module_b_ranked_choice_plan.md` (same role for
Module B). No nicknames, no real URLs, no webhook values in this file —
standing rule in `CLAUDE.md` → Conventions.

## Approval decisions (2026-10-25, dev's call, recorded at the weight given)

- **`syncSongs` stays OUT of the daily run.** Song catalog refresh remains
  the "Sync songs" button only. Mentioned once at approval; not a design
  item, not a deferred item — if a daily song sync is ever wanted it is a
  new decision.
- **`admin_clear_sync_flag` is any league admin or global — allow-plus-log.**
  The RPC clears the flag and records who cleared it and when (see the
  Stage U section). Shows are global; any league's admin may clear.

## Build order (strict)

1. **Stage U applied by the dev** in the Supabase SQL editor, verification
   queries run (footer of the stage file).
2. **Edge-function deploy** (`supabase functions deploy carton-sync
   --project-ref zdfhglvjxquvkjyvophz`). The function writes columns Stage U
   creates, so it must never go first.
3. **Client push** (`npm run build`, commit `app.js` + map with the source,
   push). The admin notice reads `shows.sync_flag`, which exists after 1.

Each step is verifiable on its own; nothing in a later step is needed to
confirm an earlier one.

## Shape

- A **pure module** `supabase/functions/carton-sync/showSync.js` — no
  Supabase client, no Deno APIs, same isolation as `scoring.js` — holds the
  three decisions as functions. `index.ts` fetches rows, calls them, and
  applies the writes they return. That is what makes the required tests
  plain Node tests rather than Deno-with-a-stubbed-client (the problem the
  still-open `activateSeasons` error-path test ran into).

### `showSync.js` exports

- `dailyGateDue({ ranAt, attemptedAt, now })` → boolean. Due when: the
  Eastern hour of `now` is ≥ 9; there is no `ranAt` on `now`'s Eastern
  calendar date; and `attemptedAt` is null or more than 30 minutes before
  `now`. Eastern conversion via `Intl.DateTimeFormat` with
  `timeZone: "America/New_York"`, the same idiom as `etHour()` /
  `easternDate()` in `index.ts`, parameterised on `now`.
- `diffShows({ incoming, existing, finalIds, today })` →
  `{ updates, flags, vanished }`.
  - `incoming`: the mapped Carton rows (`id, showdate, venue, city, state,
    permalink, timezone`) after the existing 14-day floor.
  - `existing`: the `shows` rows the app holds for those ids plus every
    row dated `today` or later.
  - `updates`: existing rows whose `showdate`/`venue`/`city`/`state`
    differ from Carton and whose id is NOT in `finalIds` — the full new row
    to upsert, plus `{ id, changed: [...], old: {...} }` for the caller.
  - `flags`: `{ id, note }` for changed rows that ARE in `finalIds`
    ("Carton changed <fields> (old → new); not applied — finalized in N
    league(s)"), and for vanished rows.
  - `vanished`: existing rows dated `today` or later whose id Carton no
    longer returns. If an incoming row that is NEW (not in `existing`) has
    the same `showdate` and `venue`, the note names it: "re-created on The
    Carton as show <newId>?".
  - Empty set: identical rows → all three lists empty. No writes, no posts.
- `cutoffPlan({ overlay, oldShow, newShow, defaultOf, now })` → one of
  `{ kind: "recompute", cutoff_at, resetStamps: boolean }` or
  `{ kind: "keep", note }`. `overlay` is one `league_shows` row.
  - Derived iff `overlay.cutoff_set_by_admin === false`, OR it is `null`
    AND `overlay.cutoff_at === defaultOf(oldShow.showdate, oldShow.state)`
    — compared against the OLD date, never the new one.
  - Recompute: `cutoff_at = defaultOf(newShow.showdate, newShow.state)`;
    `resetStamps` true when that cutoff is after `now`.
  - Keep: admin-set; note "date moved <old> → <new>; <league>'s admin-set
    cutoff left at <cutoff> — review".
  - `defaultOf` is injected: `index.ts` passes `venueCutoffISO`, the same
    function that produced the stored defaults, so the equality compare is
    against the value that was actually written.

### `index.ts`

- **Gate + stamp.** New table `sync_state` (see Stage U), one row keyed
  `daily_show_sync`. At the END of `scoreShows`, after the burst loop:
  read the row; if `dailyGateDue(...)`, write `attempted_at = now`, run
  `syncShows()`, then on success write `ran_at = now` and `note` (counts).
  `attempted_at` before the Carton call, `ran_at` only after success —
  the `activateSeasons` write-ordering lesson. **Skipped on a live-burst
  tick** (`live === true`): that invocation already sleeps ~36 s, and the
  free-tier wall-clock budget is the one real limit; it runs the next
  minute instead.
- **Isolation.** The whole daily block is inside its own `try/catch` that
  `console.error`s and returns `{ daily_sync: { error } }` in the
  response. Scoring has already run and returned its results by then;
  nothing in the sync can throw into the scoring path. A thrown error
  leaves `attempted_at` set and `ran_at` unset, so the 30-minute backoff
  applies.
- **`syncShows()` changes** (shared by the daily run and the "Sync shows"
  button; the button also stamps `ran_at`, so a manual run counts as that
  day's run):
  1. Fetch the Carton window as today.
  2. Read `existing` (`shows` for the incoming ids ∪ rows dated today or
     later) and `finalIds` (`league_shows.show_id where status = 'final'`,
     any league — the conservative reading of "finalized").
  3. `diffShows(...)`. Upsert `updates` (today's upsert loop, now
     restricted to new rows and non-final changed rows); write `flags`
     (append with " · " unless the identical note is already present —
     so yesterday's vanished note is not re-added today); never delete.
  4. For each update whose `changed` includes `showdate`: for each
     `league_shows` row of that show, `cutoffPlan(...)`. Recompute → update
     `cutoff_at` (+ `remind_sent = null, lock_sent = null` when
     `resetStamps`), `pingRealtime(league, show)`, and post the
     cutoff-changed message via `notifyLeague` — the message builder is
     factored out of `cutoffChanged()` so there is one wording. Keep →
     append the note to `shows.sync_flag`.
  5. Overlay creation, festival promotion and the NULL-cutoff refill stay
     exactly as today; new overlay inserts set `cutoff_set_by_admin =
     false`.
  6. Return counts: `synced, updated, flagged, vanished, cutoffs_moved,
     overlays_created, cutoffs_defaulted`.
- Discord delivery is unchanged: `notifyLeague` posts only where the
  league's env hook exists. Known, separate: Green Eggs posts currently
  land in the Ambassadors channel (`discord-routing.md`). **⚠️ CORRECTED
  2026-10-28 (dev's information): they land in Green Eggs' Discord,
  through the webhook built for Ambassadors. Ambassadors has no working
  channel.**

### Stage U — `sql/stage_u_show_sync.sql`

- `alter table league_shows add column cutoff_set_by_admin boolean;` —
  nullable, no default, **no backfill**: null means "predates the flag"
  and routes to the old-date comparison. (Stage R, still unapplied, gets
  a one-line note to set `false` on its seeded rows when it is applied.)
- `admin_set_cutoff`: same body plus `cutoff_set_by_admin = true` in the
  update.
- `alter table shows add column sync_flag text;` — nullable. Readable via
  the existing public `shows` select; carries venue/date facts only.
- `create table sync_state (key text primary key, ran_at timestamptz,
  attempted_at timestamptz, note text);` RLS enabled, NO policies, all
  privileges revoked from `anon` and `authenticated`. The service-role
  edge function bypasses RLS.
- `create table sync_flag_clears (show_id bigint references shows(id) on
  delete cascade, cleared_by uuid references players(id), cleared_at
  timestamptz default now(), note text);` RLS enabled, no policies,
  revoked from anon/authenticated — the allow-plus-log record. Holds a
  player UUID, never a nickname; never exported into a tracked file.
- `admin_clear_sync_flag(p_name, p_pin, p_show_id)`: `_auth_player`,
  `_reject_if_must_change_pin`, then allow if `is_global_admin` OR exists
  `league_members` row for the caller with `is_league_admin`; insert the
  log row with the flag text as `note`; set `sync_flag = null`. Revoke
  public, grant anon/authenticated.
- Footer: deploy check first (both functions present), column checks,
  then a `begin … rollback` behaviour test for `admin_clear_sync_flag`
  (no throwaway rows persist).

### Admin Shows section (`src/features/admin.js`, `src/main.js`)

- For each show with `sync_flag`, a `.noticebox` under the row head with
  the flag text and a "Clear" button → `clearSyncFlag(showId)` (on
  `window`) → `admin_clear_sync_flag` → re-render. `fetchShows` already
  selects every column, so no fetch change. No new CSS.

### Tests

- **New `test/showSync.test.mjs`**, plain Node like `scoring.test.mjs`,
  **wired into `npm test`** (`node test/scenario.test.mjs && node
  test/showSync.test.mjs`) so it cannot go stale the way the scoring
  tests did. Cases:
  - date change, non-final, derived cutoff → recompute equals the new
    default, `resetStamps` true for a future cutoff, exactly one post per
    league row (asserted on the returned plan, one entry per league);
  - same with an admin-set cutoff (`true`) → keep, note, no post;
  - null flag equal to the OLD default → derived; null flag unequal →
    admin-set;
  - date change on a show one league has final (the other not) → no
    update, flag, no post;
  - vanished show → flag text, present in `vanished`, absent from any
    delete list (there is none), re-create pair named together;
  - empty set → zero updates, flags, vanished;
  - `dailyGateDue` with injected `now`: 08:59 ET never run → false; 09:00
    never run → true; ran today, now 15:00 → false; ran yesterday 09:00,
    now 09:00 → true; failed attempt 10 min ago → false; 31 min ago →
    true; a DST-transition day (compares Eastern calendar dates).
- **Scenario harness**: a fixture show with `sync_flag` renders the
  notice; the fake `admin_clear_sync_flag` clears it and the notice
  disappears; the default fixture (no flags) renders no notice.
- Mutation pass: one mutation per function (gate hour, finalIds check,
  old-vs-new default compare, vanished floor, empty-set short-circuit).

## Files

`supabase/functions/carton-sync/showSync.js` (new) ·
`supabase/functions/carton-sync/index.ts` · `sql/stage_u_show_sync.sql`
(new) · `src/features/admin.js` · `src/main.js` · `test/showSync.test.mjs`
(new) · `test/harness.mjs` · `test/fixtures.mjs` · `test/scenario.test.mjs`
· `package.json` · `app.js` + `app.js.map` (rebuilt) · build note in
`docs/decisions/cron-secret-edge-auth.md` when done.

**RPCs:** `admin_set_cutoff` (modified), `admin_clear_sync_flag` (new).
**Tables/columns:** `league_shows.cutoff_set_by_admin`, `shows.sync_flag`,
`sync_state`, `sync_flag_clears`.

## Not in scope (recorded so it is not inferred later)

- `scoreShow`'s fallback to every setlist row for that date (decision 6).
- A dedupe stamp on `cutoffChanged()` (decision 6).
- Daily `syncSongs` (approval decision above).
- Any change to Discord routing.
