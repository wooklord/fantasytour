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

2. **A "View" chip on the standings board, beside the Score label, with two
   positions: Compact and Detail.** Compact is the default — name and
   points only, nothing expanded. Detail — every row expanded. The choice is
   **persisted per device in `localStorage` under `ft_board_view`**, same
   posture as `ft_theme2`: a device preference, not account state, never
   sent to the server, never synced across devices. **Survey correction,
   same day:** there is NO per-row expand/collapse today and never was —
   the only per-row detail is the always-visible tiebreak lines
   (`layerLines`, `standings.js:281`) inside the name cell. So "expanded"
   means those lines: Compact hides them, Detail shows them. If the dev
   meant a per-show breakdown (the RPC's `breakdown` column, which
   standings ignores), that is new work, not a view of existing detail —
   confirm before building.

3. **The viewer's own row gets an OUTLINE in the app's existing yolk
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

4. **Nickname overflow, two layers:**
   - **CSS ellipsis on every name cell** (standings rows and podium, Who's
     Picked, admin Members, no-league screen, header — every cell the
     survey finds), with the full name in a `title` attribute so it is
     recoverable on long-press / hover.
   - **`register_player` rejects names over 20 characters after trim, for
     NEW registrations only**, with a matching `maxlength="20"` on the
     registration input and a clear error message. Server cap is the real
     gate; the input attribute is a courtesy.
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

- SQL: the cap goes in its own stage file (next letter after S) — one
  `create or replace function register_player` with the length check added,
  nothing else. Verify by registering a throwaway 21-character name
  (rejected) and a 20-character one (accepted), then delete the throwaway
  through the admin boot path.
- Harness: an empty-set case for the View chip (a board with no rows must
  still render the chip and no error), a long-name case for the ellipsis
  (a 27-character fixture name — invented, not a real nickname), and the
  21/20 registration pair against the fake client.
