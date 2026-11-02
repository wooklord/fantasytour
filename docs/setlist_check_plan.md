# BUILD PLAN — daily setlist check (decision (2)) — approved 2026-11-01

> **STATUS: PLAN ONLY. NOT BUILT.** No app code, no SQL applied, no deploy.
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

## Build order (strict)

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
  projection, hash, diff, gate and verdict re-derivation. It imports
  `norm`, `deriveSlotFacts` and `scorePicks` from `scoring.js` and
  `dailyGateDue`, `easternDateOf` from `showSync.js`. `index.ts` fetches,
  calls it, and applies the writes it returns. Plain Node tests (Node 24.20
  here; `crypto.subtle` is global in Node ≥ 20 and in Deno).
- `index.ts` gains: `mapSetlistRows` (extracted from `scoreShow`), a
  baseline on the final pass, `dailySetlistCheck` / `dailySetlistCheckSafe`
  / `checkSetlists` (the `dailyShowSync` shape), and the enrichment read.
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
  `ABSENT = "absent"`.
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

---

## 3. Finalize-time baseline

- **`mapSetlistRows(show, rows)` → `{ songs, matched }`**, extracted from
  `scoreShow` verbatim: the `show_id` filter, the fallback to every row at
  that date, the sort, the field mapping, the empty-name filter. `matched`
  is true when at least one row carried the stored show id (the `mine`
  array as of `b9f3ee6` was non-empty). `scoreShow` calls it; no behaviour
  change on any existing path.
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
  `{ status: "final", ...(res?.baseline ?? {}) }` — the baseline lands in
  the same write as the status flip or not at all. Both callers go through
  this, so the manual button and the 08:00 ET auto pass behave alike.
- **`reopenShow`** unchanged: the four columns stay until the next
  finalize overwrites them, and a reopened row is not final so the daily
  check skips it.
- Response size: `autoFinalize` discards `scoreShow`'s result and
  `finalizeShow` returns `{ok}`, so the cron response in
  `net._http_response` does not grow.

---

## 4. The daily check

Constants in `index.ts`: `DAILY_SETLIST_KEY = "daily_setlist_check"`,
`SETLIST_FETCH_BATCH = 5`.

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
bracket 2 and nothing in bracket 1; zero kind B (no baseline, so no B is
possible on this run); every other target baselined silently; the 08-14
row baselined after its flag. League 1's 2026-10-23 row (final with no
picks) has no scores rows and is not a target. The 2026-10-15 footnote
edit landed before final, so no flip there. Any other flag is a finding
to record in the decision record, not to clear on sight. Clearing the
08-14 flag from the Admin tab is the acknowledgment (design item 12) and
happens at step 7.

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

**Step 1 — Stage Z.**
- Before: `node test/stageZ.test.mjs` and `node test/stageX.test.mjs`
  green (the md5s and the amendment); STEP 0 every row `ok`.
- Apply: paste the whole file. After: STEP 2A every row `ok`; STEP 2B's
  ERROR panel reads `STAGE Z SMOKE: 0 of <n> FAILED`.
- Confirm nothing persisted: `select count(*) from setlist_flags;` → 0;
  the four columns all null.
- Rollback: STEP R — only while the deployed function is `b9f3ee6`'s or
  earlier (see §1).

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
from league_shows where show_id = 1786388218;` (two rows, both `final`).
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
select count(*) filter (where setlist_hash_scoring is not null) as baselined, count(*) as total
from league_shows where status = 'final';
```
Expect: `daily_setlist_check.ran_at` set with `note` counts matching the
first query; exactly one flag (league 1, the 2026-08-14 show, kind
`scoring`, reason `baseline: …`, flips with one hit flip in bracket 2);
`baselined` = targets (every target, the 08-14 row included). Record the
outcome in the decision record as a dated line. If `ran_at` is unset,
`attempted_at` and `note` are absent: read `setlist_check.error` in the
latest cron response and the function logs; the 30-minute retry is
already scheduled.
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
rows; league 2 shows neither; a non-admin sees no pill.
- Rollback: revert the client commit and push; the RPCs stay, unused.

**Step 7 — acknowledge.** Clear the 08-14 flag from the Admin tab. Expect
the notice and the pill to go, and in SQL `cleared_at`/`cleared_by` set
on that row (the uuid is read, not copied anywhere). This is the first
live use of `admin_clear_setlist_flag`.

---

## 9. Open points — none

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

Nothing is open from this plan as of its approval.

## Files

`supabase/functions/carton-sync/setlistCheck.js` (new) ·
`supabase/functions/carton-sync/index.ts` · `sql/stage_z_setlist_check.sql`
(new) · `test/stageZ.test.mjs` (new) · `test/stageX.test.mjs` (amended) ·
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
