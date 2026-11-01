# Discord webhook routing: current state and the propagation test

> Extracted verbatim from `CLAUDE.md` at commit 54a5ab8 (2026-10-18), original lines 706–845. Nested entries were de-indented to top level; wording is unchanged.
> Decision record — currently binding. `CLAUDE.md` holds only a pointer stub under the same entry name; this file is the full text and rationale.

## ⚠️ CORRECTION 2026-10-28 (the dev's information): the routing state below is OUT OF DATE

This is the dev's statement of 2026-10-28, recorded as given. A secret's
value and a webhook's destination can't be read from here, so it is the
dev's attestation, not a reading.

- **What this record said:** from 2026-10-14, Discord posting was silenced
  for both leagues (the global `DISCORD_WEBHOOK` was deleted). Green Eggs
  was then re-enabled the same day through its own secret, but posting
  INTO the Ambassadors channel.
- **What is true, per the dev:**
  - The dev reused the webhook built for Ambassadors for Green Eggs.
  - Green Eggs' posts fired through the 2026-10-23 show, and Green Eggs'
    Discord works.
  - Ambassadors has no working channel.
- **So two claims below are out of date, and each is marked where it
  stands:**
  - "Silenced for both leagues": not true since Green Eggs' secret was
    set on 2026-10-14. Only Ambassadors is silent.
  - "Green Eggs posts go to the Ambassadors channel": the webhook was
    built for Ambassadors, but it now serves Green Eggs, and Green Eggs'
    posts reach Green Eggs' Discord.
- **Not stated, so not recorded:** how that webhook came to reach Green
  Eggs' Discord.
- **Unchanged:**
  - Ambassadors (league 1) resolves to no hook, so it posts nothing.
    **[No longer true since D7, 2026-10-31: `DISCORD_WEBHOOK_AMBASSADORS`
    is set; the D7 record under "Part 1 status" below.]**
  - Nothing replays on restore.
  - The split decided on 2026-10-14 stands: a per-league secret, no
    global fallback, and a league-name prefix. **[Prefix SUPERSEDED
    later on 2026-10-28 by a per-league author name: "Per-league split"
    below, D2.]**
  - Item (f)(i) below, "a separate Discord-side webhook for Green Eggs",
    now reads the other way round: it is Ambassadors that has no webhook.
    That is for the split's plan to settle, not this correction.
- **The 2026-10-15 propagation test:** posts firing means Green Eggs'
  secret was read, so the Green Eggs half passed (a deduction from the
  dev's statement). The dev did not say how many reminders appeared, so
  the two-sided result is still unrecorded, and `CLAUDE.md`'s DATED
  DEADLINES row stays open.

## Per-league split: LOCKED 2026-10-28 (the dev's picks), with the build plan

A fresh session builds from this section: **Part 1 first, then Part 2.**
**Part 1 is BUILT 2026-10-31** ("Part 1 status" below holds the build and
deploy record) **and D7 is DONE 2026-10-31** (the "D7" record at the end of
"Part 1 status"); **Part 2 is LIVE 2026-11-01** (Stage Y applied, edge deployed 18:26
UTC, client pushed 18:28 UTC, live build id `14b071b-de691c7`) — the "Part 2
build record" and "Part 2 status" below. The survey it rests on was read-only
and is summarised under "Survey basis" below.

### Decisions

- **D1, how the app knows a league's Discord is live: server-side, in
  Stage Y.**
  - The edge function checks each league's webhook once a day. A GET on a
    webhook posts nothing: 200 means live, 404 means deleted.
  - It also records the result of every post.
  - `my_leagues` returns `discord_live`, and the hint shows only in
    leagues where it is true.
  - Stage Y stores no webhook URL. Routing stays on env vars (roadmap
    decision 2).
- **D2, the label: a per-league author name, "Fantasy Eggy · <League>",**
  set through the webhook's `username` override on every post.
  - **It SUPERSEDES the locked 2026-10-14 text-prefix decision** (item
    (f)(iii)), by the dev's pick: it labels every post, and it hides the
    reused webhook's old name.
  - There is no text prefix. "Fantasy Eggy" is a top-of-file constant in
    the edge code (Conventions: instance values in named constants).
- **D3, notifications: a plain-text tip,** "set this channel to All
  Messages", in the hint's "How?" expander.
  - The role ping is DEFERRED. Revisit if players ask for a ping on the
    reminder only. It would need a self-assigned role per league and a
    test post.
- **D4, as recommended:** the hint shows everywhere, desktop included.
- **D5, as recommended:** dismissal is per league, with the flag keyed by
  league id.
  - A Join tap counts as a permanent dismissal.
  - The Settings switch restores the hint for the current league.
  - The install flag stays per device.
- **D6, as recommended: one hint at a time.** The Discord hint never shows
  while the install bar or the welcome card is on screen.
- **D7, Ambassadors gets its own webhook. ✅ DONE 2026-10-31** (record at
  the end of "Part 1 status"). The dev creates it and sets
  `DISCORD_WEBHOOK_AMBASSADORS` in the dashboard, **only after Part 1 is
  live**, so its first posts already carry the author name and the
  mention block. Verified by name, and by a digest comparison with Green
  Eggs' that reports same or different only (practice below).
- **D8, as recommended:** the mention block and the fallback removal ship
  first, as Part 1.

### Survey basis (2026-10-28, read-only)

- **Secrets:** 8 names, the seven platform defaults plus
  `DISCORD_WEBHOOK_GREEN_EGGS`. There is no `DISCORD_WEBHOOK` and no
  `DISCORD_WEBHOOK_AMBASSADORS`.
- **The deployed function is the committed source.** It was downloaded to
  a scratch folder, and `index.ts`, `scoring.js` and `showSync.js` compared
  equal with `cmp`.
- **Keys from the live names:**
  - league 1, `Ambassadors` → `DISCORD_WEBHOOK_AMBASSADORS`;
  - league 2, `Green Eggs` → `DISCORD_WEBHOOK_GREEN_EGGS`.
- **Routing today:** `notifyLeague` reads the league's own key, then
  `DISCORD_WEBHOOK`, on every call.
  - Every caller passes the name of the league the event belongs to.
  - So Ambassadors' posts resolve to nothing and are dropped.
  - Green Eggs gets its own copy of the song posts for a show on both
    schedules.
- **The posts** (none names its league):
  - the 1-hour reminder, naming members who haven't picked;
  - the lock;
  - the show winner, per bracket;
  - the season champion;
  - song-by-song, once per league;
  - cutoff changed, from the daily sync or an admin;
  - the show-sync flag, sent to every league;
  - scores reopened.
- **Delivery:** the body is `{content}` only, with no `allowed_mentions`.
  The HTTP status is ignored (`.catch(() => {})`), so a dead webhook is
  silent.

### Part 1: edge function only (no SQL, no client)

- **New `supabase/functions/carton-sync/discord.js`,** pure and testable
  in Node like `scoring.js` and `showSync.js`:
  - `webhookEnvKey(name)`, the same derivation as today;
  - `resolveHook(name, getEnv)`: the league's own key only, with **no
    global fallback**, and null for an empty or missing name;
  - `discordBody(leagueName, msg)`: `content` capped at 1900, `username`
    "Fantasy Eggy · <League>" (Discord caps it at 80 characters), and
    `allowed_mentions: { parse: [] }`.
- **`index.ts`:**
  - `notifyLeague` uses `discord.js`;
  - fix the stale comments at 101–106 (the global fallback "keeps
    Ambassadors working") and 357–359 ("points at the Ambassadors
    channel").
  - Part 1 still ignores the HTTP status. Recording it is Part 2.
- **`test/discord.test.mjs` (new, in `npm test`):**
  - both live keys;
  - only `DISCORD_WEBHOOK` set gives null;
  - an empty name gives null;
  - every body carries `parse: []` and the league's author name;
  - the 1900 cap.
- **Mutations:**
  - M1, the global fallback restored;
  - M2, the mention block dropped;
  - M3, the author name dropped or naming the wrong league.
- **The dev's steps for Part 1, in order:**
  1. Deploy: `supabase functions deploy carton-sync --project-ref
     zdfhglvjxquvkjyvophz`.
  2. Claude verifies the deploy by download and `cmp`.
  3. Check the next Green Eggs post: its author line reads "Fantasy Eggy
     · Green Eggs".
  4. Then (D7): create the Ambassadors webhook, and set
     `DISCORD_WEBHOOK_AMBASSADORS` in the dashboard, never on a command
     line. **✅ Done by the dev 2026-10-31.**
  5. Claude verifies it by name, and by a digest comparison with Green
     Eggs' (must be "different"). **✅ Done 2026-10-31: "different".**

### Part 1 status: ✅ LIVE 2026-10-31 (commit `bb2dea4`, deployed and verified the same day)

- **Pre-build checks, 2026-10-31, read-only:** tree clean on `main` at
  `a949ba3`, equal to `origin/main`. At 18:35 UTC no `league_shows` row of
  either league had a cutoff or a live/unfinalized status within 12 hours;
  the next show is 2026-11-06 (cutoff 23:00 UTC), so the deploy is NOT held.
  The deployed function was downloaded to a scratch folder BEFORE the build
  (`supabase functions download carton-sync --workdir <scratch>`, which
  never touches the repo copy) and `index.ts`, `scoring.js`, `showSync.js`
  compared identical to HEAD with `cmp`: the deploy replaces exactly the
  committed source.
- **Built, as planned:** `supabase/functions/carton-sync/discord.js` —
  `webhookEnvKey` (the same derivation as before), `resolveHook` (the
  league's own key only, NO global fallback, null for a name that derives to
  no key, and no env read at all in that case), `authorName` ("Fantasy Eggy
  · <League>", capped at Discord's 80 counting the WHOLE label), `discordBody`
  (`content` capped at 1900, the author name, `allowed_mentions: { parse: []
  }`, nothing else) and `postOutcome` (the HTTP status sorted into `ok`,
  `http_<code>` or `error` — Part 2's `discord_status` vocabulary). `index.ts`:
  `notifyLeague` uses the three, the two stale comments (the global-fallback
  rationale, "points at the Ambassadors channel") are fixed, and the header
  has a v9 note. `test/discord.test.mjs` is in `npm test`; the full suite is
  green.
- **One small extension of the plan, stated plainly:** the plan said Part 1
  "still ignores the HTTP status". It now sorts the status and writes a
  failed post to the function log with `console.error`. Nothing is stored,
  there is no column, and a successful post behaves exactly as before.
- **Mutations, each KILLED, each revert `cmp`-identical to a pristine copy
  taken after the suite passed:** M1 (global fallback restored) failed 4
  checks, among them "exactly ONE key is consulted, the league's own"; M2
  (mention block dropped) failed 4; M3 (label dropped) failed 4. Each was
  applied and reverted by an exact-text anchor that must occur exactly once
  (discipline item 6), never by line number.
- **Unchanged:** the secret names, every message text, the stamps and the
  dedupe. Ambassadors still resolves to no hook until D7 [done the same
  evening, below]. No `?wait`, no
  avatar: the Discord avatar is set per webhook in Discord
  (`frontend-css.md`, brand assets).
- **Deploy, 2026-10-31 (by the assistant on the dev's instruction, with
  CLAUDE.md's deploy command), VERIFIED:** committed as `bb2dea4` and pushed
  (`main` = `origin/main`) first, then deployed ("Deployed Functions.", the
  four assets uploaded), then downloaded to a fresh scratch folder and all
  four files — `index.ts`, `discord.js`, `scoring.js`, `showSync.js` —
  compared identical to HEAD `bb2dea4` with `cmp`. The literal
  `"DISCORD_WEBHOOK"` occurs zero times in the deployed `index.ts`.
  **And the deployed function boots with the new import:** every cron
  response in `net._http_response` from 18:44 UTC on (the first tick after
  the deploy) is 200 with `{"ok":true,…,"note":"no eligible shows"}` — a
  byte-identical download alone would not show a Deno import failure.
- **What to watch next:** the first post after this deploy is the 2026-11-06
  show's 1-hour reminder at 22:00 UTC (Green Eggs' channel): its author line
  must read "Fantasy Eggy · Green Eggs" (the dev's step 3). **[Since D7, the
  same reminder should also be Ambassadors' first post ever, in its own
  channel: the D7 record below.]** A failed post now
  leaves a `notifyLeague: Discord post failed` line in the function log.
- **D7 ✅ DONE 2026-10-31 (the dev's action, verified the same evening).**
  The dev created the Ambassadors webhook in Discord and set
  `DISCORD_WEBHOOK_AMBASSADORS` in the Supabase dashboard (never on a
  command line; the platform stamps it 20:36 UTC). Verified by NAME:
  `supabase secrets list` holds 9 names, the seven platform defaults plus
  `DISCORD_WEBHOOK_GREEN_EGGS` and `DISCORD_WEBHOOK_AMBASSADORS`; there is
  still no `DISCORD_WEBHOOK`. **Digest comparison: DIFFERENT**, done inside
  a script that reads both digests and prints only the names and the
  verdict (the practice under "Corrections to Chat"). Neither value nor
  digest is in any file or commit.
  - **Stated plainly:** a first names-only attempt filtered the CLI output
    as a table, but the default output is JSON (the gotcha at the bottom of
    this file), so both digests passed through to the assistant's tool
    output before the script-based comparison ran. Same shape as the
    2026-10-28 correction; in no file, no commit and no message to the dev.
  - **The avatar:** the dev re-uploaded the new `discord-icon.png`
    (`frontend-css.md`, brand assets) as the avatar on BOTH webhooks in
    Discord's settings. The function still sends no `avatar_url`.
  - **What follows from D7, in code already deployed:** league 1's posts now
    resolve to its own hook (the key is derived from the live name
    `Ambassadors`, "Survey basis" above), so the 2026-11-06 reminder should
    appear ONCE in EACH channel, each under its own author name ("Fantasy
    Eggy · Ambassadors", "Fantasy Eggy · Green Eggs"), provided both
    leagues' rows for that show carry a cutoff (not re-checked tonight).
    Two posts in one channel = both webhooks deliver to the same channel
    (the digests differ, so they are two webhooks, not one URL twice); a
    league's post in the other league's channel = the values are swapped; a
    missing Ambassadors post with `remind_sent` set = the key was not read
    (check the exact name first).
  - **No gap and no replay:** stamps always advanced while Ambassadors had
    no hook, so its first post is simply the next event, not a backlog.
- **Next: Part 2 (Stage Y).** It starts in a later session, from the "Part
  2" section below.

### Part 2: Stage Y and the hint

- **Stage Y is RESERVED for this Part 2 (the dev's call, recorded
  2026-10-30).** Any other feature needing a schema change takes the next
  free letter. Files on disk run through `stage_x`, so that is Z as of this
  writing.
- **`sql/stage_y_discord_status.sql`:**
  - `leagues` gets `discord_status` (`ok`, `no_key`, `http_<code>` or
    `error`), `discord_checked_at` and `discord_ok_at`. The columns are
    public through "pub leagues", and they hold no URL.
  - `my_leagues` is dropped and recreated, adding `discord_live` (status
    ok, checked within about 2 days).
  - The footer has STEP 0, 2A and 2B, and `test/stageY.test.mjs` checks
    it the way `stageX.test` does.
- **`index.ts`:**
  - the daily webhook check runs inside the existing daily gate
    (`dailyGateDue`);
  - every post records its result.
- **Client:**
  - `src/core/discordHint.js`: the rule, the bar and the per-league flag.
    It reuses `.installbar`/`.installhow` and the "How?" toggle, which
    holds the All Messages tip.
  - a `#discord-bar` slot in `shows.js`, after `#install-bar`;
  - a "Show Discord tip" switch in `settings.js`, for the current league;
  - window exports in `main.js`, and the flag prefix in `config.js`.
- **Scenario checks, both modes:**
  - the bar shows only with `discord_live` and an https `discord_url`;
  - never with the install bar or the welcome card;
  - Join opens the link and sets the flag, and the bar stays gone after a
    reload;
  - ✕ dismisses the same way, and the Settings switch restores it;
  - the other league is unaffected;
  - the old `my_leagues` (no column) or a `javascript:` URL never shows it.
- **Mutations:**
  - M4, the hint ignores the install bar;
  - M5, Join doesn't set the flag;
  - M6, the hint ignores `discord_live`;
  - M7, the flag is device-wide;
  - M8, `discord_live` ignores a stale check.
- **Residual:** a footer still can't run locally (the PGlite candidate in
  `testing-harness.md`), so the dev's STEP 0 is its first run.
- **The dev's steps for Part 2, in order:**
  1. STEP 0, apply, STEP 2A, STEP 2B.
  2. Deploy; Claude verifies by download and `cmp`.
  3. Claude pushes the client and confirms the build id.
  4. After the next daily gate:
     `select id, discord_status, discord_checked_at from leagues;` reads
     `ok` for both leagues.
  5. Device checks: the bar in each live league, never alongside the
     install bar or the welcome card; Join, and it never returns.
- **Swapping a league's webhook later, with no gap:**
  1. create the new webhook;
  2. replace the secret's value;
  3. a digest comparison reports "different";
  4. wait for `discord_status` to read `ok`;
  5. only then delete the old webhook.

### Part 2 build record: APPROVED 2026-11-01 (the dev's seven calls)

- **Pre-build state, 2026-11-01 04:37 UTC, read-only:** tree clean on
  `main` at `3ed62fc`, equal to `origin/main`; `sql/` runs through
  `stage_x`, no `stage_y` or `stage_z` file; no `league_shows` row of
  either league has a cutoff, or a non-final status with a past cutoff,
  within 12 hours. The next cutoffs are show 1786388218 (2026-11-06) and
  1786388257 (2026-11-07), both leagues, 23:00 UTC each (6 PM EST, DST
  having ended that morning; the 1-hour reminder fires at 22:00 UTC). The
  live `my_leagues` body md5 equals the Stage S file's
  (`dd072ff27627e89fffa1a6c02745a2d6`), the live `leagues` columns are
  `id, name, created_at, config`, and its only policy is the public
  select. `docs/security_audit_plan.md` does not exist.
- **What Part 1 left for Part 2 (checked against `3ed62fc`):**
  `notifyLeague(leagueName, msg)` resolves the hook, posts, sorts the
  answer with `postOutcome` and only logs a failure; it knows the league
  by NAME, and all ten call sites pass a name. `leagues.name` has no unique
  constraint (the primary key is the only one), so a per-post write needs
  the league ID, which every call site already holds.
- **The dev's calls, each a question the 2026-10-28 record left open:**
  1. **Gate row.** The daily webhook check has its OWN `sync_state` row,
     `daily_discord_check`, gated by the same `dailyGateDue` (09:00 ET, the
     30-minute backoff, skipped on a live-burst tick). Independent of a
     Carton failure and of the "Sync shows" button, both of which only
     touch `daily_show_sync`.
  2. **`discord_live`, a REFINEMENT of D1's "status ok, checked within
     about 2 days":** `discord_ok_at` within 2 days AND `discord_status`
     not in `http_404`, `http_401`, `no_key`. Reason: a transient 429,
     5xx or network error must not hide the hint for a day; a deleted
     webhook or a bad token must drop it at once; two days without any
     success drops it too.
  3. **Handover is NEXT RENDER, not immediate.** The Discord bar never
     appears as a direct result of dismissing the install bar or the
     welcome card; it shows the next time the shows list is built. Reason:
     one new hint per visit, and no cross-feature handover code. The
     scenario "card ✕ hands over" becomes "card ✕ does not hand over; the
     bar appears on the next render".
  4. **Join is an `<a target="_blank" rel="noopener noreferrer">`,** never
     `window.open` (in-app browsers block it). Its onclick sets the flag
     and clears the slot on the NEXT tick: an anchor removed from the
     document mid-click cannot navigate.
  5. **`no_key` is written on every post attempt** for a league whose name
     resolves to no secret, so a removed or renamed secret flips the
     league dead at its next event, not only at the next daily check.
  6. **The check constraint stays:** `discord_status` is `ok`, `no_key`,
     `error` or `http_<3 digits>`; a new status word needs a migration,
     by design.
  7. **Admin visibility.** `my_leagues` also returns `discord_status` and
     `discord_checked_at`; the admin Community editor shows one read-only
     line under the Discord link field: "Posting: OK, checked <relative
     time>" / "Not posting (<status>), checked <relative time>" / "Never
     checked". No new RPC: the row is the one `my_leagues` already
     returns at boot.
- **Also corrected with this record:** `docs/show_sync_plan.md`'s header
  still said Stage U was unapplied and undeployed; it has been live since
  2026-10-26.
- **Build order (the BUILT record follows below when done):** this record
  committed and pushed FIRST; then `sql/stage_y_discord_status.sql` (STEP 0
  / apply / 2A / 2B / STEP R, the Stage X shape), `discord.js` + `index.ts`
  (`notifyLeague` by id, `statusPatch`, `dailyDiscordCheck` wrapped like
  `dailyShowSyncSafe`, the stale `syncShows` comment fixed),
  `src/core/discordHint.js` + the bar + the Settings switch + the admin
  status line, `test/discord.test.mjs`, `test/stageY.test.mjs`, the harness
  scenario in both modes, mutations M4–M8 each applied and reverted with
  `git diff` empty between. Code committed LOCALLY, not pushed. **Deploy
  window: the edge deploy by Tue 2026-11-03, or after Sun 2026-11-08 13:00
  UTC** (the two Ardmore shows and their auto-finalize sit between).

### Part 2 status: ✅ LIVE 2026-11-01 — Stage Y APPLIED · edge DEPLOYED 18:26 UTC · first daily check ok ×2 · client PUSHED 18:28 UTC (build id `14b071b-de691c7`)

- **Deploy log 2026-11-01, each step recorded the moment it landed (the
  dev's steps 1–4 of the deploy message):**
  1. ✅ **Stage Y APPLIED 2026-11-01** by the dev in the SQL editor: STEP 0
     all ok, the apply block succeeded, STEP 2A all ok, STEP 2B
     `0 of 15 FAILED`. `leagues` now carries `discord_status`,
     `discord_checked_at`, `discord_ok_at` (all null until the first
     check), `my_leagues` returns the three new columns, and the gate row
     `daily_discord_check` sits unstamped (Y2.7). The deployed function
     is still Part 1's (`bb2dea4`): it ignores the new columns.
  2. ✅ **edge DEPLOYED 2026-11-01 18:26 UTC** (`supabase functions deploy
     carton-sync --project-ref zdfhglvjxquvkjyvophz`: "Deployed Functions.",
     the four assets uploaded, the usual Docker warning). Pre-deploy read-only
     check: no `league_shows` row with a cutoff within 12 hours and no show
     in the live window (today or yesterday, Eastern); next cutoff 2026-11-06
     23:00 UTC. Verified by download into a scratch `--workdir` and `cmp` of
     all four files against HEAD (`index.ts`, `discord.js`, `showSync.js`,
     `scoring.js`: identical, byte for byte), and by the cron responses in
     `net._http_response`: the 18:22–18:26 UTC ticks (Part 1's function)
     answered 200 with no `discord_check` key; the first post-deploy tick at
     18:27:00 UTC answered 200 with one, so the new function booted.
  3. ✅ **First daily check ran on that first post-deploy tick, 18:27 UTC**
     (13:27 EST: the gate had been open since 09:00 ET and the seeded row
     was unstamped, so the first tick was due). Read back at 18:27:17 UTC:
     both leagues `discord_status = ok`, `discord_ok_at` equal to
     `discord_checked_at` (18:27:02 UTC each); `sync_state` row
     `daily_discord_check` stamped `attempted_at` 18:27:02.36, `ran_at`
     18:27:02.96, note `{"checked":2,"ok":2,"no_key":0,"failed":0}`; the
     tick's `discord_check` read `{"due":true,"checked":2,"ok":2,"no_key":0,
     "failed":0}`. Both webhooks answered the GET with 200 — status only,
     the body cancelled unread. The daily show sync's own row was untouched
     (its 09:00 ET run stood). Next check: the first tick at or after 09:00
     ET on 2026-11-02; `discord_live` stays true for 2 days from each `ok`.
  4. ✅ **client PUSHED, Part 2 LIVE 2026-11-01 18:28 UTC.** No rebuild: the
     committed bundle is the one the suite and the mutations ran against,
     build id `14b071b-de691c7`. `git push origin main` moved origin from
     `de691c7` to `e2aeed3` (the build `065648e`, the BUILT record `4f34994`,
     deploy-log steps 1–3). The live `app.js` served the previous id
     `9dbc014-9e7ecb1` for three reads and `14b071b-de691c7` from 18:29:32
     UTC (Invoke-WebRequest with a cache-busting query; PowerShell, no
     curl). An open PWA keeps the old bundle for up to 10 minutes
     (`deploy-cache.md`). Read-only at 18:30 UTC, values not printed: BOTH
     leagues already hold an https `discord_url` in `leagues.config`, so
     both bars can show — Ambassadors needs no Admin → Community step
     first (the deploy message assumed it did; the row says otherwise).
     The Community save patches the client's own league rows, so a new
     link needs no reload; `discord_live` is read at boot only.
- **Built as approved, with the seven calls applied.** `sql/stage_y_discord_status.sql`
  (head: the three columns, the check constraint, `my_leagues` dropped and
  recreated with `discord_live`, `discord_status`, `discord_checked_at`, the
  `daily_discord_check` gate row seeded; footer in the Stage X shape: STEP 0
  five read-only checks anchored on Stage S's `my_leagues` md5
  `dd072ff27627e89fffa1a6c02745a2d6`, STEP 2A seven checks anchored on Stage
  Y's `13d48d9aee5f65990eb706790748db28`, STEP 2B a 15-check smoke that
  always rolls back, STEP R the rollback to Stage S's exact body).
  `discord.js`: `NO_KEY`, `DEAD_STATUSES`, `STATUS_RE`, `statusPatch`;
  `postOutcome` maps an out-of-range or fractional number to `error` so the
  stored word always satisfies the constraint. `index.ts` (header v10):
  `notifyLeague(leagueId, leagueName, msg)` at all nine call sites,
  `recordDiscord` after every post and `no_key` on every attempt without a
  secret; `checkWebhooks` / `dailyDiscordCheck` / `dailyDiscordCheckSafe`
  beside the show sync, own `sync_state` row, same `dailyGateDue`, skipped
  on a live burst, GET by secret NAME, only the HTTP status read and the
  body cancelled unread, `ran_at` stamped only when every status write
  succeeded, returned as `discord_check` on both paths; the stale
  `syncShows` comment fixed. Client: `src/core/discordHint.js` (the pure
  rule `discordHintApplies`, the bar on `.installbar`/`.installhow`, Join as
  an anchor whose onclick sets the flag and clears the slot on the next
  tick, ✕, How? with the All Messages tip, `relativeTime`,
  `discordStatusLine`), `DISCORD_FLAG_PREFIX` in `config.js`,
  `discordLinkOf` behind `community.js`'s one https guard, the
  `#discord-bar` slot after `#install-bar` rendered once per build of the
  list AFTER `renderInstallSlots()`, the "Show Discord tips" switch under
  the league links in Settings, the read-only line under the Discord link
  field in the admin Community editor, four window exports. Tests:
  `test/discord.test.mjs` (statusPatch, the vocabulary, the dead words),
  `test/stageY.test.mjs` in `npm test`, `runDiscordHintScenario` in the
  harness with a second league added locally (the shared fixture stays
  single-league), 13 checks per mode. **Full suite green in both modes.**
  Build id `14b071b-de691c7`.
- **Two build details, recorded at build weight (not the dev's calls):**
  the Settings switch acts at once on its own slot, as the install switch
  does — only the cross-feature handover waits for the next render; and a
  stale success reads "Not posting (ok), checked 3 days ago" in the admin
  line: the word is what was stored, the time says why it is not live.
- **Call 7 needed NO admin RPC change:** the status rides on the
  `my_leagues` row the client already loads. No follow-up candidate.
- **Mutations, each KILLED, each reverted by exact-text replacement with
  `git diff --stat` EMPTY against HEAD afterwards (discipline item 6):**
  M4 (the hint ignores the install bar) failed the D6 install-first check;
  M5 (Join doesn't set the flag) failed the Join and the per-league checks;
  M6 (the hint ignores `discord_live`) failed the refined-D1 and the
  link-gate/legacy checks; M7 (the flag device-wide) failed five checks,
  Join, per league, ✕, per device, the Settings switch; M8a (the harness
  mirror of `discord_live` drops the 2-day window) failed the refined-D1
  and the admin-line stale case, and `stageY.test`'s "harness mirrors the
  SQL rule"; M8b (the SQL body's window widened to 20 days) failed
  `stageY.test`'s STEP 2A md5 and its window check. Each client mutation
  turned the same checks red in BOTH modes.
  - **Stated plainly, the build-id caveat:** the committed `app.js` was
    built before its commit existed, so its `<contenthash>-<gitsha>` label
    carries the PREVIOUS commit's sha (`de691c7`) by construction, while a
    rebuild after a revert stamps HEAD's. The runner proved the content
    hash half IDENTICAL after every revert (it covers `src/**`,
    `styles.css` and `index.html`, so equality proves the source is back)
    and restored the committed label by exact-text replacement; only then
    was `git diff` empty. The first three runs (M4–M6) showed that one
    label line as the only diff before the runner learnt this.
- **Residual, stated plainly:** the footer has never run against a real
  database (the PGlite candidate in `testing-harness.md`), so the dev's
  STEP 0 is its first run; the daily GET check has not been exercised
  against Discord — the first daily run after the deploy is that test; the
  harness proves the fake's `discord_live`, STEP 2B proves the live
  expression. Liveness is read at boot (`my_leagues` is not re-run on
  foreground), which a once-a-day check makes acceptable.
- **Steps 1–5 of the Part 2 plan are DONE 2026-11-01 (the deploy log
  above); the edge deploy landed inside the window (by Tue 2026-11-03).**
  Rollback per layer if a device check fails: the client — revert
  `065648e`'s `src/` files, rebuild, push (the function and Stage Y can
  stay: the old client ignores the new columns); the function — revert its
  edge files and redeploy; the SQL — STEP R, only with Part 1's function
  deployed.
- **NEXT: the dev's device checks, per league.** Close and reopen the PWA
  (an open tab keeps the old bundle up to 10 minutes); Settings shows build
  id `14b071b-de691c7`. In each league: (1) Shows with the install bar or
  the welcome card up shows NO Discord bar, and dismissing those does not
  summon it until the next render (switch tabs and back); (2) the bar reads
  "Get show reminders and scores in Discord" with Join · How? · ✕; (3) How?
  opens the All Messages tip and closes again; (4) Join opens the invite in
  a new tab, and on return the bar is gone and stays gone through tab
  switches, a reopen, logout and re-login; (5) Settings → "Show Discord
  tips" is off after Join or ✕, on brings the bar back, off removes it;
  (6) the flag is per league (the other league's bar is unaffected) and per
  device (a second device still shows it); (7) Admin → Community reads
  "Posting: OK, checked N minutes ago" under the Discord link field. Then
  one non-admin player per league confirms the bar and that Join opens the
  invite. The CLAUDE.md Discord stub still reads "NEXT: Discord Part 2
  (Stage Y)" — left untouched on the dev's standing instruction; a one-line
  update is the open follow-up.

### Corrections to Chat (recorded 2026-10-28)

1. **Chat said an Ambassadors show would post into Green Eggs' channel.
   That is wrong.** The lookup is per league, Ambassadors has no key, and
   no global secret exists, so its posts are dropped. It would become true
   only if `DISCORD_WEBHOOK` came back holding Green Eggs' URL, and Part 1
   removes that fallback.
2. **Chat's survey prompt asked for secret digests, against the repo rule**
   (`CLAUDE.md`: never print a secret's value or its digest). This session
   followed the prompt and printed the one Discord digest in the terminal.
   It is in no file and no commit.
   - **New practice:** compare digests inside a script and report only
     "same" or "different". Never print them.

### Mention hazard: CHECKED AND CLEAN 2026-10-28, still UNFIXED in code

- **The hazard:** posts don't block mentions. A member named `@everyone`
  or `@here`, or a name holding a raw `<@…>` mention, would ping through
  the reminder, winner or podium posts. Registration limits a name's
  length, not its characters.
- **The dev's read-only check, 2026-10-28:** names containing `@everyone`,
  `@here` or `<@` returned **0**. No live name can ping today.
- **Still unfixed in code until Part 1 ships** the mention block
  (`allowed_mentions: { parse: [] }`).

- **The one production-behaviour change the data fix UNLOCKS — Discord
  routing. DECIDED 2026-10-11: provision `DISCORD_WEBHOOK_GREEN_EGGS`
  before 2026-10-15 21:00 UTC.** `supabase secrets list` (names only)
  shows `DISCORD_WEBHOOK` and the platform defaults — no per-league
  secret for Green Eggs — so `notifyLeague` falls back to the global
  hook, i.e. the Ambassadors channel. Without the secret, from the first
  show that channel gets Green Eggs' 1-hour reminder (naming Green Eggs
  non-voters), lock notice and winner, and every song-by-song post
  TWICE (once per league, both resolving to the same hook). There is no
  mute value: an empty secret is falsy and falls through. A secret, not
  code — no deploy.
  - **⏸️ PAUSED 2026-10-11, dev's call, same day:** nobody is using the
    Green Eggs Discord yet, so the secret is on hold. Verified by name
    only that it does not exist. The fallback above is the ACCEPTED
    consequence for now — Green Eggs' reminder (naming its non-voters),
    lock, winner and doubled song posts go to the Ambassadors channel
    until the secret is set. Tracked in DATED DEADLINES as PAUSED, not
    closed.
  - **🔇 SILENCED 2026-10-14 (dev's call): ALL Discord posts for BOTH
    leagues are off, by deleting the global `DISCORD_WEBHOOK` secret.
    Config only, no code, no deploy.** **⚠️ OUT OF DATE (CORRECTION
    2026-10-28, top of this file): only Ambassadors is silent; Green Eggs
    posts, and its Discord works.** Verified by name only the same
    day: the secrets list holds the seven platform defaults and NO
    `DISCORD_WEBHOOK` and no `DISCORD_WEBHOOK_*` name. **Reason:**
    nobody reads either channel yet, and the message templates
    (`index.ts:437-439`, `:458-459`, `:623-637`, `:490-494`) carry no
    league name — the name is used only to pick the webhook
    (`:101`), never in the text — so the shared fallback would have
    put every post in one channel twice with no way to tell the
    leagues apart, including non-voter nicknames from both leagues
    in the 1-hour reminder. This supersedes the PAUSED bullet's
    accepted consequence: the fallback it describes no longer posts
    anything.
    - **Nothing replays on restore.** `notifyLeague` returns at
      `index.ts:102` when no hook exists, and every stamp is written
      unconditionally after it: `remind_sent` `:440`, `lock_sent`
      `:460`, `winner_sent` `:496`, season champion `:527`. Song-by-song
      advances via the `setlist_songs` upsert at `:604`, which runs
      before the post block and is what the next pass diffs against.
      Restoring the secret later announces only what happens after
      that moment.
    - **Residual, stated plainly:** Supabase documents that a NEW
      secret is read by functions immediately with no redeploy; it
      does not say the same for a DELETED one. The code reads the env
      at call time (`:101`), so the only dependency is the platform's
      injection into the worker. **The test is the 2026-10-15 21:00Z
      reminder for show 1786387666 — now TWO-SIDED, since Green Eggs
      was enabled the same day (next sub-bullet), and BOTH sides are
      observed in the SAME channel, because the new secret points at
      the Ambassadors webhook [⚠️ CORRECTED 2026-10-28, top: the
      webhook built for Ambassadors, now Green Eggs']: EXACTLY ONE reminder post must appear
      there, Green Eggs' (its non-voter list is league 2's), and BOTH
      rows stamp `remind_sent`.** Two reminder posts = league 1's
      fired too, so the deletion did not propagate — record that here
      and reassess (a redeploy of the unchanged function is the likely
      fix). Zero posts = the new secret was not read; check the name
      first (`DISCORD_WEBHOOK_GREEN_EGGS`, exact), then the stamp. The
      count is the whole signal; a single post cannot be attributed by
      channel, only by content.
    - **Re-enabling AMBASSADORS is item (f) of the post-first-show
      batch** (above), narrowed 2026-10-14: a per-league Ambassadors
      secret and the league-name prefix. Green Eggs is no longer part
      of (f). **[⚠️ The prefix is SUPERSEDED 2026-10-28 by a per-league
      author name, and (f) is replaced by the plan in "Per-league split"
      at the top of this file.]**
    - **🔔 ENABLED 2026-10-14 — GREEN EGGS (league 2) POSTS AGAIN,
      PER-LEAGUE SECRET, BUT INTO THE AMBASSADORS CHANNEL. AMBASSADORS
      (league 1) REMAINS SILENCED.** **⚠️ CORRECTED 2026-10-28 (top of
      this file): Green Eggs' posts reach Green Eggs' Discord, through the
      webhook built for Ambassadors. Ambassadors has no working channel.**
      The dev set
      `DISCORD_WEBHOOK_GREEN_EGGS` in the dashboard; config only, no
      code, no deploy. Verified by NAME only the same evening via
      `supabase secrets list -o json` with names extracted and nothing
      else printed: 8 names — the seven platform defaults plus
      `DISCORD_WEBHOOK_GREEN_EGGS`; `DISCORD_WEBHOOK` absent;
      `DISCORD_WEBHOOK_AMBASSADORS` absent.
      - **CORRECTION, same day, dev's statement: the new secret holds
        the SAME Discord webhook URL the deleted global secret used.**
        So "per-league" is true of the ROUTING (league 2's posts go
        through league 2's key, league 1 resolves to nothing) and NOT
        of the DESTINATION: Green Eggs' reminder (naming Green Eggs
        non-voters), lock, winner and song-by-song posts land in the
        Ambassadors channel for now. **[⚠️ OUT OF DATE, CORRECTION
        2026-10-28 at the top: they land in Green Eggs' Discord.]** Dev's call — nobody reads that
        channel yet. Posts are NOT doubled: league 1 contributes
        nothing, so each event appears once, and that once is Green
        Eggs'. An Ambassadors member reading the channel would see
        another league's unlabelled announcements; the league-name
        prefix in (f) is what would make that legible, so it is back
        to mattering for Green Eggs until the channels are separated.
        Not verifiable from here — a secret's value is never printed —
        so this is recorded as the dev's attestation, not a reading.
      - **The name was derived before it was set, not guessed:**
        `leagueWebhookEnvKey` (`index.ts:96-97`) upper-cases the live
        `leagues.name`, collapses each non-alphanumeric run to `_` and
        strips edge underscores. Live name for id 2 is `Green Eggs`
        (10 bytes, hex `477265656e2045676773`, plain ASCII, one space),
        so the key is `DISCORD_WEBHOOK_GREEN_EGGS`. Replicated in
        PowerShell with the same two regexes. The name is re-read from
        `leagues` at the top of every `announcements()` run
        (`index.ts:416-417`), so a league rename silently changes the
        key — rename the secret with it.
      - **Why league 1 stays silent with this set:** the lookup at
        `:101` is `env(DISCORD_WEBHOOK_AMBASSADORS) || env(DISCORD_WEBHOOK)`
        for league 1, and neither name exists. Every call site passes
        its own league's name, so league 1's posts never route through
        league 2's key.
      - **Why a secret added tonight is read tomorrow:** the file has
        exactly three `Deno.env.get` calls — `SUPABASE_URL` and
        `SUPABASE_SERVICE_ROLE_KEY` at module load (`:52-53`), and the
        webhook read inside `notifyLeague` (`:101`), per call. Nothing
        caches it. The deployed function is the committed source (last
        change `1dec497`, before the 2026-08-14 deploy that was verified
        byte-identical by download; nothing since).
      - **A `supabase secrets list` gotcha, so names-only stays
        names-only:** the CLI's default output in this environment is
        JSON with a `value` field per secret holding a SHA-256 digest
        (a hash, not the secret, but still not to be printed). Use
        `-o json`, which returns a BARE ARRAY (not `{secrets:[...]}`),
        and map `.name` off each element. A first attempt this evening
        indexed `.secrets` on the array and got 8 nulls, which read as
        "name absent" — count the names before trusting a `False`.
    - **CORRECTION, recorded at the weight it carries:** on 2026-10-14
      a `leagues.discord_webhook` column was referred to in
      conversation as if an earlier plan note described one. The live
      `leagues` table has `id`, `name`, `created_at` only (read via
      `information_schema.columns` the same day); a grep of CLAUDE.md
      and `docs/` finds no tracked note mentioning such a column. It
      never existed anywhere — the only routing is the env-var lookup
      in `notifyLeague`. Same family as the other transcript-read-as-
      repo entries in this file.
    - **CHECK FOR THE POST-SHOW PROMPT ON FRIDAY 2026-10-16 (updated
      2026-10-14 for the Green Eggs enable, then corrected the same
      day because the new secret points at the AMBASSADORS channel's
      webhook) [⚠️ CORRECTED 2026-10-28, top: that webhook now delivers
      to Green Eggs' Discord]:** confirm, all in the Ambassadors channel, (1) EXACTLY
      ONE reminder, ONE lock and ONE winner post for show 1786387666,
      all Green Eggs' (the reminder's non-voter list is league 2's;
      song-by-song posts appear once each, not doubled) and NONE
      Ambassadors'; (2) `remind_sent`, `lock_sent` and `winner_sent`
      advanced normally for that show in BOTH league 1 and league 2;
      (3) `setlist_songs` holds the show's rows. Both stamps present +
      exactly one of each post = both halves worked and nothing is
      queued to replay. Two of any post = league 1's hook is live, i.e.
      the deletion did not propagate. Zero posts with stamps present =
      the secret was not read; check the exact name before anything
      else. Stamps absent = something else is wrong; the webhook is
      not the cause, since it cannot throw (`index.ts:102-107`).
