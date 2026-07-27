# Fantasy Eggy — Multi-Tenant Spec (for review, not yet built)

Three levels: **Global** → **League** → **Bracket**. One global player identity. Everything scored lives under a bracket. This document is the plan to red-team before any code.

---

## 1. Vocabulary (locked)

- **Global** — app-wide scope. You + super-admins. Creates leagues, appoints league admins, owns the shared show list + Carton sync, sees cross-league stats (Global-admin-only).
- **League** — a community with a discrete player pool (e.g. *Ambassadors*, *Facebook League*). Has admins. Contains exactly 2 brackets. Sets its own cutoffs. Boots/bans within itself.
- **Bracket** — a parallel competition with its own rules and champion (*Casual* / *Official*). Owns its seasons, scoring/pick rules, standings.
- **Player** — one global account (name + PIN, app-wide). Joins one or more leagues. Within a league, plays its brackets.

---

## 2. Schema

### 2.1 Identity & tenancy (new/changed)

```
players                     -- GLOBAL identity (mostly unchanged)
  id uuid pk
  name text unique          -- global namespace (one "WookLord" app-wide)
  pin_hash text
  is_global_admin bool      -- NEW: replaces the old is_admin (see migration)
  created_at

leagues                     -- NEW
  id bigint pk
  name text
  created_at

brackets                    -- NEW (exactly 2 per league, seeded Casual+Official)
  id bigint pk
  league_id -> leagues
  name text                 -- 'Casual' | 'Official'
  kind text                 -- 'casual' | 'official'  (drives opt-out logic)
  config jsonb              -- per-bracket scoring/pick rules (was the single global game_config)
  created_at
  unique (league_id, kind)

league_members              -- NEW: which player is in which league
  league_id -> leagues
  player_id -> players
  is_league_admin bool      -- league-admin flag is per-league
  official_opt_in bool      -- participation in this league's Official bracket
  banned bool               -- soft ban from THIS league only
  joined_at
  pk (league_id, player_id)

banned_names                -- CHANGED: now per-league
  league_id -> leagues
  name text
  pk (league_id, name)
```

### 2.2 Shows (shared globally) + per-league overlay

```
shows                       -- GLOBAL, one row per real-world show (Carton-synced)
  id bigint pk              -- Carton show_id
  showdate, venue, city, state
  -- NOTE: cutoff_at, status, format MOVE OUT of here (they're per-league now)

league_shows                -- NEW: per-league overlay on a shared show
  league_id -> leagues
  show_id -> shows
  cutoff_at timestamptz     -- each league sets its own
  format text               -- 'standard' | 'one_set'  (per-league)
  status text               -- 'upcoming'|'live'|'final'  (per-league lifecycle)
  -- announcement flags also live here (per league): remind_sent, lock_sent, winner_sent
  pk (league_id, show_id)
```

Rationale: the *show* (date/venue) is one real-world fact synced once. But cutoffs, format, live/final status, and "winner announced" are all things a league owns independently, so they live on `league_shows`, not `shows`.

### 2.3 Gameplay (all gain bracket_id)

```
picks
  ... + bracket_id -> brackets
  unique (player_id, bracket_id, show_id, slot)   -- was (player_id, show_id, slot)

scores
  ... + bracket_id -> brackets
  pk (player_id, bracket_id, show_id)

setlist_songs               -- GLOBAL (setlist is a real-world fact, shared)
  unchanged; keyed by show_id only. Every bracket scores against the same setlist.

seasons
  ... + bracket_id -> brackets   -- OFFICIAL brackets only; Casual has no seasons

season_rosters              -- NEW: frozen participant snapshot per Official season
  season_id -> seasons
  player_id -> players
  pk (season_id, player_id)
  -- written ONCE when a season starts, from who was opted-in at that moment.
  -- Never shrinks or grows afterward except via explicit admin override.

songs_cache                 -- GLOBAL, unchanged (catalog is shared)
```

Key realization: **setlists stay global** (fetched once per show), but **scoring runs per bracket** against that shared setlist. One Carton fetch → N brackets scored.

---

## 3. Permission model (database-enforced)

Same philosophy as today: anon key can't write tables directly; everything goes through `SECURITY DEFINER` RPCs that validate identity + scope server-side. Three tiers:

- **Global admin** (`players.is_global_admin`): a **superset** of league-admin powers. Can do anything a league admin can, *in any league*, without being a member/admin of it (see the OR-clause below) — this covers "my league admin fumbled, let me fix it in their league." Plus Global-exclusive powers: create/delete leagues, appoint league admins, run sync, view global stats, and the account-level nuclear boot (§3.1).
- **League admin** (`league_members.is_league_admin = true` for that league): manage that league's brackets/configs/seasons, set its cutoffs, boot/ban its members, override opt-out. Scoped to leagues where they're admin.
- **Player**: submit picks to brackets they're a member of (via their league membership + opt-in), read standings for their leagues.

Every RPC re-derives the caller and checks scope. The key mechanism: **every league-scoped power uses one shared guard** —

```
caller is_league_admin for THIS league  OR  caller is_global_admin
```

— so Global automatically passes every league gate (boot, ban, override opt-out, edit config/seasons/cutoffs, read any league's picks/standings/rosters) without a parallel set of Global-only functions. Examples:
- `submit_picks(name, pin, bracket_id, ...)` → verify PIN, verify caller is a member of the bracket's league, verify (if Official) opted in, verify league_shows cutoff not passed.
- `admin_* (name, pin, league_id, ...)` → verify PIN, then the shared guard above.
- `global_* (name, pin, ...)` → verify PIN, verify is_global_admin (the few genuinely top-level actions: create/delete league, appoint league admin, global stats, account-level boot).

Scoped reads (standings/picks/rosters) route through RPCs carrying the same guard, so a player sees only their leagues, a league admin sees their league(s), and Global sees all. Public RLS read stays **only** on truly-global tables: the show list and song catalog.

### 3.1 The two boots (distinct powers)

- **League boot/ban** (league admin, or Global via the OR-clause): removes a player from *one league* — their membership, picks, scores in that league only. Global account and other leagues untouched. The common case, including "boot this one guy from just the FB league."
- **Global nuclear boot** (Global-exclusive): acts on the `players` account itself — deletes it and cascades every membership/pick/score in *every* league (existing `on delete cascade` FKs handle this). Optional app-wide name-ban to block re-registration. Heavily confirm-guarded. For genuine bad actors only.

---

## 4. The Official opt-out mechanic

- Each `league_members` row has `official_opt_in` (default: true, or false — your call; I'd default **false** so Official is deliberate).
- **Locked while a season runs**: a player may flip their own flag only when the league's Official bracket has *no currently-active season* (today is not inside any Official season's date range). During an active season the toggle is read-only for players.
- **League admin override**: an admin RPC can set any member's flag regardless of lock.
- **Season standings membership is a frozen snapshot** (`season_rosters`): the instant an Official season becomes active, the set of currently-opted-in members is written to `season_rosters` and **that** is what the scoring engine reads — never the live `official_opt_in` flag. Consequences:
  - The UI opt-in lock during a running season is belt; the snapshot is suspenders. Even if the flag flips mid-season (admin edit, bug, manual DB change), standings cannot be affected, because scoring reads the roster, not the flag.
  - **Frozen in both directions**: someone who opts out or is booted mid-season *stays on the season's board* (their line persists, frozen; they simply stop gaining points). The roster never shrinks.
  - **Admin override goes through the front door**: to add someone mid-season, an admin explicitly inserts into that season's `season_rosters` — a deliberate, visible act, not the scoring engine silently absorbing a flag change.
  - Who-counts is thus decided exactly once, at season start, and only ever changed by explicit admin action on the roster itself.
- Casual bracket: everyone in the league, always, no opt-out, **no seasons** — a single perpetual running tally. The opt-out mechanic is therefore an **Official-only** concept. A league membership means "always in Casual, optionally in Official."

---

## 5. UI changes

### 5.1 League/Bracket switcher (the big one)
A persistent selector (top of sidebar on desktop, header on mobile): **League ▸ Bracket**. Everything on screen — shows, standings, admin — reflects the current bracket. Stored per device. If a player is in one league with two brackets, it's a simple toggle; multiple leagues nest under it.

### 5.2 Per screen
- **Shows**: same, but cutoffs/format/status read from `league_shows` for the current league; picks write to the current bracket.
- **Standings / Nerd stats**: scoped to current bracket. **Official** shows the per-bracket season selector; **Casual** has none (perpetual tally — no season dividers, no selector).
- **Admin** (league admin): manages current league — both brackets' configs, seasons, cutoffs (a per-show cutoff editor), members (add/boot/ban), opt-out overrides. Only shows for leagues you admin.
- **Global admin screen** (NEW, you only): create leagues, seed their 2 brackets, appoint league admins, global cross-league stats (total shows voted across leagues, etc.), run sync, and the account-level nuclear boot. Because Global is a superset, you can also enter *any* league's admin view to fix things directly.

### 5.3 What players see
- Only leagues they're a member of appear in the switcher.
- Official bracket shows an opt-in/out control (locked per §4).
- No global stats (Global-admin-only).

---

## 6. Migration — launch reset (supersedes the original preservation plan below)

> **Superseded.** The original plan for this section backfilled `bracket_id` onto
> existing `picks`/`scores`/`seasons` and preserved every row, so migrated standings
> would match history exactly. That plan was abandoned in favor of a simpler
> **launch reset**: beta players know scores get wiped at launch, so there's nothing
> delicate to preserve. This is now implemented in `sql/stage_a_schema.sql`, which
> is the source of truth — this section describes what it actually does.

Current state: one implicit global game — flat `players`, `picks`, `scores`, `seasons`, single `game_config`, `shows` with cutoff/status/format on them.

Steps (`sql/stage_a_schema.sql`):
1. Create `leagues` row **"Ambassadors"**.
2. Create its 2 brackets: **Official** (kind=official) and **Casual** (kind=casual). Both seeded with a sensible default `config` (the old single `game_config` is not carried over — it's dropped).
3. `league_members`: insert every existing player into Ambassadors. Preserve admin: whoever had `is_admin=true` becomes `is_league_admin=true` for Ambassadors **and** `is_global_admin=true` (the `is_admin` column is dropped after the copy). Everyone defaults `official_opt_in=true` — grandfathered into Official.
4. `league_shows`: for every show currently in `shows`, create an Ambassadors overlay row copying its existing `cutoff_at`, `status`, and `format`.
5. `shows.cutoff_at/status/format/*_sent` are then **dropped from `shows`** (already copied to the overlay in step 4).
6. **Wipe gameplay**: `picks`, `scores`, and `seasons` are dropped and recreated with `bracket_id` from scratch (no backfill — they start empty). `setlist_songs` is truncated. `season_rosters` starts empty; there is no existing-season backfill because there are no existing seasons after the wipe.
7. `songs_cache` (song catalog) is **kept as-is** — it's a catalog, not gameplay.
8. `banned_names` becomes per-league (`league_id`, `name`) — old global rows are not migrated forward; a fresh `global_banned_names` table is added for the Global-exclusive nuclear-boot name ban.

Result: everyone wakes up in **Ambassadors ▸ Official** with zero pick/score/season history but their account (name + PIN) intact; **Casual** exists empty; you're Global admin; the Facebook League is created fresh later via the Global screen.

**Safety**: the wipe only touches gameplay tables (`picks`, `scores`, `seasons`, `setlist_songs`); `players` and `songs_cache` are never dropped. Run in a quiet window with no live show, snapshot the database first, then run the verification query block at the bottom of `stage_a_schema.sql` (expects `players` = your beta count, `league_members` = same, `brackets` = 2, `picks`/`scores`/`seasons` = 0, `league_shows` = number of synced shows, `global admins` ≥ 1).

---

## 7. Edge function (sync + scoring) changes

- **Sync** (Carton → DB): still global. Fetches shows/songs once. NEW: after upserting a global show, it does *not* set cutoffs — league admins do. It may auto-create `league_shows` overlay rows for each league (with that league's default cutoff rule, e.g. 6PM venue-local) so shows appear pick-ready per league. Festival auto-tagging sets format on the overlay per league.
- **Scoring**: the big rewrite. For each `league_shows` row past its cutoff and not final: fetch the shared setlist once (cache across brackets of that show), then score **each bracket** of that league against it using that bracket's config. For **Official** brackets, the set of players whose scores count toward a season is read from `season_rosters` (the frozen snapshot), never the live opt-in flag. Casual scores everyone in the league (no seasons, no roster). Winner announcements, auto-finalize, burst polling all become per-`league_shows`.
- **Announcements**: per league (each has its own cutoffs/winners). Discord webhook could be per-league eventually; for now one webhook or none.

---

## 8. Build & deploy sequence (staged, not big-bang)

> **Superseded note on Stage A**: the original plan below kept the live app running
> during Stage A via compatibility views (e.g. a `game_config` view over Official's
> config), so no downtime was needed until Stage C flipped the read path. That's no
> longer the plan — see §6. Because Stage A now **wipes gameplay data**, there is no
> "old way" left for compatibility views to serve, and a maintenance window is
> accepted as fine: the app goes dark for the run and comes back up on the new
> schema (still pre-Stage-B/C, so the frontend won't understand brackets yet — see
> below). No compatibility-view scaffolding is built.

The goal: run the launch reset in one quiet window, then rebuild the sync/scoring and frontend behind it without further downtime. Proposed order:

**Stage A — schema + launch reset, maintenance window.** Run `sql/stage_a_schema.sql` in a quiet moment (no live show): add all new tables, wipe `picks`/`scores`/`seasons`/`setlist_songs`, keep `players` and `songs_cache`, seed Ambassadors + its 2 brackets, move every player in. The app is expected to be **down/dark for this window** — there's no compatibility view standing in for the old flat schema, so the pre-Stage-C frontend can't render against it correctly. Snapshot the DB first; verify row counts via the query block at the bottom of the file before moving on.

**Stage B — edge function v7.** Rewrite sync + scoring for the new structure. Includes the **season-activation step**: on each run, any Official season whose start_date has arrived and that has no `season_rosters` yet gets its snapshot written from current opt-ins (once). Since Stage A wiped seasons, there's no pre-existing migrated data to validate scoring against — validate against shows synced fresh after Stage A instead. Riskiest isolated piece; validate hard.

**Stage C — frontend, league/bracket-aware.** Add the switcher, scope every screen, add the Global-admin and league-admin panels. Ship behind the reality that there's only Ambassadors ▸ Official + empty Casual, so it looks almost identical to now until you create the Facebook League.

**Stage D — create the Facebook League** via the new Global screen, appoint its 2 runners as league admins, they add their ~50 players. First real exercise of multi-tenancy.

Each stage is independently deployable and reversible. A/B/C can each be validated before the next.

---

## 9. Open risks / things to watch

1. **RLS vs RPC for scoped reads** — need to pick one consistently. RPC is more code but easier to reason about for scoping; RLS is elegant but membership-checks in policies get fiddly. Leaning RPC for scoped reads, public-read only for global tables. The single shared guard (`is_league_admin(league) OR is_global_admin`) keeps this from sprawling.
2. **The switcher's "current context" is global state** the whole app depends on — needs to be rock-solid (persisted, sane defaults, handles a player removed from their only league).
3. **Scoring loop cost** — N leagues × their shows × 2 brackets, every minute. At your scale (2-3 leagues) trivial; just noting it scales with leagues.
4. **Opt-out snapshot semantics** — RESOLVED: frozen `season_rosters` snapshot written once at season start; scoring reads the roster not the flag; frozen in both directions; admin override edits the roster explicitly. See §4.
5. **Migration is one-way** — once the app reads the new structure, rolling back means restoring a backup. I'll take a full export before Stage C flips the read path.
