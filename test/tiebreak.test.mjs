// Fixture-based unit tests for the pure season-standings/tiebreaker module
// (src/core/tiebreak.js). Plain Node, no DOM/Supabase — same isolation as
// test/scoring.test.mjs.
//
//   node test/tiebreak.test.mjs

import { computeStandings, rankStandings, groupTies, ordinal, layerDisplayValue, TIEBREAK_LABELS } from "../src/core/tiebreak.js";

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

  check("pA career sums every FINAL row regardless of season scope", T.pA.career, 5);
  check("pA scoped sums only in-season rows", T.pA.scoped, 5);
  check("pA zeros: explicit 0 (show2) + missing row (show3), show4 excluded (not final), show5 excluded (before season)", T.pA.zeros, 2);

  check("pB career includes the out-of-scope row", T.pB.career, 9);
  check("pB scoped excludes the out-of-scope row", T.pB.scoped, 0);
  check("pB zeros: only show3 counts — show1/show2 predate pB's roster join", T.pB.zeros, 1);
}

// =================================================================
// 1b. computeStandings: a row for a not-yet-final show never counts, in
//     either scope — the board must not shift while a show is still
//     live-scoring. Also: once that same show flips to final, its row
//     counts normally, and if it's reopened (flips back off final), it
//     drops back out again — exactly the shape a real reopen produces
//     (league_shows.status reverts, and the edge function separately
//     wipes the scores rows, but this proves the status check alone is
//     already sufficient even if a stale row somehow survived).
// =================================================================
{
  const season = { start_date: "2026-06-01", end_date: "2026-08-31" };
  const scoreRows = [{ player_id: "p1", show_id: "show1", points: 5 }];

  const live = computeStandings({ scoreRows, showsById: { show1: { showdate: "2026-06-05", status: "live" } }, season });
  check("a live (not-yet-final) show's row counts toward nothing at all", live.p1, undefined);

  const final = computeStandings({ scoreRows, showsById: { show1: { showdate: "2026-06-05", status: "final" } }, season });
  check("the identical row counts normally once the show is final", [final.p1.career, final.p1.scoped, final.p1.shows], [5, 5, 1]);

  const reopened = computeStandings({ scoreRows, showsById: { show1: { showdate: "2026-06-05", status: "live" } }, season });
  check("flipping the same show back off final (a reopen) drops it back out", reopened.p1, undefined);
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
  // Explicit, not just inferred from resolvedBy: a player at a unique
  // score carries NO layers at all — the row should never render a
  // tiebreak label for someone who was never actually tied with anyone.
  check("distinct scores carry zero tiebreak layers", order.map(o => o.layers), [[], []]);
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
//    (wins) resolves cleanly; within {p3,p4}, wins ties too (2 vs 2), and
//    highest-single-show ties too (20 vs 20) — neither layer splits them,
//    so neither is recorded, and the stack exhausts with them sharing a
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

  // Cumulative per-layer labels: p1/p2 both carry fewest_zeros (the layer
  // that grouped them together before most_wins split them) — a player
  // never carries a layer entry their group wasn't actually subjected to.
  check("p1 carries both layers it was measured on, with its OWN values", byId.p1.layers, [{ layer: "fewest_zeros", value: 0 }, { layer: "most_wins", value: 3 }]);
  check("p2 carries the same two layers, its own (losing) values", byId.p2.layers, [{ layer: "fewest_zeros", value: 0 }, { layer: "most_wins", value: 1 }]);
  // p3/p4 exhaust the stack, but most_wins (2 vs 2) and highest_single_show
  // (20 vs 20) never actually split them — a layer that leaves the whole
  // group in one bucket explained nothing, so only fewest_zeros (which DID
  // split the original 4-way group into {p1,p2}/{p3,p4}) is recorded.
  check("p3 carries only the layer that actually split something (fewest_zeros) — most_wins/highest_single_show resolved nothing and are omitted", byId.p3.layers, [{ layer: "fewest_zeros", value: 1 }]);
  check("p4 carries the identical (short) layer history", byId.p4.layers, byId.p3.layers);
}

// =================================================================
// 5b. Real-world regression: the exact 3-way tie from the retroactive
//     dry-run against the just-ended "Test" season (Budman/Kobeybeef/
//     WookLord, all 2 pts). Locks in the literal expected output the dev
//     specified after seeing the "looks like a badge" problem with a
//     single resolvedBy label: labels must be cumulative down the stack,
//     with each player's OWN value, and a player who broke free at layer 1
//     (Budman, on zeros) must NOT carry a layer-2 (wins) entry — he was
//     never measured on it.
// =================================================================
{
  const players = {
    budman: { scoped: 2, zeros: 1, wins: 0, high: 1 },
    kobeybeef: { scoped: 2, zeros: 2, wins: 1, high: 2 },
    wooklord: { scoped: 2, zeros: 2, wins: 0, high: 2 },
  };
  const stack = ["fewest_zeros", "most_wins", "highest_single_show"];
  const order = rankStandings(players, p => p.scoped, stack);
  const byId = Object.fromEntries(order.map(o => [o.id, o]));

  check("Budman resolves at layer 1 (fewest zeros) — no wins entry at all", byId.budman.layers, [{ layer: "fewest_zeros", value: 1 }]);
  check("Budman ranks ahead of the other two", byId.budman.rank, 1);
  check("Kobeybeef: tied on zeros with WookLord, then separated by wins — both layers shown", byId.kobeybeef.layers, [{ layer: "fewest_zeros", value: 2 }, { layer: "most_wins", value: 1 }]);
  check("WookLord: same two layers, its own (losing) wins value — not a bare demotion", byId.wooklord.layers, [{ layer: "fewest_zeros", value: 2 }, { layer: "most_wins", value: 0 }]);
  check("Kobeybeef ranks ahead of WookLord", byId.kobeybeef.rank < byId.wooklord.rank, true);
}

// =================================================================
// 5c. The exact noise the dev flagged: a 6-way tie at 1 point where every
//     layer is identical across the whole group (zeros, wins, high all
//     tied for all six) — the stack exhausts without splitting anyone
//     even once. Every layer resolved nothing, so none are recorded:
//     layers must be [], not three redundant "(0)"/"(0)"/"(1)" lines.
// =================================================================
{
  const players = Object.fromEntries(["a","b","c","d","e","f"].map(id =>
    [id, { scoped: 1, zeros: 0, wins: 0, high: 1 }]));
  const stack = ["fewest_zeros", "most_wins", "highest_single_show"];
  const order = rankStandings(players, p => p.scoped, stack);
  check("all six share rank 1, tied, unresolved",
    order.map(o => [o.rank, o.tied, o.resolvedBy]),
    order.map(() => [1, true, null]));
  check("no layer split anyone, so every player carries zero labels — not one redundant line per layer",
    order.map(o => o.layers), order.map(() => []));
}

// =================================================================
// 6. TIEBREAK_LABELS covers every layer rankStandings can return.
// =================================================================
{
  check("labels exist for all three layers", Object.keys(TIEBREAK_LABELS).sort(),
    ["fewest_zeros", "highest_single_show", "most_wins"].sort());
}

// =================================================================
// 5. groupTies / ordinal / layerDisplayValue — the standings board's tie
//    groups (docs/decisions/standings-ux.md item 5). Inputs are
//    rankStandings-shaped rows built by hand so each case pins ONE
//    property of the grouping instead of re-deriving ranks; one case at
//    the end goes through rankStandings itself. Invented ids, no names.
// =================================================================
{
  const row = (id, rank, points, layers = []) => ({ id, rank, points, tied: false, resolvedBy: null, layers });
  const fz = v => ({ layer: "fewest_zeros", value: v });
  const mw = v => ({ layer: "most_wins", value: v });

  // Grouped by POINTS, not rank: a layer-resolved pair has ranks 1 and 2
  // and is still one tie. The singleton at 4 points is left out.
  check("groupTies: a layer-resolved pair is ONE group keyed on points, carrying both ranks, decided by the splitting layer",
    groupTies([row("a", 1, 5, [fz(0)]), row("b", 2, 5, [fz(1)]), row("c", 3, 4)], ["fewest_zeros"]),
    [{ key: "5-1", members: [{ id: "a", rank: 1, layers: [fz(0)] }, { id: "b", rank: 2, layers: [fz(1)] }], place: 1, deciding: "fewest_zeros", shared: false }]);
  check("groupTies: an empty stack gives a shared group (Casual / All time), members with empty layers",
    groupTies([row("a", 1, 5), row("b", 1, 5)], []),
    [{ key: "5-1", members: [{ id: "a", rank: 1, layers: [] }, { id: "b", rank: 1, layers: [] }], place: 1, deciding: null, shared: true }]);
  // Amendment 2026-10-26: each member carries ITS OWN path, not the
  // group's union — the player split off at layer 1 has no layer-2 entry.
  check("groupTies: members carry their own rankStandings layers, passed through unchanged (the layer-1 escapee has no layer-2 entry)",
    groupTies([row("a", 1, 5, [fz(0)]), row("b", 2, 5, [fz(1), mw(2)]), row("c", 3, 5, [fz(1), mw(1)])], ["fewest_zeros", "most_wins"])[0]?.members.map(m => m.layers),
    [[fz(0)], [fz(1), mw(2)], [fz(1), mw(1)]]);
  check("groupTies: a configured stack that never split anything is shared, not decided",
    groupTies([row("a", 1, 5), row("b", 1, 5)], ["most_wins"])[0]?.shared, true);
  // Partial split (decision 1): one group, one tag; the shared pair shows
  // only by its equal ranks.
  const three = groupTies([row("a", 1, 5, [fz(0)]), row("b", 2, 5, [fz(1)]), row("c", 2, 5, [fz(1)])], ["fewest_zeros", "most_wins"]);
  check("groupTies: a partial split is ONE group decided by the splitting layer; the still-shared pair is visible only by equal ranks",
    [three.length, three[0].deciding, three[0].members.map(m => m.rank)], [1, "fewest_zeros", [1, 2, 2]]);
  // Deciding = the FIRST configured layer any member carries, not the last.
  check("groupTies: deciding is the FIRST configured layer present (fewest_zeros) even though most_wins also split a sub-group",
    groupTies([row("a", 1, 5, [fz(0), mw(2)]), row("b", 2, 5, [fz(0), mw(1)]), row("c", 3, 5, [fz(1)])], ["fewest_zeros", "most_wins"])[0]?.deciding,
    "fewest_zeros");
  check("groupTies: a configured layer that split nothing is skipped — the deciding layer is the first that DID",
    groupTies([row("a", 1, 5, [mw(2)]), row("b", 2, 5, [mw(1)])], ["fewest_zeros", "most_wins"])[0]?.deciding, "most_wins");
  check("groupTies: two groups on one board get distinct keys; the singleton between them is not grouped",
    groupTies([row("a", 1, 5, [fz(0)]), row("b", 2, 5, [fz(1)]), row("c", 3, 4), row("d", 4, 3), row("e", 4, 3)], ["fewest_zeros"])
      .map(g => [g.key, g.members.map(m => m.id), g.place, g.shared]),
    [["5-1", ["a", "b"], 1, false], ["3-4", ["d", "e"], 4, true]]);
  // Empty set: the upper bound. Distinct points must produce NOTHING.
  check("groupTies empty-set: distinct points → no groups", groupTies([row("a", 1, 5), row("b", 2, 4), row("c", 3, 3)], ["fewest_zeros"]), []);
  check("groupTies empty-set: empty board → no groups", groupTies([], ["fewest_zeros"]), []);
  // Through rankStandings itself.
  const players = { a: { scoped: 5, zeros: 0, wins: 1, high: 4 }, b: { scoped: 5, zeros: 1, wins: 1, high: 5 } };
  check("groupTies on rankStandings output: a resolved by fewest_zeros, ranks 1 and 2, one group",
    groupTies(rankStandings(players, p => p.scoped, ["fewest_zeros"]), ["fewest_zeros"]).map(g => [g.deciding, g.members.map(m => `${m.id}:${m.rank}`)]),
    [["fewest_zeros", ["a:1", "b:2"]]]);
  check("layerDisplayValue reads natural units (zeros as a count, not the negated sort key)",
    [layerDisplayValue(players.b, "fewest_zeros"), layerDisplayValue(players.b, "most_wins"), layerDisplayValue(players.b, "highest_single_show")], [1, 1, 5]);
  check("ordinal: 1st 2nd 3rd 4th, the 11–13 exception, and the 21st/101st family",
    [1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101, 111, 112, 113].map(ordinal),
    ["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "23rd", "101st", "111th", "112th", "113th"]);
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
