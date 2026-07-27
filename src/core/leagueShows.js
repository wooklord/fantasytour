import { db, rpc } from "./supabaseClient.js";
import { state } from "./state.js";

// Stage A moved cutoff_at/format/status/remind_sent/lock_sent/winner_sent
// off `shows` onto a per-league `league_shows` overlay. Every read of shows
// needs both merged together, or showState() (format.js) silently treats
// every show as perpetually un-open. `queryFn` receives the base
// `db.from("shows").select("*")` builder so callers can add their own
// filters/order, same shape as a plain shows query.
export async function fetchShows(queryFn){
  const [{ data: shows }, ls] = await Promise.all([
    queryFn(db.from("shows").select("*")),
    rpc("get_league_shows", { p_league_id: state.currentLeagueId }),
  ]);
  const byId = Object.fromEntries((ls||[]).map(l => [l.show_id, l]));
  return (shows||[]).map(s => ({ ...s, ...byId[s.id] }));
}

// Single-show variant for the pick-sheet/detail-view lookups.
export async function fetchShow(id){
  const [{ data: show }, ls] = await Promise.all([
    db.from("shows").select("*").eq("id", id).single(),
    rpc("get_league_shows", { p_league_id: state.currentLeagueId }),
  ]);
  if (!show) return null;
  const row = (ls||[]).find(l => l.show_id === id);
  return { ...show, ...row };
}
