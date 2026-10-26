// Unit tests for the pure Stats-table module (src/core/stats.js). Plain
// Node, no DOM — same isolation as tiebreak.test.mjs. Wired into npm test.
//
//   node test/stats.test.mjs
//
// Invented ids and names only.

import { STAT_COLS, DEFAULT_STATS_SORT, statValue, fmtStat, bestDir, flipDir, sortStats, parseStatsSort, formatStatsSort, statLeaders } from "../src/core/stats.js";

const failures = [];
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) failures.push(`${label}\n  expected: ${e}\n  actual:   ${a}`);
}

const T = (shows, scoped, high, zeros, wins) => ({ career: scoped, scoped, shows, high, highShow: null, wins, zeros });
// Names chosen so A–Z differs from id order and from every numeric order,
// and mixes case (a plain compare would sort "bravo" after "Zed").
const names = { a: "Zed", b: "alpha", c: "Mike", d: "bravo" };
const nameOf = id => names[id];
const rows = [
  ["a", T(3, 12, 6, 2, 1)],   // avg 4.0
  ["b", T(2, 10, 7, 0, 1)],   // avg 5.0
  ["c", T(4, 12, 5, 1, 2)],   // avg 3.0
  ["d", T(1,  5, 5, 1, 1)],   // avg 5.0 — ties b on avg, c/d on high, a/b/d on wins, c/d on zeros
];
const ids = r => r.map(x => x[0]);

// ---- directions ----
check("bestDir: shows/avg/high/wins descending, zeros ascending",
  ["shows", "avg", "high", "wins", "zeros"].map(bestDir), ["desc", "desc", "desc", "desc", "asc"]);
check("STAT_COLS has exactly the five numeric columns", Object.keys(STAT_COLS), ["shows", "avg", "high", "zeros", "wins"]);
check("flipDir", [flipDir("asc"), flipDir("desc")], ["desc", "asc"]);
check("default sort is avg best-first", DEFAULT_STATS_SORT, { col: "avg", dir: "desc" });

// ---- values + format ----
check("statValue avg is scoped/shows", statValue(T(4, 10, 0, 0, 0), "avg"), 2.5);
check("statValue avg of zero shows is 0, not NaN", statValue(T(0, 0, 0, 0, 0), "avg"), 0);
check("fmtStat: avg one decimal, others plain", [fmtStat("avg", 5), fmtStat("avg", 2.456), fmtStat("high", 7), fmtStat("zeros", 0)], ["5.0", "2.5", "7", "0"]);

// ---- sortStats: each column best-first ----
check("shows best-first: most shows lead", ids(sortStats(rows, "shows", bestDir("shows"), nameOf)), ["c", "a", "b", "d"]);
check("avg best-first: highest avg leads; the b/d tie at 5.0 falls to name A–Z (alpha before bravo)", ids(sortStats(rows, "avg", bestDir("avg"), nameOf)), ["b", "d", "a", "c"]);
check("high best-first: highest high leads; the c/d tie at 5 falls to name (bravo before Mike, case-insensitive)", ids(sortStats(rows, "high", bestDir("high"), nameOf)), ["b", "a", "d", "c"]);
check("wins best-first: most wins lead; the three-way tie at 1 is name order alpha, bravo, Zed", ids(sortStats(rows, "wins", bestDir("wins"), nameOf)), ["c", "b", "d", "a"]);
check("zeros best-first is ASCENDING: fewest zeros lead; the c/d tie at 1 falls to name", ids(sortStats(rows, "zeros", bestDir("zeros"), nameOf)), ["b", "d", "c", "a"]);
// ---- the flip ----
check("zeros flipped (desc): most zeros lead; ties still name A–Z", ids(sortStats(rows, "zeros", flipDir(bestDir("zeros")), nameOf)), ["a", "d", "c", "b"]);
check("avg flipped (asc): lowest avg leads; the 5.0 tie is still alpha before bravo (name order never flips)", ids(sortStats(rows, "avg", "asc", nameOf)), ["c", "a", "b", "d"]);
// ---- the name tiebreak, isolated ----
const allTied = [["a", T(1, 1, 1, 1, 1)], ["b", T(1, 1, 1, 1, 1)], ["c", T(1, 1, 1, 1, 1)], ["d", T(1, 1, 1, 1, 1)]];
check("all equal on every column → pure name order, case-insensitive (alpha, bravo, Mike, Zed)", ids(sortStats(allTied, "wins", "desc", nameOf)), ["b", "d", "c", "a"]);
check("sortStats returns a new array and leaves the input untouched", ids(rows), ["a", "b", "c", "d"]);
check("sortStats on an empty set is empty", sortStats([], "avg", "desc", nameOf), []);

// ---- persistence parsing ----
check("parseStatsSort: a valid value round-trips", parseStatsSort("zeros:asc"), { col: "zeros", dir: "asc" });
check("parseStatsSort: formatStatsSort is its inverse", formatStatsSort(parseStatsSort("wins:desc")), "wins:desc");
check("parseStatsSort: null → default", parseStatsSort(null), DEFAULT_STATS_SORT);
check("parseStatsSort: bogus column → default", parseStatsSort("bogus:asc"), DEFAULT_STATS_SORT);
check("parseStatsSort: bogus direction → default", parseStatsSort("avg:sideways"), DEFAULT_STATS_SORT);
check("parseStatsSort: an old bare value → default", parseStatsSort("avg"), DEFAULT_STATS_SORT);
check("parseStatsSort returns a fresh object (mutating it never alters the default)",
  (() => { const p = parseStatsSort(null); p.col = "zeros"; return DEFAULT_STATS_SORT.col; })(), "avg");

// ---- leaders ----
const L = statLeaders(rows, nameOf);
check("leaders: four entries in order avg, high, wins, zeros", L.map(l => l.key), ["avg", "high", "wins", "zeros"]);
check("leaders: Best avg 5.0 shared by b and d, ids in name order (alpha, bravo)", [L[0].label, L[0].value, L[0].ids], ["Best avg", 5, ["b", "d"]]);
check("leaders: High score 7 is b alone", [L[1].label, L[1].value, L[1].ids], ["High score", 7, ["b"]]);
check("leaders: Most wins 2 is c alone", [L[2].label, L[2].value, L[2].ids], ["Most wins", 2, ["c"]]);
check("leaders: Fewest zeros 0 is b alone", [L[3].label, L[3].value, L[3].ids], ["Fewest zeros", 0, ["b"]]);
check("leaders: a three-way tie lists all three in name order (the render shows the first and +2)",
  statLeaders(allTied, nameOf)[2].ids, ["b", "d", "c", "a"].slice(0, 4));
check("leaders: withZeros:false omits Fewest zeros (no season → zeros not computed)",
  statLeaders(rows, nameOf, { withZeros: false }).map(l => l.key), ["avg", "high", "wins"]);
check("leaders empty-set: no rows → no leaders", statLeaders([], nameOf), []);

// ---------------------------------------------------------------
if (failures.length) {
  console.log(`FAIL — ${failures.length} check(s):`);
  for (const f of failures) console.log("  " + f.replace(/\n/g, "\n  "));
  process.exit(1);
} else {
  console.log("PASS — all stats.js checks passed.");
  process.exit(0);
}
