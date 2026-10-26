# Standings and Settings UX: community links, View chip, own-row outline, nickname overflow

> Decision record — currently binding. LOCKED 2026-10-25 (design settled in
> Chat, written the same day, before any code). `CLAUDE.md` holds a one-line
> pointer under "Frontend/CSS gotchas" and in the docs index; this file is
> the full text. The Who's Picked half of the same batch is recorded in
> `admin-panel.md` → "Who's Picked" (it is an admin-panel invariant, so it
> lives with the others). No nicknames in this file or any tracked file
> (standing rule in `CLAUDE.md` → Conventions).

## Locked decisions

1. **Community links also render in Settings, beneath the league dropdown,
   for the current league.** Source is `state.leagues` (already carrying
   `fb_url` / `discord_url` from `my_leagues` since Stage S) through the
   shared `communityLinks()` helper in `src/core/community.js` — **no new
   fetch, no new RPC.** This is the fifth surface for the same links (after
   the no-league screen, the login screen, the admin Community section and
   the data itself); it must share the one rendering helper and its
   https-only guard rather than add a copy. The block re-renders with the
   dropdown, so switching league switches the links.

2. **⚠️ CORRECTION 2026-10-25, recorded at full weight: items 2 and 3 were
   built against the WRONG SCREEN.** The dev meant the per-show **Scores
   page** — the view that lists every player's entry with picks and
   per-pick points (`get_show_picks`, which is where `is_mine` lives) —
   not the standings board. The Chat-side reading of "all open" as the
   board's tiebreak lines was wrong, and it shipped in `1a74cee`. The
   original wording below is kept and **SUPERSEDED**; the replacement
   decisions are 2a and 3a after item 3.
   *(superseded)* **A "View" chip on the standings board, beside the Score label, with two
   positions: Compact and Detail.** Compact is the default — name and
   points only, nothing expanded. Detail — every row expanded. The choice is
   **persisted per device in `localStorage` under `ft_board_view`**, same
   posture as `ft_theme2`: a device preference, not account state, never
   sent to the server, never synced across devices. **Survey correction,
   same day:** there is NO per-row expand/collapse today and never was —
   the only per-row detail is the always-visible tiebreak lines
   (`layerLines`, `standings.js:281`) inside the name cell. So "expanded"
   means those lines: Compact hides them, Detail shows them.
   **RESOLVED 2026-10-25 (dev's call, same day): the minimal reading is
   the decision.** Compact = name + points only, no tiebreak lines; Detail
   = name + points + the existing tiebreak lines. Persisted in
   `localStorage` `ft_board_view`, default `compact`, and the chip renders
   even when the board has zero rows. **A per-show breakdown inside rows
   is NOT in scope** — the RPC's `breakdown` column stays unread by the
   board. Recorded at mention-weight as a possible later feature, not a
   decision and not a deferred item.
   **Placement, build note 2026-10-25:** the chip renders as a right-aligned
   row directly above the table, over the Score column — not inside the
   Score header cell as "beside the Score label" might read. Two buttons
   plus "Score" in that `<th>` would leave the name column about 70px at
   phone width once the rank and score columns take their minimums.

3. *(superseded in part — see the correction under 2 and item 3a; the
   standings outline itself is KEPT)* **The viewer's own row gets an
   OUTLINE in the app's existing yolk
   color.** As locked, this was "keyed on the server-computed `is_mine`";
   **survey correction, same day:** `get_bracket_scores` has no `is_mine`
   (only `get_show_picks` does). The board already marks the own row with
   `class="me"` by comparing the RPC's `player_id` to `state.session.id`
   (`standings.js:284`) — that id is server-issued at login, so it is not
   an inference from the stored name, and adding an RPC column would buy
   nothing. **Build on the existing `.me` class.** Text colors do not
   change — **the outline does not change text color.** (Note: today the
   RANK cell is yolk, `.lb .rank`; the points cell `.lb .pts` is plain
   mono. "Points keep their yolk color" as locked described the rank.)
   A tinted-fill highlight was considered and **rejected**: per-show wins
   will add trophy marks and may tint winner rows, and an outline cannot
   collide with a fill. **The existing `.lb tr.me td` rule IS that
   rejected fill** (`rgba(255,197,61,.07)`, hardcoded dark-theme yolk that
   does not flip with the light theme, `styles.css:419`) — it is replaced
   by the outline, not kept alongside it. Any later winner/tie treatment
   must stay a fill or a mark, so the two never fight for the same
   property.

2a. **LOCKED 2026-10-25 — Scores page View chip.** On the per-show Scores
   page, a "View" chip with two positions: **Compact (default)** collapses
   every entry to name + points; **Detail** opens every entry (picks and
   per-pick points visible). Persisted per device in `localStorage`
   `ft_scores_view`, default `compact`, same posture as `ft_theme2`; the
   chip renders even with zero entries. **Name cells on this page get the
   same ellipsis treatment** as decision 4 (`.nm` + `title`).

3a. **LOCKED 2026-10-25 — Scores page own-entry outline; standings chip
   REVERTED.** On the Scores page the viewer's own entry gets the yolk
   OUTLINE, *(superseded same day, original kept:)* **keyed on `is_mine`
   from `get_show_picks`** (this is the screen the original
   "server-computed `is_mine`" wording was about).
   **SUPERSEDED 2026-10-25 (dev's call at plan approval): the own entry is
   marked by `player_id === state.session.id`.** The score entries are
   built from `get_bracket_scores`, which carries `player_id` but no
   `is_mine`; `get_show_picks` carries `is_mine` but no `player_id`.
   "Keyed on `is_mine`" was Chat's wording and wrong for this RPC — it
   would have needed a name join. The session id is server-issued at
   login, so this is the same mechanism as `.me` on the board. No name
   join, no dependence on `is_mine`.
   Point colors unchanged. **Standings board: REVERT the View chip** —
   tiebreak lines always visible again, exactly as before `1a74cee`, and
   `ft_board_view` removed (no reader, no writer). **KEEP the standings
   own-row outline on `.me`**, since it replaced a fill that was broken in
   the light theme — that part of item 3 stands on its own merits.
   **Build note 2026-10-25 (2a/3a built, standings chip reverted):**
   `renderShowDetail` is split into the fetch and `renderShowDetailHtml`,
   with the last fetched data cached per show id so the chip re-renders
   without refetching three RPCs; the harness asserts the rpc count is
   unchanged across a toggle. Compact omits the pick rows from the DOM
   (not a hidden block). The chip shares the Score heading's line, which
   had nothing else on it. The own-entry ring is `box-shadow:inset 0 0 0
   2px var(--yolk)` on the `.panel.scoreentry.mine` card. The ranked-choice
   scenario switches to Detail before reading breakdown labels.
   `ft_board_view` has no reader or writer; a leftover key is proven inert.

4. **Nickname overflow, two layers:**
   - **CSS ellipsis on every name cell** (standings rows and podium, Who's
     Picked, admin Members, no-league screen, header — every cell the
     survey finds), with the full name in a `title` attribute so it is
     recoverable on long-press / hover. *(Admin Members list: SUPERSEDED
     2026-10-26 — member rows went two-line with the name at full width
     and no truncation; `admin-panel.md` → "Members panel cleanup". Every
     other cell above keeps the ellipsis.)*
   - **`register_player` rejects names over 20 characters after trim, for
     NEW registrations only**, with a clear error message. Server cap is
     the real gate; the client check is a courtesy.
     **Build correction 2026-10-25 — NO `maxlength` on the input.** The
     locked text said "a matching maxlength on the input", but `#a-name`
     is ONE input shared by Log in and New player, and three live names
     are longer than 20: a `maxlength="20"` would have locked those three
     players out of logging in. The courtesy check lives in `doRegister`
     only (`auth.js`, `NAME_MAX_LEN` in `core/config.js`), trims first
     exactly as the server does, and shows the server's message. Login is
     untouched.
   - **Existing names are untouched.** The live maximum is 27 characters
     and three names exceed 20. This is safe because login is exact-match
     and nothing re-validates a name after creation (login, PIN reset and
     `_auth_player` all look the player up; none re-checks length).
     **Confirmed by survey 2026-10-25:** `register_player`
     (`sql/stage_c1_rpcs.sql:60`, the only live definition) trims and
     enforces a minimum of 2, no maximum, no character check;
     `_auth_player` matches `lower(name) = lower(trim(p_name))`; the PIN
     RPCs resolve by `_auth_player` or by uuid; `players.name` has no CHECK
     constraint or trigger. So the cap is a one-function change in
     `sql/stage_t_name_length_cap.sql` and must NOT be a CHECK constraint
     (three live rows would fail it). The registration input
     (`auth.js:11`) currently has no `maxlength`.
   - **Renaming existing players: rejected.** Nicknames are the login
     identifier (one factor of the name+PIN credential pair); a rename is
     a credential change, not a display tweak.

5. **LOCKED 2026-10-26 — tie groups on the standings board (tiebreak
   legibility).** Tied players render as a GROUP: a thin left bracket runs
   down the tied rows; one tag line beneath the group reads
   **"Tie for <place> · decided by <layer label>"**, or **"Tie for <place>
   · shared"** when no layer splits them; a **"+"** on the tag expands a
   full-width sub-row listing every configured layer in order with each
   tied player's value, the deciding layer marked. **Collapsed by default;
   expand state in memory only, never persisted.** The name cell returns
   to the name alone — the tiebreak lines (`layerLines`) leave it.
   **Rejected:** color-coding layers (needs a legend, and yolk is already
   the own-row outline); a global chip (per-group expand is the right
   scope, and the board chip was reverted 2026-10-25).
   **Bracket color — PROPOSED by the survey 2026-10-26, NOT locked, dev to
   confirm: `--mint`.** Existing token; against `--panel` it measures
   11.18:1 dark / 3.79:1 light, clearing the 3:1 AA floor for non-text UI
   (WCAG 1.4.11) in both themes, and it is hue-distinct from yolk (own
   row) and coral (destructive controls, links). Caveat at its weight:
   mint is the app's "done / hit / open" accent (`.pill.open`,
   `.pickmark.done`, `.pickres.hit .pt`), so a bracket in it carries a
   faint positive connotation. Fallback if that reads wrong: `--cream-dim`
   (9.61 / 3.85, the muted-text color, quieter). Ruled out: `--yolk-deep`
   (reads as yolk in the dark theme), `--coral` (semantic clash),
   `--line` / `--line2` / `--dash` (all under 1.8:1 — invisible as a
   bracket). The tag line is TEXT, not a component: it takes the existing
   `.muted` style, whose light-theme ratio (3.85:1 on the panel) is a
   pre-existing board-wide condition, not introduced here.
   **PLAN APPROVED 2026-10-26 (dev), with five decisions on the plan's
   open points, each LOCKED:**
   1. A partially resolved group (one member split off, the rest still
      shared) gets ONE tag naming the FIRST splitting layer; the shared
      sub-pair shows only by its equal ranks inside the sub-row. Nested
      tags rejected as noise.
   2. When the configured stack is empty (Casual, All time), the "+" is
      omitted and muted text **"no tiebreakers set"** renders in its
      place; there is no sub-row, since there is nothing to list.
   3. The all-zero gate (`hasAnyScore`, shared with the placeholder
      podium) stays: a fresh season shows no brackets and no tags.
   4. **Bracket color LOCKED: `--mint`.** `--cream-dim` is recorded as the
      REJECTED quieter option (it passed both themes; it lost on
      salience, not contrast). The measurements and the ruled-out tokens
      above stand as the record.
   5. The glyph flips to "−" (U+2212) while a group is open, with
      `aria-expanded` tracking it.
   **Build shape as approved:** `groupTies(order, tiebreakers)` in
   `src/core/tiebreak.js` (pure, unit-tested) returns one group per run
   of equal-points rows; the board renders grouped rows with class `tg`,
   the bracket as `border-left` on `tr.tg td:first-child` (a border, not
   a box-shadow, so `.me`'s inset box-shadows on those same cells are
   untouched), a tag row and a sub-row after each group, and
   `toggleTieGroup(key)` on `window` flipping a module-level `Set` plus
   the sub-row's `hidden` class in place, no refetch. No SQL in this
   batch. Seven harness cases, five mutations.
   **BUILT 2026-10-26, bundle `26aef8a-b9061f4`.** `groupTies`, `ordinal`
   and `layerDisplayValue` in `core/tiebreak.js` (the unit file is now
   wired into `npm test` beside scenario and showSync — it was not before,
   the same gap that let the scoring tests go stale); the board renders
   from `groupTies` with `expandedTieGroups` (module-level `Set`) and
   `toggleTieGroup` on `window`; CSS under the `.me` rules. The sub-row's
   values come from `computeStandings` totals (every configured layer),
   each member as rank · name · value, the deciding layer's label bold
   with a mint "decided" mark. Mutations, all caught: (M1) group by rank
   instead of points → 6 unit checks and 12 board failures; (M2) deciding
   layer taken last instead of first → 1 unit check, and the harness
   CANNOT see this one (every harness stack is one layer), so the unit
   test is the only pin; (M3) `Set` never records an open group → the
   re-render check and the collapse clause, both modes; (M4) all-zero
   gate dropped → the empty-set case, both modes; (M5) `tg` on the tag
   row → 12 failures. M1's first unit run died on a `[0].shared`
   dereference instead of failing an assertion (the mutation log's
   "caught by JavaScript, not by the tests" shape); the three
   single-group checks now optional-chain so an empty result fails
   honestly. **SEAM, stated: phone-width LAYOUT is not proven by anything
   here.** jsdom is blind to CSS, so the harness pins DOM shape and the
   stylesheet text only; the wrapping of the sub-row's layer label onto
   its own line under 520px, the chips wrapping beneath it, and the
   bracket beside the own-row outline at a real viewport need a look on
   the device (private tab, `npm run dev` or the live site once Pages
   serves `26aef8a`).
   **⚠️ CORRECTION 2026-10-26, same day, recorded at full weight: the
   sub-row layout above did NOT read on a phone.** The stated seam
   materialized on the first live look: the inline-wrapping rank · name ·
   value chips wrapped two-then-one, rank and value ran together, and the
   name truncated at 120px. The per-layer-block sub-row (the "values come
   from computeStandings totals … each member as rank · name · value"
   wording above) is **SUPERSEDED**, original kept and marked by this
   note, by **LAYOUT B, dev's call:** the sub-row is a GRID — one row per
   tied player (rank, full-width name with `.nm` ellipsis, then one value
   column per configured layer in stack order), a header row of layer
   labels (short labels, allowed to wrap to two lines), the deciding
   column's header and cells highlighted with a mint tint and the
   "decided" mark in its header. No per-layer blocks. **Rejected
   alternative (LAYOUT A):** keep the per-layer blocks but stack players
   one per line inside each as a rank / name / right-aligned value grid,
   deciding block bold, the others muted. Scope: `subRow()` in
   `standings.js`, its CSS, and the harness sub-row readers and
   assertions — the same facts asserted (every configured layer present,
   each member's value, the deciding one marked, equal ranks visible).
   One mutation: deciding highlight on the wrong layer. The three-way
   harness case moves to a two-layer stack, since a one-layer stack
   cannot tell "tint the deciding column" from "tint every column".
   **LAYOUT B BUILT 2026-10-26, bundle `79618b2-502ca9b`.** `subRow()`
   emits a flat CSS grid (`auto minmax(0,1fr) repeat(N,fit-content(5em))`):
   two empty header cells, one `.tg-h.tg-col` per layer, then per member
   `.tg-rank` · `.tg-name` (`.nm`) · one `.tg-v` per layer; `.deciding`
   on the deciding column's header and cells, the "decided" mark in its
   header only. The harness chunks the grid by header count and asserts
   `stray === 0`. Mutation — deciding tint inverted onto the wrong
   column(s): caught by the expand, shared and two-layer three-way
   checks, both modes. **Phone seam again, stated:** jsdom proves the
   grid's DOM and the stylesheet text only; the header labels wrapping to
   two lines, the name column truncating before the value columns do, the
   tint reading in both themes, and the sub-row's width at 360px with a
   two- or three-layer stack need a look on the device.
   **AMENDMENT 2026-10-26, after the live look — a refinement, decision 1
   stands:** sub-splits inside a group are shown by CELL tint, not only
   by equal ranks. **Rule:** a value cell (member, layer) carries
   `.deciding` iff that layer is in the member's own `layers` from
   `rankStandings` — the layers that split that member's group at each
   depth. The header tint and the "decided" mark stay on the group's
   FIRST splitting layer only, matching the tag line. **Example
   recorded:** a three-way tie where High Score splits one player off and
   Fewest zeros then splits the remaining pair — High Score cells tinted
   for all three, Fewest zeros tinted for the pair only, the first
   player's Fewest zeros cell plain, Most wins (1–1) plain. Build:
   `groupTies` members carry each member's `layers` (unit-tested, passed
   through as the `[{ layer, value }]` objects rankStandings produced);
   `subRow` tints per member per layer by the rule; header logic and CSS
   unchanged. The three-way harness fixture gains a third final show so
   the second configured layer actually splits the remaining pair (two
   shows summing to one total cannot separate equal-high players on
   zeros), and asserts the four facts; the shared and resolved-pair
   cases keep their assertions. One mutation: tint every cell in any
   splitting layer's column (ignore per-member layers) — caught by the
   already-resolved player's plain cell.
   **AMENDMENT BUILT 2026-10-26, bundle `d86d949-20c0cae`.** `groupTies`
   members carry `layers` (unit test: the layer-1 escapee has no layer-2
   entry); `subRow`'s `cellDec(m, l)` tints a value cell iff `l` is in
   `m.layers`; `dec(l)` still drives the header. Harness three-way: three
   shows, totals 6, stack High Score → Fewest zeros → Most wins, ranks
   1/2/3, all four facts asserted. Mutation result: under "ignore
   per-member layers" the split-off player's Fewest zeros cell rendered
   tinted (value 2, `deciding: true`) and only the three-way check
   failed, both modes — the shared and resolved-pair cases were
   unaffected, as they should be.
   **AMENDMENT A 2026-10-26 (dev's call after live use) — the tag line
   names EVERY layer that worked.** Supersedes decision 1's "names the
   FIRST splitting layer" wording (original kept above, marked by this
   note; the one-tag-per-group rule itself stands). The tag names every
   layer that split anyone in the group, in configured stack order,
   short labels joined with " & " — e.g. "Tie for 11th · decided by High
   Score & Most Wins". When all three configured layers were used it
   collapses to "Tie for 11th · decided by all 3 tiebreaks" to save
   width. "· shared" is unchanged. In the expanded grid the "decided"
   mark goes in the header of EVERY layer named in the tag; per-member
   cell tints stay as built.
   **ADDENDUM to A, same day (dev's call) — the header rule:** the
   "decided" mark goes in the header of every layer named in the tag, as
   built; the header TINT moves back to the primary (first splitting)
   layer ONLY, not every marked header. Per-member cell tints unchanged.
   **The meaning, recorded:** tint = where the group first broke;
   "decided" = this column did work; cell tint = for whom. (This replaces
   an earlier note that marking and tinting every named header was
   Chat's consistency call with first-only as a fallback.)
   **AMENDMENT B 2026-10-26 — label case.** The short labels were
   inconsistent: "High Score" (a hand-set override) beside "Most wins"
   and "Fewest zeros". All three become Title Case — "High Score", "Most
   Wins", "Fewest Zeros" — everywhere they render: the tag line, the grid
   headers, and the Tiebreakers footer under the board. The admin
   select's full labels are unchanged; they never appear beside the
   short ones.
   Build shape for both: `TIEBREAK_SHORT_LABELS` title-cased;
   `groupTies` gains `decidingAll` (layers present in any member's path,
   stack order; `deciding` stays as the first for anything still using
   it); a pure `decidedByText(layerKeys, stackLength)` in `tiebreak.js`
   returns the joined short labels, or the "all N tiebreaks" collapse
   when every configured layer was used and N ≥ 3; `tagRow` uses it,
   `subRow` marks headers from `decidingAll`. One mutation: the tag
   falls back to the first layer only.
   **AMENDMENTS A + B BUILT 2026-10-26, bundle `5bbc563-9639f2a`.** Unit
   tests: `decidingAll` in stack order skipping a layer that split
   nobody; the Title Case map; `decidedByText` for one name, two names,
   two-of-two (no collapse), three names joined (stack larger than the
   keys), the "all 3 tiebreaks" collapse, and empty → "". Harness: the
   resolved pair reads "decided by Fewest Zeros"; the three-way case
   reads "decided by High Score & Fewest Zeros" with both headers tinted
   and marked and Most Wins unmarked, cell tints unchanged; shared
   unchanged; the Tiebreakers footer asserted Title Case in both cases.
   Mutation result: with the tag cut to the first layer it read
   "decided by High Score" alone and the three-way check failed in both
   modes; revert byte-identical, bundle matched the index after the
   rebuild. Nothing outside `tiebreak.js`, `tagRow`/`subRow` and the
   tests changed; `admin.js`'s full labels are untouched. (The "both
   headers tinted" in that build is superseded by the addendum below.)
   **ADDENDUM BUILT 2026-10-26, bundle `cb5400f-3a10695`.** `subRow`:
   header tint from `deciding` only (`tint(l)`), the "decided" mark from
   `decidingAll` (`worked(l)`); cells unchanged. Three-way assertion:
   High Score tinted and marked, Fewest Zeros marked but NOT tinted, Most
   Wins neither; the resolved pair's single header stays tinted and
   marked. Mutation result: with the tint applied to every marked header
   the Fewest Zeros header came back tinted and the three-way check
   failed in both modes; revert byte-identical, bundle matched the index
   after the rebuild. Scope held to `subRow` and the tests.
   **AMENDMENT C 2026-10-26 (dev's call after a two-name tag wrapped on
   the phone) — tag wording.** The decided form drops the dot and "by":
   **"Tie for 5th decided: High Score & Fewest Zeros"**, and the collapse
   reads **"Tie for 5th decided: all 3 tiebreaks"**. The shared form is
   unchanged: **"Tie for 5th · shared"**. `decidedByText` is unchanged
   (it returns the list or the collapse); `tagRow` carries the new frame.
   Scope: `tagRow` and the assertions that match the old text. One
   mutation: old wording restored.
   **AMENDMENT C BUILT 2026-10-26, bundle `49c5461-d08e486`** (its own
   commit, after the Stats batch). `tagRow` builds the whole tag — "Tie
   for <place> · shared" or "Tie for <place> decided: <text>";
   `decidedByText` untouched. The resolved-pair and three-way checks
   assert the new text. Mutation result: with the old frame restored the
   tags read "Tie for 1st · decided by …" and both checks failed in both
   modes; revert byte-identical, bundle matched the index after the
   rebuild. **Phone seam, stated:** whether a two-name tag plus the "+"
   now fits one line at 360px is the point of this amendment and is
   unmeasured here.

6. **LOCKED 2026-10-26 — Stats section rework (the standings tab's
   "Nerd stats").**
   1. The section is renamed **"Stats"**; the "· <scope>" suffix stays.
   2. Columns: **Player, Shows, Avg, High, Zeros, Wins** (laurel icon
      header as today). Zeros is new, read from the same
      `computeStandings` totals the tiebreaks use. **Header text: "0s" —
      the survey's call, 2026-10-26, by estimate; device check pending.**
      At 360px the table gets ~294px (`.wrap` 16px sides, `.panel` 16px
      padding + 1px border). `.lb.compact th` (two classes) outranks
      `.lb th`, so compact headers render at .85rem uppercase with 1px
      tracking, not .72rem; SHOWS / AVG / HIGH / ZEROS / laurel plus the
      mono value cells come to ~243px and leave the Player column ~50px,
      which truncates an 8-character name. "0s" gives it ~80px. The
      legend line gains "0s = scoring zeros". If the device shows room to
      spare, "Zeros" is a one-string change.
   3. **Every numeric column sorts on header tap.** First tap sorts BEST
      FIRST — descending for Shows / Avg / High / Wins, ascending for
      Zeros; second tap flips; the active column shows a direction arrow
      and its values render bold. Ties within the sort fall back to name
      A–Z. The choice persists per device in `localStorage`
      `ft_stats_sort`, same posture as `ft_scores_view`; default Avg
      best-first (today's order). `aria-sort` on the active header.
   4. **A leaders strip above the table:** Best avg, High score, Most
      wins, Fewest zeros — name plus value, "+N" when tied, drawn from
      the same rows. Hidden when the table is hidden (the no-scores
      case).
   5. Own-row outline (`.me`) unchanged. Rows still require `shows > 0`.
   6. **Recorded as a CANDIDATE, not a decision:** a per-show matrix
      (players × shows, points per cell, heat tint) as a later component
      and the home for any consistency stat.
   **PLAN APPROVED 2026-10-26 (dev), with the five open points decided:**
   1. **Zeros without a season (All time, Casual): "—" in the column, the
      header unsortable, the Fewest zeros leader omitted.** The totals
      hold 0 for everyone there because `computeStandings` only counts
      zeros against a season's roster join dates; a column of zeros
      would read as a fact. **CANDIDATE, not a decision:** a definition
      of All-time / Casual zeros for later.
   2. A tap re-renders the stats panel only, from cached rows; the
      harness asserts the RPC count unchanged across a tap.
   3. Arrow glyphs ▼ / ▲ on the active header only; no hint elsewhere.
   4. Leaders values: avg to one decimal, the rest integers, as the table.
   5. Ship "0s" with the legend; the device decides whether it reads.
   **Build shape as approved:** pure `src/core/stats.js` (`sortStats`
   with best-first defaults, `parseStatsSort` / `formatStatsSort`,
   `statLeaders`, `fmtStat`), unit-tested and wired into `npm test`;
   `statsPanelHtml` renders into `#statspanel` from a module-level cache
   and `setStatsSort(col)` on `window` flips or switches, writes
   `ft_stats_sort`, and re-renders that panel alone; CSS for the active
   column and the leaders grid (2×2 at phone width, 4 across from
   520px). Five mutations: zeros best-first flipped, name tiebreak
   dropped, arrow on every header, bold in every column, "+N" omitted.
   **BUILT 2026-10-26, bundle `4a21ea3-4b00b5e`.** `src/core/stats.js`
   with `test/stats.test.mjs` in `npm test`; `statsPanelHtml` and
   `setStatsSort` in `standings.js`; CSS; `runStatsScenario` with ten
   checks (heading, default order, tap ascending, flip, stored preset
   honoured, bogus preset, leaders, no-scores, All time, static CSS).
   Mutations, all caught: zeros best-first flipped (3 unit + 2 board
   checks), name tiebreak dropped (5 unit + 1 board), arrow on every
   header (2 board), bold in every column (3 board), "+N" omitted (1
   board). **Lesson recorded:** the name-tiebreak mutation first PASSED
   on the board. The fixture's three players sat on equal points, the
   board's own tie sort handed the panel an alphabetical list, and a
   stable sort with the tiebreak removed reproduced it — only the unit
   test saw it. The fixture now gives the panel a non-alphabetical order
   (totals 7 / 7 / 6) and the board check fails under that mutation too.
   A correlate (the input was already sorted) stood in for the condition
   (the sort sorts) — discipline item 5, inside a test. **Phone seams,
   stated:** the "0s" header row at 360px, the active column widening
   when its values go bold, the arrow's width on the active header, and
   the leaders strip's 2×2 wrap are all unmeasured here.
   **AMENDMENT 2026-10-26 (dev's call after the live look: the 2×2 grid
   broke with three chips or a long name, and "+N" hid co-leaders) —
   leaders strip and Player sort.** Supersedes 6.4's grid and "+N";
   original kept above.
   1. The leaders strip becomes **STACKED ROWS**, one per stat, in this
      order: Best avg, High score, Most laurels, Most shows, Fewest
      zeros. Each row: a fixed-width small-caps label, the tied names at
      full width, the value right-aligned in mono. Fewest zeros is still
      omitted without a season.
   2. **Ties list EVERY name** (name order), up to 5; past 5, the first
      5 then muted "and N more". "+N" is gone. Names use `.nm` with the
      row's full width.
   3. **"Most wins" is renamed "Most laurels"** everywhere it renders;
      the column header stays the laurel icon; the legend says
      "laurels = shows won".
   4. **New row Most shows:** the highest shows-played count and
      everyone at it — the participation nudge.
   5. **The Player header sorts alphabetically:** first tap A–Z, second
      Z–A, same arrow and `aria-sort` treatment; best-first for Player is
      A–Z. Numeric columns unchanged.
   Build shape: `statLeaders` gains the shows key and returns every tied
   id (the render applies the 5-name cap through `capNames`);
   `sortStats` accepts "player" with the name comparator; stacked-row
   CSS; unit tests (shows leader, the cap boundary at 5 and 6, player
   sort both directions); harness (five rows in order on a season view,
   four on All time, a two-way tie shows both names and no "+", a
   six-way tie shows five names plus "and 1 more", Player tap A–Z then
   Z–A with the arrow). Mutations: "+N" style reintroduced, Player sort
   ignored, Most laurels label reverted.
   **AMENDMENT BUILT 2026-10-26, bundle `9a5094f-c8fc6ec`.** `capNames`
   (pure, boundary unit-tested at 5 and 6), `player` in `STAT_COLS` with
   the name comparator in `sortStats`, `statLeaders` with the shows row
   and the label as its one source of wording; `statsPanelHtml` renders
   the stacked rows and a sortable Player header (name cells go bold
   when Player is the sort); CSS replaces the grid. Harness: four new
   loads — two-way ties, a six-way tie with three invented members,
   Player A–Z then Z–A. Mutations, all caught: "+N" reintroduced (3
   board checks per mode), Player sort ignored (2 unit + 1 board), label
   reverted (1 unit + 1 board). Phone seam: the stacked rows' label
   column at 360px against a long name list is unmeasured here.

## Why these and not the alternatives

- Compact-by-default because the board is read far more often than it is
  studied; a wall of expanded breakdowns at phone width buried the ranking.
- A chip rather than a per-row memory because the board has no stable row
  identity across seasons and the per-row toggle already exists for the
  "just this one" case.
- Outline over fill for the own-row: see decision 3. The yolk color was
  chosen because it is already the points color on the board, so the row
  reads as "yours" without adding a colour to the palette.
- A 20-character cap because the name cell has to survive the 901px
  three-column desktop layout and phone width in the same markup; the
  ellipsis layer handles the three legacy names and any future edge.

## Build notes

- SQL: `sql/stage_t_name_length_cap.sql` — one `create or replace function
  register_player` with the length check added, nothing else. **No
  throwaway accounts in production:** the file's footer verifies inside a
  `begin … rollback` block (21 characters must raise the Stage T message,
  20 must succeed, then everything rolls back), followed by a count that
  must be 0. Built and **APPLIED 2026-10-25**: deploy check returned
  `register_player(text,text)`, the rolled-back behaviour test completed
  clean, and the `ZZtest_stage_t_%` count was 0. Server cap is live.
- Harness: an empty-set case for the View chip (a board with no rows must
  still render the chip and no error), a long-name case for the ellipsis
  (a 27-character fixture name — invented, not a real nickname), and the
  21/20 registration pair against the fake client.
