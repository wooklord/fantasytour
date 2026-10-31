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
deploy record); Part 2 is not built. The survey it rests on was read-only
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
- **D7, Ambassadors gets its own webhook.** The dev creates it and sets
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
     line.
  5. Claude verifies it by name, and by a digest comparison with Green
     Eggs' (must be "different").

### Part 1 status: BUILT 2026-10-31, deploy PENDING (this block is updated in place)

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
  dedupe. Ambassadors still resolves to no hook until D7. No `?wait`, no
  avatar: the Discord avatar is set per webhook in Discord
  (`frontend-css.md`, brand assets).
- **Deploy:** by the assistant on the dev's instruction of 2026-10-31
  (CLAUDE.md's deploy command), to be verified by download and `cmp`
  against HEAD, then recorded LIVE here.

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
