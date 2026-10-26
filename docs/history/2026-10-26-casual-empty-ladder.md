# 2026-10-26 — Green Eggs Casual: ranked mode with an empty ladder

> Historical record, written 2026-10-26 from a read-only diagnosis the same day. The decisions it produced are LOCKED in `docs/decisions/admin-panel.md` → "TWO SAVES WRITE `brackets.config`" (the entry that owns `admin_update_config` and both save paths), dated 2026-10-26, which points back here. `CLAUDE.md` is unchanged (at its size limit). No player nicknames here, per the standing rule in Conventions.

## What happened

- **Bracket:** league 2 (Green Eggs), Casual (bracket 4). Live config: `mode: "ranked_choice"`, `ranked: { ladder: [] }`. Official (bracket 3) on the same shows was in slots mode and unaffected.
- **Effect:** on every show the Casual pick sheet rendered only the "Lock 'em in" button with no pick rows, and The Rules card below it was empty (title only).
- **Repair:** the dev pressed Save rules on league 2's Casual on 2026-10-26, which wrote the ladder the admin panel was displaying. No picks had ever been keyed `rank1`…`rankN` for that bracket (the sheet had never rendered a row), so nothing was orphaned.

## Why the render came out empty

- `slotDefs` returns early in ranked mode with one row per ladder value (`src/features/picks.js:169`). An empty ladder returns an empty array before any slot or flat logic runs, so the sheet template drew the header, the revert link, no rows, and the save button.
- The Rules builder returns `[]` for an empty ladder in ranked mode (`picks.js:244`); Casual's `custom_rules` was empty, so no House rules; the slots-mode footnote is suppressed in ranked mode. Title only.

## Cause — reachable through the panel's normal flow, no error anywhere

- `brackets.config` has one writer, `admin_update_config`, a whole-object replace. Two client paths feed it.
- `saveMasterSwitch` spreads `state.cfg` and writes the new `mode`. Switching to ranked carried the stored ladder through unchanged — and the stored ladder was `[]`.
- Why `[]` was stored at all: league creation seeds no `ranked` key, and a slots-mode Save rules (`saveConfig`) materialises `ranked: { ladder: [] }` through its "editor not rendered" fallback. Both of league 2's brackets carried that value, which is the fingerprint of a Save rules press on each while in slots mode. Harmless while the mode is slots.
- The ranked rules region previewed the DEFAULT ladder (5, 4, 3, 2, 1) when the stored one was empty — display only, by design and by the comment on `DEFAULT_RANKED_LADDER`. So the admin flipped the master switch to ranked, saw a populated ladder, and had no reason to press Save rules. Mode ranked + ladder empty landed in the database with no warning from either save.

## Not a regression

- Read-only check 2026-10-26: no commit since 2026-10-24 on `picks.js`, `slotTypes.js`, `admin.js`, `switcher.js` or `session.js` added or removed a line touching `ladder`, `ranked`, `mode`, `state.cfg`, `loadConfig` or `admin_update_config` — only comment text. The edge function never writes `brackets.config`. The master switch has offered ranked mode since `RANKED_CHOICE_ENABLED` went true.

## Why the suite never saw it

- `runRankedChoiceScenario` builds on `makeRankedFixtures`, which stores a five-value ladder from the start. The empty-ladder state was never exercised — the missing empty-set case in the testing rules' terms (`docs/decisions/testing-harness.md`: a set-valued computation needs a case where the set is empty). `slotDefs` is that computation.

## Decisions taken from it

Recorded and LOCKED 2026-10-26 in `docs/decisions/admin-panel.md` → the save-split entry: a server gate in `admin_update_config`; the master switch writing mode and ladder in one write; a render guard on the sheet and an unsaved-default flag in the admin region; and the two empty-set tests.
