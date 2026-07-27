import { $, esc } from "./dom.js";
import { db, rpc } from "./supabaseClient.js";
import { state } from "./state.js";
import { subscribeRealtime } from "./realtime.js";
import { renderAll } from "./layout.js";

// Derived, not stored — avoids a second source of truth that could drift
// from state.leagues after a switch.
export const currentBracket = () => state.leagues.find(l => l.bracket_id === state.currentBracketId);
export const isCurrentLeagueAdmin = () => {
  if (!state.session) return false;
  if (state.session.is_global_admin) return true;
  const row = currentBracket();
  return !!(row && row.is_league_admin);
};

// Config is bracket-scoped now (brackets.config), not the old single global
// game_config row — brackets has a public read policy, no RPC needed.
export async function loadConfig(){
  const { data, error } = await db.from("brackets").select("config").eq("id", state.currentBracketId).single();
  if (error) throw new Error("Couldn't load bracket config: " + error.message);
  state.cfg = data.config;
}

// Called once from boot() after login. Returns false if the player has zero
// leagues (true for every new register_player signup — registration never
// touches league_members) so the caller can render a dedicated screen
// instead of crashing on an unresolvable bracket.
export async function resolveLeagues(){
  state.leagues = await rpc("my_leagues", { p_name: state.session.name, p_pin: state.session.pin });
  if (!state.leagues.length) return false;
  const saved = Number(localStorage.getItem("ft_bracket_id"));
  const found = state.leagues.find(l => l.bracket_id === saved);
  const pick = found || state.leagues.find(l => l.bracket_kind === "casual") || state.leagues[0];
  state.currentBracketId = pick.bracket_id;
  state.currentLeagueId = pick.league_id;
  localStorage.setItem("ft_bracket_id", String(state.currentBracketId));
  return true;
}

export function renderSwitcher(){
  const el = document.getElementById("switcher");
  if (!el) return;
  if (!state.session || !state.leagues.length){ el.innerHTML = ""; return; }
  const leagueIds = [...new Set(state.leagues.map(l => l.league_id))];
  if (leagueIds.length === 1){
    // Exactly one league — a plain Casual/Official toggle reads better than
    // a dropdown for a 2-option choice.
    el.innerHTML = state.leagues.map(r => `<button class="linkbtn switcher-btn${r.bracket_id===state.currentBracketId?" on":""}"
      onclick="switchToBracket(${r.bracket_id})">${esc(r.bracket_name)}</button>`).join("");
  } else {
    // More than one league: a flat select grouped by league. Deliberately
    // not a fancier two-level picker — there's exactly one league in
    // production today.
    el.innerHTML = `<select onchange="switchToBracket(Number(this.value))">
      ${leagueIds.map(lid => {
        const rows = state.leagues.filter(l => l.league_id === lid);
        return `<optgroup label="${esc(rows[0].league_name)}">
          ${rows.map(r => `<option value="${r.bracket_id}" ${r.bracket_id===state.currentBracketId?"selected":""}>${esc(r.bracket_name)}</option>`).join("")}
        </optgroup>`;
      }).join("")}
    </select>`;
  }
}

export async function switchToBracket(bracketId){
  const row = state.leagues.find(l => l.bracket_id === bracketId);
  if (!row || bracketId === state.currentBracketId) return;
  state.currentBracketId = bracketId;
  state.currentLeagueId = row.league_id;
  localStorage.setItem("ft_bracket_id", String(bracketId));
  // Don't try to carry an open pick sheet or tab across the switch.
  state.tab = "shows"; state.currentShow = null;
  await loadConfig();
  subscribeRealtime();
  renderSwitcher();
  const admintab = document.getElementById("admintab");
  if (admintab) admintab.style.display = isCurrentLeagueAdmin() ? "" : "none";
  await renderAll();
}
