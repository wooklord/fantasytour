import { $, esc, isDesktop } from "./dom.js";
import { db, rpc } from "./supabaseClient.js";
import { state } from "./state.js";
import { subscribeRealtime } from "./realtime.js";
import { renderAll } from "./layout.js";
import { NEW_SIGNUP_DAYS, SIGNUP_SNOOZE_DAYS } from "./config.js";
import { countRecent, badgeText } from "./signups.js";

// Derived, not stored — avoids a second source of truth that could drift
// from state.leagues after a switch.
export const currentBracket = () => state.leagues.find(l => l.bracket_id === state.currentBracketId);
export const isCurrentLeagueAdmin = () => {
  if (!state.session) return false;
  if (state.session.is_global_admin) return true;
  const row = currentBracket();
  return !!(row && row.is_league_admin);
};
export const bracketsForLeague = leagueId => state.leagues.filter(l => l.league_id === leagueId);

// Config is bracket-scoped now (brackets.config), not the old single global
// game_config row — brackets has a public read policy, no RPC needed.
export async function loadConfig(){
  const { data, error } = await db.from("brackets").select("config").eq("id", state.currentBracketId).single();
  if (error) throw new Error("Couldn't load bracket config: " + error.message);
  state.cfg = data.config;
}

// No season active or starting soon => land on Casual (the perpetual tally)
// instead of an Official bracket that has nothing open right now. Only
// consulted when there's no remembered bracket choice — an explicit past
// switch always wins over this default.
async function defaultBracketFor(leagueId){
  const rows = bracketsForLeague(leagueId);
  const casual = rows.find(l => l.bracket_kind === "casual") || rows[0];
  const official = rows.find(l => l.bracket_kind === "official");
  if (!official) return casual;
  try{
    const seasons = await rpc("get_bracket_seasons", { p_bracket_id: official.bracket_id });
    const today = new Date().toLocaleDateString('sv');
    const soon = new Date(Date.now() + 14*864e5).toLocaleDateString('sv');
    const relevant = (seasons||[]).some(se => se.start_date <= soon && se.end_date >= today);
    return relevant ? official : casual;
  }catch(e){ return casual; }
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
  const pick = found || await defaultBracketFor(state.leagues[0].league_id);
  state.currentBracketId = pick.bracket_id;
  state.currentLeagueId = pick.league_id;
  localStorage.setItem("ft_bracket_id", String(state.currentBracketId));
  return true;
}

// Header chrome: name + league name (whoami), and the thin bracket-kind
// label. Plain text, not a control — switching lives in Settings now.
export function renderHeaderChrome(){
  const who = document.getElementById("whoami");
  if (who){
    who.innerHTML = state.session
      ? `<b>${esc(state.session.name)}</b>${currentBracket() ? `<div class="who-league">${esc(currentBracket().league_name)}</div>` : ""}`
      : "";
  }
  const lbl = document.getElementById("bracketLabel");
  if (lbl) lbl.textContent = currentBracket() ? currentBracket().bracket_name : "";
  const admintab = document.getElementById("admintab");
  const title = document.getElementById("col-admin-title");
  const label = isCurrentLeagueAdmin() ? "Admin" : "Settings";
  // innerHTML, for the badge: the label is a fixed string and the badge is
  // built from numbers and a constant, so nothing a player typed lands here.
  const badge = signupBadgeHtml();
  if (admintab) admintab.innerHTML = label + badge;
  if (title) title.innerHTML = label + badge;
}

// ---------- vet-first badge (docs/decisions/onboarding.md, decision 7, Part A) ----------
// How many players in no league registered in the last NEW_SIGNUP_DAYS days,
// as a pill on the Admin tab and the desktop column title. Admins only, both
// ways: a non-admin never sees the pill, and the client never calls the
// admin-gated list for one. The rows come from whichever caller fetched
// them: loadUnaffiliated() on every admin-panel render (no extra call), or
// refreshSignupBadge() where no admin panel renders. One shared gate, so
// the fetch and the pill cannot disagree about who is an admin.
// Decision 8: rows this admin cleared within SIGNUP_SNOOZE_DAYS don't count
// (signups.js), and the list's "Clear all" shows exactly while the pill
// does, through signupBadgeLit().
const badgeApplies = () => isCurrentLeagueAdmin();
export const signupBadgeLit = () => badgeApplies() && !!state.newSignups?.n;
export function setSignupRows(rows){
  state.newSignups = countRecent(rows, { nowMs: Date.now(), days: NEW_SIGNUP_DAYS, snoozeDays: SIGNUP_SNOOZE_DAYS });
  renderHeaderChrome();
}
// A failure keeps the last count: the badge is supplementary.
export async function refreshSignupBadge(){
  if (!badgeApplies()) return;
  try{
    setSignupRows(await rpc("admin_list_unaffiliated_players", { p_name:state.session.name, p_pin:state.session.pin, p_league_id:state.currentLeagueId }));
  }catch{ /* keep the last count */ }
}
// The third column renders on desktop always and on mobile only on the
// admin tab, and its list load sets the badge. Anywhere else (a mobile
// load, a bracket switch) the badge makes its own single call.
export function refreshSignupBadgeOutsidePanel(){
  if (!isDesktop() && state.tab !== "admin") refreshSignupBadge();
}
function signupBadgeHtml(){
  const c = state.newSignups;
  if (!signupBadgeLit()) return "";
  const text = badgeText(c);
  const what = `${text} new registration${c.n === 1 ? "" : "s"} in the last ${NEW_SIGNUP_DAYS} days, not in any league`;
  return ` <span class="tabbadge" role="img" aria-label="${what}" title="${what}">${text}</span>`;
}

// Settings-screen bracket toggle: current league's brackets only (switching
// leagues is a separate control — see renderLeagueSelector).
export function renderBracketToggle(){
  const el = document.getElementById("bracketToggle");
  if (!el) return;
  el.innerHTML = bracketsForLeague(state.currentLeagueId).map(r => `<button class="linkbtn switcher-btn${r.bracket_id===state.currentBracketId?" on":""}"
    onclick="switchToBracket(${r.bracket_id})">${esc(r.bracket_name)}</button>`).join("");
}

// Only rendered when the player belongs to more than one league — a single
// league has nothing to pick between.
export function renderLeagueSelector(){
  const el = document.getElementById("leagueSelect");
  if (!el) return;
  const leagueIds = [...new Set(state.leagues.map(l => l.league_id))];
  if (leagueIds.length <= 1){ el.innerHTML = ""; return; }
  el.innerHTML = `<div class="field"><label>League</label>
    <select onchange="switchToLeague(Number(this.value))">
      ${leagueIds.map(lid => {
        const row = state.leagues.find(l => l.league_id === lid);
        return `<option value="${lid}" ${lid===state.currentLeagueId?"selected":""}>${esc(row.league_name)}</option>`;
      }).join("")}
    </select></div>`;
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
  renderHeaderChrome();
  await renderAll();
  refreshSignupBadgeOutsidePanel();
}

// Switch to another league entirely, preferring that league's bracket of
// the same kind (Casual->Casual, Official->Official) so the switch doesn't
// silently change what kind of board you're looking at too.
export async function switchToLeague(leagueId){
  if (leagueId === state.currentLeagueId) return;
  const rows = bracketsForLeague(leagueId);
  const curKind = currentBracket()?.bracket_kind;
  const pick = rows.find(r => r.bracket_kind === curKind) || rows.find(r => r.bracket_kind === "casual") || rows[0];
  if (pick) await switchToBracket(pick.bracket_id);
}
