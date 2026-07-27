import { $, esc, footerHtml } from "../core/dom.js";
import { db, rpc, edgeFn } from "../core/supabaseClient.js";
import { state } from "../core/state.js";
import { fetchShows } from "../core/leagueShows.js";
import { fmtDate, clearTimersFor } from "../core/format.js";
import { toast } from "../core/toast.js";
import { loadConfig, loadSongs } from "../core/session.js";
import { markTab } from "../core/layout.js";

// Seasons only ever belong to a league's Official bracket, and the season
// editor has to keep working regardless of which bracket the switcher
// currently shows — an admin looking at Casual still needs to manage
// Official's seasons. So this resolves the league's Official bracket_id
// directly, rather than assuming state.currentBracketId.
function officialBracketId(){
  return state.leagues.find(l => l.league_id === state.currentLeagueId && l.bracket_kind === "official")?.bracket_id;
}

export async function renderAdmin(){
  clearTimersFor("admin"); state.tab = "admin"; markTab();
  await loadConfig();
  const cfg = state.cfg;
  const b = cfg.bonuses || {};
  const os = cfg.oneset || { slots:[
      {key:"opener",type:"opener",label:"Opener",points:2},
      {key:"closer",type:"closer",label:"Closer",points:2},
      {key:"cover1",type:"cover_pick",label:"Cover Pick",points:2}
    ], flat_picks:3, flat_points:1 };
  const [shows, seasonsA] = await Promise.all([
    fetchShows(q => q.gte("showdate", new Date(Date.now()-7*864e5).toISOString().slice(0,10)).order("showdate")),
    rpc("get_bracket_seasons", { p_bracket_id: officialBracketId() }),
  ]);
  const todayA = new Date().toLocaleDateString('sv');
  const nextShow = (shows||[]).find(sh => sh.showdate >= todayA) || (shows||[])[(shows||[]).length-1];
  $("#main").innerHTML = `
    <div class="panel"><h2>Who's picked</h2>
      <div class="field"><label>Show</label>
        <select id="roster-show" onchange="loadRoster()">
          ${(shows||[]).map(sh => `<option value="${sh.id}" ${nextShow && sh.id===nextShow.id ? "selected" : ""}>${fmtDate(sh.showdate)} — ${esc(sh.venue||"TBA")}</option>`).join("")}
        </select></div>
      <div id="roster"><p class="muted">Pick a show.</p></div>
    </div>
    <div class="panel"><h2>Master switch</h2>
      <div class="field"><label>Voting override</label>
        <select id="c-override">
          <option value="auto" ${(cfg.voting_override||"auto")==="auto"?"selected":""}>Auto — cutoffs decide</option>
          <option value="locked" ${cfg.voting_override==="locked"?"selected":""}>Locked — nobody can vote</option>
          <option value="open" ${cfg.voting_override==="open"?"selected":""}>Open — voting open for today + future shows</option>
        </select></div>
      <p class="muted">Enforced in the database, saved with the rules below. Auto is normal operation.</p>
    </div>
    <div class="panel"><h2>Seasons</h2>
      <p class="muted">Named date ranges — shows sort themselves in by date.</p>
      <div id="seasonrows">${(seasonsA||[]).map(seasonRow).join("")}</div>
      <button class="btn ghost small" onclick="addSeasonRow()">+ add season</button>
    </div>
    <div class="panel"><h2>Game rules — standard shows</h2>
      <p class="muted">Slotted picks (position matters):</p>
      <div id="slots">${(cfg.slots||[]).map(sl => adminSlotRow(sl)).join("")}</div>
      <button class="btn ghost small" onclick="addSlot('slots')">+ add slot</button>
      <div class="grid2" style="margin-top:14px">
        <div class="field"><label>Flat picks (count)</label><input id="c-flat" type="number" min="0" value="${cfg.flat_picks}"></div>
        <div class="field"><label>Points per flat pick</label><input id="c-flatpts" type="number" min="0" value="${cfg.flat_points}"></div>
        <div class="field"><label>Partial credit (slot song played elsewhere)</label>
          <select id="c-partial"><option value="true" ${cfg.partial_credit?"selected":""}>On</option><option value="false" ${!cfg.partial_credit?"selected":""}>Off</option></select></div>
        <div class="field"><label>Partial points</label><input id="c-partpts" type="number" min="0" value="${cfg.partial_points}"></div>
        <div class="field"><label>Bonus: cover</label><input id="c-bcover" type="number" min="0" value="${b.cover||0}"></div>
        <div class="field"><label>Bonus: debut</label><input id="c-bdebut" type="number" min="0" value="${b.debut||0}"></div>
        <div class="field"><label>Bonus: perfect sheet (every pick hits)</label><input id="c-bperfect" type="number" min="0" value="${b.perfect||0}"></div>
        <div class="field"><label>Allow duplicate songs across picks</label>
          <select id="c-dupes"><option value="false" ${!cfg.allow_duplicates?"selected":""}>No</option><option value="true" ${cfg.allow_duplicates?"selected":""}>Yes</option></select></div>
        <div class="field"><label>Wildcard: "Any Debut" (hits if any debut is played)</label>
          <select id="c-wcdebut"><option value="true" ${(cfg.wildcards?.debut ?? true)?"selected":""}>Players may pick it</option><option value="false" ${(cfg.wildcards?.debut ?? true)?"":"selected"}>Off</option></select></div>
      </div>
    </div>
    <div class="panel"><h2>Game rules — one-set shows</h2>
      <p class="muted">Used for shows toggled to "1 set" below. Festival-tagged shows sync in as 1 set automatically.</p>
      <div id="slots1">${(os.slots||[]).map(sl => adminSlotRow(sl)).join("")}</div>
      <button class="btn ghost small" onclick="addSlot('slots1')">+ add slot</button>
      <div class="grid2" style="margin-top:14px">
        <div class="field"><label>Flat picks (count)</label><input id="c1-flat" type="number" min="0" value="${os.flat_picks}"></div>
        <div class="field"><label>Points per flat pick</label><input id="c1-flatpts" type="number" min="0" value="${os.flat_points}"></div>
      </div>
      <button class="btn" onclick="saveConfig()">Save all rules</button>
      <div class="err" id="cfg-err"></div>
      <p class="muted" style="margin-top:6px">Rule changes apply on the next scoring run. Don't change mid-show unless you enjoy arguments.</p>
    </div>
    <div class="panel"><h2>Shows & cutoffs</h2>
      <p class="muted">Times shown in your device timezone (${Intl.DateTimeFormat().resolvedOptions().timeZone}). Sync defaults new shows to 6 PM venue-local.</p>
      ${(shows||[]).map(sh => `<div class="showrow">
        <div class="date">${fmtDate(sh.showdate)}</div>
        <div class="v"><div class="venue">${esc(sh.venue||"TBA")}</div>
          <div class="loc"><input type="datetime-local" data-show="${sh.id}" value="${sh.cutoff_at ? new Date(new Date(sh.cutoff_at).getTime()-new Date().getTimezoneOffset()*6e4).toISOString().slice(0,16) : ""}" style="background:var(--pit);border:1px solid var(--line2);color:var(--cream);border-radius:8px;padding:6px 8px;font-size:.8rem"></div></div>
        <button onclick="toggleFormat(${sh.id}, '${sh.format==='one_set'?'standard':'one_set'}')" title="pick sheet format">${sh.format==='one_set'?'1 set':'2 set'}</button>
        <button onclick="saveCutoff(${sh.id}, this)">Set</button>
        ${sh.status!=='final' && sh.cutoff_at && new Date(sh.cutoff_at) < new Date() ? '<button onclick="finalizeShow('+sh.id+', this)" style="border-color:var(--coral);color:var(--coral)">Finalize</button>' : ''}
      </div>`).join("") || '<p class="muted">No shows — sync first.</p>'}
    </div>
    <div class="panel"><h2>Players</h2>
      <div id="playerlist"><p class="muted">Loading…</p></div>
      <button class="linkbtn" id="banToggle" onclick="toggleBans()" style="margin-top:8px">show ban list</button>
      <div id="banlist" class="hidden" style="margin-top:6px"></div>
    </div>
    <div class="panel"><h2>Data</h2>
      <div class="row">
        <button class="btn ghost small" onclick="runEdge('sync_shows', this)">Sync shows</button>
        <button class="btn ghost small" onclick="runEdge('sync_songs', this)">Sync song catalog</button>
        <button class="btn ghost small" onclick="runEdge('score', this)">Run scoring now</button>
      </div>
      <p class="muted" style="margin-top:8px">Scoring also runs automatically on the cron schedule. These are manual overrides.</p>
    </div>
    ${footerHtml()}`;
  if ((shows||[]).length) loadRoster();
  loadPlayers();
}
export async function loadPlayers(){
  // players_public no longer carries an admin flag (Stage A trimmed it to
  // id/name/created_at) and there's no public read on league_members to
  // source a per-player badge from either — dropping the ★ marker here is
  // an accepted, temporary regression, to be rebuilt properly in C2b
  // alongside the league-scoped member-list this panel really needs.
  const { data: pl } = await db.from("players_public").select("*").order("created_at");
  $("#playerlist").innerHTML = (pl||[]).map(p => `
    <div class="pickres hit"><span>·</span>
      <span>${esc(p.name)}</span>
      <span class="pt">${p.id===state.session.id ? '<small class="muted">you</small>'
        : '<button class="btn ghost small" onclick="bootPlayer(\''+p.id+'\', \''+esc(p.name).replace(/'/g,"\\'")+'\')" style="border-color:var(--coral);color:var(--coral)">Boot</button>'}</span>
    </div>`).join("") || '<p class="muted">Nobody here yet.</p>';
}
export function seasonRow(se){
  const v = se || { id:"", name:"", start_date:"", end_date:"" };
  return `<div class="admin-slot" data-season="${v.id}">
    <input class="k" placeholder="Name (e.g. Summer Tour 2026)" value="${esc(v.name)}">
    <input type="date" value="${v.start_date}" style="width:130px">
    <input type="date" value="${v.end_date}" style="width:130px">
    <button class="btn ghost small" onclick="saveSeason(this.parentElement)">Save</button>
    ${v.id ? `<button class="btn ghost small" onclick="deleteSeason(${v.id})" style="border-color:var(--coral);color:var(--coral)">✕</button>` : ""}
  </div>`;
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
    loadPlayers(); loadRoster();
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
export const SLOT_TYPES = {
  opener: "Opener — first song of the show",
  set1_closer: "Set 1 closer",
  set2_opener: "Set 2 opener",
  closer: "Closer — last pre-encore song",
  encore: "Encore — any encore song",
  show_closer: "Show closer — final song of the night",
  second_song: "2nd song of the show",
  cover_pick: "Cover pick — name a cover, scores if played (repeatable)",
};
export function adminSlotRow(sl){
  const t = sl.type || sl.key;
  let opts = Object.entries(SLOT_TYPES).map(([k,d]) =>
    `<option value="${k}" ${k===t?"selected":""}>${d}</option>`).join("");
  if (t && !(t in SLOT_TYPES)) opts += `<option value="${esc(t)}" selected>${esc(t)} (legacy)</option>`;
  return `<div class="admin-slot">
    <select class="k" title="which position this slot scores against">${opts}</select>
    <input class="k" placeholder="Label players see" value="${esc(sl.label)}">
    <input class="p" type="number" min="0" value="${sl.points}">
    <button class="btn ghost small" onclick="this.parentElement.remove()">✕</button></div>`;
}
export function addSlot(target){ $("#"+target).insertAdjacentHTML("beforeend", adminSlotRow({key:"encore",label:"",points:2})); }
export function readSlots(containerId){
  let coverN = 0;
  return [...document.querySelectorAll('#'+containerId+' .admin-slot')].map(r => {
    const type = r.querySelector("select.k").value;
    const [l, p] = r.querySelectorAll("input");
    const key = type === "cover_pick" ? "cover" + (++coverN) : type;
    return { key, type, label: l.value.trim(), points: Number(p.value) };
  }).filter(sl => sl.type && sl.label);
}
export async function saveConfig(){
  $("#cfg-err").textContent = "";
  const slots = readSlots('slots'), slots1 = readSlots('slots1');
  for (const arr of [slots, slots1]){
    const types = arr.filter(sl => sl.type !== "cover_pick").map(sl => sl.type);
    if (new Set(types).size !== types.length){
      $("#cfg-err").textContent = "Each slot type (except Cover pick) can only be used once per section."; return;
    }
  }
  const data = {
    slots,
    flat_picks: Number($("#c-flat").value), flat_points: Number($("#c-flatpts").value),
    partial_credit: $("#c-partial").value === "true", partial_points: Number($("#c-partpts").value),
    allow_duplicates: $("#c-dupes").value === "true",
    voting_override: $("#c-override").value,
    bonuses: { cover: Number($("#c-bcover").value), debut: Number($("#c-bdebut").value), perfect: Number($("#c-bperfect").value), jamchart: 0 },
    wildcards: { debut: $("#c-wcdebut").value === "true" },
    oneset: { slots: slots1, flat_picks: Number($("#c1-flat").value), flat_points: Number($("#c1-flatpts").value) },
  };
  try{
    await rpc("admin_update_config", { p_name:state.session.name, p_pin:state.session.pin, p_bracket_id:state.currentBracketId, p_data:data });
    state.cfg = data; toast("Rules saved ✔", "score");
  }catch(e){ $("#cfg-err").textContent = e.message; }
}
export async function saveCutoff(showId, btn){
  const input = document.querySelector(`input[data-show="${showId}"]`);
  if (!input.value) return;
  try{
    await rpc("admin_set_cutoff", { p_name:state.session.name, p_pin:state.session.pin, p_league_id:state.currentLeagueId, p_show_id:showId, p_cutoff:new Date(input.value).toISOString() });
    btn.textContent = "✔"; setTimeout(() => btn.textContent = "Set", 1500);
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
export async function runEdge(action, btn){
  btn.disabled = true; const old = btn.textContent; btn.textContent = "…";
  try{ const r = await edgeFn(action); toast(esc(JSON.stringify(r).slice(0,120)), "score"); if(action==="sync_songs") loadSongs(); }
  catch(e){ toast(esc(e.message)); }
  btn.disabled = false; btn.textContent = old;
}
