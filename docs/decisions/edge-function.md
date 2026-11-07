# Edge function: season activation write ordering and its untested error path

> Extracted verbatim from `CLAUDE.md` at commit 54a5ab8 (2026-10-18), original lines 1327–1373, 4210–4239. Nested entries were de-indented to top level; wording is unchanged.
> Decision record — currently binding. `CLAUDE.md` holds only a pointer stub under the same entry name; this file is the full text and rationale.

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
- **2026-11-07 — The same family, found live: `sync_songs` had failed on
  EVERY press since 2026-07-18, writing zero rows, and the error was
  hidden.** The Carton's `/songs.json` lists "When I Paint My Masterpiece "
  (trailing space) under two ids (created 2026-07-18 00:26 and 00:38 UTC).
  `syncSongs` upserted all 370 rows in one statement with
  `onConflict: "songname"`; one statement meeting the same conflict key
  twice is Postgres error 21000 ("ON CONFLICT DO UPDATE command cannot
  affect row a second time"), and the whole statement rolls back — so
  `songs_cache` froze at 363 of 370 (newest Carton title present: created
  2026-05-15; the seven absent: the duplicate pair, And It Stoned Me, Wild
  Mountain Honey, The Wreck of the Edmund Fitzgerald, Codex, Fire on the
  Mountain). The handler returned `{ ok: false, error: String(e) }`, and
  String() of a PostgrestError — a plain object, not an Error — is
  "[object Object]", which is all the admin toast ever said. Found when a
  player could not pick The Wreck of the Edmund Fitzgerald on the night of
  2026-11-07 (reproduced from the CLI: HTTP 500, that body; count 363
  before and after a press). **Scoring was never affected**: nothing but
  this sync reads or writes `songs_cache` — scoring matches
  `setlist_songs` against picks through `norm()` — so a title typed in full
  always scored; only the autocomplete and the not-in-catalog warning were
  wrong. **Stopgap, run by Kyle in the SQL editor that night:** an insert of
  the six distinct missing titles (the duplicate pair collapses to one) with
  the Carton's EXACT names, trailing spaces included, `times_played`/
  `last_played` null, `is_original` false, `on conflict (songname) do
  nothing` — count 369 afterwards. The trailing spaces are deliberate: they
  are the conflict key, so a later successful sync upserts cleanly OVER
  those rows instead of adding a second spelling beside them; the
  autocomplete's `normSong` is whitespace-insensitive and `savePicks` trims
  the value, so players never see the space. **Fix, committed 2026-11-07,
  NOT deployed:** `mapSongRows` in `setlistCheck.js` dedupes by exact
  decoded name, first occurrence wins (test/catalogSync.test.mjs carries the
  real Carton shape); `errorText` in `errorText.js` replaces `String(e)` in
  the handler (message + code + details, JSON fallback) and the 500 path
  logs it; the response adds `carton_rows` beside `songs` so the duplicate
  count is visible. **Deploy sequencing (Kyle's call):** ships with the
  3-hour reminder — with deploy A if A is ready on 2026-11-08, else on the
  daylight hotfix branch off `829ca6a` (discord-routing.md, the 2026-11-07
  note). Cherry-pick caveat for that branch: at `829ca6a` `index.ts` does
  not import `setlistCheck.js` and defines `decodeEntities` itself, so the
  hotfix adds the import (and `errorText.js`) by hand. The generalisation
  for the pattern above: a batch write can fail on the DATA, not only on a
  conflict with existing rows, and an error that is thrown but stringified
  badly is as invisible as one never checked.

---

**Deferred, small, and worth doing: a unit test for `activateSeasons()`'s
ERROR path.** Test 3's activation on 2026-08-14 exercised the success path
under heavy conflict (13 of 14 rows collided and were skipped, 1 inserted,
`roster_locked_at` stamped 0.1s after the write) — but **no write failed, so
the error path has never actually run**. The half still unverified is: on a
failed roster write, `roster_locked_at` is left `null`, the failure is
`console.error`-logged and surfaced, and the next cron run retries the
season. **Two identifiers are involved and they are not interchangeable**:
`failed` is the local array and the key in `activateSeasons()`'s own return
(`return { activated, failed }`, index.ts:365), while
`season_activation_failures` is the HTTP-response key `scoreShows()` maps it
to (index.ts:540 and 556). A unit test calling the function directly sees
`failed`; only an end-to-end HTTP call sees `season_activation_failures`.
That behaviour is currently guaranteed only by
reading the code, and it is precisely the half whose absence caused the
original bug — the old code stamped `roster_locked_at` regardless of whether
the insert succeeded, turning a recoverable error into a permanent silent
one.
- **Shape**: stub the Supabase roster write to return an error, call
  `activateSeasons()`, assert `roster_locked_at` stays null, the season
  appears in the returned `failed` list, and a second call retries it.
- **Same harness idiom as the 7a-7p blocks in `test/scoring.test.mjs`** —
  plain Node, no Deno, no network, a hand-rolled `check()` and fixture
  objects. The wrinkle is that `activateSeasons` lives in `index.ts` and
  talks to `supa` directly, unlike `scoring.js` which is pure data-in/
  data-out; the stub therefore has to stand in for the Supabase client
  rather than just supply inputs, or the function needs its client injected.
  Worth sizing that before starting — it may be the difference between a
  30-minute task and a refactor.
