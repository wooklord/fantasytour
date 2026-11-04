# BUILD PLAN — daily setlist check (decision (2)) — approved 2026-11-01

> **STATUS: BUILD STEPS 1, 2 AND 3 WRITTEN 2026-11-02; Stage Z APPLIED 2026-11-02**
> (results in §8 step 1). Step 3 is the deploy-A code: committed, NOT deployed,
> held until 2026-11-06 is final in both leagues (§8 step 3). The rest is still
> plan. The replay passed 2026-11-02 (§2). Checked locally before the apply,
> 2026-11-02: the Stage Z file, every
> footer step and the rehearsal SQL ran clean on throwaway in-memory Postgres
> (PGlite 0.5.14 with real pgcrypto, PGlite 0.3.14 with stubs for it) against
> hand-written stub tables. That says nothing about the rehearsal SQL on the live
> schema, which has not run there.
> Approved in Chat 2026-11-01 in two passes (the outline, then the full
> file with the five changes listed under "Second pass" below). Decision
> record (binding): `docs/decisions/setlist-check.md` — LOCKED 2026-10-31,
> with the "Refinements 2026-11-01 (from the plan)" section added when this
> file was approved. If the two ever disagree, the decision record wins and
> this file is wrong. Survey behind both:
> `docs/history/2026-10-31-setlist-guard-survey.md`.

Sibling plan files: `docs/show_sync_plan.md` (the shape this follows:
stages in apply order, files touched, verification, rollback) and
`docs/module_b_ranked_choice_plan.md`. Standing rule (`CLAUDE.md` →
Conventions): no player nicknames, no player ids, no pick contents in this
file; league ids (1 Ambassadors, 2 Green Eggs) and bracket ids (1–4) are
fine. **Every function named below is cited as of `b9f3ee6` (2026-11-01)**
unless a different sha is stated; no bare line numbers.

## What this builds

At finalize, the edge function stores two hashes and two projection texts
of the Carton setlist it just scored, on the league's `league_shows` row.
Once a day, after the daily show sync, it re-fetches every final (league,
show) that has scores rows, re-hashes, and records a `setlist_flags` row
when the scoring facts changed (kind A, `scoring`) or only the display
facts changed (kind B, `drift`). A kind A flag is enriched with a
field-level diff and a re-derivation of that league's frozen verdicts (slot
and song only). Flags surface on the Admin tab: a notice per show in the
Shows section, a block for flagged shows older than the section's window,
and the existing header pill carrying the combined count. Nothing is
corrected automatically; design item 8 governs corrections.

## Approval decisions (2026-11-01, dev's call, recorded at the weight given)

The section outline was approved with these decisions, which this file
folds in. Items (a) and (b) are also recorded in the decision record.

- **Findings 1–5 approved as proposed**: the Stage X test amendment and the
  `_account_has_played` extension (1); the flagged-shows block for shows
  outside the Shows section's 7-day window (2); the three-way show-id rule
  (3); `setlistCheck.js` as the pure module, hash tests in
  `test/scoring.test.mjs`, that file wired into `npm test` (4); the first
  run as a permanent null-hash branch of the daily job (5).
- **Finding 3's guard:** the null-hash branch writes a baseline only from
  an id-matched fetch. Fallback rows never baseline: the row stays null and
  is flagged with `detail.reason` naming the fallback.
- **(a) Baseline stays at finalize; Clear never rewrites hashes.** Detection
  is per hash, independently: scoring hash vs baseline → kind A, deduped on
  the scoring hash; full hash vs baseline → kind B, deduped on the full
  hash; kind B is suppressed only in a run that raises a kind A for the
  same (league, show). So `carton_hash` on a flag row is the scoring hash
  for kind A and the full hash for kind B (column comment says so).
- **(b) Store the projection text beside each hash** on `league_shows`
  (two nullable text columns, written wherever the hashes are). `detail`
  carries a field-level diff from a pure `diffProjections(baseline,
  current)` in `setlistCheck.js` (added / removed / moved rows, per-field
  changes keyed by position and `norm(songname)`), with its own tests and
  mutation list. Never diff against `setlist_songs`.
- **(c)** The flagged-shows block sits above the dated rows inside the
  Shows collapsible, same noticebox + Clear.
- **(d)** The three-way rule of finding 3, plus the guard above.
- **(e)** `note` is SQL-editor-only in v1; `admin_clear_setlist_flag` takes
  no note parameter.
- **(f)** Clearing a setlist flag counts as account history, the same as
  `sync_flag_clears`.

**Second pass (same day), on the three points the draft surfaced and two
more:**

- **Day-after kind B (draft §9 item 1):** kind A rows carry the full hash
  at raise time in `detail.full_hash`; a kind B candidate is suppressed
  whenever ANY kind A row for the same (league, show) carries the current
  full hash, not only when this run raised one. Reason: the literal rule
  produced one redundant kind B per kind A on the day after. Found while
  writing the plan; recorded in the decision record as a refinement of
  (a).
- **Guard at finalize (item 2): one rule everywhere.** No baseline is
  written from fallback rows, in the final pass or in the null-hash
  branch. Consequence: a show whose Carton id is not among the rows at
  its stored date stays null, gets one flag per state, and is watched by
  daily enrichment rather than by hash until the id or the date is fixed.
- **Enrichment on fallback rows (item 3): run it, labelled.** Flips are
  PRESENT on every kind A, fallback rows included. Reason: the flips are
  what separate "re-created on The Carton, same show" (zero flips) from "a
  different show on the stored date" (flips everywhere); the reason string
  alone cannot. This overrides the draft's reading.
- **P8 constant computed independently** of the code under test, in
  PowerShell over the UTF-8 bytes of `setlist-v1:[]`; the command sits in
  the test's comment beside the constant. It matched the draft's value.
- **Deploy A timing:** only after the 2026-11-06 show has gone final in
  both leagues (the 08:00 ET auto pass on 2026-11-07, or earlier by hand).
  Reason: deploy A changes `scoreShow`, which runs live that night, and
  11-06 is also the first real Discord post through the Stage Y path — one
  new variable on a show night, not two. Steps 1 and 2 can proceed any
  time: the live function reads none of what Stage Z creates.

**Additions 2026-11-02 (approved in Chat the same day; the rehearsal is
Kyle's call), made when build steps 1 and 2 started:**

- **The Carton row mapping moves into the pure module.** `mapSetlistRows`
  and `decodeEntities` live in `setlistCheck.js`, not `index.ts`, so the
  hash, the daily check and the replay script share one mapping. Deploy A
  imports both (§2, §3). Tests M1–M4.
- **`tools/replay_setlist_check.mjs`** replays the whole pure path against
  frozen-verdict exports before any of it is deployed (§2, last part).
- **Two cross-checks read `setlistCheck.js` until deploy B.**
  `DAILY_SETLIST_KEY` and `FLAG_DEDUP_KEY` are declared there; deploy B
  imports them into `index.ts` rather than redeclaring them (§1, §4).
- **A shadow league rehearsal:** §8 step 0, with rehearsal sub-steps under
  deploy A, deploy B and the client step. §6's expected counts adjusted.
  The deploy A timing rule is unchanged. What in the brief did not survive
  contact with the code is stated in step 0 and in §9.

## Build order (strict)

0. **Rehearsal fixture** (§8 step 0), any time before step 3.
1. **Stage Z applied by the dev** (STEP 0 → paste → STEP 2A → STEP 2B).
2. **Projection, diff, gate and enrichment tests green**, mutation pass
   done, `npm test` wiring in.
3. **Edge deploy A** — §3 only: the mapping extraction and the baseline
   written at finalize. NOT before the 2026-11-06 show is final in both
   leagues (§8 step 3); checked on the first real final after it.
4. **Edge deploy B** — §4, §5, §6: the daily check with the null-hash
   branch.
5. **First run reviewed** by SQL against the expected result in §6.
6. **Client push** (§7), live build id verified, device check.
7. **The 2026-08-14 flag cleared from the Admin tab** — the acknowledgment
   (design item 12) and the first live use of the Clear path.

The function writes columns Stage Z creates, so it never goes first (the
Stage U rule). Each step is verifiable on its own.

## Shape

- A **pure module** `supabase/functions/carton-sync/setlistCheck.js` — no
  Supabase client, no Deno APIs, the `showSync.js` isolation — holds the
  Carton row mapping (2026-11-02), the projection, hash, diff, gate and
  verdict re-derivation. It imports
  `norm`, `deriveSlotFacts` and `scorePicks` from `scoring.js` and
  `dailyGateDue`, `easternDateOf` from `showSync.js`. `index.ts` fetches,
  calls it, and applies the writes it returns. Plain Node tests (Node 24.20
  here; `crypto.subtle` is global in Node ≥ 20 and in Deno).
- `index.ts` gains a baseline on the final pass, `dailySetlistCheck` /
  `dailySetlistCheckSafe` / `checkSetlists` (the `dailyShowSync` shape), and
  the enrichment read. It imports `mapSetlistRows` and `decodeEntities` from
  the pure module (2026-11-02) in place of its own copies.
- Stage Z SQL, two RPCs, one service-role helper, one redefinition.
- Client: `switcher.js`, `admin.js`, `main.js`, `state.js`, `signups.js`.

---

## 1. Stage Z — `sql/stage_z_setlist_check.sql`

Header in the Stage U/Y form: run once in the SQL editor BEFORE edge deploy
A; the function writes columns this file creates. Pasting the whole file
runs `begin … commit` only; the footer is one block comment.

### WHAT

1. **`league_shows`** gains four nullable text columns, no default, NO
   backfill: `setlist_hash_scoring`, `setlist_hash_full`,
   `setlist_projection_scoring`, `setlist_projection_full`. Null = never
   baselined (the null-hash branch, §6, fills it). Column comments: the
   hashes are SHA-256 hex of the projection texts; both are computed from
   the fetched Carton rows after the existing mapping, never from
   `setlist_songs`. `get_league_shows` (`sql/stage_c2a_rpcs.sql`) names its
   columns explicitly, so none of the four reaches a client.
2. **`setlist_flags`**:
   ```sql
   create table setlist_flags (
     id          bigint generated always as identity primary key,
     league_id   bigint not null references leagues(id) on delete cascade,
     show_id     bigint not null references shows(id) on delete cascade,
     kind        text not null check (kind in ('scoring', 'drift')),
     carton_hash text not null,   -- kind 'scoring': the scoring hash of what was fetched;
                                  -- kind 'drift': the full hash; the literal 'absent' when
                                  -- the stored date returned no rows at all
     detail      jsonb not null default '{}'::jsonb,
     found_at    timestamptz not null default now(),
     cleared_at  timestamptz,
     cleared_by  uuid references players(id) on delete set null,
     note        text,            -- SQL-editor-only in v1 (decision (e))
     unique (league_id, show_id, kind, carton_hash)
   );
   ```
   RLS on, NO policies, `revoke all … from anon, authenticated`. The unique
   key is the dedup key of design item 5: one flag per distinct Carton
   state per kind, whether or not an earlier flag for that state was
   cleared. Kind A rows also carry the full hash at raise time in
   `detail.full_hash` (second-pass decision; §4 step 4 reads it for the
   kind B suppression) — jsonb, so no column and no index at this scale. `on delete set null` on `cleared_by` for the Stage U reason: an
   audit row must never be what blocks a boot. Holds a player UUID; never
   export it into a tracked file. The `absent` sentinel exists because
   `carton_hash` is part of the unique key and so cannot be null; the
   alternative (nullable plus a partial unique index) buys nothing here.
3. **`sync_state`** row `daily_setlist_check`, seeded unstamped (the Stage
   Y form). `sync_state` is already RLS-locked (Stage U).
4. **`_setlist_check_targets()`** — the daily job's target list, service
   role only:
   ```sql
   create function _setlist_check_targets()
   returns table(league_id bigint, show_id bigint, showdate date, format text,
                 setlist_hash_scoring text, setlist_hash_full text,
                 setlist_projection_scoring text, setlist_projection_full text)
   language sql stable security definer set search_path = public, extensions as $$
     select ls.league_id, ls.show_id, s.showdate, ls.format,
            ls.setlist_hash_scoring, ls.setlist_hash_full,
            ls.setlist_projection_scoring, ls.setlist_projection_full
     from league_shows ls
     join shows s on s.id = ls.show_id
     where ls.status = 'final'
       and exists (select 1 from scores sc join brackets b on b.id = sc.bracket_id
                   where b.league_id = ls.league_id and sc.show_id = ls.show_id)
     order by s.showdate, ls.league_id;
   $$;
   revoke execute on function _setlist_check_targets() from public, anon, authenticated;
   grant execute on function _setlist_check_targets() to service_role;
   ```
   Why a helper: "final with at least one scores row in that league's
   brackets" is a join PostgREST cannot express, and reading `scores` to
   compute it in code would hit PostgREST's 1,000-row default cap within a
   year (292 rows on 2026-10-31, roughly 40–50 more per show). The
   per-row `count` alternative (one HEAD query per final row) works today
   and grows linearly; the helper is one query forever.
5. **`admin_list_setlist_flags(p_name, p_pin, p_league_id)`** returns
   `table(id bigint, show_id bigint, showdate date, venue text, kind text,
   found_at timestamptz, detail jsonb)`: the UNCLEARED flags of that
   league, newest first, `showdate`/`venue` joined from `shows` so the
   client can render a flag whose show is outside its own list (decision
   (c)). Auth: `_auth_player`; NO `_reject_if_must_change_pin` (a read;
   `stage_n` leaves reads ungated, same as `admin_list_unaffiliated_players`
   in Stage X); `_is_league_admin_or_global(pl.id, p_league_id)` else
   `'League admins only'`. Revoke public, grant anon/authenticated.
6. **`admin_clear_setlist_flag(p_name, p_pin, p_flag_id)`** — the
   `admin_clear_sync_flag` shape (auth, must-change-PIN gate, admin check,
   stamp, `{ok, cleared}`), scoped to the flag's league because a setlist
   flag belongs to one league where a sync flag belongs to a global show:
   `_auth_player`; `_reject_if_must_change_pin`; read the flag's
   `league_id` (`'Flag not found'`); `_is_league_admin_or_global(pl.id,
   that league)` (`'League admins only'`); already cleared → `{ok: true,
   cleared: false}`; else `cleared_at = now(), cleared_by = pl.id` →
   `{ok: true, cleared: true}`. No note parameter (decision (e)); no
   separate log table (design item 5). Revoke public, grant
   anon/authenticated.
7. **`_account_has_played`** redefined: the Stage X body plus
   `or exists (select 1 from setlist_flags where cleared_by = p_player_id)`
   (decision (f): an admin action counts, as D7 said of
   `sync_flag_clears`). Same revoke/grant as Stage X.

### Footer (one block comment; copy one step at a time)

- **STEP 0** (read-only, before): the live `_account_has_played` is Stage
  X's (one definition, its whitespace-collapsed body md5 recomputed by
  `test/stageX.test.mjs` today); `league_shows` has none of the four
  columns; none of Z's objects exist (`setlist_flags`, the three
  functions); `sync_state` holds exactly `daily_discord_check,
  daily_show_sync`. Every `"char"` catalog column cast `::text` where it
  meets `||` (the Stage X lesson).
- **STEP 2A** (read-only, after): md5s of the four function bodies and the
  list function's return type; the four columns present with null
  defaults; the unique constraint and the `kind` check present; RLS on and
  anon/authenticated hold no table privilege; the gate row seeded
  unstamped; the helper NOT executable by anon or authenticated and
  executable by service_role; the two RPCs executable by anon.
- **STEP 2B** — the smoke test, Stage X style: self-contained, throwaway
  players/leagues/brackets only, hangs rows on an EXISTING show inside the
  block, calls the real functions, ENDS IN `raise exception` carrying
  PASS/FAIL so everything rolls back every time. Checks (the stated total
  in the raise message must equal the count; `stageZ.test.mjs` recomputes
  it):
  - T1–T3 `_setlist_check_targets`: a final row with a scores row in the
    league's bracket is listed with its date, format and null baseline; a
    final row with no scores row is not; a non-final row with a scores row
    is not.
  - L1–L4 list: the league's admin sees both planted flags (kinds A and
    B) with `showdate`/`venue` filled; a planted-then-cleared flag is not
    listed; the OTHER league's admin is refused (`'League admins only'`);
    a non-admin member is refused.
  - C1–C7 clear: the admin clears → `cleared: true`, `cleared_at =
    now()`, `cleared_by` = the admin; the second clear → `cleared: false`
    and the stamps unchanged; the other league's admin → refused, row
    untouched; a non-admin → refused; a wrong PIN → `'Wrong name or PIN'`;
    a pending PIN change → `'PIN change required before this action'`;
    an unknown id → `'Flag not found'`.
  - D1 dedup: inserting a second row with the same (league, show, kind,
    carton_hash) raises `unique_violation` (caught); a row with the other
    kind and the same hash text inserts.
  - H1–H2 history: `_account_has_played` is true for the admin who
    cleared and false for a fresh account.
  - K1 the `kind` check rejects a third value (caught).
- **STEP R** — rollback. Drops the two RPCs, the helper, `setlist_flags`,
  the four columns and the gate row, and restores `_account_has_played`
  to the Stage X body verbatim (md5 checked by `stageZ.test.mjs`).
  **Allowed only while the deployed edge function is `b9f3ee6`'s or
  earlier**: deploy A writes the four columns inside the same update that
  sets `status = 'final'`, so with the columns gone that update fails and
  the show does not go final. After deploy A, roll the function back first
  (§8 step 3).

### `test/stageZ.test.mjs` (Stage Y style, wired into `npm test`)

File structure (`begin…commit`, ONE block comment, steps in order); STEP
0's expected helper md5 recomputed from the Stage X file; STEP 2A's md5s
from Z's own bodies and the list's return type; the smoke's stated total
equals its `lbl :=` count and it ends by raising; the `"char"` cast check;
the gate-row key equals `DAILY_SETLIST_KEY` in `index.ts`; the `kind`
vocabulary in the check constraint equals `KINDS` exported by
`setlistCheck.js`; the unique key's column list equals the `onConflict`
string `index.ts` passes; STEP R's helper body md5 equals Stage X's; the
helper's revoke/grant lines present; every `references players(` is a
column line inside a `create table` block.

**2026-11-02:** until deploy B, `DAILY_SETLIST_KEY` and the unique key's
column list (`FLAG_DEDUP_KEY`) are declared in `setlistCheck.js`, and these
two checks read them there. Deploy B imports both into `index.ts` and passes
`FLAG_DEDUP_KEY` as the `onConflict` string, so there is still one definition
for the SQL to be checked against.

**Stage X test amendment (finding 1).** `test/stageX.test.mjs` computes its
"foreign keys to players before/after Stage X" and "uuid columns before
Stage X" expectations over EVERY file in `sql/`, and its helper-coverage
check reads `_account_has_played` from the Stage X file only. Two changes,
in the same commit as Stage Z: (i) those expectations are computed over
the files that existed at Stage X — exclude `stage_y_*`, `stage_z_*` and
two-letter stages `stage_[a-z][a-z]_*`; (ii) the coverage check resolves
the helper's body from the LAST stage file (stage order: single letters,
then two letters) that defines it, so Stage Z's extension is what is
checked and a later table holding a player id still fails until some
stage's helper covers it. Run both tests before pasting Stage Z.

---

## 2. Projection, hash and diff — `setlistCheck.js`

Input to all of it: the mapped rows `scoreShow` builds (as of `b9f3ee6`:
`position`, `setnumber`, `is_encore`, `songname` already entity-decoded
but otherwise raw, `is_cover` possibly null, `footnote` possibly null,
`segue` boolean; `show_id` present and ignored). Scoring applies `norm()`
later; the projection applies it here for the scoring fields.

### Exports

- `PROJECTION_VERSION = "setlist-v1"`, `KINDS = ["scoring", "drift"]`,
  `ABSENT = "absent"`, `DAILY_SETLIST_KEY = "daily_setlist_check"`,
  `FLAG_DEDUP_KEY = "league_id,show_id,kind,carton_hash"`.
- **`mapSetlistRows(show, rows)` → `{ songs, matched }`** and
  **`decodeEntities`** (2026-11-02): the mapping `scoreShow` holds as of
  `efb088b`, moved here so the hash, the daily check and the replay share
  it; deploy A imports it (§3). `matched` is true when at least one row
  carried the stored show id. It sorts a copy; `scoreShow`'s version sorts
  the fetched array in place, and reads nothing from it afterwards.
- **`projectSetlist(songs)` → `{ scoring, full }`**, two strings. Rows
  copied and sorted by numeric `position`. Each row is an ARRAY in fixed
  order (no object keys, so no key-order question — the lesson of bug
  (ii) in `scoring-rules.md`):
  - scoring: `[position, setnumber, is_encore, norm(songname), is_cover,
    has_debut]` where `has_debut = /debut/i.test(footnote ?? "")`;
  - full: the scoring row plus `[songname, segue, footnote]`.
  `is_cover` null stays null; `footnote` null stays null; `segue` is
  coerced to boolean. Text = `PROJECTION_VERSION + ":" +
  JSON.stringify(rows)`. The prefix makes a future projection change a
  deliberate re-baseline event (bump the constant, null the four columns
  in a migration) rather than a mass kind A.
- **`hashSetlist(songs)` (async) → `{ setlist_hash_scoring,
  setlist_hash_full, setlist_projection_scoring, setlist_projection_full
  }`**, the four column values. SHA-256 via `crypto.subtle.digest` over
  the UTF-8 bytes, lowercase hex.
- **`parseProjection(text)`** → the rows, or null when the prefix is not
  the current version (the caller then treats the row as never baselined).
- **`diffProjections(baseline, current)`** → `{ added, removed, moved,
  changed }` or null when either side fails to parse. Rows are matched in
  three passes: (1) a longest-common-subsequence alignment on
  `norm(songname)` — rows in the alignment are the same song in the same
  relative order, so a position shift caused by an insert or a removal is
  NOT reported as a move; (2) rows unmatched on both sides with the same
  `norm(songname)` are `moved: {song, from, to}`; (3) the rest are
  `removed: {position, song}` / `added: {position, song}`. For every
  matched pair the remaining fields are compared one by one and each
  difference is `changed: {position, song, field, from, to}` (`position`
  and `song` are the current side's; `song` is the raw name). Works on
  either projection: the scoring one yields scoring-field changes, the
  full one adds `songname`, `segue`, `footnote`. Duplicate songs (a
  sandwich) align as a sequence, not as a set.
- **`setlistCheckDue({ ranAt, attemptedAt, showSyncRanAt, now })`** →
  `dailyGateDue({ ranAt, attemptedAt, now }) && showSyncRanAt != null &&
  easternDateOf(showSyncRanAt) === easternDateOf(now)`. The second clause
  is "today's `daily_show_sync.ran_at` is set" (design item 11): a manual
  "Sync shows" stamps `ran_at` too and so counts.
- `syntheticConfig(slotKey)` and `rederiveVerdicts(...)` — §5.

### Tests — a new section at the end of `test/scoring.test.mjs`

Top-level `await`; the existing fixtures are already in mapped shape. The
file passes today (2026-11-01) and is added to `npm test` in this stage.

Mapping (2026-11-02; the mapping cited is `scoreShow`'s as of `efb088b`):
- M1 the show-id filter keeps only the rows carrying the stored id, and
  `matched` is true.
- M2 no row carries the id: the fallback uses every row at the date, and
  `matched` is false.
- M3 empty-name rows are dropped.
- M4 the output field set and order equal what `scoreShow` stores
  (`show_id, position, setnumber, is_encore, songname, is_cover, footnote,
  segue`), entities decoded on the way.

Projection and hash:
- P1 the 16-row fixture: both hashes are 64 lowercase hex, differ from
  each other, and are identical on a second call.
- P2 the same rows in shuffled input order → identical strings and hashes.
- P3 a 2-row fixture → the exact canonical strings, prefix included (the
  field order is a tested contract).
- P4 each scoring field moves the scoring hash: `setnumber`, `is_encore`,
  `is_cover`, a footnote gaining the word "Debut", a songname changed to
  a different word, a row inserted at position 3 with every later row
  shifted (the 2026-08-14 shape).
- P5 a trailing space on one songname → scoring hash unchanged, full hash
  changed (the 2026-07-30 case).
- P6 a `segue` flip → scoring unchanged, full changed (the 2026-10-15
  case).
- P7 full-only too: a footnote change without the word debut; a case
  change; a diacritic; and "FTP" in a footnote does not set `has_debut`.
- P8 the empty setlist: both strings equal `setlist-v1:[]`, both hashes
  equal the pinned constant
  `cbb50793a89bdda2c5264ae31fc7e560d5047d45fe0b363a5d76b29b370b5214`, and
  differ from any one-row list. The constant was computed independently
  of the code under test (2026-11-01) with this PowerShell line, which the
  test quotes in a comment beside the constant; it matched the value the
  draft had derived in Node:
  ```powershell
  ([System.BitConverter]::ToString([System.Security.Cryptography.SHA256]::HashData([System.Text.Encoding]::UTF8.GetBytes('setlist-v1:[]'))) -replace '-','').ToLower()
  ```
- P9 null `is_cover` and null `footnote` serialize as null without
  throwing; an undefined `segue` becomes false.
- P10 `parseProjection` round-trips P3's strings; another prefix → null.

Diff:
- D1 identical → all four lists empty.
- D2 a row inserted at position 3 → `added` has that one row at 3;
  `removed`, `moved`, `changed` empty (the shifted rows are not moves).
- D3 one row removed → `removed` has it; the rest empty.
- D4 two adjacent rows swapped → `moved` non-empty, `added`/`removed`/
  `changed` empty.
- D5 one row's `is_cover` flipped → `changed` is exactly
  `[{position, song, field: "is_cover", from: false, to: true}]`.
- D6 a footnote gaining "Debut": on the scoring projection `changed` has
  `has_debut` only; on the full projection it has `has_debut` and
  `footnote` for the same row.
- D7 a trailing space: full projection → `changed` has `songname` only;
  scoring projection → all empty.
- D8 the sandwich fixture with one of the two occurrences removed →
  `removed` has exactly one, the other occurrence is matched.
- D9 an empty baseline → everything `added`; an unparsable side → null.

Gate:
- G1 own gate due but the show sync has not run today → false.
- G2 show sync ran today, own row never run → true.
- G3 own row ran today → false.
- G4 own attempt 10 minutes ago → false; 31 minutes ago → true.
- G5 show sync ran at 22:30 ET yesterday, now 09:00 ET today → false
  (Eastern calendar date on both sides).

Mutation list for this stage (one per function; revert each by Edit
anchored on text and confirm with an empty `git diff` — discipline item
6): drop `is_cover` from the scoring row → P4 fails; drop the sort → P2;
raw name instead of `norm` in the scoring row → P5; drop the version
prefix → P3 and P8; diff matched by position only (no alignment) → D2
reports shifted rows as moved; skip the field comparison → D5; gate
without the show-sync clause → G1.

### `tools/replay_setlist_check.mjs` (2026-11-02)

Tracked, with no player data in it or its output. Reads two exports the dev
produces into the gitignored `.scratch/`: `verdict_groups.json` (the
`q_allshows.sql` shape: show, bracket, slot, songname, hit, reason, n) and
`final_rows.json` (one row per final `league_shows` row: league, show, date,
format, that league's bracket ids). Neither export selects `player_id`.
Fetches each distinct date once from The Carton with Node `fetch`, runs
`mapSetlistRows` → `hashSetlist` → `rederiveVerdicts` per (league, show), and
prints per row: matched, the four hash and projection lengths, the baseline
hashes, and the hit and reason flip counts per bracket. It prints counts, not
slots or songs. It writes nothing and is not imported by the edge function.
**Pass/fail on the 2026-10-31 data, sharpened by Kyle's call 2026-11-02: exactly
one hit flip (2026-08-14, bracket 2) and ZERO reason flips.** The prototype's 22
reason differences were artifacts of today's config. The module infers mode
from the slot key, so any reason flip is a finding.

**Result, run 2026-11-02 18:55 UTC on the exports Kyle saved that day: PASS.**
Exports: 1,280 verdict groups summing to 1,657 rows (bracket 1: 428, bracket 2:
204, bracket 3: 947, bracket 4: 78), no bonus rows; 35 final rows (league 1: 28,
league 2: 7) on 28 dates. All 35 matched, with no fallback, no date without rows
and no fetch errors. 19 rows on 17 dates hold frozen verdicts (league 1: 12,
league 2: 7), which is the first run's expected target count before the shadow
row. Hit flips 1 (2026-08-14, bracket 2). Reason flips 0, on all six scored
`one_set` rows too. 2026-09-18 returned 14 rows and 5 matched: the other 9 are the
second Carton show on that date, which the survey recorded.

**The 2026-10-23 values the rehearsal compares against, from this run:** scoring
hash `aa933c6afa4a30648ceacea97921a6f34e3431fc788424a4ecf63d7b1c8d66f4`, full hash
`7afb063eddd92e8fd510703dad2891160d1fd1d87ce1aab54e58596f9efb9b32`, projection
lengths 266 and 496. A Carton edit to that show after this run moves them.

The exports, read-only. Both name leagues 1 and 2, so the shadow league stays out
whichever order the rehearsal and a replay happen in. Paste one statement at a time
in the SQL editor. Each returns one cell, which is the whole file.

```sql
-- Save the one cell this returns as .scratch/verdict_groups.json
select jsonb_agg(to_jsonb(x)) as result from (
  select s.show_id as show, s.bracket_id as bracket, e->>'slot' as slot, e->>'songname' as songname,
         (e->>'hit')::boolean as hit, e->>'reason' as reason, count(*) as n
  from scores s
  join brackets b on b.id = s.bracket_id and b.league_id in (1, 2)
  cross join lateral jsonb_array_elements(s.breakdown) e
  group by 1, 2, 3, 4, 5, 6
) x;

-- Save the one cell this returns as .scratch/final_rows.json
select jsonb_agg(to_jsonb(x) order by x.showdate, x.league_id) as result from (
  select ls.league_id, ls.show_id, s.showdate, ls.format,
         (select array_agg(b.id order by b.id) from brackets b where b.league_id = ls.league_id) as bracket_ids
  from league_shows ls
  join shows s on s.id = ls.show_id
  where ls.status = 'final' and ls.league_id in (1, 2)
) x;
```

---

## 3. Finalize-time baseline

- **`mapSetlistRows(show, rows)` → `{ songs, matched }`**, extracted from
  `scoreShow` verbatim: the `show_id` filter, the fallback to every row at
  that date, the sort, the field mapping, the empty-name filter. `matched`
  is true when at least one row carried the stored show id (the `mine`
  array as of `b9f3ee6` was non-empty). `scoreShow` calls it; no behaviour
  change on any existing path.
  - **2026-11-02:** the function and `decodeEntities` live in
    `setlistCheck.js` (§2), written in steps 1 and 2. Deploy A deletes the
    inline mapping and the local `decodeEntities` from `index.ts` and imports
    both; `syncShows` uses the same import. `scoreShow` keeps its two early
    returns as two: zero fetched rows is "no setlist yet", zero named rows is
    "empty setlist".
- **`scoreShow`** when `isFinal`: if `matched`, `await hashSetlist(songs)`
  and return it as `baseline` beside the existing result; if not matched,
  `baseline: null` and a `console.warn` that the final pass hashed nothing
  because the stored id was not among the rows at that date. **One rule
  everywhere (second-pass decision): no baseline is ever written from
  fallback rows, in the final pass or in the null-hash branch.**
  Consequence: a show whose Carton id is not among the rows at its stored
  date stays null, gets one flag per fallback state (§6 case 3), and is
  watched by daily enrichment rather than by hash until the id or the
  date is fixed. The early returns ("no setlist yet", "empty setlist")
  carry no baseline either.
- **`autoFinalize`** and **`finalizeShow`**: `const res = await
  scoreShow(…, true).catch(() => null)` and then one update,
  `finalUpdatePatch(res)` — the baseline lands in the same write as the
  status flip. Both callers go through this, so the manual button and the
  08:00 ET auto pass behave alike.
- **CORRECTION 2026-11-02, found at the deploy-A review (Kyle's call): a final
  pass always writes all four columns.** This replaces "the four columns stay
  until the next finalize overwrites them" and the payload
  `{ status: "final", ...(res?.baseline ?? {}) }`. `finalUpdatePatch(res)` is
  `{ status: "final" }` plus the four baseline values when `res.baseline` is
  present, and the four columns explicitly null otherwise: baseline null, `res`
  null because `scoreShow` threw, or an early-return result. Reason: as first
  written, a re-finalize after a reopen that produced no baseline left the old
  one in place, so the daily check would compare today's Carton against a
  setlist nobody scored from and flag a show whose scores are current. Writing
  nulls hands the row to §6's null-hash branch next morning, which re-derives
  the frozen verdicts first and then either baselines silently or flags with a
  reason. This is still "baseline written at finalize", since it happens at
  finalize. Stage Z's column comments still read "Null: never baselined", now
  narrower than the behaviour; left as applied, since this step runs no SQL.
- **`reopenShow`** unchanged: a reopen does not touch the four columns, and a
  reopened row is not final so the daily check skips it. The next final pass
  replaces them, with values or with nulls.
- **Also approved at that review, 2026-11-02.** `withFinalBaseline` in
  `setlistCheck.js` holds the two rules around the hash (not final: the result
  untouched, so the cron response keeps its shape; not matched: `baseline:
  null`), so they are tested in plain Node; the `console.warn` stays in
  `scoreShow`. Both final updates log their `error` with `console.error`, and
  nothing else about them changes: `autoFinalize` still counts the row and
  `finalizeShow` still returns `{ ok: true }`. The `decodeEntities` import
  serves `syncSongs` as well as `syncShows`.
- Response size: `autoFinalize` discards `scoreShow`'s result and
  `finalizeShow` returns `{ok}`, so the cron response in
  `net._http_response` does not grow.
- **Deploy-A code written 2026-11-02, NOT deployed.** Checked before the commit:
  the module mapping deep-equal to the inline code as of `3d5c3a7` on all 28 stored
  shows, the second 2026-09-18 show and 28 forced fallbacks (766 songs, 0
  mismatches), plus 8 synthetic cases; 24 of 24 mutations caught; `deno check` 0
  errors; Deno and Node hashes byte-identical on all 28, with 2026-10-23 equal to
  the values in §2; `index.ts` loads under Deno with dummy env and `Deno.serve`
  stubbed, no request sent. Not exercised: the final update against the real
  columns. The first run of that is the rehearsal's manual finalize (§8 step 3).

---

## 4. The daily check

Constants: `SETLIST_FETCH_BATCH = 5` in `index.ts`. `DAILY_SETLIST_KEY` and
`FLAG_DEDUP_KEY` are declared in `setlistCheck.js` (2026-11-02) and imported
at deploy B; step 5's `onConflict` passes `FLAG_DEDUP_KEY`.

- **Placement.** A third entry, `setlist_check: await
  dailySetlistCheckSafe(live)`, after `discord_check` in BOTH return
  objects of `scoreShows`. Object-literal evaluation is sequential, so on
  the first due tick of the day the show sync runs and stamps its `ran_at`
  in the same tick, and this check then sees it. `live === true` →
  `{ skipped: "live burst" }`.
- **`dailySetlistCheck(live)`**: read both `sync_state` rows
  (`daily_setlist_check`, `daily_show_sync`); `setlistCheckDue(...)` or
  `{ due: false }`; upsert `attempted_at = now` (throw if that write
  fails — no backoff record, no run); `checkSetlists()`.
- **`dailySetlistCheckSafe`**: the `dailyShowSyncSafe` isolation — a
  throw is logged and returned as `setlist_check.error`; scoring has
  already run.
- **`checkSetlists()`**:
  1. `targets = supa.rpc("_setlist_check_targets")`.
  2. Distinct `showdate`s, in batches of 5: `Promise.all` of
     `carton("/setlists/showdate/<date>.json")`. A date whose fetch throws
     is logged, counted in `errors`, and its targets are skipped this
     attempt. Two leagues on one show share one fetch (about 17 GETs for
     24 targets today, +1 per new show).
  3. Per target: `mapSetlistRows({ id: show_id, showdate }, rows)` →
     **the three-way rule (decision (d))**:
     - matched → `current = await hashSetlist(songs)`;
     - not matched, zero rows at the date → `current = null`, kind A
       candidate with `carton_hash = ABSENT`, `detail.reason = "show not
       found at stored date"`;
     - not matched, rows exist → `current` = the hashes of the fallback
       rows, and every flag raised from them carries `detail.reason =
       "stored show id not among the N row(s) at the stored date;
       compared the rows found there"`.
  4. Baseline null → §6. Baseline present → **two independent
     comparisons (decision (a))**:
     - `current.setlist_hash_scoring !== stored scoring hash` (or
       `ABSENT`) → kind A candidate, `carton_hash` = the current scoring
       hash or `ABSENT`;
     - `current.setlist_hash_full !== stored full hash` → kind B
       candidate, `carton_hash` = the current full hash — **suppressed
       whenever ANY kind A row for the same (league, show) carries the
       current full hash in `detail.full_hash`** (second-pass decision,
       replacing the draft's "raised this run" reading, which produced
       one redundant kind B per kind A on the day after). The kind A
       raised this run is written with that value, so the same lookup
       covers it; a later display-only edit on a show that already
       carries a kind A has a full hash no kind A row holds, so its kind
       B still surfaces.
  5. **Dedup before any enrichment**, in this order per target: (i) the
     kind A candidate: `select id from setlist_flags where league_id,
     show_id, kind, carton_hash` match → exists → counted `deduped`,
     nothing else happens for it; otherwise build `detail` (with
     `full_hash` = the current full hash, null in the `ABSENT` case) and
     insert with `upsert(row, { onConflict:
     "league_id,show_id,kind,carton_hash", ignoreDuplicates: true })`, so
     a concurrent or retried run cannot double-insert; (ii) the kind B
     candidate: `select id from setlist_flags where league_id, show_id,
     kind = 'scoring' and detail->>'full_hash' = <current full hash>`
     (PostgREST: `.eq("detail->>full_hash", …)`) → exists → counted
     `suppressed_drift`; else the same dedup-then-insert on its own
     unique key.
  6. `console.log` per inserted flag, ids only: `setlist check: league
     <id> show <id> kind <scoring|drift> <reason or "+a −r ~m Δc">
     flips <per-bracket counts>`.
  7. Counts → `note`: `{ targets, dates, fetched, errors, baselined,
     flagged_scoring, flagged_drift, suppressed_drift, deduped, not_found,
     fallback }`.
  8. **`ran_at`** only when `errors === 0` and every write succeeded;
     otherwise throw after processing what could be processed. The throw
     leaves `attempted_at` set, so `dailyGateDue` retries in 30 minutes
     (the show sync's gate, design item 11); the dedup key makes the
     retry idempotent on the DB side. Worst case while The Carton is down
     for a whole day: the date GETs repeat every 30 minutes until the
     Eastern day rolls over — the same policy the show sync has, and
     bounded by the day.

**`detail` schema** (jsonb; never `player_id`, never a nickname, never a
whole pick sheet, never points):
```json
{ "reason": "<only the not-found / fallback / baseline cases>",
  "full_hash": "<kind A only: the full hash of the fetched rows at raise time; null when absent>",
  "diff":   { "added": [], "removed": [], "moved": [], "changed": [] },
  "flips":  { "<bracket_id>": { "hit_flips": 0, "reason_flips": 0,
              "pairs": [ { "slot": "", "song": "", "from": {"hit": false, "reason": ""},
                           "to": {"hit": true, "reason": ""}, "n": 1 } ] } },
  "counts": { "baseline_rows": 0, "current_rows": 0 } }
```
`diff` is over the scoring projection for kind A and the full projection
for kind B, and null when there is no baseline or no current rows.
`full_hash` is what the kind B suppression reads. `flips` is kind A only
(§5) and PRESENT on every kind A that had rows to re-derive against,
fallback rows included; null only in the `ABSENT` case. `song` in a pair
is the pick's text, `n` the number of sheets that carried that verdict —
a multiplicity, not an identity.

---

## 5. Enrichment on kind A

Ported from `.scratch/setlist-check-2026-10-31/verdicts.mjs` and
`verdicts2.mjs` (untracked; method in the survey, §0d), with the mode
taken from each stored slot key instead of today's config.

- **`index.ts` read:** `brackets.select("id,name").eq("league_id", …)`,
  then `scores.select("bracket_id,breakdown").eq("show_id", …)
  .in("bracket_id", ids)` — `player_id` is never selected. Each
  `breakdown` element with `slot !== "bonus"` becomes `{ bracket_id,
  slot, songname, hit, reason }`.
- **`rederiveVerdicts({ rows, songs, format })`** in `setlistCheck.js`:
  - group rows by `(bracket_id, slot, songname, hit, strippedReason)`
    with multiplicity `n`, where `strip` removes `" (no partial credit)"`
    and every `" +cover"` / `" +debut"` (the prototype's rule);
  - `mode = /^rank\d+$/.test(slot) ? "ranked" : "slots"`;
  - `syntheticConfig(slot)`: slots → `{ mode: "slots", flat_points: 1,
    partial_credit: true, partial_points: 1, bonuses: {}, slots:
    /^flat\d*$/.test(slot) ? [] : [{ key: slot, type: slot === "cover1" ?
    "cover_pick" : slot, points: 1 }] }`; ranked → `{ mode:
    "ranked_choice", ranked: { ladder: Array(24).fill(1) }, bonuses: {} }`
    (a unit ladder long enough for any rank key; rung values do not
    affect `hit` or `reason`);
  - `facts = deriveSlotFacts(songs, true)` once per call;
  - per group `scorePicks({ picks: [{ slot, songname }], songs,
    slotFacts: facts, cfg, format })` with `format` =
    `league_shows.format` (design item 3; it only matters when a config
    has a `oneset` section, which the synthetic ones do not);
  - `hit` differs → a hit flip; else stripped `reason` differs → a reason
    flip; output per bracket as in the `detail.flips` schema, plus
    `total_rows`.
- The slot-key-is-the-slot-type mapping (with `cover1` → `cover_pick`)
  held for all 1,657 frozen rows on 2026-10-31 (204 of 204 unchanged
  under slot rules for the two brackets that are ranked today). A bracket
  that ever used a custom key with a different type would show as a
  persistent reason flip on its first baseline run, which is the right
  place to notice it.
- A frozen row carrying `"played — slot undetermined"` means the show
  went final without a final pass (`scoreShow` failed inside the
  `.catch`); re-derived under `isFinal = true` it flips its reason, and
  that is a true positive worth a flag.
- Tests (same file, after the diff cases): E1 the 2026-08-14 shape — a
  frozen `"not played"` on a flat slot whose song is now at position 3 →
  one hit flip in that bracket, `n` carried; E2 `cover1` against a cover
  → unchanged; E3 a `rank3` row → ranked mode, `hit` from the played set,
  no slot reasoning; E4 a footnote that only adds `" +debut"` → stripped
  → no flip; E5 two brackets' rows kept apart; E6 rows passed in with an
  extra `player_id` field are not echoed and `JSON.stringify(result)`
  contains no `player` key; E7 the fallback distinction (second-pass
  decision) — the same frozen rows against fallback rows that are the
  same show (re-created under a new id, identical setlist) → zero flips
  in every bracket; against another show's setlist → flips in every
  bracket. Mutations: drop the strip → E4; map `cover1` to type `cover1`
  → E2; drop the rank regex → E3.

---

## 6. First run = the null-hash branch

A permanent branch of `checkSetlists()` for targets whose
`setlist_hash_scoring` or `setlist_hash_full` is null, not a one-off
trigger (finding 5, approved): nulls recur — a finalize whose `scoreShow`
threw or returned "no setlist yet", a final pass that hit the fallback
(§3), a projection-version bump — and the branch inherits the gate, the
backoff, the isolation and the dedup for free. A manual trigger would also
mean a new action on a router whose `sync_shows`/`sync_songs`/`score`
are still unauthenticated and where an unknown action runs scoring
(`docs/decisions/cron-secret-edge-auth.md`).

Per null target, after the fetch, by the three-way rule:
1. **matched** → `rederiveVerdicts` against today's rows FIRST; if any hit
   or reason flip → insert kind A with `carton_hash` = today's scoring
   hash, `detail.reason = "baseline: frozen verdicts differ from today's
   Carton"`, `flips`, `diff: null`, `counts`; THEN write the four columns.
   Flag before baseline, so the 2026-08-14 flag exists before its
   baseline does. If the flag insert fails the baseline is not written
   and the run throws (retry in 30 minutes; dedup makes it idempotent).
   No flip → write the four columns, no flag, counted `baselined`.
2. **not matched, zero rows** → kind A `ABSENT` with its reason; no
   baseline; the row is re-examined daily and the dedup key keeps it to
   one flag.
3. **not matched, fallback rows** (the one rule) → NO baseline; kind A
   with `carton_hash` = the fallback rows' scoring hash, `detail.reason`
   naming the fallback and the row count, `detail.full_hash` = the
   fallback rows' full hash, and **flips PRESENT**, computed against the
   fallback rows (second-pass decision, overriding the draft): zero flips
   in every bracket reads as "re-created on The Carton, same show"; flips
   in every bracket reads as "a different show on the stored date"; the
   reason string alone cannot tell the two apart. The row stays null,
   gets one flag per fallback state, and is watched by this branch's
   enrichment rather than by hash until the id or the date is fixed (the
   consequence stated in §3).

**Expected first-run result against the 2026-10-31 data** (survey §1a;
the dev confirms the counts before the run with the first query in §8
step 5): targets = league 2's 7 final rows plus league 1's final rows that
have scores rows — between 12 and 17, the union of bracket 1's 9 and
bracket 2's 12 shows with scores; 17 distinct dates; exactly ONE flag,
kind A on league 1's 2026-08-14 row with `flips` showing one hit flip in
bracket 2, zero reason flips, and nothing in bracket 1; zero kind B (no baseline, so no B is
possible on this run); every other target baselined silently; the 08-14
row baselined after its flag. League 1's 2026-10-23 row (final with no
picks) has no scores rows and is not a target. The 2026-10-15 footnote
edit landed before final, so no flip there. Any other flag is a finding
to record in the decision record, not to clear on sight. Clearing the
08-14 flag from the Admin tab is the acknowledgment (design item 12) and
happens at step 7.

**The shadow league (2026-11-02).** If the rehearsal fixture exists by then
(§8 step 0), its 2026-10-23 row is one more target, already baselined by its
manual finalize at deploy A, so the null-hash branch skips it. Targets go up
by 1. Distinct dates stay the same, because league 2's 10-23 row is already a
target. `note.baselined` is targets minus every row that already carried a
baseline: the shadow row, and any show that went final with scores after
deploy A. The shadow row raises nothing. Every other shadow row on a final
show has no scores, is not a target, and carries an inert baseline from deploy
A onward.

---

## 7. Client

- **`src/core/state.js`:** `setlistFlags: null` — the current league's
  uncleared flags once fetched.
- **`src/core/signups.js`:** pure `attentionTotal({ signups, flags })` →
  `{ n, saturated }`, `n = (signups?.n ?? 0) + (flags?.length ?? 0)`,
  `saturated` from `signups`. Tests in `test/signups.test.mjs`: A1 both
  null → 0; A2 sign-ups only; A3 flags only; A4 both, and saturation
  carries (`badgeText` → `"52+"`).
- **`src/core/switcher.js`:** `setSignupRows` unchanged; new
  `setSetlistFlags(rows)` → `state.setlistFlags = rows ?? [];
  renderHeaderChrome()`; `refreshSignupBadge` fetches BOTH
  `admin_list_unaffiliated_players` and `admin_list_setlist_flags` with
  `Promise.allSettled`, each failure keeping its last value (a PGRST202
  from a database without Stage Z therefore keeps the old pill);
  `signupBadgeLit` unchanged — sign-ups only, because `loadUnaffiliated`'s
  "Clear all" keys on it; new `attentionBadgeLit` = admin and
  `attentionTotal(...).n > 0`; `signupBadgeHtml` renders
  `attentionTotal` and its `aria-label`/`title` names only the non-zero
  parts ("N new registrations …", "M setlist flags"); `renderHeaderChrome`
  unchanged; `switchToBracket` sets `state.setlistFlags = null` when the
  league changes, before the re-render, so the old league's count never
  shows under the new league's name (the sign-up count is
  league-independent and needs no such reset).
- **`src/features/admin.js`:** `renderAdmin` adds
  `rpc("admin_list_setlist_flags", …)` to its existing `Promise.all`,
  calls `setSetlistFlags(flags)`, and in the Shows collapsible renders
  (decision (c)) a block ABOVE the dated rows — one
  `.noticebox.setlist-flag` per flag whose `show_id` is not in the 7-day
  list, headed by that flag's date and venue from the RPC row — and,
  for shows in the list, the same notice under the row head beside the
  sync-flag notice. `setlistFlagText(flag)` composes the copy: kind A →
  "⚠️ Setlist check: The Carton's setlist changed after this show went
  final (scoring facts). <reason if any> <+a added, −r removed, m moved,
  c changed>. Verdict flips — <bracket name>: h hit, r reason; …" with
  bracket names from `state.leagues`; kind B → "ℹ️ Setlist check: display
  details changed on The Carton after final (names, segues or footnotes);
  scoring unaffected. <diff summary>"; both end "found <date>", and a
  collapsed `<details>` lists the diff rows and the flip pairs. New
  `clearSetlistFlag(flagId, btn)` mirrors `clearSyncFlag`: disable the
  button, `rpc("admin_clear_setlist_flag", …)`, `await renderAdmin()`;
  on error toast and re-enable. `loadUnaffiliated` unchanged.
- **`src/main.js`:** `clearSetlistFlag` added to both `window` export
  lists (the two lists that already carry `clearSyncFlag`).
- **`src/core/realtime.js`, `src/core/session.js`:** unchanged — they
  call `refreshSignupBadge` / `refreshCurrent`, which now cover flags.
- **`styles.css`:** none. `.noticebox` and `.tabbadge` exist.
- **Harness:** `test/fixtures.mjs` adds `setlist_flags: []`;
  `test/harness.mjs` `RPC_HANDLERS` gain `admin_list_setlist_flags` (a
  real join against `league_members`, like the sync-flag fake; uncleared
  rows of the league with `showdate`/`venue` from `tables.shows`) and
  `admin_clear_setlist_flag` (stamps `cleared_at`/`cleared_by`; a second
  clear → `cleared: false`). `test/scenario.test.mjs` cases: S1 a flag on
  a listed show renders exactly one notice under that row head; S2 a flag
  on an older, unlisted show renders in the block above the rows with
  its date and venue; S3 Clear is on `window`, calls the RPC once with
  the session's name/PIN and `p_flag_id`, the fake stamps, the re-render
  drops the notice and keeps both show rows; S4 the pill shows the sum
  (fixture: one new sign-up plus two flags → "3") and its label names
  both parts; S5 flags only → pill lit with the flag count and
  `signupBadgeLit` false, so "Clear all" is not offered; S6 the default
  fixture → no notice, no block, no pill; S7 a non-admin session never
  calls the list RPC; S8 the list RPC rejecting (pre-Stage-Z database) →
  last count kept, no block, no throw.

---

## 8. Deploy order, verification and rollback

Every shell example is PowerShell. SQL runs in the Supabase SQL editor
(or psql read-only via the connection string kept OUTSIDE the repo,
`CLAUDE.md` → Backups; never paste it anywhere).

**Step 0 — rehearsal fixture (Kyle's call 2026-11-02; created by 2026-11-05).**
A real, permanent league that takes the whole path on a row no player depends
on. **Timing, Kyle's call 2026-11-02: the league is created by 2026-11-05, so
setup stays SQL-free.** The 09:00 ET show sync on 2026-11-06 then creates its
rows while the 2026-10-23 show is still in the window. The insert in item 3 is
the fallback if creation slips past 2026-11-06. Every code reference here
is as of `efb088b`. No player nickname, player id or pick text goes in any
tracked file. **The league is id 11, "Test League Ignore", created 2026-11-03**
(recorded in the decision record), filled in below. **Every
future survey or count excludes this league.**

1. **Create the league** in the Global console, under a name Kyle picks that
   no one can mistake for play, and that does not derive to an existing
   secret (`webhookEnvKey`). `global_create_league` **always creates two
   brackets**, Official and Casual, both on the default config (slots mode:
   no `mode` key). The brief asked for one bracket. Keep both: removing
   Official takes SQL and leaves a league the client does not expect (the 2.0
   model is exactly two, and `officialBracketId()` reads it). Official with no
   season is inert, because `scoreBracket` returns "no active season — not
   scored". **The sheet goes in Casual, so `flips` carries one bracket.**
2. **Appoint Kyle** from the Global console (`global_appoint_league_admin`
   makes Kyle a member and admin). Fully reload the app so the switcher sees
   the league (`docs/decisions/multi-league-switcher.md`). No season. No
   Discord secret.
3. **The overlay row.** Press "Sync shows", or let the 09:00 ET sync run.
   `syncShows` creates **one `league_shows` row per show in its 14-day window,
   and for every later show**, not the single row the brief describes. The
   2026-10-23 show is inside that window only through 2026-11-06 (UTC). If
   creation slips past that date, this is the one step that needs SQL, because
   nothing else creates an overlay row for an old show:
   ```sql
   insert into league_shows (league_id, show_id, cutoff_at)
   select 11, s.id, now() - interval '1 hour' from shows s where s.showdate = '2026-10-23'
     and 11 not in (1, 2);
   ```
4. **The pick sheet, with no SQL.** Move the cutoff to tomorrow, submit the
   sheet in the app, move the cutoff back. The Admin tab cannot do the cutoff
   half: `renderAdmin` lists shows from the last 7 days and 10-23 left that
   list on 2026-10-30. So both moves call `admin_set_cutoff` directly, the
   same RPC the button calls, and no Discord notice goes out because
   `cutoff_changed` is the button's own second call. The sheet itself goes
   through the app: Shows tab, Casual bracket, Recent panel, the 10-23 row.
   `showState` reads a future cutoff as open and `openShow` opens the sheet.
   `submit_picks` accepts it, because its "That show already happened" gate
   sits only in the `voting_override = 'open'` branch, and the default config
   is `auto`. **The sheet must name at least one song 10-23 actually played,
   because injection 2b needs one.** These PowerShell lines have not been run.
   **Credentials, Kyle's call 2026-11-02:** every step that calls
   `admin_set_cutoff` or the `finalize` action reads the name and PIN at run
   time with `Read-Host`, with no literal in this file. Run it in `pwsh` 7.1 or
   later, since Windows PowerShell 5.1 has no `-MaskInput`. Paste the first line
   alone and answer its two prompts. A multi-line paste can feed the next line
   to a prompt, which would leave the PIN to be typed at the normal prompt,
   where PSReadLine keeps it.
   ```powershell
   $name = Read-Host "name"; $pin = Read-Host "PIN" -MaskInput
   ```
   ```powershell
   $base = "https://zdfhglvjxquvkjyvophz.supabase.co"
   $anon = "sb_publishable_qN1goR6-Ss3cErnJJIJdKw_xr5nrFuo"   # public by design: CLAUDE.md, Credentials
   $h = @{ Authorization = "Bearer $anon"; apikey = $anon; "Content-Type" = "application/json" }
   $league = 11
   $show = (Invoke-RestMethod "$base/rest/v1/shows?showdate=eq.2026-10-23&select=id" -Headers $h).id   # must print ONE id
   $show
   $rows = Invoke-RestMethod -Method Post "$base/rest/v1/rpc/get_league_shows" -Headers $h -Body (@{ p_league_id = $league } | ConvertTo-Json)
   $orig = ($rows | Where-Object show_id -eq $show).cutoff_at
   function Set-Cutoff($iso) { Invoke-RestMethod -Method Post "$base/rest/v1/rpc/admin_set_cutoff" -Headers $h -Body (@{ p_name = $name; p_pin = $pin; p_league_id = $league; p_show_id = $show; p_cutoff = $iso } | ConvertTo-Json) }
   Set-Cutoff (Get-Date).ToUniversalTime().AddDays(1).ToString("o")
   ```
   Submit the sheet in the app, then:
   ```powershell
   Set-Cutoff $orig
   Remove-Variable name, pin
   ```
5. **The row stays unscored until deploy A.** `eligibleLeagueShows` drops any
   show older than a day, and `autoFinalize` reads that list, so the cron
   never touches it.

**What the fixture does on its own, all expected:**
- **Discord fails closed.** There is no `DISCORD_WEBHOOK_<NAME>` secret, so
  `resolveHook` returns null and `notifyLeague` records `no_key` and returns.
  **The function logs show nothing for it:** neither `notifyLeague` nor
  `checkWebhooks` logs on that path. It shows as `leagues.discord_status =
  'no_key'` with `discord_live` false (Stage Y's rule), as "Not posting
  (no_key), checked <when>" on the Admin status line, and as one more `no_key`
  in the daily check's note: `{"checked":3,"ok":2,"no_key":1,"failed":0}`, in
  place of today's two-league note. A monitor reading that note must expect
  it.
- **The 2026-11-06 reminder (recorded 2026-11-02).** Created by 11-05, this
  league exists for that show's 22:00 UTC reminder, the Stage Y watch item. Its
  row for show 1786388218 stamps `remind_sent` with nothing posted, and its
  `leagues` row reads `no_key`. That is expected and is not the watch item
  failing: the watch item reads leagues 1 and 2. **No failed post appears in the
  logs for it.** Kyle's answer said the logs would show failed posts, but
  `notifyLeague` returns right after recording `no_key`, before its `Discord
  post failed` line, so the log is silent. That line naming this league would
  be a finding: it means a secret exists under the league's derived name.
- **Every show from now on has a shadow row.** It goes live, then final at the
  08:00 ET pass, with no picks and no scores. Reminder, lock and winner stamps
  advance with nothing posted. A shadow row that is final counts in
  `syncShows`' "finalized in N league(s)" text. None of these rows is a setlist
  check target.
- **Kyle's switcher carries the league** from step 2 onward.

**Where its rows live, for a future one-off deletion.** `delete from leagues
where id = 11` cascades to `brackets`, `league_members`,
`league_shows`, `setlist_flags`, `banned_names` and `realtime_pings`;
`brackets` cascades to `seasons`, `picks` and `scores`. Global `shows` and
`setlist_songs` do not cascade, and `sync_state` notes are not rewritten.
Cleanup: none; the fixture stays.

**Step 1 — Stage Z.**
- Before: `node test/stageZ.test.mjs` and `node test/stageX.test.mjs`
  green (the md5s and the amendment); STEP 0 every row `ok`.
- Apply: paste the whole file. After: STEP 2A every row `ok`; STEP 2B's
  ERROR panel reads `STAGE Z SMOKE: 0 of <n> FAILED`.
- Confirm nothing persisted: `select count(*) from setlist_flags;` → 0;
  the four columns all null.
- **Applied 2026-11-02 (Kyle, in the SQL editor).** STEP 0: 4 of 4 `ok`. STEP
  2A: 11 of 11 `ok`, with live md5s matching the file: helper `9b341334…`,
  targets `fff84b2a…`, clear `c70ab88a…`, list `bf020545…`. STEP 2B: `STAGE Z
  SMOKE: 0 of 18 FAILED`, rolled back. `setlist_flags` count 0 afterwards. The
  four columns were null at STEP 2A (its Z2.11).
- Rollback: STEP R — only while the deployed function is `b9f3ee6`'s or
  earlier (see §1). **Recorded 2026-11-02: with Stage Z live, STEP R is governed
  by the deploy-A warning in §1 from now on.** Deploy A writes the four columns
  in the same update that sets `status = 'final'`, so with the columns gone the
  show does not go final. After deploy A, roll the function back first (step 3).

**Step 2 — tests and mutations.**
```powershell
npm test            # now includes test/scoring.test.mjs and test/stageZ.test.mjs
```
Then the §2 and §5 mutation lists, one at a time: apply, see the named
case fail, revert by Edit anchored on the text, `git diff --stat` empty
before the next one. Record the tally in the decision record's build
note.

**Step 3 — edge deploy A (§3 only).** **Not before the 2026-11-06 show
(id 1786388218) is final in BOTH leagues** — the 08:00 ET auto pass on
2026-11-07, or earlier by hand; confirm with `select league_id, status
from league_shows where show_id = 1786388218 and league_id in (1, 2);` (two
rows, both `final`; the filter is there because the shadow league has its own
row for this show by then).
Reason (second-pass decision): deploy A changes `scoreShow`, which runs
live that night, and 11-06 is also the first real Discord post through
the Stage Y path (`docs/decisions/discord-routing.md`) — one new variable
on a show night, not two. Steps 1 and 2 can run any time before it: the
live function reads none of what Stage Z creates.
```powershell
supabase functions deploy carton-sync --project-ref zdfhglvjxquvkjyvophz
```
- Files: download into a scratch workdir (never without `--workdir`, it
  would overwrite the repo copy) and compare each file's hash with HEAD:
  ```powershell
  $wd = Join-Path $env:TEMP "carton-sync-deployA"; New-Item -ItemType Directory -Force (Join-Path $wd "supabase") | Out-Null
  supabase functions download carton-sync --project-ref zdfhglvjxquvkjyvophz --workdir $wd
  foreach ($f in 'index.ts','scoring.js','showSync.js','discord.js','setlistCheck.js') {
    $live = (Get-FileHash (Join-Path $wd "supabase\functions\carton-sync\$f")).Hash
    $head = (Get-FileHash "supabase\functions\carton-sync\$f").Hash
    "{0,-16} {1}" -f $f, $(if ($live -eq $head) { "identical" } else { "DIFFERS" })
  }
  ```
- Boot: the next cron ticks answer 200 with `{"ok":true,…}`
  (`select status_code, created, left(content,160) from net._http_response
  order by created desc limit 4;`). Byte-identical files do not prove a
  Deno import resolves; this does.
- The real check waits for the first show AFTER 2026-11-06 to go final
  (its 08:00 ET auto pass the morning after, or a manual finalize). Then,
  per league, with that show's id:
  ```sql
  select league_id, show_id, status,
         setlist_hash_scoring is not null as hs, setlist_hash_full is not null as hf,
         encode(extensions.digest(setlist_projection_scoring, 'sha256'), 'hex') = setlist_hash_scoring as scoring_hash_matches_text,
         encode(extensions.digest(setlist_projection_full, 'sha256'), 'hex') = setlist_hash_full as full_hash_matches_text,
         left(setlist_projection_scoring, 12) as prefix
  from league_shows where show_id = <that show's id>;
  ```
  Expect `final`, `hs`/`hf` true, both `*_matches_text` true (Postgres's
  SHA-256 of the stored text equals Deno's), prefix `setlist-v1:[`. A
  null baseline with `status = final` means `scoreShow` hit the `.catch`
  or the fallback: read the function logs before the next step, and
  expect the null-hash branch to handle it after deploy B.
- **Rehearsal, after this deploy's boot check:** manual finalize on the
  shadow row. The Admin tab cannot reach it for the same 7-day reason as step
  0, so it is the `finalize` action the button sends. `requireLeagueAdmin`
  checks name and PIN, read the way step 0 reads them: `pwsh` 7.1 or later, the
  first line pasted alone, and answered at its prompts. This step runs days
  after step 0, so it sets up its own variables.
  ```powershell
  $name = Read-Host "name"; $pin = Read-Host "PIN" -MaskInput
  ```
  ```powershell
  $base = "https://zdfhglvjxquvkjyvophz.supabase.co"
  $anon = "sb_publishable_qN1goR6-Ss3cErnJJIJdKw_xr5nrFuo"   # public by design: CLAUDE.md, Credentials
  $h = @{ Authorization = "Bearer $anon"; apikey = $anon; "Content-Type" = "application/json" }
  $league = 11
  $show = (Invoke-RestMethod "$base/rest/v1/shows?showdate=eq.2026-10-23&select=id" -Headers $h).id   # must print ONE id
  $show
  Invoke-RestMethod -Method Post "$base/functions/v1/carton-sync" -Headers $h -Body (@{ action = "finalize"; p_name = $name; p_pin = $pin; league_id = $league; show_id = $show } | ConvertTo-Json)
  Remove-Variable name, pin
  ```
  ```sql
  select ls.status, encode(extensions.digest(ls.setlist_projection_scoring, 'sha256'), 'hex') = ls.setlist_hash_scoring as scoring_hash_matches_text,
         encode(extensions.digest(ls.setlist_projection_full, 'sha256'), 'hex') = ls.setlist_hash_full as full_hash_matches_text,
         ls.setlist_hash_scoring, ls.setlist_hash_full,
         (select count(*) from scores sc join brackets b on b.id = sc.bracket_id
          where b.league_id = ls.league_id and b.kind = 'casual' and sc.show_id = ls.show_id) as casual_scores,
         (select count(*) from scores sc join brackets b on b.id = sc.bracket_id
          where b.league_id = ls.league_id and b.kind = 'official' and sc.show_id = ls.show_id) as official_scores
  from league_shows ls
  where ls.league_id = 11 and ls.league_id not in (1, 2)
    and ls.show_id = (select id from shows where showdate = '2026-10-23');
  ```
  **Pass:** `final`; both `*_matches_text` true; both hashes equal what
  `tools/replay_setlist_check.mjs` printed for 10-23 (any league's row, since
  the hash does not depend on the league; the 2026-11-02 values are in §2);
  `casual_scores` 1; `official_scores`
  0. **Nothing posts:** `announcements` stamps a winner older than 7 days
  without sending, and skips the lock notice on a show that old. **One side
  effect is not isolated:** `scoreShow` writes the global `setlist_songs`, so
  if The Carton edited this show since its last pass, this finalize refreshes
  that shared table for both real leagues' setlist views. It re-scores nobody
  else, since `scoreShow` receives only the shadow's row. **Accepted, Kyle's
  call 2026-11-02:** the write can only bring the shared 10-23 rows closer to
  The Carton and never touches scores. As of `efb088b`, `scoreShow` returns
  before writing when The Carton has no rows, and the only score this finalize
  writes is the shadow's own Casual sheet. If the write inserts a row because
  The Carton added a song, open apps in every league get the song toast, since
  the realtime binding on `setlist_songs` has no league filter. If The Carton has a
  new song name on that show, its "new songs" post also goes to the shadow
  league only, and ends in `no_key`. This does not replace the check on the
  first real final below it.
- Rollback: redeploy `b9f3ee6`'s function from a scratch worktree, never
  by `git checkout` in the working tree:
  ```powershell
  $wt = Join-Path $env:TEMP "fantasytour-b9f3ee6"
  git worktree add $wt b9f3ee6
  Push-Location $wt; supabase functions deploy carton-sync --project-ref zdfhglvjxquvkjyvophz; Pop-Location
  git worktree remove $wt
  ```

**Step 4 — edge deploy B (§4, §5, §6).** Same command, same file and boot
checks (the download loop above with a new `$wd`). Nothing else is
observable until the next gate.
- **Rehearsal, on the next daily run:** the shadow row is a target, its
  baseline equals today's Carton, and it raises nothing.
  ```sql
  select count(*) from setlist_flags where league_id = 11;   -- pass: 0
  select count(*) from _setlist_check_targets() where league_id = 11;   -- pass: 1
  ```
  A flag here is only a failure if the stored hashes differ with no Carton
  edit behind them; a real Carton edit to 10-23 would flag this row and show
  up on the real leagues' rows too.

**Step 5 — first run reviewed** (the morning after deploy B, after the
09:00 ET gate; the show sync runs first in the same tick):
```sql
-- the target count the run should report (run BEFORE the gate too)
select count(*) as targets, count(distinct s.showdate) as dates
from league_shows ls join shows s on s.id = ls.show_id
where ls.status = 'final'
  and exists (select 1 from scores sc join brackets b on b.id = sc.bracket_id
              where b.league_id = ls.league_id and sc.show_id = ls.show_id);
select key, ran_at, attempted_at, note from sync_state order by key;
select id, league_id, show_id, kind, left(carton_hash, 12) as hash, found_at,
       detail->>'reason' as reason, detail->'flips' as flips, detail->'counts' as counts
from setlist_flags order by id;
select count(*) filter (where setlist_hash_scoring is not null) as baselined, count(*) as targets
from _setlist_check_targets();
```
Expect: `daily_setlist_check.ran_at` set with `note` counts matching the
first query; exactly one flag (league 1, the 2026-08-14 show, kind
`scoring`, reason `baseline: …`, flips with one hit flip in bracket 2 and zero
reason flips);
`baselined` = targets (every target, the 08-14 row included). Record the
outcome in the decision record as a dated line. If `ran_at` is unset,
`attempted_at` and `note` are absent: read `setlist_check.error` in the
latest cron response and the function logs; the 30-minute retry is
already scheduled.
- **Rehearsal (2026-11-02):** the first query counts the shadow row, and
  `note.baselined` leaves it out (§6). The last query reads the target list
  rather than every final row, because from deploy A onward a final row with
  no scores also carries a baseline, the shadow league's included.
- Rollback: redeploy A's commit from a scratch worktree (the loop
  above). Data written stays and is harmless: deploy A reads none of it.

**Step 6 — client.**
```powershell
npm run build
git add app.js app.js.map src test   # with the source change, one commit
git push
[regex]::Match((Invoke-WebRequest https://fantasyeggy.wooklord.net/app.js -UseBasicParsing).Content, '[0-9a-f]{7}-[0-9a-f]{7}').Value
```
The printed id must equal the one the Settings card shows after a fresh
load (`docs/decisions/deploy-cache.md`, Quick reference; a stale tab
shows the old id until closed). Device check, both leagues' admin views:
league 1 shows the pill and the 08-14 flag in the block above the dated
rows; league 2 and the shadow league show neither; a non-admin sees no
pill.
- Rollback: revert the client commit and push; the RPCs stay, unused.
- **Rehearsal, after this push.** Drift injected by SQL on the shadow row ONLY.
  Paste, never type (`CLAUDE.md` → Tooling). **The order is full-only first,
  then scoring (Kyle's call 2026-11-02; the reason is §9, item 1).** Each
  injection is judged on the next daily run.

  **First, before any injection, save two things to `.scratch/`** (gitignored):
  the row's four finalize-time values, and the one frozen element 2b will edit.
  That element holds pick text, so it never goes in a tracked file.
  ```sql
  -- Save the one cell this returns as .scratch/shadow_finalize_values.json
  select to_jsonb(x) as result from (
    select setlist_hash_scoring, setlist_hash_full, setlist_projection_scoring, setlist_projection_full
    from league_shows
    where league_id = 11 and league_id not in (1, 2)
      and show_id = (select id from shows where showdate = '2026-10-23')
  ) x;

  -- Save the one cell this returns as .scratch/shadow_2b_element.json. A frozen
  -- hit on a real song is a song in the 10-23 setlist. Its idx is <IDX> below.
  select to_jsonb(x) as result from (
    select e.ord - 1 as idx, e.elem
    from scores sc
    join brackets b on b.id = sc.bracket_id
    cross join lateral jsonb_array_elements(sc.breakdown) with ordinality e(elem, ord)
    where b.league_id = 11 and b.league_id not in (1, 2) and b.kind = 'casual'
      and sc.show_id = (select id from shows where showdate = '2026-10-23')
      and e.elem->>'slot' <> 'bonus' and (e.elem->>'hit')::boolean
      and lower(e.elem->>'songname') <> 'any debut'
    order by e.ord limit 1
  ) x;
  ```
  Then the injections. Run the first query before each one: its two values are
  the `carton_hash` values the flags must carry.
  ```sql
  -- Before each injection: note the row's stored hashes. Before injection 1
  -- these equal today's Carton hashes.
  select setlist_hash_scoring, setlist_hash_full from league_shows
  where league_id = 11 and league_id not in (1, 2)
    and show_id = (select id from shows where showdate = '2026-10-23');

  -- Injection 1, kind B: a trailing space on the third row's raw name in the stored full baseline.
  update league_shows
  set setlist_projection_full = inj.txt,
      setlist_hash_full = encode(extensions.digest(inj.txt, 'sha256'), 'hex')
  from (
    select 'setlist-v1:' || jsonb_set(j, '{2,6}', to_jsonb((j #>> '{2,6}') || ' '))::text as txt
    from (select substr(setlist_projection_full, 12)::jsonb as j from league_shows
          where league_id = 11 and league_id not in (1, 2)
            and show_id = (select id from shows where showdate = '2026-10-23')) q
  ) inj
  where league_id = 11 and league_id not in (1, 2)
    and show_id = (select id from shows where showdate = '2026-10-23');

  -- Injection 2a, kind A: drop the third row from the stored scoring baseline.
  update league_shows
  set setlist_projection_scoring = inj.txt,
      setlist_hash_scoring = encode(extensions.digest(inj.txt, 'sha256'), 'hex')
  from (
    select 'setlist-v1:' || (j - 2)::text as txt
    from (select substr(setlist_projection_scoring, 12)::jsonb as j from league_shows
          where league_id = 11 and league_id not in (1, 2)
            and show_id = (select id from shows where showdate = '2026-10-23')) q
  ) inj
  where league_id = 11 and league_id not in (1, 2)
    and show_id = (select id from shows where showdate = '2026-10-23');

  -- Injection 2b, SAME DAY as 2a (§9, item 2), shadow sheet only: the saved
  -- element becomes hit false, reason "not played". Its points stay, since
  -- enrichment never reads them.
  update scores sc
  set breakdown = jsonb_set(jsonb_set(sc.breakdown, '{<IDX>,hit}', 'false'::jsonb), '{<IDX>,reason}', '"not played"'::jsonb)
  from brackets b
  where b.id = sc.bracket_id and b.league_id = 11 and b.league_id not in (1, 2)
    and b.kind = 'casual' and sc.show_id = (select id from shows where showdate = '2026-10-23')
    and (sc.breakdown-><IDX>->>'hit')::boolean;
  ```
  The projection text comes back from `jsonb::text` with spaces after commas,
  so it is no longer byte-canonical. That is harmless: the hash is recomputed
  from that same text, `parseProjection` is `JSON.parse`, and only a baseline
  that differs is wanted.

  | | Injection 1 (full-only) | Injection 2a (scoring) |
  |---|---|---|
  | **New `setlist_flags` row** | exactly one, kind `drift` | exactly one, kind `scoring` |
  | **`carton_hash`** | the full hash noted before it | the scoring hash noted before it |
  | **`detail.diff`** | `changed` is one entry, position 3, `field: "songname"`, `from` with the trailing space, `to` without; the other three lists empty | `added` is one entry, position 3, the norm name; the other three lists empty |
  | **`detail.full_hash`** | absent | today's Carton full hash: the full hash noted before injection 1 |
  | **`detail.flips`** | absent | the shadow Casual bracket and nothing else: `hit_flips` 1, `reason_flips` 0, one pair, `n` 1 |
  | **`note`** | `flagged_drift` 1 | `flagged_scoring` 1, `suppressed_drift` 1 (the altered full baseline is still a kind B candidate, and this kind A carries the current full hash) |
  | **Admin tab, shadow league** | pill 1; one notice in the block above the dated rows, since 10-23 is outside the 7-day list; kind B copy | same, kind A copy, with the flip line |
  | **Clear** | notice and pill go; `cleared_at` and `cleared_by` set | same |
  | **The next daily run** | no new row, `deduped` 1 | no new row, `deduped` 1 and `suppressed_drift` 1 |

  Any other result is a failure to record in the decision record. Those last
  two counts appear in the daily `note` every day until the restore below.

  **Restore, Kyle's call 2026-11-02 (§9, item 3).** After the last rehearsal
  flag is cleared, write the saved element back, then null the four columns, in
  that order. §6's null-hash branch re-derives first, so an element left edited
  would raise a flag instead of a baseline.
  ```sql
  -- Pass: 0. Do not restore until this reads 0.
  select count(*) from setlist_flags
  where league_id = 11 and league_id not in (1, 2) and cleared_at is null;

  -- Restore 1. From .scratch/shadow_2b_element.json: idx replaces <IDX>, and the
  -- "elem" value goes between the dollar quotes, which survive an apostrophe.
  update scores sc
  set breakdown = jsonb_set(sc.breakdown, '{<IDX>}', $el$<SAVED_ELEM>$el$::jsonb)
  from brackets b
  where b.id = sc.bracket_id and b.league_id = 11 and b.league_id not in (1, 2)
    and b.kind = 'casual' and sc.show_id = (select id from shows where showdate = '2026-10-23');

  -- Restore 2. This one row only: the shadow league's other final rows keep their baselines.
  update league_shows
  set setlist_hash_scoring = null, setlist_hash_full = null,
      setlist_projection_scoring = null, setlist_projection_full = null
  where league_id = 11 and league_id not in (1, 2)
    and show_id = (select id from shows where showdate = '2026-10-23');

  -- After the next daily run: save the one cell this returns as .scratch/shadow_rebaseline_values.json
  select to_jsonb(x) as result from (
    select setlist_hash_scoring, setlist_hash_full, setlist_projection_scoring, setlist_projection_full
    from league_shows
    where league_id = 11 and league_id not in (1, 2)
      and show_id = (select id from shows where showdate = '2026-10-23')
  ) x;
  ```
  ```powershell
  $a = Get-Content .scratch\shadow_finalize_values.json -Raw | ConvertFrom-Json
  $b = Get-Content .scratch\shadow_rebaseline_values.json -Raw | ConvertFrom-Json
  foreach ($k in 'setlist_hash_scoring','setlist_hash_full','setlist_projection_scoring','setlist_projection_full') { "{0,-28} {1}" -f $k, ($a.$k -ceq $b.$k) }
  "lengths {0} {1}" -f $b.setlist_projection_scoring.Length, $b.setlist_projection_full.Length
  ```
  **Pass/fail is this equality.** On that next daily run: no new flag; `baselined`
  in the `note` up by 1; all four lines above `True`; and
  `tools/replay_setlist_check.mjs`, run the same day, prints the same two hashes
  on its 10-23 `baseline:` line and the same two projection lengths on its
  `lengths:` line. The replay prints no projection text, so those are the values
  it is compared on. If The Carton edited 10-23 after the finalize, the equality
  fails and league 2's 10-23 row carries a flag too. That is a Carton edit, not a
  rehearsal failure, and it goes in the decision record as one.

**Step 7 — acknowledge.** Clear the 08-14 flag from the Admin tab. Expect
the notice and the pill to go, and in SQL `cleared_at`/`cleared_by` set
on that row (the uuid is read, not copied anywhere). This is the first
live use of `admin_clear_setlist_flag`.

---

## 9. Open points

Everything the outline left open was settled in the 2026-11-01 first
pass. The draft of this file surfaced three more, listed here as they
were put to Chat, each settled in the second pass the same day and folded
into the body (the "Second pass" list at the top records the decisions
and their reasons):

1. **Day-after kind B** under the literal reading of (a) → kind A rows
   carry `detail.full_hash`; kind B is suppressed whenever any kind A for
   the same (league, show) carries the current full hash (§4 step 4 and
   step 5, the `detail` schema).
2. **The guard at finalize** → one rule everywhere, no baseline from
   fallback rows; consequence stated in §3 and §6.
3. **Enrichment on fallback rows** → run it, labelled; flips present on
   every kind A; E7 added (§5, §6 case 3).

Nothing was open from this plan as of its approval.

**Added 2026-11-02 with the rehearsal and answered the same day (Kyle's calls,
folded into §2, §6 and §8). Nothing here is open, and none of it blocks a build
step:**

1. **2026-11-02 — Injection order: full-only first, then scoring. Approved.**
   The brief ran scoring first. The injections move the baseline instead of The
   Carton, so The Carton's full hash never changes during the rehearsal. A
   scoring injection first would raise a kind A carrying that unchanged full
   hash, and the second-pass rule would then suppress the later kind B by its
   own logic. The reversal works around the simulation method, not a flaw in
   the rule. It needs no extra SQL and no behaviour change, and it also
   exercises the suppression, since injection 2a's run reports
   `suppressed_drift` 1.
2. **2026-11-02 — Injection 2b: yes, shadow sheet only.** A baseline edit cannot
   produce a flip, because enrichment compares the frozen verdicts with today's
   Carton and neither changes. 2b edits one element whose song is in the 10-23
   setlist: hit false, reason "not played", points left alone, since enrichment
   never reads them. The guard joins `scores` to `brackets` and requires
   `brackets.league_id = 11` and `league_id not in (1, 2)`. The
   original element is saved to `.scratch/` first; it holds pick text, so never
   a tracked file. The save takes the sheet's first frozen hit that is not an
   "Any Debut" pick: `scorePicks` sets `hit` true for any played song, wrong
   slot included (as of `efb088b`), so that element's song is in the setlist. 2b
   lands the same day as 2a, because a deduped kind A never re-runs enrichment.
   Expected: the scoring injection's kind A carries `detail.flips` with
   `hit_flips` 1 in the shadow Casual bracket and nothing else.
3. **2026-11-02 — Restore afterward: yes, by re-baseline.** Before any rehearsal
   injection, the shadow row's four finalize-time values are saved to
   `.scratch/`. After the last rehearsal flag is cleared, the saved 2b element
   is written back, then the shadow row's four columns are nulled. Next daily
   run, expected: no flag, baselined +1, and the four new values equal both the
   saved finalize-time values and the replay's 10-23 output. Pass/fail is that
   equality. The replay prints the two hashes and the two projection lengths,
   not the text, so those are the values it is compared on. The league itself
   stays, as step 0 says.
4. **2026-11-02 — Credentials.** Every PowerShell step that calls
   `admin_set_cutoff` or the `finalize` action reads the name and PIN at run
   time with `Read-Host`, `-MaskInput` for the PIN. No nickname or PIN literal
   in this file, and none typed where PSReadLine history keeps it. Two steps were
   fixed: the cutoff step had no `-MaskInput`, and the finalize step borrowed
   step 0's variables from days earlier. `-MaskInput` needs `pwsh` 7.1 or later;
   checked locally, `pwsh` 7.6.9 has it and Windows PowerShell 5.1 does not.
5. **2026-11-02 — Timing.** The shadow league is created by 2026-11-05 so setup
   stays SQL-free, and the templated insert stays as the fallback if creation
   slips past 2026-11-06. Its traces on the 2026-11-06 reminder are expected and
   are not the Stage Y watch item failing. They are a stamped `remind_sent` and
   `no_key`, not failed posts in the logs as the answer put it: §8 step 0, "What
   the fixture does on its own". The deploy A gate query now names leagues 1 and
   2, because a third row would otherwise break its "two rows".
6. **2026-11-02 — Replay pass/fail, sharpened.** Exactly one hit flip
   (2026-08-14, bracket 2) and ZERO reason flips. The prototype's 22 reason
   differences were artifacts of today's config. The module infers mode from the
   slot key, so any reason flip is a finding.
7. **2026-11-02 — The shadow finalize's write to the shared `setlist_songs` is
   accepted.** It can only bring the shared 10-23 rows closer to The Carton and
   never touches scores (§8 step 3).

## Files

`supabase/functions/carton-sync/setlistCheck.js` (new) ·
`supabase/functions/carton-sync/index.ts` · `tools/replay_setlist_check.mjs`
(new) · `sql/stage_z_setlist_check.sql` (new) · `test/stageZ.test.mjs` (new) · `test/stageX.test.mjs` (amended) ·
`test/scoring.test.mjs` (new section; wired into `npm test`) ·
`test/signups.test.mjs` · `test/harness.mjs` · `test/fixtures.mjs` ·
`test/scenario.test.mjs` · `package.json` · `src/core/state.js` ·
`src/core/signups.js` · `src/core/switcher.js` · `src/features/admin.js` ·
`src/main.js` · `app.js` + `app.js.map` (rebuilt) · build notes in
`docs/decisions/setlist-check.md` when done.

**RPCs:** `admin_list_setlist_flags` (new), `admin_clear_setlist_flag`
(new), `_setlist_check_targets` (new, service role), `_account_has_played`
(redefined). **Tables/columns:** `setlist_flags`; `league_shows.
setlist_hash_scoring / setlist_hash_full / setlist_projection_scoring /
setlist_projection_full`; `sync_state` row `daily_setlist_check`.
**Edge actions:** none added; the router is unchanged.

## Not in scope (recorded so it is not inferred later)

- The correction path: the placeholder SQL template and `admin_adjust_
  verdict` are design item 7's own deliverables, not this plan's.
- Bug (i) (`scoreShow`'s stored-row diff ignoring `footnote`/`is_cover`)
  and bug (ii) (the score-write change check) in `scoring-rules.md`.
- Nulling the four columns on reopen; the per-run cap (design item 4);
  any Discord surfacing; the "does FTP count as a debut" question;
  `shows.sync_flag` stays exactly as it is.
