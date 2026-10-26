# 2026-10-26 — Empty ranked ladder, twice: Green Eggs Casual, then Ambassadors Official

> Historical record, written 2026-10-26 from a read-only diagnosis the same day; renamed from `2026-10-26-casual-empty-ladder.md` later that day when a second instance in a different league and bracket surfaced (see "Second instance" below). The decisions it produced are LOCKED in `docs/decisions/admin-panel.md` → "TWO SAVES WRITE `brackets.config`" (the entry that owns `admin_update_config` and both save paths), dated 2026-10-26, which points back here. `CLAUDE.md` is unchanged (at its size limit). No player nicknames here, per the standing rule in Conventions.

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

Recorded and LOCKED 2026-10-26 in `docs/decisions/admin-panel.md` → the save-split entry: a server gate in `admin_update_config`; the master switch writing mode and ladder in one write; a render guard on the sheet and an unsaved-default flag in the admin region; and the two empty-set tests. Built the same day (bundle `11227b3-6c0fb8c`); Stage V applied the same day.

## Second instance — Ambassadors Official (bracket 1), found by Stage V's own footer

- **Found 2026-10-26** by Stage V's verification step 4, the "state the gate prevents" query, run right after the stage was applied: bracket 1 (Ambassadors Official, league 1) had `mode: "ranked_choice"` with an empty ladder. Not an artefact of the footer's behaviour test: that ran against bracket 4 inside `begin … rollback` and persisted nothing.
- **Repair:** the dev restored bracket 1 to SLOTS mode in the app on 2026-10-26 — its original mode. Ranked with a ladder was not an option: bracket 1's stored picks are slot-keyed, and a ranked sheet would have stranded them (the orphaning `saveConfig` warns about). The last Ambassadors Official picks before the repair were dated 2026-09-04 — 12 picks, two players' worth — with none for any show since, so the sheet was empty for the whole October run.
- **What it adds to the cause:** the same flow reached the same state in a different league and a different bracket. Ambassadors Official is a slots-mode bracket by design (Module B shipped in Casual — `docs/decisions/scoring-modes.md`), so ranked mode there was itself not intended. The picks dates bound the window: the flip happened after 2026-09-04, and from then until the repair no Ambassadors Official pick could be entered, because the sheet had no rows.
- **Why it cannot recur:** Stage V's gate now refuses `ranked_choice` with an empty or missing ladder at the only writer, `admin_update_config`; the client writes mode and ladder together and warns on both surfaces. Footer steps 1–4 passed after the repair, step 4 returning no rows.
