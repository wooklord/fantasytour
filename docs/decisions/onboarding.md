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
six decisions recorded there; build in progress. Then Batch 4 (join codes).
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
