import { $, esc, footerHtml } from "../core/dom.js";
import { db, rpc, edgeFn } from "../core/supabaseClient.js";
import { state } from "../core/state.js";
import { fetchShows } from "../core/leagueShows.js";
import { fmtDate, clearTimersFor, showState } from "../core/format.js";
import { toast } from "../core/toast.js";
import { loadConfig, loadSongs } from "../core/session.js";
import { markTab } from "../core/layout.js";
import { settingsPanelHtml, wireSettingsPanel } from "./settings.js";
import { currentBracket } from "../core/switcher.js";
import { TIEBREAK_LABELS } from "../core/tiebreak.js";
import { SLOT_LABELS, SLOT_TOOLTIPS, ONE_SET_EXCLUDED_TYPES, slotLabelFor } from "../core/slotTypes.js";
import { venueLocalInputValue, venueLocalToUTC, venueLongName, hasDstTransition } from "../core/venueTime.js";
import { RANKED_CHOICE_ENABLED } from "../core/config.js";

// Seasons only ever belong to a league's Official bracket, and the season
// editor has to keep working regardless of which bracket the switcher
// currently shows — an admin looking at Casual still needs to manage
// Official's seasons. So this resolves the league's Official bracket_id
// directly, rather than assuming state.currentBracketId.
function officialBracketId(){
  return state.leagues.find(l => l.league_id === state.currentLeagueId && l.bracket_kind === "official")?.bracket_id;
}

// Bracket-wide custom rules (brackets.config's custom_rules: string[]) — a
// soft cap enforced client-side by disabling the add button at the limit,
// not by rejecting a save that's already over it. `maxlength` on the input
// stops a typed-past-the-limit line at the source; readCustomRules() still
// re-slices defensively in case a value ever gets in past that (paste into
// a devtools-edited input, a future caller, etc.).
const CUSTOM_RULES_MAX = 10;
const CUSTOM_RULE_MAXLEN = 140;
function customRuleRow(text){
  return `<div class="admin-slot">
    <input class="rule-text" maxlength="${CUSTOM_RULE_MAXLEN}" value="${esc(text||"")}" placeholder="e.g. No repeating a cover pick within the same show" oninput="checkRuleCap()">
    <button class="btn ghost small" onclick="this.parentElement.remove(); checkRuleCap()">✕</button></div>`;
}
export function addCustomRule(){
  const box = $("#customrules");
  if (box.children.length >= CUSTOM_RULES_MAX) return;
  box.insertAdjacentHTML("beforeend", customRuleRow());
  checkRuleCap();
}
export function checkRuleCap(){
  const btn = $("#add-rule-btn");
  if (btn) btn.disabled = $("#customrules").children.length >= CUSTOM_RULES_MAX;
}
function readCustomRules(){
  return [...document.querySelectorAll("#customrules .rule-text")]
    .map(i => i.value.trim().slice(0, CUSTOM_RULE_MAXLEN))
    .filter(Boolean)
    .slice(0, CUSTOM_RULES_MAX);
}

// Per-device collapse state for the admin panel's sections — same idiom as
// ft_theme2/ft_bracket_id (core/theme.js, core/switcher.js): a plain
// localStorage-backed map read once at module load, written back on every
// toggle. Every section wired through collapsible() below defaults to
// collapsed (a missing key is falsy), so there's no separate "defaults"
// list to maintain — "Who's picked" and Settings never call collapsible()
// at all, since they're always expanded and have no toggle.
let sectionState = {};
try{ sectionState = JSON.parse(localStorage.getItem("ft_admin_sections") || "{}"); }catch(e){ sectionState = {}; }
function sectionOpen(key){ return !!sectionState[key]; }
export function toggleSection(key){
  sectionState[key] = !sectionOpen(key);
  localStorage.setItem("ft_admin_sections", JSON.stringify(sectionState));
  const body = $("#sec-"+key), btn = $("#sec-btn-"+key);
  if (body) body.classList.toggle("hidden", !sectionState[key]);
  if (btn) btn.textContent = sectionState[key] ? "hide" : "show";
}
// Collapsing only toggles a CSS class (.hidden => display:none) on the body
// div — the section's inputs/selects stay in the DOM with their values
// intact and fully readable by querySelectorAll (readSlots, saveConfig,
// etc.) whether or not the section is currently open. `alwaysVisible` is a
// slot for content that must stay visible even when collapsed (the
// Official-no-season warning) — it renders between the header and the
// collapsible body, never inside it.
function collapsible(key, title, bodyHtml, alwaysVisible = ""){
  const open = sectionOpen(key);
  return `<div class="panel">
    <div class="row"><h2 style="margin:0">${title}</h2>
      <button class="linkbtn" id="sec-btn-${key}" onclick="toggleSection('${key}')" style="margin-left:auto">${open ? "hide" : "show"}</button></div>
    ${alwaysVisible}
    <div id="sec-${key}" class="${open ? "" : "hidden"}">${bodyHtml}</div>
  </div>`;
}

// Session 4 step 5 — Global console, folded into the existing Admin screen
// as one more collapsible() section rather than a new nav tab: used a
// handful of times a year, Admin already uses this pattern everywhere, and
// a real tab would touch index.html's nav, layout.js's 3-column grid, and
// dom.js's $() redirect logic for no real benefit at this scale. Gated
// entirely on is_global_admin — league admins never see this section at all.
function globalConsoleHtml(){
  if (!state.session.is_global_admin) return "";
  return collapsible("global", "Global console", `
    <p class="muted">Global-only: create leagues, appoint league admins, and reset any player's PIN app-wide.</p>
    <div class="field"><label>New league name</label>
      <div class="row"><input id="gc-league-name" placeholder="e.g. Facebook League">
      <button class="btn ghost small" onclick="globalCreateLeague()">Create</button></div></div>
    <div class="err" id="gc-league-err"></div>
    <div class="field" style="margin-top:14px"><label>Appoint a league admin</label>
      <select id="gc-appoint-league">${(state.allLeagues||[]).map(l => `<option value="${l.id}">${esc(l.name)}</option>`).join("")}</select>
      <input id="gc-appoint-search" placeholder="Search player name…" oninput="globalSearchPlayers('appoint')" autocomplete="off"></div>
    <div id="gc-appoint-results"></div>
    <div class="field" style="margin-top:14px"><label>Reset a player's PIN (app-wide)</label>
      <input id="gc-reset-search" placeholder="Search player name…" oninput="globalSearchPlayers('reset')" autocomplete="off"></div>
    <div id="gc-reset-results"></div>
  `);
}
export async function loadGlobalLeagues(){
  // leagues has a public RLS read policy (same free read renderNoLeague()
  // already relies on) — no RPC needed just to list them.
  const { data, error } = await db.from("leagues").select("id,name").order("name");
  if (error){ toast(esc(error.message)); return; }
  state.allLeagues = data || [];
  const sel = $("#gc-appoint-league");
  if (sel) sel.innerHTML = state.allLeagues.map(l => `<option value="${l.id}">${esc(l.name)}</option>`).join("");
}
export async function globalCreateLeague(){
  $("#gc-league-err").textContent = "";
  const name = $("#gc-league-name").value.trim();
  if (!name){ $("#gc-league-err").textContent = "League needs a name"; return; }
  try{
    await rpc("global_create_league", { p_name:state.session.name, p_pin:state.session.pin, p_league_name:name });
    toast(`${name} created`, "score");
    $("#gc-league-name").value = "";
    loadGlobalLeagues();
  }catch(e){ $("#gc-league-err").textContent = e.message; }
}
// One search box pattern, reused for both the appoint-admin and reset-PIN
// player lookups — same shape as searchMembers()/addMember() above, just
// unscoped (global_find_players has no league_id, unlike admin_find_players).
export async function globalSearchPlayers(kind){
  const inputSel = kind === "appoint" ? "#gc-appoint-search" : "#gc-reset-search";
  const resultsSel = kind === "appoint" ? "#gc-appoint-results" : "#gc-reset-results";
  const q = $(inputSel).value.trim();
  if (q.length < 2){ $(resultsSel).innerHTML = ""; return; }
  try{
    const rows = await rpc("global_find_players", { p_name:state.session.name, p_pin:state.session.pin, p_query:q });
    $(resultsSel).innerHTML = (rows||[]).map(p => `
      <div class="pickres">
        <span>${esc(p.name)}</span>
        <span class="pt">${kind === "appoint"
          ? `<button class="btn ghost small" onclick="globalAppointAdmin('${p.player_id}', '${esc(p.name).replace(/'/g,"\\'")}')">Appoint</button>`
          : `<button class="btn ghost small" onclick="globalResetPin('${p.player_id}', '${esc(p.name).replace(/'/g,"\\'")}')">Reset PIN</button>`}</span>
      </div>`).join("") || '<p class="muted">No matches.</p>';
  }catch(e){ $(resultsSel).innerHTML = `<p class="err">${esc(e.message)}</p>`; }
}
export async function globalAppointAdmin(id, name){
  const leagueId = Number($("#gc-appoint-league").value);
  if (!leagueId){ toast("Pick a league first"); return; }
  try{
    await rpc("global_appoint_league_admin", { p_name:state.session.name, p_pin:state.session.pin, p_league_id:leagueId, p_player_id:id });
    toast(`${name} appointed league admin`, "score");
    $("#gc-appoint-search").value = ""; $("#gc-appoint-results").innerHTML = "";
  }catch(e){ toast(esc(e.message)); }
}
// Same shape as resetMemberPin() above, but p_league_id:null — Global
// resetting someone app-wide has no "current league" to scope it to.
// admin_reset_player_pin treats a null league_id as "caller must be global",
// already enforced server-side, not re-checked here.
export async function globalResetPin(id, name){
  if (!confirm(`Reset ${name}'s PIN app-wide? They'll be forced to set a new one on next login. Relay the new PIN to them directly — it can't be recovered after this.`)) return;
  try{
    const r = await rpc("admin_reset_player_pin", { p_name:state.session.name, p_pin:state.session.pin, p_league_id:null, p_player_id:id });
    alert(`New PIN for ${name}: ${r.new_pin}\n\nRelay this to them now — it will not be shown again.`);
  }catch(e){ toast(esc(e.message)); }
}

// Starting ladder offered when a bracket is switched to ranked mode without
// one. An empty editor with a lone "+ add rank" button reads as a broken
// feature, and an admin choosing ranked choice almost certainly wants a
// ladder — but note this is DISPLAY ONLY until they press Save. Nothing
// writes it to brackets.config on its own, so switching mode and navigating
// away persists nothing.
const DEFAULT_RANKED_LADDER = [5, 4, 3, 2, 1];

// Row position IS the rank, so the label is derived from position at render
// time rather than stored on the row — see renumberRanks() for why that
// matters after a deletion.
function rankRow(pts, i){
  return `<div class="admin-slot">
    <label style="min-width:4.2rem;opacity:.75">Rank ${i+1}</label>
    <input class="rank-pts" type="number" min="0" value="${pts ?? ""}">
    <button class="btn ghost small" onclick="this.parentElement.remove(); renumberRanks()">✕</button></div>`;
}
export function addRankRow(){
  const box = $("#rankladder");
  box.insertAdjacentHTML("beforeend", rankRow("", box.children.length));
}
// Deleting a middle row would otherwise leave labels reading "Rank 1, Rank 3,
// Rank 4" while position — the thing that actually determines the rank, both
// here and in readLadder() — says otherwise. Relabel from position so the
// visible label can't disagree with the real ordering.
export function renumberRanks(){
  [...document.querySelectorAll("#rankladder .admin-slot")].forEach((row, i) => {
    row.querySelector("label").textContent = `Rank ${i+1}`;
  });
}

// The mode-dependent slice of the admin panel, extracted so onModeChange()
// can re-render just this region when the scoring-mode select changes,
// without disturbing Master switch / Seasons / House rules (a full
// renderAdmin() would discard unsaved edits in those).
//
// `mode` is a parameter rather than read from state.cfg on purpose:
// state.cfg must stay a faithful copy of what's in the database, because
// saveConfig()'s fallbacks read it to preserve fields whose inputs aren't
// currently rendered. A locally-mutated state.cfg would corrupt that, and
// would also let a mode switch leak into the pick sheet before it's saved.
function rulesRegionHtml(cfg, mode){
  const b = cfg.bonuses || {};
  if (mode === "ranked_choice") {
    const stored = cfg.ranked?.ladder ?? [];
    const ladder = stored.length ? stored : DEFAULT_RANKED_LADDER;
    return collapsible("rules-ranked", "Game rules — ranked choice", `
      <p class="muted">Players pick one song per rank. A pick scores its rank's value if that
        song is played anywhere in the show — position doesn't matter, so a single ladder
        covers every show regardless of format. There's no separate one-set section here.</p>
      <div id="rankladder">${ladder.map(rankRow).join("")}</div>
      <button class="btn ghost small" onclick="addRankRow()">+ add rank</button>
      <p class="muted" style="margin-top:6px">Row order is the rank — the first row is Rank 1.
        Every rank needs a value — use ✕ to remove a rank. Cover, debut, and "Any Debut"
        don't apply in this mode; perfect sheet still does and lives under Master switch.</p>
    `);
  }
  const os = cfg.oneset || { slots:[
      {key:"opener",type:"opener",label:"Opener",points:2},
      {key:"closer",type:"closer",label:"Closer",points:2},
      {key:"cover1",type:"cover_pick",label:"Cover Pick",points:2}
    ], flat_picks:3, flat_points:1 };
  return `
    ${collapsible("rules-standard", "Game rules — standard shows", `
      <p class="muted">Slotted picks (position matters):</p>
      <div id="slots">${(cfg.slots||[]).map(sl => adminSlotRow(sl, "standard")).join("")}</div>
      <button class="btn ghost small" onclick="addSlot('slots')">+ add slot</button>
      <div class="grid2" style="margin-top:14px">
        <div class="field"><label>Flat picks (count)</label><input id="c-flat" type="number" min="0" value="${cfg.flat_picks}"></div>
        <div class="field"><label>Points per flat pick</label><input id="c-flatpts" type="number" min="0" value="${cfg.flat_points}"></div>
        <div class="field"><label>Partial credit (slot song played elsewhere)</label>
          <select id="c-partial"><option value="true" ${cfg.partial_credit?"selected":""}>On</option><option value="false" ${!cfg.partial_credit?"selected":""}>Off</option></select></div>
        <div class="field"><label>Partial points</label><input id="c-partpts" type="number" min="0" value="${cfg.partial_points}"></div>
        <div class="field"><label>Bonus: cover</label><input id="c-bcover" type="number" min="0" value="${b.cover||0}"></div>
        <div class="field"><label>Bonus: debut</label><input id="c-bdebut" type="number" min="0" value="${b.debut||0}"></div>
        <div class="field"><label>Allow duplicate songs across picks</label>
          <select id="c-dupes"><option value="false" ${!cfg.allow_duplicates?"selected":""}>No</option><option value="true" ${cfg.allow_duplicates?"selected":""}>Yes</option></select></div>
        <div class="field"><label>Wildcard: "Any Debut" (hits if any debut is played)</label>
          <select id="c-wcdebut"><option value="true" ${(cfg.wildcards?.debut ?? true)?"selected":""}>Players may pick it</option><option value="false" ${(cfg.wildcards?.debut ?? true)?"":"selected"}>Off</option></select></div>
      </div>
    `)}
    ${collapsible("rules-oneset", "Game rules — one-set shows", `
      <p class="muted">Used for shows toggled to "1 set" below. Festival-tagged shows sync in as 1 set automatically.</p>
      <div id="slots1">${(os.slots||[]).map(sl => adminSlotRow(sl, "one_set")).join("")}</div>
      <button class="btn ghost small" onclick="addSlot('slots1')">+ add slot</button>
      <div class="grid2" style="margin-top:14px">
        <div class="field"><label>Flat picks (count)</label><input id="c1-flat" type="number" min="0" value="${os.flat_picks}"></div>
        <div class="field"><label>Points per flat pick</label><input id="c1-flatpts" type="number" min="0" value="${os.flat_points}"></div>
      </div>
    `)}`;
}

// Re-render only the mode-dependent region when the scoring-mode select
// changes. Reads the new mode from the select; does not touch state.cfg.
export function onModeChange(){
  $("#rules-region").innerHTML = rulesRegionHtml(state.cfg, $("#c-mode").value);
}

export async function renderAdmin(){
  clearTimersFor("admin"); state.tab = "admin"; markTab();
  await loadConfig();
  const cfg = state.cfg;
  const b = cfg.bonuses || {};
  // A config with no `mode` key is slot mode — that's every bracket that
  // existed before ranked choice, so absence must keep working untouched.
  const mode = cfg.mode || "slots";
  // The ranked option is withheld until the scorer is deployed (see
  // RANKED_CHOICE_ENABLED), but it's still offered when this bracket is
  // ALREADY ranked — otherwise the select couldn't represent the state it
  // just loaded, would display "Slots", and the next save would silently
  // rewrite the bracket's real mode.
  const showRanked = RANKED_CHOICE_ENABLED || mode === "ranked_choice";
  const [shows, seasonsA] = await Promise.all([
    fetchShows(q => q.gte("showdate", new Date(Date.now()-7*864e5).toISOString().slice(0,10)).order("showdate")),
    rpc("get_bracket_seasons", { p_bracket_id: officialBracketId() }),
  ]);
  const todayA = new Date().toLocaleDateString('sv');
  const nextShow = (shows||[]).find(sh => sh.showdate >= todayA) || (shows||[])[(shows||[]).length-1];
  // Official-no-season warning: checked against the show's own date (an
  // upcoming show, not "today"), independent of which bracket the switcher
  // currently shows — Seasons always manages the league's Official bracket
  // regardless (see officialBracketId above). Rendered via collapsible()'s
  // alwaysVisible slot, outside the Seasons section's collapsible body, so
  // it stays visible whether or not that section is expanded.
  const uncoveredShows = (shows||[]).filter(sh => sh.showdate >= todayA
    && !(seasonsA||[]).some(se => se.start_date <= sh.showdate && sh.showdate <= se.end_date));
  const seasonWarning = uncoveredShows.length ? `<div class="noticebox">
      ⚠️ Official has no season covering ${uncoveredShows.length === 1 ? "an upcoming show" : uncoveredShows.length + " upcoming shows"} —
      picks will be blocked there until a season is added: ${uncoveredShows.map(sh => {
        // Just the compact M/D, no venue — this list has no cap and grows one
        // entry per un-seasoned upcoming show, so venue names get unwieldy
        // fast and the date alone is enough to act on. Sliced straight off
        // the "YYYY-MM-DD" string rather than through a Date object, so
        // there's no local-timezone rollover risk right at a date boundary.
        const [, m, d] = sh.showdate.split("-");
        return `${Number(m)}/${Number(d)}`;
      }).join(", ")}</div>` : "";
  $("#main").innerHTML = `
    ${globalConsoleHtml()}
    <div class="panel"><h2>Who's picked</h2>
      <div class="field"><label>Show</label>
        <select id="roster-show" onchange="loadRoster()">
          ${(shows||[]).map(sh => `<option value="${sh.id}" ${nextShow && sh.id===nextShow.id ? "selected" : ""}>${fmtDate(sh.showdate)} — ${esc(sh.venue||"TBA")}</option>`).join("")}
        </select></div>
      <div id="roster"><p class="muted">Pick a show.</p></div>
    </div>
    ${collapsible("master", "Master switch", `
      <div class="field"><label>Voting override</label>
        <select id="c-override">
          <option value="auto" ${(cfg.voting_override||"auto")==="auto"?"selected":""}>Auto — cutoffs decide</option>
          <option value="locked" ${cfg.voting_override==="locked"?"selected":""}>Locked — nobody can vote</option>
          <option value="open" ${cfg.voting_override==="open"?"selected":""}>Open — voting open for today + future shows</option>
        </select></div>
      <div class="field"><label>Scoring mode</label>
        <select id="c-mode" onchange="onModeChange()">
          <option value="slots" ${mode!=="ranked_choice"?"selected":""}>Slots — position matters (opener, closers, encore)</option>
          ${showRanked ? `<option value="ranked_choice" ${mode==="ranked_choice"?"selected":""}>Ranked choice — N picks against a fixed ladder</option>` : ""}
        </select></div>
      <div class="field"><label>Bonus: perfect sheet (every pick hits)</label><input id="c-bperfect" type="number" min="0" value="${b.perfect||0}"></div>
      <p class="muted">Enforced in the database, saved with the rules below. Auto is normal operation.
        Perfect sheet lives here rather than with the other bonuses because it's the one
        bonus that applies in every scoring mode — it scores the whole sheet being right,
        not any individual song.</p>
    `)}
    ${collapsible("seasons", "Seasons", `
      <p class="muted">Named date ranges — shows sort themselves in by date.</p>
      <div id="seasonrows">${(seasonsA||[]).map(seasonRow).join("")}</div>
      <button class="btn ghost small" onclick="addSeasonRow()">+ add season</button>
    `, seasonWarning)}
    ${currentBracket()?.bracket_kind === "official" ? collapsible("tiebreakers", "Season tiebreakers", `
      <p class="muted">Applies only to Official's season standings, when a season ends with players tied on points. Tried in order — the first layer that separates two players decides. Leave all "None", or exhaust every layer without a difference, and they share the placing — same as a per-show tie.</p>
      <div class="grid2">
        ${[0,1,2].map(i => tiebreakerSelectRow(i, (cfg.tiebreakers||[])[i] || "")).join("")}
      </div>
      <p class="muted" style="margin-top:6px;font-size:.78rem">Fewest zeros — any show in scope worth 0 points, including one never picked at all, counts against you (scoped from when you joined the season roster, not the season's start). Most wins — per-show ties still share the crown. Highest single-show score.</p>
    `) : ""}
    ${collapsible("rules-custom", "House rules", `
      <p class="muted">Bracket-wide house rules, shown on the pick sheet's "The Rules"
        card below the auto-generated slot definitions. Casual and Official can each
        have their own. Up to ${CUSTOM_RULES_MAX} rules, ${CUSTOM_RULE_MAXLEN}
        characters each.</p>
      <div id="customrules">${(cfg.custom_rules||[]).map(customRuleRow).join("")}</div>
      <button class="btn ghost small" id="add-rule-btn" onclick="addCustomRule()"
        ${(cfg.custom_rules||[]).length >= CUSTOM_RULES_MAX ? "disabled" : ""}>+ add rule</button>
    `)}
    <div id="rules-region">${rulesRegionHtml(cfg, mode)}</div>
    <div class="panel">
      <button class="btn" onclick="saveConfig()">Save all rules</button>
      <div class="err" id="cfg-err"></div>
      <p class="muted" style="margin-top:6px">Rule changes apply on the next scoring run. Don't change mid-show unless you enjoy arguments. Saves both rule sections above, whether or not they're currently expanded.</p>
    </div>
    ${collapsible("shows", "Shows & cutoffs", `
      <p class="muted">Cutoffs are shown and edited in each show's venue-local time. New shows default to 6 PM venue-local.</p>
      ${(shows||[]).map(sh => {
        const tz = sh.timezone || null;
        const inputVal = !sh.cutoff_at ? ""
          : tz ? venueLocalInputValue(sh.cutoff_at, tz)
          : new Date(new Date(sh.cutoff_at).getTime()-new Date().getTimezoneOffset()*6e4).toISOString().slice(0,16);
        // The input already shows the time — this only needs to name the
        // zone (and carry the caveats that add real information), not
        // restate the value a second time.
        const zoneLabel = !sh.cutoff_at ? "" : tz
          ? `<div class="muted" style="font-size:.75rem;margin:8px 0 2px">Timezone: <b style="color:var(--cream)">${esc(venueLongName(sh.cutoff_at, tz))}</b>${
              hasDstTransition(inputVal, tz) ? ' <span style="color:var(--coral)">⚠ DST changes on this date — double-check this time</span>' : ""
            }</div>`
          : `<div class="muted" style="font-size:.75rem;margin:8px 0 2px"><span style="color:var(--coral)">Device time — venue timezone unknown</span></div>`;
        return `<div class="arow">
        <div class="arow-head"><span class="date">${fmtDate(sh.showdate)}</span><span class="venue">${esc(sh.venue||"TBA")}</span></div>
        ${zoneLabel}
        <input class="cutoff-in" type="datetime-local" step="900" data-show="${sh.id}" data-tz="${tz||''}" value="${inputVal}">
        <div class="switcher" style="margin-bottom:8px" title="pick sheet format">
          <button class="linkbtn switcher-btn${sh.format!=='one_set'?" on":""}" onclick="toggleFormat(${sh.id}, 'standard')">2 set</button>
          <button class="linkbtn switcher-btn${sh.format==='one_set'?" on":""}" onclick="toggleFormat(${sh.id}, 'one_set')">1 set</button>
        </div>
        <div class="arow-btns">
          <button onclick="saveCutoff(${sh.id}, this)">Change cutoff</button>
          ${sh.status!=='final' && sh.cutoff_at && new Date(sh.cutoff_at) < new Date() ? '<button onclick="finalizeShow('+sh.id+', this)" style="border-color:var(--coral);color:var(--coral)">Finalize</button>' : ''}
          ${sh.status==='final' ? '<button onclick="reopenShow('+sh.id+', this)" style="border-color:var(--coral);color:var(--coral)">Reopen</button>' : ''}
        </div>
      </div>`;
      }).join("") || '<p class="muted">No shows — sync first.</p>'}
    `)}
    ${collapsible("members", "Members", `
      <div class="field"><label>Add a member</label>
        <input id="member-search" placeholder="Search registered players by name…" oninput="searchMembers()" autocomplete="off"></div>
      <div id="member-results"></div>
      <div id="playerlist"><p class="muted">Loading…</p></div>
      <button class="linkbtn" id="banToggle" onclick="toggleBans()" style="margin-top:8px">show ban list</button>
      <div id="banlist" class="hidden" style="margin-top:6px"></div>
    `)}
    ${collapsible("data", "Data", `
      <div class="row">
        <button class="btn ghost small" onclick="runEdge('sync_shows', this)">Sync shows</button>
        <button class="btn ghost small" onclick="runEdge('sync_songs', this)">Sync song catalog</button>
        <button class="btn ghost small" onclick="runEdge('score', this)">Run scoring now</button>
      </div>
      <p class="muted" style="margin-top:8px">Scoring also runs automatically on the cron schedule. These are manual overrides.</p>
    `)}
    ${settingsPanelHtml()}
    ${footerHtml()}`;
  if ((shows||[]).length) loadRoster();
  loadMembers();
  if (state.session.is_global_admin) loadGlobalLeagues();
  wireSettingsPanel();
}
export async function loadMembers(){
  // Scoped to the current league via admin_list_members (Stage C2b) —
  // replaces the old app-wide players_public read, which listed every
  // registered player regardless of league membership and let Boot fire
  // against people who weren't actually in this league. is_league_admin
  // restores the ★ marker the pre-2.0 build had.
  const rows = await rpc("admin_list_members", { p_name:state.session.name, p_pin:state.session.pin, p_league_id:state.currentLeagueId });
  $("#playerlist").innerHTML = (rows||[]).map(p => `
    <div class="pickres hit"><span>${p.is_league_admin ? "★" : "·"}</span>
      <span>${esc(p.name)}${p.official_opt_in ? ' <small class="muted">Official</small>' : ""}</span>
      <span class="pt">${p.player_id===state.session.id ? '<small class="muted">you</small>'
        : (p.is_league_admin ? '<small class="muted">admin</small> ' : '')
          +'<button class="btn ghost small" onclick="resetMemberPin(\''+p.player_id+'\', \''+esc(p.name).replace(/'/g,"\\'")+'\')">Reset PIN</button> '
          +'<button class="btn ghost small" onclick="bootPlayer(\''+p.player_id+'\', \''+esc(p.name).replace(/'/g,"\\'")+'\')" style="border-color:var(--coral);color:var(--coral)">Boot</button>'}</span>
    </div>`).join("") || '<p class="muted">Nobody here yet.</p>';
}
// Session 4 step 4 — server-generates the new PIN (this admin never chooses
// it), returned once for relay; the reset target is forced to set a real
// PIN on next login (must_change_pin, Session 4 step 2). Uses alert(), not
// toast(): toast() auto-dismisses after 6s and caps at 4 visible — wrong for
// a value that has to be read and relayed carefully with no recovery if
// missed. alert() blocks until dismissed, and is already a no-op stub in
// the test harness, so no new test plumbing is needed for it.
export async function resetMemberPin(id, name){
  if (!confirm(`Reset ${name}'s PIN? They'll be forced to set a new one on next login. Relay the new PIN to them directly — it can't be recovered after this.`)) return;
  try{
    const r = await rpc("admin_reset_player_pin", { p_name:state.session.name, p_pin:state.session.pin, p_league_id:state.currentLeagueId, p_player_id:id });
    alert(`New PIN for ${name}: ${r.new_pin}\n\nRelay this to them now — it will not be shown again.`);
  }catch(e){ toast(esc(e.message)); }
}
export async function searchMembers(){
  const q = $("#member-search").value.trim();
  if (q.length < 2){ $("#member-results").innerHTML = ""; return; }
  try{
    const rows = await rpc("admin_find_players", { p_name:state.session.name, p_pin:state.session.pin, p_league_id:state.currentLeagueId, p_query:q });
    $("#member-results").innerHTML = (rows||[]).map(p => `
      <div class="pickres">
        <span>${esc(p.name)}</span>
        <span class="pt"><button class="btn ghost small" onclick="addMember('${p.player_id}', '${esc(p.name).replace(/'/g,"\\'")}')">Add</button></span>
      </div>`).join("") || '<p class="muted">No matches.</p>';
  }catch(e){ $("#member-results").innerHTML = `<p class="err">${esc(e.message)}</p>`; }
}
export async function addMember(id, name){
  try{
    await rpc("admin_add_league_member", { p_name:state.session.name, p_pin:state.session.pin, p_league_id:state.currentLeagueId, p_player_id:id });
    toast(`${name} added`, "score");
    $("#member-search").value = ""; $("#member-results").innerHTML = "";
    loadMembers();
  }catch(e){ toast(esc(e.message)); }
}
export function seasonRow(se){
  const v = se || { id:"", name:"", start_date:"", end_date:"" };
  return `<div class="admin-slot" data-season="${v.id}">
    <input class="k" placeholder="Name (e.g. Summer Tour 2026)" value="${esc(v.name)}">
    <input type="date" value="${v.start_date}" style="width:130px">
    <input type="date" value="${v.end_date}" style="width:130px">
    <button class="btn ghost small" onclick="saveSeason(this.parentElement)">Save</button>
    ${v.id ? `<button class="btn ghost small" onclick="deleteSeason(${v.id})" style="border-color:var(--coral);color:var(--coral)">✕</button>` : ""}
  </div>
  ${v.id ? `<div style="margin:0 0 10px">
    <button class="linkbtn" id="roster-toggle-${v.id}" onclick="toggleRoster(${v.id})">manage roster</button>
    <div id="roster-panel-${v.id}" class="hidden" style="margin-top:6px"></div>
  </div>` : ""}`;
}
// Opt-in override for a running Official season — add/remove a player from
// season_rosters directly (bypasses the live-flag lock, per the admin
// override rule in CLAUDE.md). Kept as plain module state, not state.js:
// purely a UI expand/collapse flag, not app data.
const rosterOpen = {};
async function renderRosterPanel(seasonId){
  const panel = $("#roster-panel-"+seasonId);
  if (!panel) return;
  panel.innerHTML = '<p class="muted">Loading…</p>';
  try{
    const [members, roster] = await Promise.all([
      rpc("admin_list_members", { p_name:state.session.name, p_pin:state.session.pin, p_league_id:state.currentLeagueId }),
      rpc("admin_list_season_roster", { p_name:state.session.name, p_pin:state.session.pin, p_season_id:seasonId }),
    ]);
    const onRoster = new Set((roster||[]).map(r => r.player_id));
    panel.innerHTML = (members||[]).map(m => `
      <div class="pickres ${onRoster.has(m.player_id)?"hit":"miss"}">
        <span>${onRoster.has(m.player_id)?"✔":"—"}</span><span>${esc(m.name)}</span>
        <span class="pt"><button class="btn ghost small" onclick="setRosterMember(${seasonId}, '${m.player_id}', ${!onRoster.has(m.player_id)})">${onRoster.has(m.player_id)?"Remove":"Add"}</button></span>
      </div>`).join("") || '<p class="muted">No members in this league yet.</p>';
  }catch(e){ panel.innerHTML = `<p class="err">${esc(e.message)}</p>`; }
}
export async function toggleRoster(seasonId){
  rosterOpen[seasonId] = !rosterOpen[seasonId];
  const toggleBtn = $("#roster-toggle-"+seasonId), panel = $("#roster-panel-"+seasonId);
  if (toggleBtn) toggleBtn.textContent = rosterOpen[seasonId] ? "hide roster" : "manage roster";
  if (panel) panel.classList.toggle("hidden", !rosterOpen[seasonId]);
  if (rosterOpen[seasonId]) renderRosterPanel(seasonId);
}
export async function setRosterMember(seasonId, playerId, add){
  try{
    await rpc("admin_set_season_roster", { p_name:state.session.name, p_pin:state.session.pin, p_season_id:seasonId, p_player_id:playerId, p_add:add });
    toast(add ? "Added to roster" : "Removed from roster", "score");
    renderRosterPanel(seasonId);
  }catch(e){ toast(esc(e.message)); }
}
export function addSeasonRow(){ $("#seasonrows").insertAdjacentHTML("beforeend", seasonRow(null)); }
export async function saveSeason(row){
  const [name, start, end] = [...row.querySelectorAll("input")].map(i => i.value);
  const id = row.dataset.season ? Number(row.dataset.season) : null;
  try{
    await rpc("admin_save_season", { p_name:state.session.name, p_pin:state.session.pin, p_bracket_id:officialBracketId(), p_id:id, p_sname:name, p_start:start||null, p_end:end||null });
    toast("Season saved ✔", "score"); state.boardSeason = null; renderAdmin();
  }catch(e){ toast(esc(e.message)); }
}
export async function deleteSeason(id){
  if (!confirm("Delete this season? Scores are untouched — only the grouping goes away.")) return;
  try{
    await rpc("admin_delete_season", { p_name:state.session.name, p_pin:state.session.pin, p_id:id });
    toast("Season deleted", "score"); state.boardSeason = null; renderAdmin();
  }catch(e){ toast(esc(e.message)); }
}
let bansOpen = false;
export async function toggleBans(){
  bansOpen = !bansOpen;
  $("#banToggle").textContent = bansOpen ? "hide ban list" : "show ban list";
  $("#banlist").classList.toggle("hidden", !bansOpen);
  if (!bansOpen) return;
  $("#banlist").innerHTML = '<p class="muted">Loading…</p>';
  try{
    const rows = await rpc("admin_list_bans", { p_name:state.session.name, p_pin:state.session.pin, p_league_id:state.currentLeagueId });
    $("#banlist").innerHTML = (rows||[]).map(r => `
      <div class="pickres miss"><span>⛔</span><span>${esc(r.name)}</span>
        <span class="pt"><small class="muted">${new Date(r.banned_at).toLocaleDateString()}</small>
          <button class="btn ghost small" onclick="unban('${esc(r.name).replace(/'/g,"\\'")}')">Unban</button></span>
      </div>`).join("") || '<p class="muted">Nobody is banned. A peaceful kingdom.</p>';
  }catch(e){ $("#banlist").innerHTML = `<p class="err">${esc(e.message)}</p>`; }
}
export async function unban(name){
  if (!confirm(`Unban "${name}"? The name becomes registerable again.`)) return;
  try{
    await rpc("admin_unban", { p_name:state.session.name, p_pin:state.session.pin, p_league_id:state.currentLeagueId, p_banned:name });
    toast(`${name} unbanned`, "score");
    bansOpen = false; toggleBans();
  }catch(e){ toast(esc(e.message)); }
}
export async function bootPlayer(id, name){
  if (!confirm(`Remove ${name} from this league? Their past picks/scores stay on the books — they just stop being able to submit new ones.`)) return;
  const ban = confirm(`Also block the name "${name}" from rejoining this league?\n\nOK = remove + ban · Cancel = remove only`);
  try{
    await rpc("admin_league_boot", { p_name:state.session.name, p_pin:state.session.pin, p_league_id:state.currentLeagueId, p_player_id:id, p_ban:ban });
    toast(`${name} removed${ban ? " and banned" : ""}`, "score");
    loadMembers(); loadRoster();
  }catch(e){ toast(esc(e.message)); }
}
export async function toggleFormat(showId, next){
  try{
    await rpc("admin_set_show_format", { p_name:state.session.name, p_pin:state.session.pin, p_league_id:state.currentLeagueId, p_show_id:showId, p_format:next });
    toast("Format: " + (next === "one_set" ? "1 set" : "2 set"), "score");
    renderAdmin();
  }catch(e){ toast(esc(e.message)); }
}
export async function loadRoster(){
  const showId = Number($("#roster-show").value);
  if (!showId) return;
  try{
    const rows = await rpc("admin_pick_status", { p_name:state.session.name, p_pin:state.session.pin, p_bracket_id:state.currentBracketId, p_show_id:showId });
    const total = rows.length, done = rows.filter(r => r.picks_count > 0).length;
    $("#roster").innerHTML = `
      <p class="muted" style="margin-bottom:6px"><b style="color:var(--mint)">${done}</b> of ${total} players have picks in</p>
      ${rows.map(r => `<div class="pickres ${r.picks_count>0?"hit":"miss"}">
        <span>${r.picks_count>0?"✔":"—"}</span><span>${esc(r.player_name)}</span>
        <span class="pt">${r.picks_count>0
          ? r.picks_count+" picks · saved "+new Date(r.last_saved).toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})
          : "no picks yet"}</span>
      </div>`).join("")}`;
  }catch(e){ $("#roster").innerHTML = `<p class="err">${esc(e.message)}</p>`; }
}
// Player-facing labels are fixed/code-owned (src/core/slotTypes.js) — the
// admin only ever picks a TYPE and a point value now. The dropdown option
// text is built from that same label+tooltip data (not a separately
// maintained description string), so there's one source of truth instead
// of two copies that can drift. One-set sections exclude set1_closer/
// set2_opener entirely (see ONE_SET_EXCLUDED_TYPES) rather than just
// relabeling them — a one-set show can't ever satisfy either slot.
export function adminSlotRow(sl, format){
  const t = sl.type || sl.key;
  const excluded = format === "one_set" ? ONE_SET_EXCLUDED_TYPES : [];
  let opts = Object.keys(SLOT_LABELS).filter(k => !excluded.includes(k)).map(k =>
    `<option value="${k}" ${k===t?"selected":""}>${esc(slotLabelFor(k, format))} — ${esc(SLOT_TOOLTIPS[k])}</option>`).join("");
  if (t && !(t in SLOT_LABELS)) opts += `<option value="${esc(t)}" selected>${esc(t)} (legacy)</option>`;
  return `<div class="admin-slot">
    <select class="k" title="which position this slot scores against">${opts}</select>
    <input class="p" type="number" min="0" value="${sl.points}">
    <button class="btn ghost small" onclick="this.parentElement.remove()">✕</button></div>`;
}
export function addSlot(target){
  const format = target === "slots1" ? "one_set" : "standard";
  $("#"+target).insertAdjacentHTML("beforeend", adminSlotRow({ key:"encore", points:2 }, format));
}
export function readSlots(containerId){
  let coverN = 0;
  return [...document.querySelectorAll('#'+containerId+' .admin-slot')].map(r => {
    const type = r.querySelector("select.k").value;
    const points = Number(r.querySelector("input.p").value);
    const key = type === "cover_pick" ? "cover" + (++coverN) : type;
    return { key, type, points };
  }).filter(sl => sl.type);
}
// Only rendered on the Official bracket (see renderAdmin) — three ordered
// slots rather than a drag-reorderable list, matching this codebase's
// existing <select>-based config-panel style.
function tiebreakerSelectRow(idx, current){
  const opts = ["", ...Object.keys(TIEBREAK_LABELS)].map(k =>
    `<option value="${k}" ${k===current?"selected":""}>${k ? esc(TIEBREAK_LABELS[k]) : "None"}</option>`).join("");
  return `<div class="field"><label>${["1st","2nd","3rd"][idx]} tiebreaker</label><select id="tb-${idx}">${opts}</select></div>`;
}
// undefined (not [] ) when the picker isn't on the page at all (viewing
// Casual, which has no seasons) — saveConfig then omits the key entirely
// rather than writing a meaningless tiebreakers field onto Casual's config.
// A duplicate pick across the three slots is silently deduped to its first
// (higher-priority) position rather than rejected — unlike the slot-type
// dupe check, there's no ambiguous game state to guard against here.
function readTiebreakers(){
  const els = [0,1,2].map(i => $("#tb-"+i));
  if (!els[0]) return undefined;
  const seen = new Set(), list = [];
  for (const el of els){
    const v = el.value;
    if (v && !seen.has(v)){ seen.add(v); list.push(v); }
  }
  return list;
}
export async function saveConfig(){
  $("#cfg-err").textContent = "";
  const mode = $("#c-mode").value;
  // Only one mode's rule sections are on screen at a time, so every read
  // below has to tolerate its input being absent — and must fall back to
  // the value ALREADY IN state.cfg, never to a literal like 0/false/[].
  // A literal fallback is a data-loss path, not a harmless default: switch
  // to ranked, save, switch back, and every slot, bonus and flag the admin
  // had configured would have been overwritten with zeros by the save that
  // happened while their inputs weren't rendered. Symmetric in both
  // directions — a slots-mode save has to preserve the ladder the same way.
  const slots  = $("#slots")  ? readSlots("slots")  : (state.cfg.slots ?? []);
  const slots1 = $("#slots1") ? readSlots("slots1") : (state.cfg.oneset?.slots ?? []);
  for (const arr of [slots, slots1]){
    const types = arr.filter(sl => sl.type !== "cover_pick").map(sl => sl.type);
    if (new Set(types).size !== types.length){
      $("#cfg-err").textContent = "Each slot type (except Cover pick) can only be used once per section."; return;
    }
  }
  // readLadder() signals invalid input with null (distinct from a legitimately
  // empty []), having already written the reason to #cfg-err. Checked here,
  // before the data object is assembled and before the RPC — a ternary that
  // let a failed read fall through as [] would silently wipe the ladder on a
  // single stray character, which is the same data-loss shape the fallbacks
  // above exist to prevent.
  let ladder;
  if ($("#rankladder")) {
    ladder = readLadder();
    if (ladder === null) return;
    if (mode === "ranked_choice" && !ladder.length){
      $("#cfg-err").textContent = "A ranked-choice bracket needs at least one rank. Add a rank, or switch back to slots."; return;
    }
  } else {
    ladder = state.cfg.ranked?.ladder ?? [];
  }
  // Changing scoring mode orphans existing picks: they're stored keyed by
  // slot ("opener"/"closer"/… in slots mode, "rank1"/"rank2"/… in ranked),
  // and after a switch those keys match nothing the new sheet renders. The
  // player opens a blank sheet and their entries are simply gone. This is
  // not hypothetical — it happened on 2026-08-13, and one player's six
  // picks had to be re-keyed by hand with direct SQL.
  //
  // The confirm lives HERE rather than on the select's onchange, on purpose.
  // onModeChange only re-renders the rules region locally; nothing a player
  // can see has changed and nothing is written, so a confirm there would
  // warn about a non-event and would fight an admin merely browsing the
  // dropdown. It would also contradict onModeChange's deliberate refusal to
  // touch state.cfg. Writing the config is the moment of consequence, and
  // cancelling here is clean: return early, nothing persisted, the select
  // keeps the admin's choice so they can simply change it back.
  //
  // Only asks when there is something to lose — a bracket whose open shows
  // have no picks yet shouldn't nag. The lookup is gated on the mode
  // actually changing, so it stays off the normal save path entirely.
  if (mode !== (state.cfg.mode || "slots")){
    let atRisk = [];
    let lookupFailed = false;
    try{
      const shows = await fetchShows(q => q.gte("showdate", new Date(Date.now()-2*864e5).toISOString().slice(0,10)));
      const open = (shows||[]).filter(sh => showState(sh) === "open");
      const counts = await Promise.all(open.map(sh =>
        rpc("get_show_picks", { p_bracket_id: state.currentBracketId, p_show_id: sh.id })
          .then(rows => ({ show: sh, n: (rows||[]).length }))));
      atRisk = counts.filter(c => c.n > 0);
    }catch(e){ lookupFailed = true; }
    // A failed lookup gets its own confirm rather than falling through
    // silently. Not blocking the save on a network hiccup is the right
    // default, but "no picks are at risk" and "couldn't find out" must not
    // look the same to the admin — that's the difference between an
    // informed decision and an invisible pass.
    if (lookupFailed){
      const ok = confirm(
        `Couldn't check whether existing picks would be orphaned.\n\n` +
        `Switching mode may erase picks players have already entered for open shows.\n\n` +
        `Switch anyway?`);
      if (!ok) return;
    } else if (atRisk.length){
      const nPicks = atRisk.reduce((sum, c) => sum + c.n, 0);
      const venues = atRisk.map(c => c.show.venue || "TBA").join(", ");
      const ok = confirm(
        `Switching scoring mode will orphan existing picks.\n\n` +
        `Saved picks are keyed to the current mode — opener/closer/… in slots mode, ` +
        `rank1/rank2/… in ranked. After the switch those keys stop matching, so anyone ` +
        `who has already picked for an open show sees a blank sheet and loses what they entered.\n\n` +
        `This affects ${nPicks} pick${nPicks === 1 ? "" : "s"} across ` +
        `${atRisk.length} open show${atRisk.length === 1 ? "" : "s"} (${venues}).\n\n` +
        `Nothing in the app re-keys them; it has to be done directly in the database.\n\n` +
        `Switch anyway?`);
      if (!ok) return;
    }
  }
  const tiebreakers = readTiebreakers();
  const data = {
    slots,
    mode,
    ranked: { ladder },
    custom_rules: readCustomRules(),
    flat_picks: Number($("#c-flat")?.value ?? state.cfg.flat_picks ?? 0),
    flat_points: Number($("#c-flatpts")?.value ?? state.cfg.flat_points ?? 1),
    partial_credit: $("#c-partial") ? $("#c-partial").value === "true" : !!state.cfg.partial_credit,
    partial_points: Number($("#c-partpts")?.value ?? state.cfg.partial_points ?? 1),
    allow_duplicates: $("#c-dupes") ? $("#c-dupes").value === "true" : !!state.cfg.allow_duplicates,
    voting_override: $("#c-override").value,
    bonuses: {
      cover: Number($("#c-bcover")?.value ?? state.cfg.bonuses?.cover ?? 0),
      debut: Number($("#c-bdebut")?.value ?? state.cfg.bonuses?.debut ?? 0),
      // Always rendered (Master switch), in every mode — no guard needed.
      perfect: Number($("#c-bperfect").value),
      jamchart: 0,
    },
    wildcards: { debut: $("#c-wcdebut") ? $("#c-wcdebut").value === "true" : (state.cfg.wildcards?.debut ?? true) },
    oneset: {
      slots: slots1,
      flat_picks: Number($("#c1-flat")?.value ?? state.cfg.oneset?.flat_picks ?? 0),
      flat_points: Number($("#c1-flatpts")?.value ?? state.cfg.oneset?.flat_points ?? 1),
    },
    ...(tiebreakers !== undefined ? { tiebreakers } : {}),
  };
  try{
    await rpc("admin_update_config", { p_name:state.session.name, p_pin:state.session.pin, p_bracket_id:state.currentBracketId, p_data:data });
    state.cfg = data; toast("Rules saved ✔", "score");
    // Re-render the rules region from what was actually SAVED, not from what
    // was typed. Both readers normalize: readLadder() drops blank rows and
    // readSlots() drops rows with no type, so a blank left in the middle of
    // the ladder shifts every rank below it up one. Without this the panel
    // would keep showing five rows while the database holds four, and the
    // admin would have no way to see which rank a pick now scores.
    const region = $("#rules-region");
    if (region) region.innerHTML = rulesRegionHtml(data, data.mode);
  }catch(e){ $("#cfg-err").textContent = e.message; }
}

// Row position is the rank, so order here is load-bearing: querySelectorAll
// returns document order, which is the visual order of the rows.
//
// EVERY RENDERED ROW MUST CARRY A VALUE. Removing a rank means clicking the
// row's ✕, not clearing its field — a rank's position is meaningful, so a
// blank row in the middle was never a coherent way to express deletion.
//
// Why empty and garbage produce the same message, which looks lazy and
// isn't: the input is type="number", and both real browsers and JSDOM
// coerce unparseable content to "" at `.value` (verified directly — setting
// .value = "abc", and even setAttribute("value","abc"), both read back as
// ""). So "empty because the admin cleared it" and "empty because the admin
// typed 1.2.3" are literally indistinguishable here, and `!Number.isFinite`
// is unreachable through the UI for that reason. `validity.badInput` is the
// standard way to tell them apart, but JSDOM reports it false
// unconditionally, so anything built on it would be untestable. Rejecting
// empty covers both causes with a message that's correct either way, which
// is strictly better than the alternative it replaced: silently dropping
// the row, leaving the admin to notice a rank had vanished.
//
// Returns null (NOT []) on rejection, after writing the reason to #cfg-err —
// saveConfig aborts on null, so nothing partial is ever written. Accepted
// values are coerced with Number() so the stored jsonb is numeric; a DOM
// scrape yields strings, and leaving them would make the scorer fix types on
// every scoring pass.
function readLadder(){
  const out = [];
  const rows = [...document.querySelectorAll("#rankladder .rank-pts")];
  for (let i = 0; i < rows.length; i++){
    const raw = rows[i].value.trim();
    if (raw === ""){
      $("#cfg-err").textContent = `Rank ${i+1} has no value — enter a number or remove the row.`;
      return null;
    }
    const n = Number(raw);
    // Unreachable from the UI (see above) but kept for a value that arrives
    // some other way — a devtools edit, or a future input type change.
    if (!Number.isFinite(n)){
      $("#cfg-err").textContent = `Rank ${i+1} isn't a number — enter a number or remove the row.`;
      return null;
    }
    out.push(n);
  }
  return out;
}
export async function saveCutoff(showId, btn){
  const input = document.querySelector(`input[data-show="${showId}"]`);
  if (!input.value) return;
  // input.value is venue-local wall-clock text when a timezone is known
  // (data-tz set) — must be interpreted as such, not as device-local, or
  // saving would reintroduce exactly the silent-shift bug this panel exists
  // to prevent. Falls back to the old device-local parse when the venue's
  // timezone isn't known (matches what's actually displayed in that case).
  const tz = input.dataset.tz;
  const cutoffISO = tz ? venueLocalToUTC(input.value, tz) : new Date(input.value).toISOString();
  try{
    await rpc("admin_set_cutoff", { p_name:state.session.name, p_pin:state.session.pin, p_league_id:state.currentLeagueId, p_show_id:showId, p_cutoff:cutoffISO });
    btn.textContent = "✔"; setTimeout(() => btn.textContent = "Change cutoff", 1500);
    // Best effort — the cutoff itself already saved above; a failed Discord
    // notice shouldn't read to the admin as a failed save, so this is
    // fire-and-forget rather than awaited inside the try/catch above it.
    edgeFn("cutoff_changed", { p_name:state.session.name, p_pin:state.session.pin, league_id:state.currentLeagueId, show_id:showId }).catch(() => {});
  }catch(e){ toast(esc(e.message)); }
}
export async function finalizeShow(showId, btn){
  if (!confirm("Run final scoring and mark this show complete? Picks and scores lock for good.")) return;
  btn.disabled = true; btn.textContent = "…";
  try{
    await edgeFn("finalize", { p_name:state.session.name, p_pin:state.session.pin, league_id:state.currentLeagueId, show_id:showId });
    toast("Show finalized 🏁", "score");
    renderAdmin();
  }catch(e){ toast(esc(e.message)); btn.disabled = false; btn.textContent = "Finalize"; }
}
// Un-finalizes a show so a correction to The Carton's setlist can be
// re-scored — pairs with the "fix the setlist on The Carton, then Reopen,
// then Finalize again" workflow (CLAUDE.md). The edge function's `reopen`
// action does the actual work (wipes this league's scores for the show,
// resets league_shows.status back to 'live' and winner_sent to null so the
// corrected winner re-announces); this is just the frontend wiring that was
// missing — the action itself has been authenticated and deployed since
// Stage C1.
export async function reopenShow(showId, btn){
  if (!confirm("Reopen this show? This league's scores for it are wiped and it goes back to live so scoring can run again — use this after correcting the setlist on The Carton, then Finalize once it's right.")) return;
  btn.disabled = true; btn.textContent = "…";
  try{
    await edgeFn("reopen", { p_name:state.session.name, p_pin:state.session.pin, league_id:state.currentLeagueId, show_id:showId });
    toast("Show reopened", "score");
    renderAdmin();
  }catch(e){ toast(esc(e.message)); btn.disabled = false; btn.textContent = "Reopen"; }
}
export async function runEdge(action, btn){
  btn.disabled = true; const old = btn.textContent; btn.textContent = "…";
  try{ const r = await edgeFn(action); toast(esc(JSON.stringify(r).slice(0,120)), "score"); if(action==="sync_songs") loadSongs(); }
  catch(e){ toast(esc(e.message)); }
  btn.disabled = false; btn.textContent = old;
}
