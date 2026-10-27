# Onboarding: community links, derived states, join codes

## RESUME HERE (updated 2026-10-26 — Batch 1 LIVE, Stage F APPLIED, Batch 3 LOCKED)

**State:** Batch 1 (onboarding community links: Stage S SQL, no-league
screen links, login-screen links, admin Community section) is **LIVE as of
2026-10-25**. Stage S applied in Supabase and verified: footer queries 1
and 2 passed (both RPCs present, `my_leagues` returns the 9-column shape,
`leagues.config` exists with the `'{}'` default); queries 3–5 were not
reported as run, but the real links were saved through the production
path (Admin → Community → Save links), which exercises the RPC's https
guard with real values. Pushed as `9bce051..2157779` (bundle
`c3b67c3-4711dfc`). The link values live in the admin UI only — never in
any tracked file.

**✅ Stage F (Batch 2) APPLIED 2026-10-26 by the dev**, whole file, both
statements: the post-apply count of `official_opt_in = false` rows is 0
and the column default reads `true` (`information_schema.columns`). The
default is now the reaffirmed decision in the live catalog, not the
2026-10-11 accident. Record: `official-opt-in-default.md` → "Stage F apply
decision". (`CLAUDE.md`'s official-opt-in bullet has since been updated
to "Stage F APPLIED 2026-10-26"; this parenthetical said it was stale
until then.)

**Remaining:** Batch 3 (welcome card, install guide, first-save toast) —
LOCKED 2026-10-26 under decision 6 below; plan APPROVED the same day with
six decisions recorded there; BUILT the same day (bundle `7b4f28f-503c56d`),
device checks listed there still open; install-help fixes from the dev's
live device checks AMENDED the same day (end of item 3 below). Then Batch 4
(join codes).
Standings/Settings/Who's Picked UX (a separate batch, LOCKED 2026-10-25)
is in `standings-ux.md` and `admin-panel.md` → "Who's Picked".

> Decision record — currently binding. LOCKED 2026-10-24 (design settled in
> Chat, written the same day). `CLAUDE.md` holds a one-line pointer under
> "THE 2.0 MODEL → Locked decisions" and in the docs index; this file is the
> full text. No nicknames, no real URLs, no real codes — ever — in this file
> or any tracked file (standing rule in `CLAUDE.md` → Conventions).

## Locked decisions

1. **Community links are per-league config, stored in a new
   `leagues.config` jsonb column**, admin-editable from the admin tab's
   league-scoped group, never in tracked files. Keys v1: `fb_url`,
   `discord_url`. Rationale: both brackets of a league share
   one community, so the links belong to the league, not a bracket; and
   links are data, not source, so they cannot live in `src/core/config.js`
   or any seed SQL.
   **⚠️ SUPERSEDED IN PART 2026-10-24 (same day, after the conflict note
   below was written).** As first recorded, the v1 key list read
   "`fb_url`, `discord_url`, `join_code`". That was wrong: `leagues` is
   publicly selectable on every column, so a join code in `leagues.config`
   would be published the moment it was written. **`leagues.config` never
   carries `join_code`.** Join codes live in a new table
   `league_join_codes` (`league_id` pk → `leagues`, `code text unique`,
   `rotated_at timestamptz`), RLS enabled with NO policies and all
   privileges revoked from `anon` and `authenticated`, read and written
   only by security-definer RPCs: `admin_get_join_code`,
   `admin_rotate_join_code`, `join_league`. Codes are 8 characters from an
   unambiguous alphabet (no 0/O/1/I/l), generated server-side, compared
   case-insensitively. **Rejected:** hash storage (admins must display the
   code, and an 8-character code behind a public hash is brute-forceable
   offline) and column-level grants (they break `select *` callers,
   including the Global console). Built in Batch 4.

2. **Onboarding has three DERIVED states and no onboarding-step column.**
   - **no-league**: `state.leagues.length === 0` → `renderNoLeague()`
     (`src/core/session.js`), which gains the community links.
   - **in-league-no-picks**: `get_my_pick_counts` returns all zeros AND no
     `ft_draft_*` key exists for this player → a welcome `.noticebox` at the
     top of the shows list (`src/features/shows.js`).
   - **has-picks**: a one-time toast on first successful save
     (`submit_picks` success path in `src/features/picks.js`).
   - **pre-auth (fourth surface, added 2026-10-24):** the login/new-player
     screen (`src/features/auth.js`) shows the same per-league links via
     the anon `leagues` select; fetched async AFTER the form renders,
     additive only, never blocks sign-in. A fetch error or no league with a
     URL renders nothing. Shares one rendering helper with the no-league
     screen (`src/core/community.js`) rather than a second copy of the
     https-only guard. Not a state of the player (there is no player yet);
     listed here because it is the first thing a recruit sees.
   The welcome card auto-hides once any picks exist. A manual Dismiss
   stores `ft_welcome_<playerId>` in localStorage (per-device, per-player;
   same posture as `ft_draft_*`). Derivation reuses the signals catalogued
   in the 2026-10-24 onboarding audit: `state.leagues`, the pick-count map
   `savedCountOf`, and the draft key.

3. **Exposure, accepted:** the public league list and `my_leagues` return
   `fb_url` and `discord_url`. Anyone able to read the public list can read
   the Discord invite. Mitigation: a rotatable, non-expiring Discord invite
   the admin can replace from the admin tab. See the conflict note below
   for what "public league list" actually is in this codebase.

4. **`admin_update_league_config` MERGES (`config || p_data`) rather than
   replacing**, gated on `_is_league_admin_or_global(pl.id, p_league_id)`
   and `_reject_if_must_change_pin` (stage_n convention for writes).
   Reason: `admin_update_config` writes the whole `brackets.config` object,
   which forced the two-writer merge discipline in
   `docs/decisions/admin-panel.md`; the league-level writer must not
   inherit that hazard.

5. **Admin automation:**
   - Stage F (Official opt-in default TRUE,
     `sql/stage_f_official_default_optin.sql`) is applied as ITS OWN batch,
     not folded into the links batch. Before applying, read the Part 3
     note in this record: the file as written also BACKFILLS every existing
     `false` row to `true`, which flips every current Green Eggs member.
     That is a data change, not a default change. **Decided 2026-10-24:
     apply both statements, gated on the writer grep — full reasoning in
     `official-opt-in-default.md` → "Stage F apply decision".**
   - Join codes v1: entered only on the no-league screen; 8 characters,
     stored in `league_join_codes` (see the correction under decision 1);
     admin-rotatable from the Community section. Second-league
     joins remain admin-add (the Stage Q panel), so a code can never land
     someone in a second league by accident.
   - New-signup admin ping: CUT. Join codes remove the admin step the ping
     existed to prompt.

6. **Batch order** (each its own commit set, each verified before the next):
   1. `leagues.config` + links on the no-league screen + admin Community
      section (two URL fields + save; no join-code field at all — amended
      2026-10-24, it was first planned as a read-only line).
   2. Stage F apply (see 5 above and Part 3 below).
   3. Welcome card + install guide + first-save toast.
      **LOCKED 2026-10-26 (dev's call).** This fills in the card and
      toast already locked in decision 2 and adds an install guide. Plan
      pending approval; nothing built yet.
      1. **Welcome card.** Shown in the in-league-no-picks state, derived
         exactly as decision 2 says: all-zero `get_my_pick_counts` AND no
         `ft_draft_*` key for this player. Contents: the league's name as
         the heading; three how-to-play lines; the next open show's
         cutoff with a "Make your picks" button that opens that show; a
         pointer to The Rules on any pick sheet; the league's community
         links via `communityLinks()`; a ✕ that stores
         `ft_welcome_<playerId>`. It hides itself once any picks exist.
      2. **"Get the app" section inside the card.** Shown ONLY when the
         app is not running standalone (`display-mode: standalone`, or
         `navigator.standalone` on iOS) AND only on phones. Branches:
         - (a) `beforeinstallprompt` captured (Android Chrome, Edge,
           Samsung Internet): one Install button calling `prompt()`; the
           section hides on `appinstalled`.
         - (b) Android without a captured prompt: "Browser menu (⋮) →
           Install app / Add to Home screen".
         - (c) iPhone / iPad: "Tap Share, then Add to Home Screen", plus
           "You'll sign in once more inside the app, so keep your PIN
           handy". iOS home-screen apps do not share Safari's storage,
           so the session does not carry over into the installed app.
         - (d) In-app browsers (Facebook, Messenger, Instagram, detected
           by user agent): "You're in <app>'s browser, which can't
           install apps. Tap ⋯ → Open in browser, then install from
           there." **Why (d) matters:** the Facebook group is the
           recruiting channel, so a recruit's first open is most likely
           inside Facebook's or Messenger's in-app browser, where
           neither install path exists.
         **Wording of (b) and (c) superseded 2026-10-26** by the
         device-check amendment at the end of this item.
      3. **Install bar for players who already have picks.** When not
         standalone, a slim one-line bar on the shows list: "Add Fantasy
         Eggy to your home screen", plus a "How?" that expands the same
         platform instructions. Standalone always hides both the bar and
         the card's section. *Not specified when locked:* whether the
         bar is phones-only like the card's section. Resolved by
         decision 2 of the approved plan below: phones only.
         **AMENDED 2026-10-26, same day (dev's call): install help is
         permanently dismissable.** As first written, `ft_install_dismissed`
         governed the bar only and its ✕ was a plain close. Now:
         - **ONE device flag, `ft_install_dismissed`, governs ALL install
           help**: the bar AND the "Get the app" section inside the
           welcome card. Dismissing either hides both.
         - **Permanent.** No expiry and no re-show. Never cleared by
           logout, re-login, or switching players on the device.
         - **The dismiss control on both reads "Don't show again"**, as
           text or as the ✕'s aria-label and title, never a bare close.
         - **The undo is a Settings switch, "Show install tips"**, which
           clears the flag. It is hidden when the app is already running
           standalone.
         - **Per device, not per account**, the same posture as the
           welcome card's dismissal. Per-account would need server
           state, and was judged not worth it.
         The card's own ✕ (`ft_welcome_<playerId>`, item 1) is a
         separate control and is unchanged by this amendment.
      4. **First-save toast**, once per player per device
         (`ft_first_save_<playerId>`): "Picks locked in ✔ Change them
         any time before cutoff. Scores show up on the show's Scores
         page after it ends."
      5. **Rejected:** a modal, because it would block the shows list on
         first load; server-side dismissal state, because per-device is
         enough at this scale.
      **PLAN APPROVED 2026-10-26, with the dev's six decisions:**
      1. **Card scope is per league.** The current bracket's
         `get_my_pick_counts` is checked first; only when it is empty is
         the league's other bracket checked. A draft key for either of
         the league's brackets also counts as picks.
      2. **The bar is phones only**, like the card's section.
      3. **`ft_first_save_<playerId>` is also set silently whenever the
         shows list sees saved picks**, so only genuinely new players get
         the toast and existing players never see it.
      4. **`appinstalled` also sets `ft_install_dismissed`**, so an Android
         browser tab stops showing install help after the install. iPhone
         has no such event; iPhone players use "Don't show again".
      5. **Samsung Internet is detected for branch (b)** and names its ≡
         menu. Branch (d) uses each OS's menu glyph: ⋯ on iOS, ⋮ on
         Android. The rest of the locked wording is unchanged.
      6. **The welcome card's ✕ hides only the card**, never install
         help. **Bar rule AMENDED:** the bar shows whenever install help
         applies (phone, not standalone, `ft_install_dismissed` not set)
         and the card's install section is not on screen. This replaces
         "for players who already have picks" in item 3, and closes the
         gap where a no-picks player who closed the card saw no install
         help.
      **How-to-play lines, five (dev's copy), replacing "three" in
      item 1:**
      - "Before each show, pick the songs you think <band> will play."
      - "Picks partly score in realtime and finalize once the setlist is in."
      - "Standings update after every show."
      - "Change your picks any time until the cutoff."
      - "Scoring details are in The Rules under every pick sheet."
      `<band>` comes from a config constant beside `APP_NAME` in
      `src/core/config.js`: one source of truth, no band name hardcoded in
      feature code. The fifth line is the Rules pointer item 1 asks for.
      **Toast duration (part of the approved plan):** the first-save toast
      stays up 10 seconds through a new optional `toast()` duration; every
      other toast keeps 6.
      **Follow-up candidate, NOT in this batch:** a maskable manifest
      icon. Android shows the current icon inside a white circle because
      none of the manifest's icons is marked maskable.
      **DONE 2026-10-26** with the wreath-stems change: `assets/icon-maskable-192.png`
      and `-512.png` are in the manifest as `"purpose": "maskable"`, beside the
      existing icons, now marked `"purpose": "any"`. Record: `frontend-css.md`, brand assets.
      **BUILT 2026-10-26, bundle `7b4f28f-503c56d`.** New
      `src/core/install.js` (pure detection, standalone check and branch
      text, plus the prompt capture wired before `boot()`), the card and
      bar slot in `shows.js`, the toast in `picks.js` with a 10-second
      `toast()` duration, the switch in `settings.js`, `BAND_NAME` in
      `config.js`. Tests: `test/install.test.mjs` (a user-agent table of
      13 shapes, the standalone table, every branch's text) and
      `runOnboardingScenario` (21 checks per mode, one of them a static check).
      **Mutations, all five failed their target checks in both modes;
      every revert byte-identical and the bundle matched:** standalone
      ignored (1 scenario, 3 unit); Facebook detected as plain iOS (1
      scenario, 5 unit); the toast on every save (1); logout clearing
      `ft_install_dismissed` (1); the bar back to players-with-picks only,
      the pre-amendment rule (1).
      **Judgment calls made in the build, stated:**
      - The heading reads "Welcome to <league name>".
      - The card's ✕ is labelled "Hide this card", to keep it distinct
        from "Don't show again".
      - The Settings switch is hidden on desktop as well as in
        standalone, because install help never applies off a phone.
      - **The bar wraps to two lines below about 360px instead of
        truncating.** Measured in headless Chrome with the real stylesheet:
        at .85rem with an ellipsis it cut "screen" off the locked sentence
        at 320px and 360px. It is now one line from 360px up and two lines
        at 320px. The card, its section, the expanded "How?" and the switch
        rendered cleanly in both themes with nothing overflowing.
      - Wide layouts show Settings beside the list (an iPad in landscape
        is a "phone" here), so a dismissal also syncs the switch.
      **Device checks (jsdom cannot do these):** a real install through
      the Install button, and `appinstalled` firing; Chrome's engagement
      delay (about 30 seconds and a tap) before the Install button can
      appear; Samsung Internet's actual behaviour and its ≡ menu path;
      the iOS sign-in-again line (home-screen storage separate from
      Safari's); real user agents from the Facebook, Messenger and
      Instagram in-app browsers on both OSes, to add to the unit table;
      links opened from Discord, whose built-in browser view is not on the
      detection list.
      **AMENDED 2026-10-26: install-help fixes from the dev's live device
      checks (the dev's calls, the same day as BUILT).**
      1. **Branch (b), Chrome: DEVICE-VERIFIED** on the dev's Android
         Chrome. The ⋮ menu item reads "Install and create shortcut". It
         opens a sheet with "Install" and "Create shortcut"; a shortcut
         opens in Chrome, so it is not an install. Older Chrome labels the
         menu item "Add to home screen" and leads to the same sheet. New
         text: "Tap ⋮ (top right), then Install and create shortcut (older
         Chrome: Add to home screen), then Install."
         *Noted, not changed:* every non-Samsung Android browser without a
         captured prompt (Edge, Firefox) still lands in this branch and gets
         Chrome's wording, as it got the ⋮ glyph before.
      2. **Branch (b), Samsung Internet: DEVICE-VERIFIED** on the dev's
         phone: ≡ menu → "Add page to" → "Home screen". New text: "Tap ≡
         (bottom), then Add page to, then Home screen." This closes the
         Samsung ≡ device check listed under BUILT.
      3. **iOS branch (c): "If you see Open as Web App, leave it on." is
         ADDED**, between the Share line and the sign-in line.
         - Verified by search on 2026-10-26: WebKit's own WWDC25 post on
           Safari 26 shows the Add to Home Screen sheet with an "Open as Web
           App" toggle, on by default. Turned off, the icon becomes a
           bookmark that opens in Safari, even for a site with a manifest.
         - iOS before 26 has no such switch, hence "If you see".
         - Not checked on a device.
      4. **Already installed, same browser only.**
         - **What changes.** The manifest gains `related_applications` with
           one `"platform": "webapp"` entry whose `url` is the app's own
           manifest, written relative (`manifest.webmanifest`). Chrome's
           docs allow a relative path, and it resolves to the manifest
           itself on any host. `main.js` calls
           `navigator.getInstalledRelatedApps()` at boot, beside the prompt
           capture.
         - **When the list holds a `webapp` entry, ALL install help is
           hidden in the browser tab:** the card's section, the bar and the
           Settings switch. The result is held in memory only.
           `ft_install_dismissed` is NOT set, so an uninstall brings help
           back on the next load.
         - Where the API is missing (iOS, Samsung Internet, desktop) or
           throws, behaviour is exactly as before.
         - **Recorded honestly: Chat first guessed "already installed" as
           the cause of the dev's logged-out Chrome check, and that guess was
           WRONG.** The dev's installed copy came from Samsung Internet. A
           browser can only detect an install made by that same browser, so
           this check can never see a cross-browser install. It is kept on
           its own merits, for the same-browser case.
         - **Interaction with approved decision 4, flagged and left
           unchanged:** `appinstalled` still sets `ft_install_dismissed`.
           An install started from one of our tabs fires it, and after that
           install help stays hidden even once the app is uninstalled.
           "Uninstalling brings help back" holds only where the flag was
           never set, such as an install that predates Batch 3 or one made
           with no tab of ours open. Changing decision 4 is the dev's call.
         - **Deliberately not done:**
           - No manifest `id`. Chrome needs it only on desktop, and desktop
             never shows install help.
           - Nothing for "Create shortcut". It is not an install, so this
             check cannot see it, and it opens in Chrome, where help still
             showing is correct.
      5. **Observed, not changed: browsers do not share storage.** Each
         browser keeps its own `localStorage`, so a player who installed
         through one browser and opens a link that lands in another appears
         logged out there. This explains the dev's logged-out Chrome tab. No
         code can bridge it.
      **Device checks still open:**
      - The one-tap Install button appearing after Chrome's engagement
        delay (about 30 seconds and a tap).
      - A phone with a Chrome-installed copy showing no install help in a
        Chrome tab.
      **BUILT 2026-10-26, bundle `5179756-416d858`.**
      - `install.js`: the three texts; `checkInstalledApp()`, called from
        `main.js` right after `captureInstallPrompt()`; an in-memory
        `installedHere` folded into `installHelpPossible()`. That one
        function gates the card's section, the bar and the Settings switch.
        `renderInstallSlots()` now also removes an on-screen switch when an
        answer lands after render.
      - `manifest.webmanifest`: the `related_applications` entry.
      - **Unit tests** (`test/install.test.mjs`):
        - both branch (b) texts, with Edge on Android pinned to Chrome's;
        - the three iOS lines;
        - a static check that the manifest has exactly one related app, a
          `webapp` entry, resolving to the manifest `index.html` links. It
          is checked on the live host, the dev server and a subpath.
      - **Scenario checks** (three new, per mode):
        - an installed entry hides the section, the bar and the switch, and
          leaves the flag unset;
        - the next load with nothing installed brings help back;
        - an answer landing after render clears the section, a picks
          player's bar, and an open Settings switch;
        - an empty list or a throwing API changes nothing. "API absent" is
          every other onboarding check, which jsdom runs without the API.
      - **Mutation, the installed check ignored** (`&& !installedHere` dropped
        from `installHelpPossible()`): the two installed checks failed in
        both modes, 4 failures, and the empty/throwing check correctly still
        passed. The anchored revert was byte-identical to the backup, and the
        rebuilt bundle matched the pre-mutation one.
   4. Join codes: `league_join_codes` table + its three RPCs, entry on the
      no-league screen, rotation in Community.

## Conflict found while writing this record (durability rule 3) — RESOLVED same day

The design says "public league-list RPC". **There is no such RPC.** The
no-league screen (`src/core/session.js:27`) and the Global console
(`src/features/admin.js:115`) read the `leagues` table directly under the
RLS policy `"pub leagues" ... for select using (true)`
(`sql/stage_a_schema.sql:270`), which exposes EVERY column of `leagues` to
the anon key. Consequences:

- Adding `leagues.config` makes `fb_url` and `discord_url` publicly
  readable with no RPC change at all. That matches decision 3.
- It ALSO makes `join_code` publicly readable the moment it is written,
  which defeats batch 4 entirely: the gate and its key would be in the same
  public row. **Batch 1 must therefore not store `join_code` where the
  public select can see it, or must close the public select first.**
  Options, not yet decided: (a) move the public read behind a
  `list_leagues()` RPC returning `id, name, fb_url, discord_url` and drop
  the `pub leagues` policy (`my_leagues` is already an RPC, so the switcher
  path needs no change; check `renderNoLeague` and `loadGlobalLeagues`);
  (b) keep `join_code` out of `leagues.config` and store it in its own
  non-public column or table, checked only by a `join_league_by_code` RPC;
  (c) store only a hash. **RESOLVED 2026-10-24: none of (a)–(c). A
  separate RLS-locked table, `league_join_codes`, behind three RPCs; see
  the correction under decision 1.** The Stage S whitelist in
  `admin_update_league_config` accepts only `fb_url` and `discord_url`,
  so nothing can put a code into the public row by accident.
- `my_leagues` already returns `official_opt_in` (redefined in
  `sql/stage_c2a_rpcs.sql:99`, which also added the `drop function` the
  return-type change needs). Adding two columns to it needs the same drop.

## Related records

`official-opt-in-default.md` (Stage F history) · `admin-panel.md` (section
order; Community goes in the league-scoped group above the EDITING divider)
· `multi-league-switcher.md` (a newly added player must fully reload; the
no-league poll already re-boots, so Batch 1 inherits that path) ·
`post-first-show-batch.md` item (e) (Stage F was already queued there; this
record supersedes its timing, not its content) · `deferred.md` (the
notification toggle and webhook DB+UI stay deferred).
