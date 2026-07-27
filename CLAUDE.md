# CLAUDE.md — Fantasy Eggy project playbook

This file is read automatically by Claude Code. It carries the full context of a
project that was built over many sessions in the Claude chat UI (single-file,
paste-based workflow) and is now moving into Claude Code ahead of a large
"2.0" multi-tenant rebuild. Read this whole file before touching anything.

---

## What this is

**Fantasy Eggy** — a fantasy-setlist game for fans of the jam band **Eggy**. Players
predict what songs the band will play in specific "slots" (opener, encore, etc.),
scores are computed automatically from the real setlist after each show, and there
are standings, seasons, an admin panel, and notifications. Think fantasy football,
but for concert setlists.

Sibling app: the "Ambassadors" tour-map PWA (separate project, same developer).

## Current architecture (pre-2.0)

- **Frontend**: ONE self-contained file, `index.html` (~1100 lines) — all HTML, CSS,
  and JS inline, no build step. Served as a static file from **GitHub Pages**.
  This single-file design is currently load-bearing: it deploys by pushing the file.
- **Backend**: **Supabase** (Postgres + Row Level Security + Realtime + Edge Functions).
  - Auth is **name + PIN** (no email/magic-link — chosen for reliability on venue
    LTE and for a friendly closed community). Writes go through `SECURITY DEFINER`
    RPCs that validate the PIN server-side; the anon key cannot write tables directly.
  - **Realtime** pushes score/show changes to open apps as toast notifications.
  - **Edge function** `supabase/functions/carton-sync/index.ts` (Deno) polls the
    setlist source, scores picks, and posts announcements.
- **Setlist data source**: The Carton's public Songfish API, `https://thecarton.net/api/v2`
  (no key). Returns `data.data` arrays; venue field names vary (`venuename`/`venue`).
  Debuts/covers come from footnotes / an `isoriginal`-style flag. `is_encore` is
  derived from setnumber/settype. IMPORTANT: closer/opener/etc. are **positional
  inferences** the scorer computes (e.g. closer = last non-encore song), NOT tags
  from the API — this matters for live vs. post-show labeling.
- **Notifications**: two channels — (1) in-app realtime toasts, (2) Discord webhook
  (secret `DISCORD_WEBHOOK`). Discord is broadcast (per-channel), so it can't do the
  "you haven't voted" personalization the in-app toasts do; it names non-voters
  publicly instead.

## Credentials

- Supabase project ref: `zdfhglvjxquvkjyvophz`
- Publishable/anon key: `sb_publishable_qN1goR6-Ss3cErnJJIJdKw_xr5nrFuo`
  — this is PUBLIC by design (it's in the deployed frontend JS). Safe to commit.
- The **service_role / secret key must NEVER** be committed or put in the frontend.
- The current `index.html` has these two constants filled in near the top of its
  `<script>` (`SUPABASE_URL`, `SUPABASE_ANON`).

---

## THE MERCILESS EDITING DISCIPLINE (hard-won — do not skip)

The single-file paste workflow caused real bugs. Even though Claude Code edits files
directly (lower risk), keep these habits:

1. **Assert before you replace.** Before any string replacement in a large file,
   confirm the anchor appears exactly once. A blind find-and-replace once landed a
   patch twice and broke the pick buttons; another time a mid-batch partial write
   shipped. Count first, replace second.
2. **Syntax-check after every edit.** The JS lived inside `index.html`; extract and
   `node --check` it (or lint the split modules once they exist) after each change.
3. **Boot the app in a harness to catch runtime throws.** There were jsdom harnesses
   (`/tmp/harness.js` mobile, `/tmp/harness_desk.js` desktop) that instantiate the
   app with a stubbed Supabase client and confirm it renders without throwing.
   `matchMedia` must be set on `window` in the harness. Recreate equivalents.
4. **Trace critical paths end-to-end after touching them** (tap-Pick → save;
   score update → standings; etc.). A valid-syntax, wrong-scope bug won't be caught
   by a syntax check — only by tracing.

**Known limitation of `test/compare.mjs`:** it compares rendered DOM structure and
text between `legacy-index.html` and the current build — nothing else. It is blind
to CSS (including computed styles, cascade interactions between dead and live
selectors), external resource loading (fonts, the Supabase CDN script), and anything
in `<head>` that isn't reflected in DOM text. One real bug has already slipped past
it this way: a dormant `.logo span` CSS rule (never matched anything pre-split,
since `.logo` had no `<span>`) went live and broke the header title's font styling
when a `<span>` was added to that element for the `APP_NAME` work — a PASS the
whole time, because the DOM text was unchanged. Don't treat a harness PASS as proof
a frontend change is visually correct — it only proves the DOM/JS behavior didn't
change. (A full line-by-line diff of `styles.css` against the original inline
`<style>` block, done after finding that bug, confirmed no other CSS content —
gradients, box-shadows, transforms, keyframes, media queries, custom properties —
was lost in the split.)

## Postgres / Supabase gotchas learned the hard way

- **pgcrypto lives in the `extensions` schema** on Supabase. Every `SECURITY DEFINER`
  function that uses `gen_salt`/`crypt` must `set search_path = public, extensions`
  or it throws "function gen_salt does not exist".
- **Finalized scores are frozen**: score `breakdown` text is written at score time and
  not recomputed once a show is `final`. So wording changes only affect
  future-scored shows. Display-computed things (like tie handling) fix retroactively;
  stored-at-score-time things don't.
- **The single global config** currently lives in a `game_config` table (id=1). In 2.0
  this becomes per-bracket `brackets.config`.
- Realtime only pushes tables in the `supabase_realtime` publication. `shows` and
  `scores` are in it; adding a table to realtime requires
  `alter publication supabase_realtime add table <t>`.

---

## Current deployed feature set (pre-2.0), for context

Slot types (opener, set1_closer, set2_opener, closer, encore, show_closer,
second_song, **cover_pick** [repeatable, catalog-restricted to covers]) + an
**"Any Debut" wildcard** (any slot, hits if any debut is played). Flat picks,
partial credit, perfect-sheet bonus, cover/debut bonuses. Per-show venue-local
cutoffs (state→IANA tz map, DST-aware). Admin: master voting override
(auto/locked/open), "who's picked" roster, players panel with boot + per-league
ban + collapsible ban list, seasons (named date ranges), per-show 1set/2set format
toggle, finalize + (planned) reopen. Show lifecycle open→locked→live→complete.
Standings with podium (top-3 trophies, gold/silver/bronze **eggs** inside the
wreaths), single Score column (season pts, or career when "All time"), season
selector, nerd stats (shows/avg/high/wins). Draft persistence (pick sheets save to
localStorage every keystroke, restore on return, never wiped by foreground refresh).
3-state theme (auto-follow-phone / light / dark). Collapsible desktop sidebar with
live top-3 mini-standings; bottom-tab single-view on mobile. Tie handling shows
co-winners everywhere ("X & Y tie"). App icon = green laurel wreath (halo on
favicon/small badges only, not the header). Winner "trophy" = wreath over a laurel
pile; podium version has the medal egg inside.

## Known pending work (was queued in chat; verify against actual code state)

- **v6 edge function batch** ("carton-sync-v6"): Cover Pick slot type + Any Debut
  wildcard scoring; "slot not played" wording; tie-fix. Was HELD from deploy while a
  show's picks were locked. Deploy edge fn first, then frontend.
- **Reopen button** (un-finalize a show so corrected Carton data re-scores): planned,
  should also fire a "scores reopened" notification and RESET the show's `winner_sent`
  flag so the corrected winner re-announces. Pairs with "correct The Carton before
  finalizing" workflow (a friend of the dev can edit setlists on The Carton).
- **Slot labels in setlists & notifications**: setlist view shows all slot labels
  ("Laurel — Opener"); live toasts tag ONLY unambiguous-when-they-happen slots
  (opener, set2_opener, encore) + debut. Closer/show_closer are positional so only
  appear in the after-the-fact setlist view. Other footnotes = setlist trivia only.
- **Discord notification logic rework**: broadcast (not personal) + per-league in 2.0.
  Needs a design pass (public non-voter shaming vs. neutral counts; dedupe with
  in-app toasts; per-league channels + per-league webhooks + Discord roles).

---

## THE 2.0 REBUILD (the big upcoming work)

Full spec in `docs/MULTITENANT_SPEC.md`. Summary:

**Three levels: Global → League → Bracket.**
- **Global** (super-admin / the dev): creates leagues, appoints league admins, owns
  the shared show list + Carton sync, sees cross-league global stats (Global-only).
  This app is Eggy-specific; a different band = a fork of the whole app, not a tenant.
- **League** (e.g. *Ambassadors*, *Facebook League*): a discrete community/player pool.
  Has admins. Contains exactly 2 brackets. Sets its own cutoffs. Boots/bans within itself.
- **Bracket** (*Casual* / *Official*): parallel competitions, each with own rules and
  champion. **Casual has NO seasons** (perpetual tally). **Official has seasons** +
  the opt-out mechanic.

**Key decisions (all locked):**
- **One global player identity** (name+PIN app-wide). Players hold per-league
  memberships. Enables global stats (e.g. total shows voted across leagues).
- **Official participation is opt-IN**, and the toggle is **locked while a season runs**
  — no opting in mid-season. League admin can override.
- **Frozen season roster** (`season_rosters`): when an Official season starts, the set
  of opted-in members is snapshotted; scoring reads the snapshot, NOT the live flag.
  Frozen in both directions (opting out / getting booted mid-season leaves you on the
  board, frozen). This makes the "no mid-season change" rule structurally unbreakable.
  Admin override edits the roster explicitly.
- **Global is a SUPERSET of league admin**: every league-scoped power/read uses one
  shared guard `is_league_admin(league) OR is_global_admin`, so Global can act inside
  or see any league (to fix a fumbling league admin). The ONLY Global-exclusive power
  is the account-level nuclear boot (delete a player everywhere + optional app-wide
  name ban).
- **Show list is fully global/shared** (one sync). Cutoffs, format, status, and
  announcement flags are **per-league** (a `league_shows` overlay table). Setlists
  stay global (fetched once per show); scoring runs **per-bracket** against the shared
  setlist.
- **Scoped reads via RPCs** (not RLS) for anything sensitive; public RLS read only on
  truly-global tables (shows, songs_cache, setlist_songs, league names, bracket config).
- **Scale is small** (~10 Ambassadors + ~50 FB = 2x current). No pagination or
  public-registration hardening needed. FB league's 2 runners verify signups manually
  via FB comments; join = admin-adds-player.

**Launch reset (agreed):** beta players know scores get wiped at launch. The wipe
keeps player accounts (names+PINs) but wipes all gameplay (picks, scores, seasons,
setlist data) and keeps the song catalog. This collapses the migration — no delicate
preservation. A **maintenance window is acceptable** (app goes dark between stages),
so NO compatibility-view scaffolding is needed.

**Stage A is already written**: `sql/stage_a_schema.sql` — one file that supersedes
`schema.sql` + all `add_*.sql`. It builds the tenancy tables, does the account-
preserving wipe, and seeds the "Ambassadors" league with Casual + Official brackets,
moving all current players in (grandfathered opt_in=true). Has a verification query
block at the bottom. RUN IT in a quiet window, snapshot first, then check the counts.

**Build sequence from here:**
1. (Claude Code first jobs, BEFORE 2.0) Reorganize repo; split `index.html` into
   modules WITH a build step; verify GitHub Pages deploy still works; recreate the
   test harnesses. Get git history going.
2. **Stage A** — run `sql/stage_a_schema.sql`, verify counts. App goes dark here.
3. **Stage B** — edge function v7: global sync, per-league `league_shows` overlays
   with auto-defaulted cutoffs, the **season-activation step** that writes the frozen
   roster, and the scoring rewrite (one setlist fetch → each bracket under its own
   config; Official reads the roster). Fold in: v6 Cover Pick/wildcard, reopen +
   notification + winner_sent reset, slot labels, debut toast, the Discord
   broadcast/per-league notification rework.
3. **Stage C** — frontend: league/bracket switcher, every screen scoped to current
   bracket, league-admin panel, Global-admin screen (create leagues, appoint admins,
   cross-league stats, nuclear boot). Carry over the cleaner admin show-row layout.
4. App back up; smoke-test **Ambassadors ▸ Official** + empty **Casual**.
5. Create the **Facebook League** via the Global screen, appoint its 2 admins (need to
   know who they are + whether they have beta accounts), they add ~50 players.

### Stage B design notes (scoring / edge function)

- **Relabel the closer slot to "Set 2 Closer"** — display label only; the slot key
  stays `closer` so existing picks/configs don't break. Rationale: "closer" read
  ambiguously next to "show closer." Final vocabulary: **Set 1 Closer** (last of set
  1) / **Set 2 Closer** (last before encore) / **Show Closer** (final song of the
  night, encore included). Keep all three — a wide array of bets is intentional.
- **Best-result-across-replays scoring (CONFIRMED rule).** A pick scores the best
  result the song achieved across all its appearances in a show. If a song plays in
  the wrong slot first (+1 partial) and later plays again in the picked slot, the
  score upgrades to the full slot value — it replaces the partial, it does not add to
  it. Best result never downgrades if a later appearance is wrong-slot. The finalize
  snapshot freezes whatever the best result is at finalization. This matters because
  songs repeat (reprises and sandwiches).
- **Verify repeated-song / sandwich handling** during the scoring rewrite. Sandwiches
  (A > B > A) mean the same song holds two positions, so it gets multiple shots at
  matching a slot. Confirm the scorer evaluates every appearance, not just the first.
- **Duplicates stay OFF by default.** Add a warning tooltip on that admin toggle
  noting the consequence: with duplicates allowed, on a one-song encore a song picked
  for both Encore and Show Closer scores both slots — usually a free double.
- **Cutoff-changed notification** — when a league admin changes a show's cutoff, post
  to that league's Discord channel. Per-league (reads `league_shows`); build as part
  of the broader broadcast/per-league notification rework, not before.
- **`sync_shows` must map `permalink`** from the `/shows.json` response into the
  `shows.permalink` column, and the upsert must UPDATE existing rows, not
  insert-and-ignore-on-conflict — the slug embeds the venue name, so a corrected
  venue name regenerates the slug and a stale permalink would 404.

### Stage C design notes (frontend)

- **Player tooltips on pick-sheet slots** — plain-language definitions so bets are
  informed. Especially the three closers (a player recently lost points picking Show
  Closer when they meant Set 2 Closer), the Any Debut wildcard, and Cover Pick's
  covers-only catalog restriction.
- **Admin tooltips on the config screens** — the same slot definitions plus the rule
  mechanics a game runner controls: partial credit, perfect-sheet bonus, wildcards,
  the duplicates warning above, the best-result-across-replays rule, master override,
  format toggle, and (in 2.0) the Official opt-out mechanic. Important because 2.0
  delegates leagues to admins who didn't build the game. Write the slot definitions
  once and surface them in both the player and admin surfaces.
- **Standings default season selection (replaces current behavior).** Rules in
  priority order:
  1. If a season is currently active (today inside its date range) → default to
     that season.
  2. Else if a season ended within the last 7 days → default to that just-finished
     season (grace period, so people can savor the result).
  3. Else → default to All time.
  If a new season starts during another's grace period, the new active season wins.
  Note: current code falls back to the most recent season when none is active, which
  leaves stale finished boards showing indefinitely between tours — this replaces
  that. In 2.0 this rule generalizes for free: Casual has no seasons, so it always
  lands on All time, which is correct since Casual is a perpetual tally.
- **`players_public` no longer carries admin status** (Stage A drops `is_admin` and
  recreates the view without it). The current `loadPlayers()` reads `p.is_admin` from
  this view to show the ★ marker; in 2.0 that has to come from
  `league_members.is_league_admin` (and `players.is_global_admin` for Global), scoped
  per league.

---

## Conventions

Instance-specific values (name, branding, default slots, data source) live in
named constants (`src/core/config.js` for frontend; a top-of-file constant in
the edge function/SQL seed) rather than hardcoded inline.

## Deploy model

- Frontend: commit + push → GitHub Pages serves it. (After the monolith split, a build
  step will produce the deployable output — establish and document it.)
- Edge function: `supabase functions deploy carton-sync`.
- SQL: run in the Supabase SQL editor (or via `supabase db` tooling).
- Cron: the scoring function runs on a schedule; the schedule SQL embeds the anon key
  in an Authorization header — if the key ever rotates, the cron header needs updating
  too (two places: frontend constants + cron header).

## Tone / working style the dev prefers

Direct, honest about tradeoffs and limitations, no false reassurance. Flags the
non-obvious consequence of a change. Doesn't over-engineer for hypotheticals. Willing
to push back on a design smell. Values getting the data model right over shipping fast.
