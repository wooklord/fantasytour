// Unit tests for the vet-first badge count (src/core/signups.js): the
// window boundary, clock skew, the pre-Stage-W row shape, the empty case
// and the cap. Plain Node, no DOM. Wired into npm test. Record:
// docs/decisions/onboarding.md, decision 7.
//
//   node test/signups.test.mjs

import { countRecent, isRecent, badgeText } from "../src/core/signups.js";
import { NEW_SIGNUP_DAYS } from "../src/core/config.js";

const failures = [];
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) failures.push(`${label}\n  expected: ${e}\n  actual:   ${a}`);
}

const DAY = 864e5;
const NOW = Date.parse("2026-10-27T15:00:00Z");
const at = ms => ({ created_at: new Date(ms).toISOString() });
const opts = { nowMs: NOW, days: NEW_SIGNUP_DAYS };

check("decision 1: the window is 14 days", NEW_SIGNUP_DAYS, 14);
check("empty list, and a missing one: zero, not saturated",
  [countRecent([], opts), countRecent(null, opts), countRecent(undefined, opts)],
  [{ n: 0, saturated: false }, { n: 0, saturated: false }, { n: 0, saturated: false }]);
check("the boundary is inclusive: exactly 14 days ago counts, one millisecond more does not",
  [countRecent([at(NOW - 14 * DAY)], opts).n, countRecent([at(NOW - 14 * DAY - 1)], opts).n], [1, 0]);
check("clock skew: a created_at ahead of this device's clock counts as recent",
  countRecent([at(NOW + 3600e3)], opts).n, 1);
check("the pre-Stage-W shape (no created_at) and junk never count, so the old function shows no badge",
  countRecent([{ player_id: "a", name: "A" }, { created_at: null }, { created_at: "not a date" }, {}], opts).n, 0);
check("a date-only created_at parses (as UTC midnight)",
  [isRecent("2026-10-20", opts), isRecent("2026-10-01", opts)], [true, false]);
check("a mix: three inside the window, two outside",
  countRecent([at(NOW - DAY), at(NOW - 2 * DAY), at(NOW - 13 * DAY), at(NOW - 15 * DAY), at(NOW - 400 * DAY)], opts),
  { n: 3, saturated: false });
check("the cap: 50 rows all inside the window means there may be more: saturated, '50+'",
  (() => { const c = countRecent(Array.from({ length: 50 }, (_, i) => at(NOW - i * 3600e3)), opts); return [c, badgeText(c)]; })(),
  [{ n: 50, saturated: true }, "50+"]);
check("50 rows with one outside the window: exact, not saturated (the cap drops the OLDEST, so none inside is missing)",
  (() => { const rows = Array.from({ length: 49 }, (_, i) => at(NOW - i * 3600e3)).concat([at(NOW - 30 * DAY)]); const c = countRecent(rows, opts); return [c, badgeText(c)]; })(),
  [{ n: 49, saturated: false }, "49"]);
check("badgeText below the cap is the plain number", badgeText({ n: 3, saturated: false }), "3");

if (failures.length) {
  console.log(`FAIL — ${failures.length} check(s):`);
  for (const f of failures) console.log("  " + f.replace(/\n/g, "\n  "));
  process.exit(1);
} else {
  console.log("PASS — all signups.js checks passed.");
  process.exit(0);
}
