// Pure Stats-table logic for the standings tab — sort, persistence
// parsing, leaders, number formatting. No DOM, no Supabase, same isolation
// as tiebreak.js; test/stats.test.mjs runs it under plain Node.
//
// Record: docs/decisions/standings-ux.md item 6 (LOCKED 2026-10-26).
// Rows are the board's `[id, totals]` pairs (totals from computeStandings:
// shows, scoped, high, highShow, wins, zeros), already filtered to
// shows > 0 by the caller.

// Best-first direction per column: a first tap on a header sorts so the
// best value leads — most shows / highest avg / highest high / most wins
// descending, fewest zeros ascending.
export const STAT_COLS = {
  shows: { best: "desc" },
  avg:   { best: "desc" },
  high:  { best: "desc" },
  zeros: { best: "asc"  },
  wins:  { best: "desc" },
};
export const DEFAULT_STATS_SORT = { col: "avg", dir: "desc" };

export function statValue(t, col){
  if (col === "shows") return t.shows;
  if (col === "avg") return t.shows ? t.scoped / t.shows : 0;
  if (col === "high") return t.high;
  if (col === "zeros") return t.zeros;
  if (col === "wins") return t.wins || 0;
  throw new Error("Unknown stat column: " + col);
}

// Display form: avg to one decimal, everything else as-is (decision 4).
export function fmtStat(col, v){
  return col === "avg" ? Number(v).toFixed(1) : String(v);
}

export function bestDir(col){ return STAT_COLS[col]?.best ?? "desc"; }
export function flipDir(dir){ return dir === "asc" ? "desc" : "asc"; }

// The board's within-tie name order, reused so a stats tie reads the same
// way a standings tie does: accent-sensitive, case-insensitive.
const byName = (nameOf) => (a, b) =>
  String(nameOf(a) || "").localeCompare(String(nameOf(b) || ""), undefined, { sensitivity: "accent" });

// Returns a NEW array of [id, totals] pairs sorted on `col` in `dir`
// ("asc" | "desc"); equal values fall back to name A–Z regardless of
// direction. The input is not mutated.
export function sortStats(rows, col, dir, nameOf = () => ""){
  const sign = dir === "asc" ? 1 : -1;
  const nm = byName(nameOf);
  return rows.slice().sort((a, b) => {
    const d = statValue(a[1], col) - statValue(b[1], col);
    if (d !== 0) return sign * d;
    return nm(a[0], b[0]);
  });
}

// localStorage value "<col>:<dir>" → { col, dir }; anything unknown (a
// missing key, a bogus column or direction, an old format) falls back to
// the default silently — the same posture as ft_scores_view's whitelist.
export function parseStatsSort(raw){
  if (typeof raw !== "string") return { ...DEFAULT_STATS_SORT };
  const [col, dir] = raw.split(":");
  if (!STAT_COLS[col] || (dir !== "asc" && dir !== "desc")) return { ...DEFAULT_STATS_SORT };
  return { col, dir };
}
export function formatStatsSort({ col, dir }){ return `${col}:${dir}`; }

// Leaders strip (item 6.4): Best avg, High score, Most wins, Fewest zeros,
// each with the leading value and EVERY id that holds it, in name order
// (the render shows the first and "+N" for the rest). `withZeros: false`
// omits Fewest zeros (no season → zeros are not computed — decision 1).
// Empty rows → []. Values are numbers; fmtStat formats them.
export function statLeaders(rows, nameOf = () => "", { withZeros = true } = {}){
  if (!rows.length) return [];
  const nm = byName(nameOf);
  const pick = (key, col, label, best) => {
    const vals = rows.map(([id, t]) => [id, statValue(t, col)]);
    const top = vals.reduce((m, [, v]) => (m === null ? v : (best === "max" ? Math.max(m, v) : Math.min(m, v))), null);
    const ids = vals.filter(([, v]) => v === top).map(([id]) => id).sort(nm);
    return { key, col, label, value: top, ids };
  };
  const out = [
    pick("avg", "avg", "Best avg", "max"),
    pick("high", "high", "High score", "max"),
    pick("wins", "wins", "Most wins", "max"),
  ];
  if (withZeros) out.push(pick("zeros", "zeros", "Fewest zeros", "min"));
  return out;
}
