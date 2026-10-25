# Onboarding: community links, derived states, join codes

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
   3. Welcome card + first-save toast.
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
