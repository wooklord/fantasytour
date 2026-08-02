// Fixture-based unit tests for the pure season-standings/tiebreaker module
// (src/core/tiebreak.js). Plain Node, no DOM/Supabase — same isolation as
// test/scoring.test.mjs.
//
//   node test/tiebreak.test.mjs

import { computeStandings, rankStandings, TIEBREAK_LABELS } from "../src/core/tiebreak.js";

const failures = [];
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) failures.push(`${label}\n  expected: ${e}\n  actual:   ${a}`);
}

// =================================================================
// 1. computeStandings: zeros are scoped by roster join date, not season
//    start — a mid-season add doesn't eat zeros for shows before they
//    could even submit. Also: a missing score row is a zero exactly like
//    an explicit 0-point row; a non-final show is never a zero opportunity
//    either way; a show outside the season's own date range never counts.
// =================================================================
{
  const season = { start_date: "2026-06-01", end_date: "2026-08-31" };
  const showsById = {
    show1: { showdate: "2026-06-05", status: "final" },
    show2: { showdate: "2026-06-12", status: "final" },
    show3: { showdate: "2026-06-19", status: "final" },
    show4: { showdate: "2026-06-26", status: "live" },   // not final: never a zero opportunity
    show5: { showdate: "2026-05-20", status: "final" },  // before season start entirely
  };
  const rosterJoinDates = { pB: "2026-06-15" }; // pA falls back to season.start_date
  const scoreRows = [
    { player_id: "pA", show_id: "show1", points: 5 },
    { player_id: "pA", show_id: "show2", points: 0 }, // explicit zero
    // pA has no row at all for show3 — counts as a zero too
    { player_id: "pB", show_id: "show5", points: 9 }, // outside season range: counts toward career only
    // pB has no rows for show1/show2 (before their 06-15 join) or show3 (after join, in scope)
  ];
  const T = computeStandings({ scoreRows, showsById, season, rosterJoinDates });

  check("pA career sums every row regardless of season scope", T.pA.career, 5);
  check("pA scoped sums only in-season rows", T.pA.scoped, 5);
  check("pA zeros: explicit 0 (show2) + missing row (show3), show4 excluded (not final), show5 excluded (before season)", T.pA.zeros, 2);

  check("pB career includes the out-of-scope row", T.pB.career, 9);
  check("pB scoped excludes the out-of-scope row", T.pB.scoped, 0);
  check("pB zeros: only show3 counts — show1/show2 predate pB's roster join", T.pB.zeros, 1);
}

// =================================================================
// 2. computeStandings: wins share the crown on a per-show tie; highest
//    single-show tracks the actual show object for the tooltip.
// =================================================================
{
  const season = { start_date: "2026-06-01", end_date: "2026-08-31" };
  const showsById = { s1: { showdate: "2026-06-05", status: "final", venue: "The Barn" } };
  const scoreRows = [
    { player_id: "p1", show_id: "s1", points: 5 },
    { player_id: "p2", show_id: "s1", points: 5 },
    { player_id: "p3", show_id: "s1", points: 2 },
  ];
  const T = computeStandings({ scoreRows, showsById, season });
  check("tied top scorers both credited a win", [T.p1.wins, T.p2.wins, T.p3.wins], [1, 1, 0]);
  check("highest single-show carries the real show object", T.p1.highShow?.venue, "The Barn");
}

// =================================================================
// 3. rankStandings: distinct scores need no tiebreaker at all.
// =================================================================
{
  const players = { p1: { scoped: 10 }, p2: { scoped: 7 } };
  const order = rankStandings(players, p => p.scoped, ["fewest_zeros", "most_wins", "highest_single_show"]);
  check("distinct scores rank sequentially, untouched by tiebreakers",
    order.map(o => [o.id, o.rank, o.tied, o.resolvedBy]),
    [["p1", 1, false, null], ["p2", 2, false, null]]);
}

// =================================================================
// 4. rankStandings: empty stack means equal points share a placing —
//    not an arbitrary order (the bug this whole feature exists to fix).
// =================================================================
{
  const players = { p1: { scoped: 10, zeros: 0, wins: 3, high: 20 }, p2: { scoped: 10, zeros: 2, wins: 1, high: 5 } };
  const order = rankStandings(players, p => p.scoped, []);
  check("no configured tiebreakers: both share rank 1, tied, unresolved",
    order.map(o => [o.id, o.rank, o.tied, o.resolvedBy]).sort(),
    [["p1", 1, true, null], ["p2", 1, true, null]].sort());
}

// =================================================================
// 5. rankStandings: full recursive resolution across a 4-way tie —
//    layer 1 splits {p1,p2} from {p3,p4} on zeros; within {p1,p2}, layer 2
//    (wins) resolves cleanly; within {p3,p4}, wins ties too, and even
//    highest-single-show ties, so the stack exhausts and they share a
//    placing. Confirms competition-style rank numbering (1,2,3,3) — the
//    next rank after a shared pair skips ahead by the group size.
// =================================================================
{
  const players = {
    p1: { scoped: 10, zeros: 0, wins: 3, high: 20 },
    p2: { scoped: 10, zeros: 0, wins: 1, high: 15 },
    p3: { scoped: 10, zeros: 1, wins: 2, high: 20 },
    p4: { scoped: 10, zeros: 1, wins: 2, high: 20 },
  };
  const stack = ["fewest_zeros", "most_wins", "highest_single_show"];
  const order = rankStandings(players, p => p.scoped, stack);
  const byId = Object.fromEntries(order.map(o => [o.id, o]));
  check("p1 separated from p2 by most_wins (fewest_zeros tied them first)", [byId.p1.rank, byId.p1.tied, byId.p1.resolvedBy], [1, false, "most_wins"]);
  check("p2 likewise resolved by most_wins", [byId.p2.rank, byId.p2.tied, byId.p2.resolvedBy], [2, false, "most_wins"]);
  check("p3/p4 exhaust the whole stack (wins AND high both tied) — shared placing", [byId.p3.rank, byId.p3.tied, byId.p3.resolvedBy], [3, true, null]);
  check("p3/p4 share the same rank", byId.p3.rank, byId.p4.rank);
}

// =================================================================
// 6. TIEBREAK_LABELS covers every layer rankStandings can return.
// =================================================================
{
  check("labels exist for all three layers", Object.keys(TIEBREAK_LABELS).sort(),
    ["fewest_zeros", "highest_single_show", "most_wins"].sort());
}

// ---------------------------------------------------------------
if (failures.length) {
  console.log(`FAIL — ${failures.length} check(s):`);
  for (const f of failures) console.log("  " + f.replace(/\n/g, "\n  "));
  process.exit(1);
} else {
  console.log("PASS — all tiebreak.js fixture checks passed.");
  process.exit(0);
}
