// Unit tests for the pure show-sync module (supabase/functions/carton-sync/
// showSync.js). Plain Node — no Deno, no Supabase, no network, no DOM — the
// same isolation as test/scoring.test.mjs. Wired into `npm test` so it
// cannot go stale the way the scoring tests did.
//
//   node test/showSync.test.mjs
//
// Gate cases use FIXED instants, never Date.now(): a gate is a fact about a
// clock reading, and these particular readings (08:59 vs 09:00 ET, the two
// 2026 US DST transition days) are the ones the gate has to get right.

import { dailyGateDue, diffShows, cutoffPlan, appendFlag, easternDateOf, easternHourOf } from "../supabase/functions/carton-sync/showSync.js";

const failures = [];
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) failures.push(`${label}\n  expected: ${e}\n  actual:   ${a}`);
}

// ---------------------------------------------------------------
// Eastern helpers — the two primitives the gate is built on.
// ---------------------------------------------------------------
check("easternDateOf: 03:00Z on Jan 15 is still Jan 14 in Eastern", easternDateOf("2026-01-15T03:00:00Z"), "2026-01-14");
check("easternHourOf: 13:59Z in January is 08 ET", easternHourOf("2026-01-15T13:59:00Z"), 8);
check("easternHourOf: 14:00Z in January is 09 ET", easternHourOf("2026-01-15T14:00:00Z"), 9);
check("easternHourOf: midnight ET reads 0, never 24", easternHourOf("2026-01-15T05:00:00Z"), 0);
check("easternHourOf: 13:00Z in July (EDT) is 09 ET", easternHourOf("2026-07-15T13:00:00Z"), 9);

// ---------------------------------------------------------------
// dailyGateDue — every case from the plan, with injected `now`.
// January instants are EST (UTC-5): 14:00Z = 09:00 ET.
// ---------------------------------------------------------------
check("gate: 08:59 ET, never run → false",
  dailyGateDue({ ranAt: null, attemptedAt: null, now: "2026-01-15T13:59:00Z" }), false);
check("gate: 09:00 ET, never run → true",
  dailyGateDue({ ranAt: null, attemptedAt: null, now: "2026-01-15T14:00:00Z" }), true);
check("gate: ran today 09:00, now 15:00 → false",
  dailyGateDue({ ranAt: "2026-01-15T14:00:30Z", attemptedAt: "2026-01-15T14:00:00Z", now: "2026-01-15T20:00:00Z" }), false);
check("gate: ran yesterday 09:00, now 09:00 → true",
  dailyGateDue({ ranAt: "2026-01-14T14:00:00Z", attemptedAt: "2026-01-14T14:00:00Z", now: "2026-01-15T14:00:00Z" }), true);
check("gate: failed attempt 10 min ago (ran_at still yesterday) → false",
  dailyGateDue({ ranAt: "2026-01-14T14:00:00Z", attemptedAt: "2026-01-15T14:20:00Z", now: "2026-01-15T14:30:00Z" }), false);
check("gate: failed attempt exactly 30 min ago → false (more than 30 is the rule)",
  dailyGateDue({ ranAt: "2026-01-14T14:00:00Z", attemptedAt: "2026-01-15T14:00:00Z", now: "2026-01-15T14:30:00Z" }), false);
check("gate: failed attempt 31 min ago → true",
  dailyGateDue({ ranAt: "2026-01-14T14:00:00Z", attemptedAt: "2026-01-15T13:59:00Z", now: "2026-01-15T14:30:00Z" }), true);
check("gate: first-ever failed attempt 10 min ago, no ran_at at all → false",
  dailyGateDue({ ranAt: null, attemptedAt: "2026-01-15T14:20:00Z", now: "2026-01-15T14:30:00Z" }), false);
check("gate: before 09:00 ET even though yesterday's run is old → false (hour gate comes first)",
  dailyGateDue({ ranAt: "2026-01-14T14:00:00Z", attemptedAt: "2026-01-14T14:00:00Z", now: "2026-01-15T12:00:00Z" }), false);

// Calendar-date comparison must be Eastern on both sides. Two mirror cases:
// (a) the UTC date has rolled but the Eastern date has not — a UTC compare
//     would wrongly say "not run today" and run twice;
// (b) the UTC date is the same but the Eastern date differs (the Sync shows
//     button pressed at 22:00 ET yesterday) — a UTC compare would wrongly
//     say "already ran today" and skip.
check("gate: ran 09:00 ET, now 22:00 ET same Eastern day (UTC date already tomorrow) → false",
  dailyGateDue({ ranAt: "2026-01-15T14:00:00Z", attemptedAt: "2026-01-15T14:00:00Z", now: "2026-01-16T03:00:00Z" }), false);
check("gate: button-run at 22:00 ET yesterday (same UTC date as now), now 09:00 ET → true",
  dailyGateDue({ ranAt: "2026-01-15T03:00:00Z", attemptedAt: null, now: "2026-01-15T14:00:00Z" }), true);

// DST transition days (US 2026: spring forward Mar 8, fall back Nov 1).
// On each, a run in the morning and a check at 22:00 ET must read as the
// same Eastern day even though the UTC date has rolled.
check("gate: DST fall-back day (Nov 1) — ran 09:00 EST, now 22:00 EST (03:00Z next day) → false",
  dailyGateDue({ ranAt: "2026-11-01T14:00:00Z", attemptedAt: "2026-11-01T14:00:00Z", now: "2026-11-02T03:00:00Z" }), false);
check("gate: DST fall-back day — next morning 09:00 EST → true",
  dailyGateDue({ ranAt: "2026-11-01T14:00:00Z", attemptedAt: "2026-11-01T14:00:00Z", now: "2026-11-02T14:00:00Z" }), true);
check("gate: DST spring-forward day (Mar 8) — ran 10:00 EDT, now 22:30 EDT (02:30Z next day) → false",
  dailyGateDue({ ranAt: "2026-03-08T14:00:00Z", attemptedAt: "2026-03-08T14:00:00Z", now: "2026-03-09T02:30:00Z" }), false);
check("gate: DST spring-forward day — 09:00 EDT is 13:00Z, and that opens the gate",
  dailyGateDue({ ranAt: "2026-03-07T14:00:00Z", attemptedAt: "2026-03-07T14:00:00Z", now: "2026-03-08T13:00:00Z" }), true);
check("gate: accepts Date objects as well as ISO strings",
  dailyGateDue({ ranAt: new Date("2026-01-14T14:00:00Z"), attemptedAt: null, now: new Date("2026-01-15T14:00:00Z") }), true);

// ---------------------------------------------------------------
// diffShows — one fixture exercising every branch at once, then an
// empty-set case (the set-valued-computation rule from testing-harness.md:
// non-empty cases bound what must be present; only the empty case bounds
// what must NOT be).
// ---------------------------------------------------------------
const today = "2026-11-10";
const existing = [
  { id: 100, showdate: "2026-11-20", venue: "Venue A", city: "City A", state: "NY", permalink: "a", timezone: "America/New_York", sync_flag: null },
  { id: 101, showdate: "2026-11-21", venue: "Venue B", city: "City B", state: "NY", permalink: "b", timezone: "America/New_York", sync_flag: null },
  { id: 102, showdate: "2026-11-22", venue: "Venue C", city: "City C", state: "PA", permalink: "c", timezone: "America/New_York", sync_flag: null },
  { id: 103, showdate: "2026-11-25", venue: "Venue D", city: "City D", state: "NY", permalink: "d", timezone: "America/New_York", sync_flag: null },
  { id: 104, showdate: "2026-10-01", venue: "Old Venue", city: "Old City", state: "NY", permalink: "o", timezone: "America/New_York", sync_flag: null },
  { id: 105, showdate: "2026-11-26", venue: "Venue E", city: "City E", state: "NY", permalink: "e", timezone: "America/New_York", sync_flag: null },
  { id: 106, showdate: "2026-11-27", venue: "Venue F", city: "City F", state: "NY", permalink: "f-old", timezone: "America/New_York", sync_flag: null },
  { id: 107, showdate: "2026-11-28", venue: "Venue G", city: "City G", state: "NY", permalink: "g-old", timezone: null, sync_flag: null },
  { id: 109, showdate: "2026-11-29", venue: "Venue H ", city: "City H", state: "NY", permalink: "h", timezone: "America/New_York", sync_flag: null },
];
const incoming = [
  { id: 100, showdate: "2026-11-20", venue: "Venue A", city: "City A", state: "NY", permalink: "a", timezone: "America/New_York" },
  { id: 101, showdate: "2026-11-22", venue: "Venue B", city: "City B", state: "NY", permalink: "b", timezone: "America/New_York" }, // date moved, non-final
  { id: 102, showdate: "2026-11-23", venue: "Venue C", city: "City C", state: "PA", permalink: "c", timezone: "America/New_York" }, // date moved, FINAL in one league
  { id: 203, showdate: "2026-11-25", venue: "Venue D", city: "City D", state: "NY", permalink: "d2", timezone: "America/New_York" }, // re-create of 103 under a new id
  { id: 106, showdate: "2026-11-27", venue: "Venue F", city: "City F", state: "NY", permalink: "f-new", timezone: "America/New_York" }, // final, only permalink differs
  { id: 107, showdate: "2026-11-28", venue: "Venue G", city: "City G", state: "NY", permalink: "g-new", timezone: "America/New_York" }, // non-final, carried fields only
  { id: 108, showdate: "2026-12-01", venue: "Venue I", city: "City I", state: "NY", permalink: "i", timezone: "America/New_York" }, // brand new
  { id: 109, showdate: "2026-11-29", venue: "Venue H", city: "City H", state: "NY", permalink: "h", timezone: "America/New_York" }, // whitespace-only difference
];
// 102 final in one league; 106 final in two. One entry per league_shows row.
const finalIds = [102, 106, 106];
const d = diffShows({ incoming, existing, finalIds, today });

check("diff: updates are exactly the non-final changed rows, in incoming order", d.updates.map((u) => u.id), [101, 107]);
check("diff: a date move on a non-final show lists showdate as changed with the old value",
  d.updates.find((u) => u.id === 101)?.changed, ["showdate"]);
check("diff: ... and carries the old value", d.updates.find((u) => u.id === 101)?.old, { showdate: "2026-11-21" });
check("diff: ... and the full new row to upsert", d.updates.find((u) => u.id === 101)?.row,
  { id: 101, showdate: "2026-11-22", venue: "Venue B", city: "City B", state: "NY", permalink: "b", timezone: "America/New_York" });
check("diff: permalink/timezone-only differences on a non-final row still rewrite it (carried fields), listed as changed",
  d.updates.find((u) => u.id === 107)?.changed, ["permalink", "timezone"]);
check("diff: a FINAL show with a date change is NOT updated", d.updates.some((u) => u.id === 102), false);
check("diff: ... it is flagged, naming the field, old → new, and the league count",
  d.flags.find((f) => f.id === 102)?.note, "Carton changed showdate (2026-11-22 → 2026-11-23); not applied — finalized in 1 league(s)");
check("diff: a final show whose only difference is a carried field is neither updated nor flagged",
  [d.updates.some((u) => u.id === 106), d.flags.some((f) => f.id === 106)], [false, false]);
check("diff: a whitespace-only venue difference is not a change", [d.updates.some((u) => u.id === 109), d.flags.some((f) => f.id === 109)], [false, false]);
check("diff: inserts are the rows with no existing id", d.inserts.map((r) => r.id), [203, 108]);
check("diff: vanished = existing rows dated today or later that Carton no longer returns",
  d.vanished.map((v) => v.id), [103, 105]);
check("diff: the past row missing from the window is NOT vanished (the floor)", d.vanished.some((v) => v.id === 104), false);
check("diff: ... and not flagged either", d.flags.some((f) => f.id === 104), false);
check("diff: a vanished show with a new-id twin (same date + venue) names it",
  d.vanished.find((v) => v.id === 103)?.recreatedAs, 203);
check("diff: ... in the flag text", d.flags.find((f) => f.id === 103)?.note,
  "Carton no longer returns this show (2026-11-25 · Venue D); not deleted — re-created on The Carton as show 203?");
check("diff: a vanished show with no twin is flagged without the re-create suffix",
  d.flags.find((f) => f.id === 105)?.note, "Carton no longer returns this show (2026-11-26 · Venue E); not deleted");
check("diff: ... and recreatedAs is null", d.vanished.find((v) => v.id === 105)?.recreatedAs, null);
check("diff: there is no delete list of any kind", Object.keys(d).sort(), ["flags", "inserts", "updates", "vanished"]);
check("diff: flags are exactly the final-changed row and the two vanished rows", d.flags.map((f) => f.id).sort(), [102, 103, 105]);

// Finalized in TWO leagues — the count comes from duplicate ids.
const d2 = diffShows({ incoming: [incoming[2]], existing: [existing[2]], finalIds: [102, 102], today });
check("diff: finalized in two leagues says so", d2.flags[0]?.note.endsWith("finalized in 2 league(s)"), true);
// Venue-only change, non-final.
const d3 = diffShows({ incoming: [{ ...incoming[0], venue: "Venue A (renamed)" }], existing: [existing[0]], finalIds: [], today });
check("diff: a venue-only change on a non-final show is an update with changed = [venue]", d3.updates[0]?.changed, ["venue"]);
check("diff: ... and no flag", d3.flags, []);
// Ids arrive as strings from some paths (Carton's show_id, PostgREST
// filters); they must still match.
const d4 = diffShows({ incoming: [{ ...incoming[0], id: "100" }], existing: [existing[0]], finalIds: ["100"], today });
check("diff: string ids match numeric ids", [d4.inserts.length, d4.updates.length, d4.flags.length, d4.vanished.length], [0, 0, 0, 0]);

// EMPTY SET: identical rows → nothing to write, flag, or post.
const sameRows = existing.filter((r) => r.showdate >= today).map(({ sync_flag, ...r }) => r);
const d0 = diffShows({ incoming: sameRows, existing: sameRows, finalIds: [100, 101], today });
check("diff empty-set: identical rows → no inserts", d0.inserts, []);
check("diff empty-set: identical rows → no updates (even for the final ones)", d0.updates, []);
check("diff empty-set: identical rows → no flags", d0.flags, []);
check("diff empty-set: identical rows → nothing vanished", d0.vanished, []);
check("diff empty-set: no incoming, no existing → all empty", diffShows({ incoming: [], existing: [], finalIds: [], today }),
  { inserts: [], updates: [], flags: [], vanished: [] });

// ---------------------------------------------------------------
// appendFlag — the "don't re-add yesterday's note" rule.
// ---------------------------------------------------------------
check("appendFlag: onto null", appendFlag(null, "first"), { text: "first", added: true });
check("appendFlag: a new note joins with the separator", appendFlag("first", "second"), { text: "first · second", added: true });
check("appendFlag: an identical note is not re-added", appendFlag("first · second", "second"), { text: "first · second", added: false });
check("appendFlag: a note that is a substring of an existing one is still new", appendFlag("first note", "first"), { text: "first note · first", added: true });

// ---------------------------------------------------------------
// cutoffPlan — defaultOf is injected; a simple stub standing in for
// venueCutoffISO (6 PM EST = 23:00Z). Stored cutoffs are written in the
// "+00:00" form Postgres actually returns, NOT the ".000Z" form the stub
// produces, so the equality must be by instant.
// ---------------------------------------------------------------
const defaultOf = (showdate) => `${showdate}T23:00:00.000Z`;
const oldShow = { id: 101, showdate: "2026-11-21", state: "NY" };
const newShow = { id: 101, showdate: "2026-11-22", state: "NY" };
const before = "2026-11-10T15:00:00Z"; // the new cutoff is still ahead
const after = "2026-12-01T15:00:00Z";  // the new cutoff has passed

const ovDerived = { league_id: 1, show_id: 101, cutoff_at: "2026-11-21T23:00:00+00:00", cutoff_set_by_admin: false, remind_sent: null, lock_sent: null };
check("cutoff: flag false → recompute to the NEW date's default, stamps reset when it is in the future",
  cutoffPlan({ overlay: ovDerived, oldShow, newShow, defaultOf, now: before, leagueName: "Ambassadors" }),
  { kind: "recompute", cutoff_at: "2026-11-22T23:00:00.000Z", resetStamps: true });
check("cutoff: flag false, new cutoff already past → recompute, stamps NOT reset",
  cutoffPlan({ overlay: ovDerived, oldShow, newShow, defaultOf, now: after, leagueName: "Ambassadors" }),
  { kind: "recompute", cutoff_at: "2026-11-22T23:00:00.000Z", resetStamps: false });

const ovAdmin = { ...ovDerived, cutoff_at: "2026-11-21T20:00:00+00:00", cutoff_set_by_admin: true };
const keep = cutoffPlan({ overlay: ovAdmin, oldShow, newShow, defaultOf, now: before, leagueName: "Ambassadors" });
check("cutoff: flag true → keep", keep.kind, "keep");
check("cutoff: ... with a review note naming the move, the league and the kept cutoff",
  keep.note, "date moved 2026-11-21 → 2026-11-22; Ambassadors's admin-set cutoff left at Nov 21, 2026, 3:00 PM ET — review");
check("cutoff: flag true even when the stored value equals the OLD default → still keep (the flag wins)",
  cutoffPlan({ overlay: { ...ovDerived, cutoff_set_by_admin: true }, oldShow, newShow, defaultOf, now: before, leagueName: "L" }).kind, "keep");

// Rows predating the flag (null): derived iff stored == OLD date's default.
check("cutoff: null flag, stored equals the OLD default (Postgres +00:00 form) → derived → recompute",
  cutoffPlan({ overlay: { ...ovDerived, cutoff_set_by_admin: null }, oldShow, newShow, defaultOf, now: before, leagueName: "L" }),
  { kind: "recompute", cutoff_at: "2026-11-22T23:00:00.000Z", resetStamps: true });
check("cutoff: null flag, stored unequal to the old default → admin-set → keep",
  cutoffPlan({ overlay: { ...ovDerived, cutoff_at: "2026-11-21T20:00:00+00:00", cutoff_set_by_admin: null }, oldShow, newShow, defaultOf, now: before, leagueName: "L" }).kind,
  "keep");
check("cutoff: null flag, stored already equals the NEW default (moved by hand) → keep, not recompute",
  cutoffPlan({ overlay: { ...ovDerived, cutoff_at: "2026-11-22T23:00:00+00:00", cutoff_set_by_admin: null }, oldShow, newShow, defaultOf, now: before, leagueName: "L" }).kind,
  "keep");
check("cutoff: null flag, null cutoff → derived (nobody set it) → recompute",
  cutoffPlan({ overlay: { ...ovDerived, cutoff_at: null, cutoff_set_by_admin: null }, oldShow, newShow, defaultOf, now: before, leagueName: "L" }).kind,
  "recompute");
check("cutoff: undefined flag (column absent from the row) behaves as null",
  cutoffPlan({ overlay: { league_id: 1, show_id: 101, cutoff_at: "2026-11-21T23:00:00+00:00" }, oldShow, newShow, defaultOf, now: before, leagueName: "L" }).kind,
  "recompute");
check("cutoff: the new default is computed with the NEW show's state",
  cutoffPlan({ overlay: ovDerived, oldShow, newShow: { ...newShow, state: "CA" }, defaultOf: (dt, st) => `${dt}T${st === "CA" ? "02" : "23"}:00:00.000Z`, now: before, leagueName: "L" }).cutoff_at,
  "2026-11-22T02:00:00.000Z");
check("cutoff: the old default is computed with the OLD show's state",
  cutoffPlan({ overlay: { ...ovDerived, cutoff_at: "2026-11-21T02:00:00+00:00", cutoff_set_by_admin: null }, oldShow: { ...oldShow, state: "CA" }, newShow,
    defaultOf: (dt, st) => `${dt}T${st === "CA" ? "02" : "23"}:00:00.000Z`, now: before, leagueName: "L" }).kind,
  "recompute");

// One post per league row: the caller iterates every league_shows row of
// the moved show and posts per `recompute`. Two leagues, both derived →
// exactly two plans, one per league, both recompute.
const overlays = [
  { league_id: 1, show_id: 101, cutoff_at: "2026-11-21T23:00:00+00:00", cutoff_set_by_admin: false },
  { league_id: 2, show_id: 101, cutoff_at: "2026-11-21T23:00:00+00:00", cutoff_set_by_admin: null },
];
const plans = overlays.map((ov) => ({ league_id: ov.league_id, ...cutoffPlan({ overlay: ov, oldShow, newShow, defaultOf, now: before, leagueName: `L${ov.league_id}` }) }));
check("cutoff: two derived league rows → two recompute plans, one per league",
  plans.map((p) => [p.league_id, p.kind]), [[1, "recompute"], [2, "recompute"]]);
const mixed = [overlays[0], { ...overlays[1], cutoff_set_by_admin: true }]
  .map((ov) => ({ league_id: ov.league_id, ...cutoffPlan({ overlay: ov, oldShow, newShow, defaultOf, now: before, leagueName: `L${ov.league_id}` }) }));
check("cutoff: one derived + one admin-set → one recompute (a post) and one keep (a flag), each for its own league",
  mixed.map((p) => [p.league_id, p.kind]), [[1, "recompute"], [2, "keep"]]);

// ---------------------------------------------------------------
if (failures.length) {
  console.log(`FAIL — ${failures.length} check(s):`);
  for (const f of failures) console.log("  " + f.replace(/\n/g, "\n  "));
  process.exit(1);
} else {
  console.log("PASS — all showSync.js checks passed.");
  process.exit(0);
}
