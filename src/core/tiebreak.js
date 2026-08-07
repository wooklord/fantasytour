// Season standings aggregation + tiebreaker resolution — pure, no DOM/
// Supabase, mirroring the isolation of scoring.js (see test/tiebreak.test.mjs
// for fixture coverage). Exactly three tiebreaker layers exist by design;
// average was deliberately dropped — tied players already have equal totals,
// so a higher average just means fewer shows played, which rewards absence
// and fights the zeros layer.
export const TIEBREAK_LABELS = {
  fewest_zeros: "Fewest zeros",
  most_wins: "Most wins",
  highest_single_show: "Highest single-show score",
};

// Standings-row display only, where space is tight — the admin config
// picker keeps the fuller wording above.
export const TIEBREAK_SHORT_LABELS = {
  ...TIEBREAK_LABELS,
  highest_single_show: "High Score",
};

// scoreRows: [{player_id, show_id, points}] — every score row for the
// bracket, unfiltered (career needs everything; scoped/wins/high/zeros are
// filtered internally against `season`).
// showsById: { [show_id]: { showdate, status, ... } } — this league's shows,
// merged with the league_shows overlay (status/showdate).
// season: { start_date, end_date } | null — null means "All time": no
// scoping, no zeros (a zero only means something within a season's roster).
// rosterJoinDates: { [player_id]: 'YYYY-MM-DD' } — only consulted when
// `season` is set; missing entries fall back to the season's start_date.
// rosterIds: every player_id on the season's roster, only consulted when
// `season` is set — seeds an all-zero entry for a roster member with no
// scoreRows at all (opted in, never had a show finalize while eligible),
// so they land in standings at 0 instead of being invisible. All-time has
// no single "roster" (a player can move between seasons over time), so
// this is deliberately season-scoped, same as rosterJoinDates above.
export function computeStandings({ scoreRows, showsById, season, rosterJoinDates = {}, rosterIds = [] }){
  const inScope = row => {
    if (!season) return true;
    const sh = showsById[row.show_id];
    return !!sh && sh.showdate >= season.start_date && sh.showdate <= season.end_date;
  };
  const T = {};
  for (const row of scoreRows){
    const t = (T[row.player_id] ??= { career:0, scoped:0, shows:0, high:0, highShow:null, wins:0, zeros:0 });
    t.career += row.points;
    if (inScope(row)){
      t.scoped += row.points; t.shows++;
      if (row.points > t.high){ t.high = row.points; t.highShow = showsById[row.show_id] || null; }
    }
  }
  if (season) for (const id of rosterIds) T[id] ??= { career:0, scoped:0, shows:0, high:0, highShow:null, wins:0, zeros:0 };
  const byShow = {};
  for (const row of scoreRows) if (inScope(row) && showsById[row.show_id]?.status === "final")
    (byShow[row.show_id] ??= []).push(row);
  for (const arr of Object.values(byShow)){
    const mx = Math.max(...arr.map(x => x.points));
    if (mx > 0) for (const x of arr) if (x.points === mx) T[x.player_id].wins++;
  }
  if (season){
    const byPlayerShow = {};
    for (const row of scoreRows) (byPlayerShow[row.player_id] ??= {})[row.show_id] = (byPlayerShow[row.player_id][row.show_id] ?? 0) + row.points;
    for (const playerId of Object.keys(T)){
      const joinDate = rosterJoinDates[playerId] || season.start_date;
      const lo = joinDate > season.start_date ? joinDate : season.start_date;
      let zeros = 0;
      for (const [showId, sh] of Object.entries(showsById)){
        if (sh.status !== "final") continue;
        if (sh.showdate < lo || sh.showdate > season.end_date) continue;
        const pts = byPlayerShow[playerId]?.[showId] ?? 0;
        if (pts === 0) zeros++;
      }
      T[playerId].zeros = zeros;
    }
  }
  return T;
}

function layerValue(player, layer){
  // Higher is always "better" here so both the grouping and the final sort
  // can share one comparison direction — zeros is inverted at the source.
  if (layer === "fewest_zeros") return -player.zeros;
  if (layer === "most_wins") return player.wins;
  if (layer === "highest_single_show") return player.high;
  throw new Error("Unknown tiebreaker layer: " + layer);
}

// The player's own value in its natural (non-inverted) units, for display —
// "fewest zeros (1)" should read as 1 zero, not layerValue's -1.
function displayValue(player, layer){
  if (layer === "fewest_zeros") return player.zeros;
  if (layer === "most_wins") return player.wins;
  if (layer === "highest_single_show") return player.high;
  throw new Error("Unknown tiebreaker layer: " + layer);
}

function groupBy(ids, valueOf){
  const byValue = new Map();
  for (const id of ids){
    const v = valueOf(id);
    if (!byValue.has(v)) byValue.set(v, []);
    byValue.get(v).push(id);
  }
  return [...byValue.keys()].sort((a,b) => b - a).map(v => byValue.get(v));
}

// Recurses through the configured stack: split, and only recurse into a
// still-tied subgroup, never one already resolved to a singleton. Reaching
// the end of the stack with a group >1 is "exhausted stack = shared
// placing" — no further resolution, resolvedBy stays null.
//
// `path` accumulates one {layer, value} entry per layer the CURRENT group
// was actually subjected to, on the way down from the top of the stack.
// Every id inside `ids` shares the same value at every layer already in
// `path` — that's exactly why groupBy still has them together at this
// depth — so the path can be built once per group rather than per id, and
// handed out unchanged to whichever singleton/exhausted-tied group it ends
// up labeling. This is what keeps a player who broke free at layer 1 from
// ever being stamped with a layer-2 value they were never actually measured
// against.
function resolveGroup(ids, players, tiebreakers, idx, path){
  if (idx >= tiebreakers.length) return [{ ids, resolvedBy: null, path }];
  const layer = tiebreakers[idx];
  const out = [];
  for (const group of groupBy(ids, id => layerValue(players[id], layer))){
    const newPath = [...path, { layer, value: displayValue(players[group[0]], layer) }];
    if (group.length === 1) out.push({ ids: group, resolvedBy: layer, path: newPath });
    else out.push(...resolveGroup(group, players, tiebreakers, idx + 1, newPath));
  }
  return out;
}

// players: output of computeStandings(). primaryMetric: fn(player) => number
// (r.scoped for a season view, r.career for All time). tiebreakers: ordered
// array, 0-3 of 'fewest_zeros'|'most_wins'|'highest_single_show' — an empty
// array means equal-points players simply share a placing (no arbitrary
// order), same as a per-show tie.
// Returns: [{ id, rank, points, tied, resolvedBy, layers }] in display order.
// `tied` is true for any player whose final group still has >1 member.
// `resolvedBy` names the layer that separated this player from the group it
// was tied with, or null if none was needed (stack empty, or exhausted
// without separating them). `layers` is the full [{layer, value}] history of
// every layer that group was actually measured on, cumulative down the
// stack — not just the one that resolved it — so a player who broke free at
// layer 1 never carries a layer-2/3 entry they were never subjected to.
export function rankStandings(players, primaryMetric, tiebreakers = []){
  const byPoints = groupBy(Object.keys(players), id => primaryMetric(players[id]));
  const groups = [];
  for (const ids of byPoints){
    if (ids.length === 1 || !tiebreakers.length){
      groups.push({ ids, resolvedBy: null, path: [] });
    } else {
      groups.push(...resolveGroup(ids, players, tiebreakers, 0, []));
    }
  }
  let rank = 1;
  const result = [];
  for (const g of groups){
    for (const id of g.ids) result.push({ id, rank, points: primaryMetric(players[id]), tied: g.ids.length > 1, resolvedBy: g.resolvedBy, layers: g.path });
    rank += g.ids.length;
  }
  return result;
}
