// Unit tests for the vet-first badge count (src/core/signups.js): the
// window boundary, clock skew, the pre-Stage-W row shape, the empty case
// and the cap; then decision 8's snooze ("Clear all"). Plain Node, no DOM.
// Wired into npm test. Record: docs/decisions/onboarding.md, decisions 7
// and 8.
//
//   node test/signups.test.mjs

import { countRecent, isRecent, isNew, isSnoozed, badgeText } from "../src/core/signups.js";
import { NEW_SIGNUP_DAYS, SIGNUP_SNOOZE_DAYS } from "../src/core/config.js";

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

// ---------- decision 8 (D2): the snooze ----------
const sopts = { ...opts, snoozeDays: SIGNUP_SNOOZE_DAYS };
const iso = ms => new Date(ms).toISOString();
const row = (createdMs, clearedMs) => ({ created_at: iso(createdMs), cleared_at: clearedMs == null ? null : iso(clearedMs) });
const C = NOW - 3 * DAY;   // a clear three days ago
check("decision 8a: the snooze is 7 days", SIGNUP_SNOOZE_DAYS, 7);
check("never cleared (cleared_at null) and the pre-Stage-X shape (no cleared_at) snooze nothing",
  [countRecent([row(NOW - DAY, null)], sopts).n, countRecent([at(NOW - DAY)], sopts).n], [1, 1]);
check("a clear covers registrations before it and exactly at it; one millisecond after it is new",
  [isNew(row(C - DAY, C), sopts), isNew(row(C, C), sopts), isNew(row(C + 1, C), sopts)], [false, false, true]);
check("the snooze ends exactly SIGNUP_SNOOZE_DAYS after the clear: a millisecond short it holds, at the mark the row is new again",
  [isNew(row(NOW - 10 * DAY, NOW - 7 * DAY + 1), sopts), isNew(row(NOW - 10 * DAY, NOW - 7 * DAY), sopts)], [false, true]);
check("after the snooze ends, a cleared row that is now outside the 14-day window stays not new",
  isNew(row(NOW - 15 * DAY, NOW - 8 * DAY), sopts), false);
check("isSnoozed needs both dates to parse",
  [isSnoozed(null, iso(C), sopts), isSnoozed(iso(C - DAY), "junk", sopts), isSnoozed(iso(C - DAY), undefined, sopts), isSnoozed(iso(C - DAY), iso(C), sopts)],
  [false, false, false, true]);
check("while a snooze runs, the rows counted are a prefix of the newest-first list, so the cap rule stays exact: 49 after the clear plus 1 before it is 49, not saturated; 50 after it is saturated",
  (() => {
    const after = k => Array.from({ length: k }, (_, i) => row(NOW - i * 3600e3, C));
    const a = countRecent(after(49).concat([row(C - DAY, C)]), sopts), b = countRecent(after(50), sopts);
    return [a, badgeText(a), b, badgeText(b)];
  })(),
  [{ n: 49, saturated: false }, "49", { n: 50, saturated: true }, "50+"]);

if (failures.length) {
  console.log(`FAIL — ${failures.length} check(s):`);
  for (const f of failures) console.log("  " + f.replace(/\n/g, "\n  "));
  process.exit(1);
} else {
  console.log("PASS — all signups.js checks passed.");
  process.exit(0);
}
