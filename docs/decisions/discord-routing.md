# Discord webhook routing: current state and the propagation test

> Extracted verbatim from `CLAUDE.md` at commit 54a5ab8 (2026-10-18), original lines 706–845. Nested entries were de-indented to top level; wording is unchanged.
> Decision record — currently binding. `CLAUDE.md` holds only a pointer stub under the same entry name; this file is the full text and rationale.

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
    Config only, no code, no deploy.** Verified by name only the same
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
      the Ambassadors webhook: EXACTLY ONE reminder post must appear
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
      of (f).
    - **🔔 ENABLED 2026-10-14 — GREEN EGGS (league 2) POSTS AGAIN,
      PER-LEAGUE SECRET, BUT INTO THE AMBASSADORS CHANNEL. AMBASSADORS
      (league 1) REMAINS SILENCED.** The dev set
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
        Ambassadors channel for now. Dev's call — nobody reads that
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
      webhook):** confirm, all in the Ambassadors channel, (1) EXACTLY
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
