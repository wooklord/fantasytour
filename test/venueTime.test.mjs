// Fixture-based unit tests for the pure venue-local time helpers
// (src/core/venueTime.js). Plain Node, no DOM/Supabase — same isolation as
// test/scoring.test.mjs and test/tiebreak.test.mjs. Uses fixed HISTORICAL
// dates (real, known US DST transition dates), not "now" — these are facts
// about the calendar, not something that drifts like a lock/cutoff fixture
// would.
//
//   node test/venueTime.test.mjs

import {
  venueLocalInputValue, venueLocalToUTC, venueLocalTimeDisplay, venueAbbrev, hasDstTransition,
} from "../src/core/venueTime.js";

const failures = [];
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) failures.push(`${label}\n  expected: ${e}\n  actual:   ${a}`);
}

// =================================================================
// 1. UTC -> venue-local wall clock and display, DST-correct abbreviation.
// =================================================================
{
  const summer = "2026-08-02T01:00:00.000Z"; // 2026-08-01 6:00 PM PDT
  check("summer UTC->venue-local wall clock (PDT, UTC-7)",
    venueLocalInputValue(summer, "America/Los_Angeles"), "2026-08-01T18:00");
  check("summer time display", venueLocalTimeDisplay(summer, "America/Los_Angeles"), "6:00 PM");
  check("summer abbreviation is PDT, not PST", venueAbbrev(summer, "America/Los_Angeles"), "PDT");

  const winter = "2026-01-02T02:00:00.000Z"; // 2026-01-01 6:00 PM PST
  check("winter UTC->venue-local wall clock (PST, UTC-8)",
    venueLocalInputValue(winter, "America/Los_Angeles"), "2026-01-01T18:00");
  check("winter abbreviation is PST, not PDT", venueAbbrev(winter, "America/Los_Angeles"), "PST");
}

// =================================================================
// 2. Venue-local wall clock -> UTC round-trips back through
//    venueLocalInputValue to the same numbers the admin typed.
// =================================================================
{
  const iso = venueLocalToUTC("2026-08-01T18:00", "America/Los_Angeles");
  check("venue-local->UTC round-trips to the same wall clock",
    venueLocalInputValue(iso, "America/Los_Angeles"), "2026-08-01T18:00");
}

// =================================================================
// 3. A zone with no DST at all (Arizona) never flags a transition and
//    never changes abbreviation between a summer and winter date.
// =================================================================
{
  check("no-DST zone: never a transition (summer date)",
    hasDstTransition("2026-08-01T18:00", "America/Phoenix"), false);
  check("no-DST zone: never a transition (winter date)",
    hasDstTransition("2026-01-01T18:00", "America/Phoenix"), false);
  check("no-DST zone: same abbreviation year-round",
    venueAbbrev("2026-08-02T01:00:00.000Z", "America/Phoenix"),
    venueAbbrev("2026-01-02T02:00:00.000Z", "America/Phoenix"));
}

// =================================================================
// 4. Real, known US DST transition dates are detected generically (via
//    offset comparison, not a hardcoded "2nd Sunday of March" rule) — and
//    the days immediately adjacent are correctly NOT flagged.
// =================================================================
{
  check("2024 US spring-forward date IS detected",
    hasDstTransition("2024-03-10T12:00", "America/New_York"), true);
  check("the day before spring-forward is NOT flagged",
    hasDstTransition("2024-03-09T12:00", "America/New_York"), false);
  check("the day after spring-forward is NOT flagged",
    hasDstTransition("2024-03-11T12:00", "America/New_York"), false);
  check("2024 US fall-back date IS detected",
    hasDstTransition("2024-11-03T12:00", "America/New_York"), true);
  check("the day before fall-back is NOT flagged",
    hasDstTransition("2024-11-02T12:00", "America/New_York"), false);
}

// ---------------------------------------------------------------
if (failures.length) {
  console.log(`FAIL — ${failures.length} check(s):`);
  for (const f of failures) console.log("  " + f.replace(/\n/g, "\n  "));
  process.exit(1);
} else {
  console.log("PASS — all venueTime.js fixture checks passed.");
  process.exit(0);
}
