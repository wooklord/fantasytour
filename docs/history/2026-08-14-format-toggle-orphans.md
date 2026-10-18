# 2026-08-14: the standard→one_set toggle orphaned two Official slot keys

> Extracted verbatim from `CLAUDE.md` at commit 54a5ab8 (2026-10-18), original lines 1651–1867. Nested entries were de-indented to top level; wording is unchanged.
> Historical record — resolved, closed or superseded. Kept for its method and evidence. Not a current instruction.

- **⚠️ OPEN 2026-08-14 — the standard→one_set toggle ORPHANS two Official
  slot keys on show `1765912122`. THE FORMAT IS CORRECT AND STANDS — the
  band is playing one set; the dev confirmed the toggle was intended and
  meant to have been made days earlier. What is open is the exposure, not
  the decision. Do not revert.**
  - **✅ RESOLVED 2026-08-14 ~23:1xZ — the orphans were deleted and the
    league is level.** Four rows removed via a single data-modifying CTE
    (`with d as (delete ... returning player_id, slot, songname) select
    ...`), whose RETURNING output was **exactly** the four expected rows and
    no others: two players × two slots each (`encore` + `flat2`), one
    player's pair stamped 2026-08-12 12:31:13Z and the other's 2026-08-14
    17:24:46Z. (Player nicknames and the removed songnames were recorded
    here in `caab1d6` and redacted 2026-08-15 UTC — see the standing rule
    in Conventions. Nothing analytic depended on them: the timestamps,
    slot keys and counts below are the whole evidentiary content.)
    Post-delete
    verification: **7 players, every one at exactly 4 rows with the
    identical key set `{closer,cover1,flat1,opener}`**, and every player's
    `min(updated_at)` equal to their `max(updated_at)` — i.e. each sheet
    was written in one transaction and nobody has partially edited since.
  - **Seven players, not the six counted earlier**: an eighth league member
    submitted a fresh sheet at `2026-08-14 23:05:18Z`, after the earlier count and
    around the time of the delete. It carries no orphan keys, and could
    not have: under `one_set` the sheet renders no `encore`/`flat2` input
    (`slotDefs`), and `submit_picks` would reject those keys anyway since
    `valid_slots` derives from `ls.format`. **No save made while the format
    is one_set can recreate an orphaned key**, so the delete is not
    racy — there is no window in which a concurrent save could have
    reintroduced what it removed. The other six players' timestamps are
    unchanged from the pre-delete reading, confirming nothing else moved.
  - **The later of the two deleted `encore` rows was stamped 17:24:46Z** — direct
    evidence for the reconstruction above, since an `encore` row cannot be
    written under one_set. That timestamp is the hard lower bound on when
    the format changed.
  Casual is unaffected (ranked mode is format-independent); **Official is
  the exposed bracket, and Test 3 (season id 8, `start_date = end_date =
  2026-08-14`, roster 14) covers this show, so Official picks are live and
  scoreable tonight.**
  - **The two sections do NOT define the same keys** — read from the live
    `brackets.config` at write time, not from the spec:
    - `slots` (standard): `opener` 2, `closer` 2, `encore` 2, `cover1` 2,
      plus `flat_picks: 2` @ `flat_points: 1` → keys `opener, closer,
      encore, cover1, flat1, flat2` (6 rows, 10 pts + 2 perfect).
    - `oneset`: `opener` 5, `closer` 5, `cover1` 5, plus `flat_picks: 1` @
      `flat_points: 2` → keys `opener, closer, cover1, flat1` (4 rows,
      17 pts + 2 perfect).
    - **Orphaned by the toggle: `encore` and `flat2`.** The other four keys
      are common to both sections and still render and prefill normally.
  - **The toggle also re-prices the whole Official sheet** — slots 2 → 5,
    flat 1 → 2 — which lands on all 13-14 members regardless of whether
    they hold an orphaned key. Worth separating from the orphaning when
    deciding: the re-pricing is arguably intended (a one-set show is
    supposed to score differently), the orphaning almost certainly isn't.
  - **`submit_picks` does NOT wipe-then-insert — it upserts per slot, so
    untouched rows survive and a revert to `standard` restores them.** The
    writes are `insert ... on conflict (player_id, bracket_id, show_id,
    slot) do update`. **But there is a trailing catch-all delete** —
    `delete from picks where player_id/bracket_id/show_id and not (slot =
    any(select jsonb_array_elements(p_picks)->>'slot'))` — which removes
    every stored slot absent from the submitted payload. For an orphaned
    key that is the same destructive outcome by a different route: the
    one-set sheet has no `encore`/`flat2` input, so any save drops them
    from the payload and the catch-all deletes them. `submit_picks` would
    also now reject them on the way back in (`Invalid slot: encore`),
    since slot mode derives `valid_slots` from `ls.format`.
  - **Blank rows are filtered client-side before the payload is built**
    (`savePicks`, `picks.js:342` — `.filter(p => p.songname)`), with no
    guard on an empty result, so a player who clears every row sends
    `p_picks: []` and the catch-all deletes ALL their rows for that
    bracket/show. Not the likely case tonight (the four surviving keys
    still prefill, so the sheet does not open blank), but it is the worst
    case and it is reachable.
  - **Perverse interaction worth knowing before deciding**: perfect-sheet
    in slot mode gates on `picks.length === expected` (a raw count — the
    same count-vs-coverage substitution flagged elsewhere in this file),
    and `expected` is now `3 + 1 = 4`. A player still holding 6 rows can
    therefore **never** earn Official's perfect bonus for this show, even
    going 6-for-6 — while a player who re-saves (dropping to 4 rows)
    becomes eligible again by destroying two picks. The incentive points
    the wrong way.
  - **The orphans are an EQUITY problem, not a scoring loss — and that
    framing is the whole decision.** An `encore` or `flat2` row with
    `format = one_set` fails `p.slot in slotPoints`, falls to the flat
    branch, and pays `flat_points` (2) if the song played anywhere. So the
    two players holding 6 rows have a **21-point ceiling against everyone
    else's 19**, on the easiest condition in the game — no position
    required — purely because of when they last saved relative to an admin
    toggle. **An earlier draft of this file got this backwards**, reasoning
    from those two players' individual ceilings (21 > 19, so leave them
    alone) and concluding the right advice was "don't touch your sheet."
    That optimises the wrong axis: the question is not whether the accident
    helps its beneficiaries, it's that four other players cannot earn those
    points at all. **Resolution: drop the orphans.** The dev — one of the
    two affected — made the call to level the ceiling rather than keep the
    advantage.
  - **A re-save DOES delete the orphans, and it will not error. Verified at
    both ends 2026-08-14 before two players were asked to do it, rather
    than assumed from the catch-all's wording.**
    - **Client**: `renderPickSheet` builds rows from `slotDefs(show.format)`
      (`picks.js:169`), which under one_set returns only
      `opener/closer/cover1/flat1` — so **no input element exists** for
      `encore`/`flat2`, and `savePicks`' `querySelectorAll(".slotline
      input")` cannot pick them up.
    - **Server**: the payload therefore carries 4 slots; the catch-all
      `delete ... and not (slot = any(select jsonb_array_elements(p_picks)
      ->>'slot'))` matches `encore`/`flat2` and removes them.
    - **The failure mode worth ruling out was the opposite one**: if the
      sheet had rendered rows for stored-but-invalid slots, the payload
      would have included `encore` and `submit_picks` would have raised
      `Invalid slot: encore`, failing the whole save. It doesn't — the key
      never reaches the server, so the validation never fires.
    - **The Save button is not gated on dirty state** (`picks.js:236` — no
      `disabled` attribute), so "open it and press Lock 'em in without
      changing anything" genuinely works.
    - **Preconditions that would make it fail, all checkable by the player
      in one glance**: picks must still be open (cutoff `03:00Z`), and the
      player must pass `_official_gate` for season 8. Both collapse to a
      single self-check — `openShow()` renders `renderIneligible` instead
      of the sheet when the gate fails, so **if they can see the sheet,
      the save will go through.**
    - **Equivalent alternative, more reliable under time pressure**: a
      direct `delete from picks where bracket_id = 1 and show_id =
      1765912122 and slot in ('encore','flat2')` reaches the identical end
      state (4 rows, `expected = 4`, perfect-sheet eligible) without
      depending on two people acting before cutoff. The only difference is
      cosmetic — a re-save also bumps `updated_at` on the four surviving
      rows.
  - **No warning covers this.** The orphan confirm added in `e266a40` is
    scoped to scoring-MODE changes (`admin.js:679-724`); `toggleFormat`
    (`admin.js:566`) fires `admin_set_show_format` immediately with no
    confirm and no orphan check, and toasts success. A format toggle is one
    click from the Shows & cutoffs panel.
  - **UNRESOLVED, and it decides the response: whether Official actually
    has picks for tonight, how many players, and whether anyone has saved
    since the toggle.** Could not be read at write time — `get_show_picks`
    is cutoff-gated until `03:00Z` and `picks` has no public SELECT policy.
    **Note `[]` from PostgREST on a policy-less table is a DENIAL, not an
    empty result** — verified by reading `picks?select=id&limit=1`
    unfiltered, which also returned `[]`; don't read either as "no picks."
    Needs the SQL editor or an admin PIN (`admin_pick_status` returns
    `picks_count` + `last_saved` per player, which answers both halves).
  - **Revert would be non-destructive, but is NOT happening** — the format
    is correct. Recorded only because it bounds the damage: `submit_picks`
    upserts per slot, so every row not deleted by a post-toggle save is
    still there, and a hypothetical revert would restore the 6-row sheet
    and the original point values. Nothing about the orphaning is
    irreversible except rows an actual save has already deleted.
  - **NOTHING RECORDS WHEN THE FORMAT CHANGED. Checked exhaustively
    2026-08-14; do not re-derive this.** `league_shows` has no `updated_at`
    (`sql/stage_a_schema.sql` — the columns are `league_id, show_id,
    cutoff_at, format, status, remind_sent, lock_sent, winner_sent`);
    there are **zero triggers anywhere in `sql/`**;
    `admin_set_show_format` writes `format` and nothing else; no Discord
    notice exists for a format change (only `cutoff_changed`/`reopen`/
    `finalize` have edge actions); `pingRealtime()` is never called from an
    admin RPC; and this show's `remind_sent`/`lock_sent`/`winner_sent` are
    all still `null`, so no announcement fired that could date it either.
    **`picks` cannot date it from the inside**: `picks.id` is a
    `uuid default gen_random_uuid()`, not a sequence, so there is no
    insertion-order signal, and the table has `updated_at` but **no
    `created_at`** — a row's timestamp tells you its last write, never its
    first. **The only timestamped record that exists is the Supabase
    dashboard's API log** (a `POST /rest/v1/rpc/admin_set_show_format`
    entry), subject to the project's retention window.
  - **But the picks themselves give a hard LOWER bound, and it's proof, not
    inference: format was `standard` at 17:24Z on 2026-08-14.** An `encore`
    or `flat2` row cannot be written while `format = 'one_set'` —
    `submit_picks` derives `valid_slots` from `ls.format` and raises
    `Invalid slot: encore`. So the existence of encore/flat2 rows stamped
    17:24Z proves the format was still standard at that moment. **The upper
    bound is inference only**: four players hold exactly
    `opener/closer/cover1/flat1` — the one_set key set
    — with last saves 20:07–21:07Z, which is strong behavioural evidence
    the format was already one_set by 20:07, since four people
    independently leaving exactly those two rows blank is not credible.
    It is not proof: blank rows are filtered client-side
    (`picks.js:342`), so a standard-format sheet CAN produce that exact
    footprint. **The dev's recollection of having toggled it "a few minutes
    before ~21:10Z" is therefore probably off by one to three hours** — and
    note that the recollection and the evidence disagree in a direction
    that does not matter much, because no save has occurred after 21:07Z
    under either reading.
  - **The cron did NOT do it — the auto-promotion path is real but inert,
    verified live.** `syncShows` (`index.ts:279-281`) runs
    `update league_shows set format='one_set' ... .eq("format","standard")`
    for every festival-tagged show on **every sync tick**, which would have
    been a much better explanation than a misremembered manual toggle.
    It isn't the explanation: `GET /shows.json?show_tag=festival` returns
    `{"error":false,"data":[]}` — the tag is not in use on The Carton at
    all, so `festIds` is always empty and the `if (festIds.length)` guard
    never opens. Confirmed against a control query (an untagged
    `shows.json` returns rows through the same parser), because an empty
    array from a misparsed response would have exonerated the cron
    incorrectly.
  - **Latent bug found while ruling that out — the comment above that block
    is wrong, and it will matter the day anyone uses the tag.**
    `index.ts:252-253` claims the promotion is "promote only — a manual
    admin toggle back to standard is never overwritten by a later sync."
    The first clause is true (it never demotes one_set→standard). **The
    second is false**: `.eq("format","standard")` doesn't protect a manual
    toggle, it *targets* it — a festival-tagged show that an admin sets
    back to standard is re-promoted to one_set by the next cron tick,
    within a minute, silently and forever. Inert today only because the tag
    is unused. See the deferred `toggleFormat` warning item for where this
    is tracked.
  - **Whether the four ever held 6 rows is NOT answerable from `picks`, and
    the ambiguity is structural.** A player who saved fresh under one_set
    and a player who held 6 rows and lost 2 to the catch-all delete leave
    **identical** footprints: four rows, one timestamp, no residue. There
    is no `created_at`, no row-id ordering (uuid), no history table, and
    the localStorage draft is cleared on successful save
    (`picks.js:355`). **The one place an answer could still exist is the
    Supabase API log**: count `POST /rest/v1/rpc/submit_picks` entries for
    today against the six distinct last-save timestamps — extra calls mean
    somebody saved more than once. It cannot attribute a call to a player
    (every request carries the same anon key, there is no per-request
    identity), so it can establish that a double-save happened, never who.
