# Postgres / Supabase rules (full text)

> Extracted verbatim from `CLAUDE.md` at commit 54a5ab8 (2026-10-18), original lines 928–958, 1000–1065. Nested entries were de-indented to top level; wording is unchanged.
> Decision record — currently binding. `CLAUDE.md` holds only a pointer stub under the same entry name; this file is the full text and rationale.

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

---

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
  ended up with two case-variant accounts and
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
