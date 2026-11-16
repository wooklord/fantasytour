# CLAUDE.md — Fantasy Eggy project playbook

This file is read automatically by Claude Code. It holds the binding rules,
hard constraints, the ways-of-working protocol, and a pointer stub for every
other entry. The full decision records with their rationale live in
`docs/decisions/`; resolved checkpoints, dated verifications and closed
batches live in `docs/history/` (index at the bottom). Every moved paragraph
is there verbatim, extracted from this file at commit 54a5ab8 on 2026-10-18.
Read this whole file before touching anything, and read the linked record
before touching the thing it covers.

---

## What this is

**Fantasy Eggy** — a fantasy-setlist game for fans of the jam band **Eggy**. Players
predict what songs the band will play in specific "slots" (opener, encore, etc.),
scores are computed automatically from the real setlist after each show, and there
are standings, seasons, an admin panel, and notifications. Think fantasy football,
but for concert setlists.

Sibling app: the "Ambassadors" tour-map PWA (separate project, same developer).

## Current architecture

- **Frontend**: ES modules under `src/` (`src/core/` shared infra — state,
  Supabase client, theme, switcher, session, tiebreak, format, layout,
  realtime, dom; `src/features/` tab screens — auth, shows, picks, standings,
  admin, settings). `node build.mjs` (esbuild) bundles `src/main.js` into
  `app.js` + `app.js.map` at the repo root; `index.html` is a thin shell that
  loads `app.js` as a plain `<script>`. **The bundle is checked into git and
  must be rebuilt (`npm run build`) and committed with every `src/` or
  `styles.css` change — GitHub Pages serves whatever `app.js` is committed
  and runs no build step itself.**
- **Backend**: Supabase (Postgres + RLS + Realtime + Edge Functions). Auth is
  name + PIN, not Supabase Auth (chosen for venue LTE and a closed community);
  all writes go through `SECURITY DEFINER` RPCs that verify the PIN
  server-side. Edge function `supabase/functions/carton-sync/index.ts` (Deno)
  polls the setlist source, scores picks (`scoring.js`, pure, unit-tested) and
  posts announcements; a pg_cron job calls it every minute with
  `{"action":"score"}`.
- **Setlist source**: The Carton's public Songfish API
  (`https://thecarton.net/api/v2`, no key; `data.data` arrays, venue field
  names vary, debuts/covers from footnotes/`isoriginal`, `is_encore` from
  setnumber/settype). Opener/closer/etc. are positional inferences the scorer
  computes, NOT API tags — this matters for live vs. post-show labeling.
- **Notifications**: in-app realtime toasts, and per-league Discord webhooks
  resolved from `DISCORD_WEBHOOK_<LEAGUENAME>` secrets (broadcast, so it names
  non-voters publicly rather than personalising). Current routing state:
  `docs/decisions/discord-routing.md`.

## Credentials

- Supabase project ref: `zdfhglvjxquvkjyvophz`
- Publishable/anon key: `sb_publishable_qN1goR6-Ss3cErnJJIJdKw_xr5nrFuo`
  — this is PUBLIC by design (it's in the deployed frontend JS). Safe to commit.
- The **service_role / secret key must NEVER** be committed or put in the frontend.

---

## SESSION DURABILITY PROTOCOL (standing rule — read this every session)

A session can end without warning at any point — a usage limit, a context
boundary, a closed terminal. This project already lost a full session's
worth of decisions once this way (the edge-function-scope assumption behind
Module B sat wrong in conversation for an entire session because nothing
forced a write to disk). Three rules, effective 2026-08-12:

1. **Write decisions when they're made, not at wrap-up.** The moment a
   decision, interpretation, or answer to an open question is locked, write
   it into CLAUDE.md (or the relevant in-repo plan file) and commit it right
   then — don't batch documentation for an end-of-session step. Don't ask
   permission first; make the write, then report what was written in one
   line. If mid-task when a decision lands, finish the write before
   continuing the task.
2. **On "park" / "stop" / "wrap up" / "I'm done," do the durable writes
   FIRST, in this order:** (a) update CLAUDE.md with every decision locked
   this session; (b) update the in-repo plan file with current state, next
   step, and any question still open — including unresolved ones, since a
   question that only exists in conversation is lost the moment the session
   ends; (c) commit and push both, confirm `main` matches `origin/main`;
   (d) only then stop any dev server, report what's still running, and give
   the resume command/directory. (a)-(c) are the only steps that require the
   assistant at all — if something is about to cut the session off, do
   (a)-(c) and skip (d).
3. **If a decision from an earlier session turns out wrong or was never
   actually recorded, say so explicitly rather than quietly working around
   it.** That's exactly how the edge-function assumption behind Module B
   survived as long as it did.
4. **LOCKED 2026-10-18 — new decision records go to
   `docs/decisions/<topic>.md` by default, with a one-line pointer in this
   file's index (and a stub under the entry name, if the entry has one).**
   This changes only the *destination* in rules 1 and 2(a); "write it when
   it's made, not at wrap-up" is unchanged. This file stays under 40k
   characters so Claude Code loads all of it: if a pointer stub needs more
   than 5 lines, the content belongs in `docs/`, not here. Resolved
   checkpoints and dated verifications go to `docs/history/`.

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
5. **Verify the condition, not a proxy for it.** This codebase has produced the
   same bug three times: `picks.length === expected` instead of checking which
   rank positions are actually covered; `added_at IS NOT NULL` instead of
   comparing it to `roster_locked_at`; "zero pre-adds on Wednesday" asserted
   about Friday's state. Each was a real, measurable thing that *usually*
   correlates with the condition that actually mattered — which is exactly what
   makes the substitution easy to miss in review and easy to pass in testing.
   When writing a check, state the condition in words first, then confirm the
   code tests **that** and not a correlate of it. The three above are worth
   re-reading as a set: a count standing in for coverage, a
   presence check standing in for equality, and a point-in-time observation
   standing in for a claim about the future.
6. **NEVER use `git checkout <file>` (or `git restore <file>`) as a cleanup
   step. It is whole-file and reverts to HEAD** — it does not undo "the
   thing you just did", it discards *every* uncommitted change in that file.
   It is only safe when the file has no other uncommitted work, which is
   exactly the condition nobody checks before typing a cleanup command.
   - **This fired on 2026-08-17, it was not a near miss.** A probe line was
     appended to `styles.css` to prove a CSS edit moved the new build hash,
     with `git checkout styles.css 2>/dev/null || sed -i '$ d' styles.css`
     as cleanup. `git checkout` **succeeded**, so the `sed` fallback never
     ran — and the success is what did the damage: it reverted the whole
     file to HEAD, discarding an entire session's CSS work (the `.scopeline`
     label/note split, the `.section-scope` comment, the `#bracketToggle`
     sizing, the `.buildid` rule). Caught by grepping for each expected
     marker and finding all four at zero, then restored by hand.
   - **The instinct to correct: the danger was the PRIMARY command, not the
     fallback.** A `||` chain reads as "try the safe thing, fall back to the
     blunt one", which inverts what actually happened here. Reasoning about
     the fallback while the primary is the destructive one is how this gets
     repeated.
   - **Use instead:** a targeted revert of the specific edit (remove the
     exact line you added), or copy the file first and restore from the
     copy — the same backup pattern the mutation-testing passes use. Both
     are bounded to what you changed; `git checkout` never is.
   - Related, same family: `git stash`, `git restore .`, and `git clean` all
     have this property at wider scope. None belong in an automated cleanup.
   - **SECOND INSTANCE, same night, different tool: a line-numbered `sed`
     revert that can SILENTLY NO-OP.** Reverting a mutation with
     `sed -i '120s/^$/      stopNoLeaguePolling();/'` only works if line 120
     is still empty. Any edit that shifted the file leaves the substitution
     matching nothing, `sed` exits 0, and **the mutation stays in the
     source**. The suite then passes — because the assertion that catches
     that mutation only fails when it runs against a correctly reverted
     file — so a green run would have been read as "reverted and clean"
     when the code was still mutated.
   - **The shared shape across both instances: a cleanup command that
     reports success whether or not it did what you meant.** `git checkout`
     succeeds while discarding more than intended; line-numbered `sed`
     succeeds while discarding nothing. Neither failure is visible in the
     exit code, and both look identical to a correct run.
   - **Use `str_replace`/Edit for reverts, anchored on the actual text**, so
     a moved line fails loudly instead of silently. Then **confirm with
     `git diff <file>` before building** — an empty diff against HEAD is the
     only real proof the mutation is gone. Do not infer it from a passing
     suite; a suite that passes is exactly what a failed revert produces.
7. **Record mentions at the weight they were given.** One offhand comment is a
   mention, not a commitment — and writing it down as a deliverable makes it
   indistinguishable from one later. This project has run the failure in both
   directions on the same subject (the desktop sidebar): a single passing
   remark was escalated across sessions into a named artifact with its own
   roadmap entry and an implied rejected alternative, and then the correction
   over-swung to "never existed," deleting the real preference along with the
   invented detail around it. Inflation and erasure look like opposite
   mistakes but are the same one — **a claim not calibrated to the evidence
   behind it.** So: write down what was actually said, at the strength it was
   actually said, and mark the strength explicitly ("mentioned once, never
   specified") rather than letting a later reader infer it from the fact that
   it got written down at all.
   - Note the remedy in item 5 and the repo-check remedy elsewhere in this
     file **do not cover this case**. "Check it against the actual repo"
     adjudicates claims about *code*; a claim about what the dev *wants* has
     no artifact to check against, and never will. Calibrating at the moment
     of recording is the only defense available.

**Testing harness, coverage gaps and mutation-derived rules —
`docs/decisions/testing-harness.md`:** `npm test` (scenario suite, blind to
CSS); no two-league fixture yet; a set-valued computation needs an empty-set
case; a stage file's first check is the catalog; "does anything INVOKE this
handler?" is standard. Mutation log: `docs/history/2026-08-mutation-log.md`.

## Postgres / Supabase gotchas learned the hard way

Pointer stubs under the original entry names; the full text and rationale is
in the file each one names.

- **🚨 A NEW LEAGUE GETS ZERO `league_shows` ROWS (found 2026-10-11).** Only
  `syncShows()` creates overlay rows; Green Eggs' were created by "Sync shows"
  on 2026-10-11. LOCKED list, Stage R (written, NOT applied) and THE
  POST-FIRST-SHOW BATCH (a)–(f): `docs/decisions/post-first-show-batch.md`.
  Pre-sync check, verification, findings: `docs/history/2026-10-green-eggs-overlay.md`.
- **Discord routing — Part 2 LIVE 2026-11-01** (Stage Y applied, edge deployed,
  client pushed; Part 1 LIVE 2026-10-31, D7 DONE): the league's own secret
  only, NO global fallback; author "Fantasy Eggy · <League>", no mentions. The
  full record, the daily webhook check, the hint rules and the status
  vocabulary: `docs/decisions/discord-routing.md`.
- **Short Postgres rules — `docs/decisions/postgres-rules.md`:** pgcrypto is
  in `extensions`; finalized `breakdown` text is frozen; `shows.timezone` null
  means unmapped, and a new `shows` column needs its own backfill; `banned` is
  vestigial; scoped reads are RPCs not RLS; the three edge actions authenticate;
  revoke PUBLIC on every new helper; login is case-insensitive; competition ranking.
- **Realtime gotcha — `docs/decisions/realtime.md`:** a table missing from
  the `supabase_realtime` publication silently kills EVERY binding on the
  shared channel while it still reports `SUBSCRIBED`; publication and RLS are
  independent gates. `scores`/`league_shows` have no public policy by design,
  so `realtime_pings` (roadmap decision 4) carries their toasts.
- **Auth and security — `docs/decisions/auth-security.md`:** login rate-limiting (3-part fix,
  progressive delay NOT lockout; gate #1); `ft_session` holds the plaintext PIN (token exchange
  is the fix; gate #2); PINs ARE bcrypt-hashed; 401/403 on auth failure; the ADMIN PIN RESET live
  read (a reset breaks other sessions silently; playbook `docs/admin_playbook_forgot_pin.md`).
  Gates #1 and #2: trigger passed 2026-10-11; status in local notes.
- **✅ Domain move 2026-08-15** to `fantasyeggy.wooklord.net` needed no code
  changes; never set a cookie with a `domain` attribute.
  `docs/history/2026-08-domain-move.md`.
- **`songs_cache.times_played`/`last_played` are dead** — The Carton never
  returns them; any play-count feature needs a full-history backfill first.
  In `docs/decisions/scoring-modes.md`, since Module A is what it blocks.
- **Edge function — `docs/decisions/edge-function.md`:** the silent
  multi-row-insert failure in `activateSeasons()` (fixed: upsert + stamp only
  on success; watch for an unguarded batch write followed by an unconditional
  "done" stamp anywhere) and the still-open unit test for its error path.
  Same family, 2026-11-07: `sync_songs` failed on EVERY press since
  2026-07-18 (a duplicate Carton title sank the whole upsert; the error read
  "[object Object]"); fixed in code, deploy pending with the 3-hour reminder.
- **✅ Ranked-choice deploy batch and first production run (2026-08-14/15).**
  If ranked scores ever look uniform and low, check the deployed `scoring.js`
  has `scoreRankedPicks` first; recovery is `reopen` → fix → `finalize`.
  `docs/history/2026-08-ranked-choice-deploy.md`.
- **Format toggle orphans (2026-08-14, resolved by deleting the rows):**
  standard→one_set stranded `encore`/`flat2`; `submit_picks`'s catch-all
  delete destroys orphans; nothing records when a format changed.
  `docs/history/2026-08-14-format-toggle-orphans.md`.
- **✅ Test 3 activation (2026-08-14):** the roster fix verified under 13-of-14
  conflicts, with the method for any future activation check.
  `docs/history/2026-08-test3-activation.md`.

---

## Frontend/CSS gotchas learned the hard way

- **Admin cutoff-fallback DST bug (found 2026-10-11, NOT FIXED):** the
  "venue timezone unknown" path applies today's device offset to the show's
  date. **Dev's rule until fixed: Change cutoff is off-limits for November
  and December shows in both leagues.** Fix approved, HELD for the
  post-first-show batch (d): `docs/decisions/post-first-show-batch.md`.
- **`.sheet` is theme-invariant paper** — never use `--cream*`/`--panel*`/
  `--line*`/`--pit`/`--indigo` or any app-wide component class on it;
  `--coral` on paper fails AA in both themes (NOT FIXED). **The podium row**
  has three width tiers and must never wrap. `docs/decisions/frontend-css.md`.
- **Standings/Settings UX LOCKED 2026-10-25 — `docs/decisions/standings-ux.md`:**
  Settings links from `state.leagues`; View chip (`ft_board_view`); own-row
  yolk OUTLINE on `is_mine`, never a fill; 20-char cap on NEW names only.
  Who's Picked two-line rows + Show chip: `admin-panel.md`.

---

## Multi-league switcher behavior

**A player added to a second league, or removed from one, must FULLY RELOAD
the app** (close and reopen the PWA); foregrounding refreshes everything
except `state.leagues`. Brief every league admin. The no-league screen polls
itself (2026-08-20); a stale `ft_bracket_id` cannot desync (don't "fix" it);
bracket ids are globally unique by dependency. `docs/decisions/multi-league-switcher.md`.

---

## Feature set frozen at the start of 2.0 (historical snapshot — NOT current)

`docs/history/pre-2.0-feature-snapshot.md`. Not maintained, and it has sent
work the wrong way four times: verify any claim against `src/` or `git log`
before acting on it. The false-memory mechanism it documents runs in both
directions — inflation and erasure — see discipline item 7.

## Known pending work (pre-2.0 queue)

`docs/history/pre-2.0-pending-work.md` — reopen and `cutoff_changed` are
wired, debut tags shipped, per-song slot labels were never built. Game
numbering past 12 shows: `docs/decisions/deferred.md`.

---

## THE 2.0 MODEL (built — spec in `docs/MULTITENANT_SPEC.md`)

**Three levels: Global → League → Bracket.** Global (the dev) creates leagues,
appoints league admins, owns the shared show list and Carton sync. A League
is a discrete player pool with its own admins, exactly two brackets, its own
cutoffs and bans. A Bracket (Casual / Official) is a parallel competition with
its own config and champion: Casual is a perpetual tally with no seasons,
Official has seasons. This app is Eggy-specific; another band is a fork, not
a tenant.

**Locked decisions:**
- **One global player identity** (name+PIN app-wide) with per-league
  memberships.
- **Official opt-in defaults TRUE** (reaffirmed 2026-10-12) and the toggle is
  locked while a season runs; a league admin can override via the roster.
  Stage F APPLIED 2026-10-26: live default `true`, zero `false` rows; batch
  item (e) done. There is no self-service opt-out UI (`set_official_opt_in`
  has no caller). Full record and the Stage F history:
  `docs/decisions/official-opt-in-default.md`.
- **Onboarding LOCKED 2026-10-24** — `leagues.config` jsonb for community
  links, three derived states, join codes, Stage F as its own batch, and
  a public-select conflict found during the write: `docs/decisions/onboarding.md`.
- **Frozen season roster** (`season_rosters`): snapshotted at activation,
  scoring reads the snapshot not the live flag, frozen in both directions;
  admin override edits the roster explicitly.
- **No season covering a show's date = nobody scores in Official.** Signed
  off, not a bug; the Seasons-panel "no season covers" warning is the
  mitigation.
- **Global is a SUPERSET of league admin**: one shared guard,
  `is_league_admin(league) OR is_global_admin`. The only Global-exclusive
  power is the account-level nuclear boot (`global_boot_player`).
- **Shows are global; cutoffs, format, status and announcement flags are
  per-league** (`league_shows` overlay). Setlists are global; scoring runs
  per bracket against the shared setlist.
- **Scoped reads via RPCs, not RLS**; public RLS only on truly-global tables
  (shows, songs_cache, setlist_songs, league names, bracket config).
- **Scale is small** (two leagues, under 100 players): no pagination, no
  self-registration hardening; join = an admin adds the player.
- **Launch reset, Stage A and the original build sequence are done** —
  `docs/history/stage-a-and-build-sequence.md`; Stage B/C design and build
  logs in `docs/decisions/scoring-rules.md` and
  `docs/history/stage-c-build-log.md`.

### Stage B design notes (scoring / edge function)

**Binding scoring rules — `docs/decisions/scoring-rules.md`:** Set 1 / Set 2
/ Show Closer vocabulary; scoring is fresh off the current snapshot, never
merged (Boston 7/31); closer-family slots score only once `slotDetermined`;
duplicates off by default; `sync_shows` maps `permalink`. Also there: the
`oneset` two-fallbacks fix, perfect-sheet count-vs-coverage, the "Perfect"
rename rule and the format-change design question.

2026-10-15 footnote incident (2-point Any Debut swing; "FTP" never matched) and
the open debut/finalize rules questions: `docs/history/2026-10-15-wild-mountain-honey-footnote.md`.

### Stage C design notes (frontend)

Build log for C1 / C2a / C2b, Official gating, the no-season warning, the
roster override, The Rules card and the standings default season:
`docs/history/stage-c-build-log.md`. Still open: admin tooltips for rule
mechanics — `docs/decisions/deferred.md`.

### 2.0 REBUILD roadmap — resolved decisions

(full reasoning and the Session 0–5 log: `docs/history/rebuild-session-log.md`)
1. **Global console: minimal build** — create league, appoint admin,
   Global-scoped PIN reset. No cross-league stats (revisit past 2–3 leagues).
2. **Per-league Discord webhooks: env-var stopgap kept**
   (`DISCORD_WEBHOOK_<LEAGUENAME>`); DB column + admin UI stays deferred.
3. **Forgot-PIN: self-service `change_own_pin` + admin `admin_reset_player_pin`**
   — server-generated PIN, returned once, never stored in plaintext, forces a
   change on next login (`must_change_pin`); league admins reset within their
   league, Global anyone. Built (Session 4).
4. **scores/league_shows realtime: a ping table, not a public RLS policy and
   not polling** — a public policy would expose every league's scores to the
   shared anon key. Built (Session 3): `docs/decisions/realtime.md`.
5. **Notification-preference toggle: deferred**, separate work, no trigger.

Sessions 1–4 are done. Session 5 (second-league launch) is partially done.
The PRE-SESSION-5 GATE written to precede it was overtaken on 2026-10-11:
`docs/decisions/pre-session-5-gate.md`.

### DATED DEADLINES — check these first, they expire

Distinct from the Pre-Session-5 gate, which was triggered by an *event* (the
second league's launch) and was overtaken on 2026-10-11:
`docs/decisions/pre-session-5-gate.md`. These are triggered by a *date* and stop
being actionable once it passes. Indexed here because they otherwise live
only inside the Postgres/Supabase gotchas section, where nothing points at
them. **The Status column is the count** — closed rows stay as a record
rather than being deleted.

**No row is listed here as of 2026-11-15.** The 2026-10-15 reminder-test row
was moved verbatim to `docs/history/closed-deadlines.md` with its outcome not
recorded. The closed rows (three 2026-08-14 items, the 2026-10-14 Green Eggs
overlay) are in the same file.

### PRE-SESSION-5 GATE — OVERTAKEN 2026-10-11, kept as a record

Written to be walked before the second league launched and before any non-dev
league admin existed. Green Eggs launched, and its first non-dev league admins
joined on 2026-10-11, with the gate not completed, so it is a record now, not a
pending checklist: `docs/decisions/pre-session-5-gate.md` (seven items,
numbering kept).

**Ordering and the deferred list — `docs/decisions/deferred.md`:** the gate's
ordering note (settle #4 before #5, and #1–#3 before either) was written for an
event that passed 2026-10-11, and it was not met; the desktop sidebar is
deferred at mention-weight; cross-league stats, the webhook DB+UI, the
notification toggle and game numbering each have a revisit trigger there.

**DECIDED 2026-08-17, NOT STARTED: `sync_shows`, `sync_songs` and `score` are
UNAUTHENTICATED** — `docs/decisions/cron-secret-edge-auth.md`. Dual path (a
`CRON_SECRET` for the cron, name/PIN for the buttons), keep the three buttons.
Hourly `sync_shows` SUPERSEDED by the daily in-tick show sync — LIVE 2026-10-26:
Stage U applied, deployed, pushed (`docs/show_sync_plan.md`). Unknown actions run scoring: don't probe.

**HOW TO ANSWER "IS THE NEW BUNDLE LIVE?" — build id:** compare the
`<hash>-<sha>` the Settings card shows with what `curl` of the live `app.js`
serves; the curl commands, the stale-client vs not-deployed distinction and
the hash rationale: `docs/decisions/deploy-cache.md` (Quick reference).

**Cache-busting entry — deferred:** `app.js` has no cache-busting and both it
and `index.html` are served with `max-age=600`, so an open PWA keeps the old
bundle until closed and every breaking RPC change needs the P1/P2 two-file
dance. Recommended fix: `app.js?v=<hash>`. `docs/decisions/deploy-cache.md`.

**Backups — THE RESTORE PATH HAS NEVER BEEN TESTED.** Dumps live outside the
repo in `C:\Users\kylem\backups\fantasyeggy\` (the folder holds a plaintext
connection string; never move it into the repo). `docs/decisions/backups.md`.

**Orphan checks (✅ `toggleFormat` confirms, 2026-08-18; ✅ `saveConfig`'s
check fixed, 2026-08-21):** count at-risk picks via `admin_pick_status`, never
the cutoff-gated `get_show_picks`; the fake's cutoff gate is permanent.
`docs/history/2026-08-orphan-checks.md`.

**Admin panel — `docs/decisions/admin-panel.md`:** two saves write
`brackets.config`, one writer per field; the admin tab is GROUPED BY SCOPE
with three bounding dividers and the order is load-bearing (Seasons sits
above the line on purpose); Members-panel styling understates Reset PIN.

**Boot entry — BUG: BOOTING A PLAYER MID-SEASON DOES NOT STOP THEM ACCRUING
ZEROS** (the `season_rosters` row stays and standings counts roster zeros).
Rejected: deleting the roster row. Real fix: `season_rosters.removed_at`, its
own session; gate is state-based. `docs/decisions/boot-removed-at.md`.

**`must_change_pin` is set by BOTH reset buttons (NOT a bug)** and the full
ADMIN PIN RESET read: `docs/decisions/auth-security.md`. The countdown is
phrased two ways (`picks.js` vs `shows.js`, unresolved):
`docs/history/2026-08-copy-changes.md`.

### Alternate scoring modes (designed; Module B shipped in Casual)

`docs/decisions/scoring-modes.md`. Module A (last-played weighting) is blocked
on a full-history backfill. Module B's four locked decisions (2026-08-12): pure
rank-value scoring, perfect-sheet against the full ladder by coverage, fixed
row count regardless of format, partial sheets allowed. Mid-season ladder
edits stay unguarded; the revisit was tied to the first non-dev league admin
(gate #4), an event that passed 2026-10-11. Current status is kept in local notes.

---

## Conventions

**STANDING RULE — no player nicknames and no pick contents in tracked files,
ever.** This repo is public: `curl` with no credentials returns 200 on both
`github.com/wooklord/fantasytour` and `raw.githubusercontent.com/.../CLAUDE.md`
(verified 2026-08-15 UTC). Nicknames are the login identifier — half of the
name+PIN credential pair — so writing them into a tracked file publishes one
factor of every account named. That covers CLAUDE.md, plan files, commit
messages, SQL comments, test fixtures, and analysis HTML alike. Player UUIDs
too. Refer to players by role ("the league admin", "the eighth member") or by
the property that matters ("the one member not on the roster before
activation"); resolve identity with a query at the time you need it.
- **Broken the day it was written** (`caab1d6`, redacted 2026-08-15; history
  deliberately not rewritten — the leak was dominated by the then-anon
  `get_show_picks`): `docs/history/2026-08-15-nickname-redaction.md`.
- **`test2-scoring-comparison.html` is GRANDFATHERED, explicitly.** Removing it
  is a separate decision, not a cleanup task, and it needs the dev's call. A few
  other files carry real nicknames as fixture data under the same
  grandfathering. Why, and which files: `docs/decisions/conventions.md`.

Instance-specific values (name, branding, default slots, data source) live in
named constants (`src/core/config.js` for frontend; a top-of-file constant in
the edge function/SQL seed) rather than hardcoded inline.

**Decision docs cite code by function name plus "as of <sha>", never a bare
line number** (2026-11-01): bare numbers in `scoring-rules.md` rotted twice
within two weeks, the 2026-10-18 anchors at Stage U and the 2026-10-30 ones
at `bb2dea4`.

## Deploy model

- Frontend: `node build.mjs` (or `npm run build`) to rebuild `app.js`/`app.js.map`
  from `src/`, commit the bundle alongside the source change, then push → GitHub
  Pages serves whatever's committed. There is no CI build step — a `src/` edit
  that isn't rebuilt+committed silently ships stale behavior.
- Edge function: deploy via the Supabase CLI (`supabase`, v2.x) — install and
  authenticate it if it isn't already, on whatever machine you're working from.
  Project ref is `zdfhglvjxquvkjyvophz` (matches Credentials above; `supabase
  projects list` confirms it once authenticated). Deploy with:
  `supabase functions deploy carton-sync --project-ref zdfhglvjxquvkjyvophz`
  (the `--project-ref` is redundant once linked, but explicit is safer than
  relying on link state). A "WARNING: Docker is not running" line is harmless —
  the CLI falls back to uploading source directly instead of bundling in a
  container; the deploy still succeeds and the printed `dashboard_url` /
  `"message":"Deployed Functions."` confirms it.
- SQL: run in the Supabase SQL editor (or via `supabase db` tooling).
- Cron: the scoring function runs on a schedule; the schedule SQL embeds the anon key
  in an Authorization header — if the key ever rotates, the cron header needs updating
  too (two places: frontend constants + cron header).
- **Local preview: `npm run dev`**, fixed at `http://localhost:8080/`. Before
  starting a second one, check `netstat -ano | findstr :8080`. **On mobile, open
  a new private/incognito tab, not an existing regular one.** Full note:
  `docs/decisions/deploy-cache.md` (Local preview).

## Tooling / account notes (full text: `docs/decisions/tooling.md`)

- **An account switch needs re-auth in TWO places**: Claude Code AND the Chrome
  extension, separately.
- **NEVER TYPE A DESTRUCTIVE STATEMENT INTO THE SUPABASE SQL EDITOR.** Typed
  input silently drops characters. Set the text through the editor's model and
  verify it before executing: `docs/decisions/tooling.md` (Quick reference).

## Tone / working style the dev prefers

Direct, honest about tradeoffs and limitations, no false reassurance. Flags the
non-obvious consequence of a change. Doesn't over-engineer for hypotheticals. Willing
to push back on a design smell. Values getting the data model right over shipping fast.

## Index of docs/ files

Each file opens with the `CLAUDE.md` lines it came from. New records go here
by default (durability rule 4).

`docs/decisions/` (binding): `admin-panel` · `auth-security` · `backups` ·
`boot-removed-at` · `conventions` · `cron-secret-edge-auth` · `deferred` (plus two 2026-10-18
scoring bugs: stale `setlist_songs` footnote/cover, score-write diff never
matches — full text in `scoring-rules`) · `deploy-cache` ·
`discord-routing` · `edge-function` · `frontend-css` ·
`multi-league-switcher` · `official-opt-in-default` · `onboarding` ·
`post-first-show-batch` (the 🚨 overlay entry, LOCKED list, batch (a)–(f),
DST bug) · `postgres-rules` · `pre-session-5-gate` (overtaken 2026-10-11) ·
`realtime` · `score-corrections` (Stage AA + first fix APPLIED 2026-11-15;
Reopen Global-only + audit log DECIDED, NOT BUILT, wanted by 11-20; backups open) · `scoring-modes` ·
`scoring-rules` · `setlist-check` (decision (2), the daily setlist check:
LOCKED 2026-10-31, not built; item 8 scope 2026-11-15: not scorer/deploy bugs,
whose repair is the dev's alone (Global)) · `standings-ux` · `testing-harness` · `tooling`.

`docs/history/` (resolved, dated): `2026-08-14-format-toggle-orphans` ·
`2026-08-15-nickname-redaction` · `2026-08-16-stage-p` (gate #7) ·
`2026-08-copy-changes` · `2026-08-domain-move` · `2026-08-mutation-log` ·
`2026-08-orphan-checks` · `2026-08-ranked-choice-deploy` ·
`2026-08-test3-activation` · `2026-10-green-eggs-overlay` ·
`2026-10-15-wild-mountain-honey-footnote` (2-point Any Debut swing) ·
`closed-deadlines` · `pre-2.0-feature-snapshot` (not current) ·
`pre-2.0-pending-work` · `rebuild-session-log` (Sessions 0–5) ·
`stage-a-and-build-sequence` · `stage-c-build-log`.

Local notes = `.scratch/local-notes.md`: untracked; holds per-item status and sensitive reasoning. Tracked files say "local notes" and carry none of it.
