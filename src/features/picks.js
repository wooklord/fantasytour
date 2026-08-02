import { $, esc, isDesktop, footerHtml } from "../core/dom.js";
import { db, rpc } from "../core/supabaseClient.js";
import { state } from "../core/state.js";
import { fetchShow } from "../core/leagueShows.js";
import { CARTON_SITE_BASE } from "../core/config.js";
import { fmtDate, fmtCutoff, countdown, clearTimers, clearTimersFor, showState } from "../core/format.js";
import { trophy, winBadge } from "../core/trophy.js";
import { toast } from "../core/toast.js";
import { currentBracket } from "../core/switcher.js";

export const isWildcard = v => (v||"").trim().toLowerCase() === "any debut";

function draftKey(showId){ return `ft_draft_${state.session.id}_${state.currentBracketId}_${showId}`; }

export async function openShow(id){
  if (isDesktop()) state.tab = "shows";
  clearTimersFor("shows");
  const show = await fetchShow(id);
  state.currentShow = show;
  const st = showState(show);
  if (st !== "open"){ renderShowDetail(show); return; }
  // Official gating is authoritative server-side (submit_picks calls the
  // same _official_gate helper) — this call is purely so a player isn't
  // shown a form they can't submit. Casual never gates (RPC short-circuits
  // ok=true), so this always resolves fast for the common case.
  let gate = { ok: true, reason: null };
  try{
    const [row] = await rpc("can_submit_picks", { p_name:state.session.name, p_pin:state.session.pin, p_bracket_id:state.currentBracketId, p_show_id:show.id });
    if (row) gate = row;
  }catch(e){ /* fail open to the sheet — submit_picks itself still enforces this */ }
  if (gate.ok) renderPickSheet(show);
  else renderIneligible(show, gate.reason);
}

function renderIneligible(show, reason){
  const casual = state.leagues.find(l => l.league_id === state.currentLeagueId && l.bracket_kind === "casual");
  $("#main").innerHTML = `
    <p style="margin-top:14px"><button class="btn ghost small" onclick="renderShows()">← shows</button></p>
    <div class="sheet">
      <h2>${esc(show.venue||"TBA")}</h2>
      <div class="sub">${fmtDate(show.showdate)}</div>
      <p class="ineligible-reason">${esc(reason || "Picks aren't open for this bracket.")}</p>
      ${casual ? `<button class="btn ghost small" onclick="switchToBracket(${casual.bracket_id})">Switch to Casual</button>` : ""}
    </div>
    ${footerHtml()}`;
}

function prettifySlotKey(key){
  return key
    .replace(/[_-]+/g, " ")
    .replace(/([a-zA-Z])(\d)/g, "$1 $2")
    .trim()
    .split(/\s+/)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

// Canonical pick-sheet order + display label for every slot in a show's config,
// for rendering a frozen breakdown consistently regardless of DB row order.
// `order`: configured slots in configured order, then flat picks numerically.
// Any breakdown slot key missing from `order` (legacy/removed slot) sorts last
// and falls back to a prettified key rather than the raw key.
function breakdownSlotInfo(format){
  const sect = (format === "one_set" && state.cfg.oneset) ? state.cfg.oneset : state.cfg;
  const slots = sect.slots || [];
  const coverKeys = slots.filter(s => (s.type||s.key) === "cover_pick").map(s => s.key);
  const order = [], label = {};
  slots.forEach(s => {
    order.push(s.key);
    label[s.key] = (coverKeys.length > 1 && coverKeys.includes(s.key))
      ? `${s.label} ${coverKeys.indexOf(s.key)+1}`
      : s.label;
  });
  for (let i=1; i<=(sect.flat_picks||0); i++){ order.push("flat"+i); label["flat"+i] = "Pick "+i; }
  return { order, label };
}

function sortBySlotOrder(items, order){
  return [...items].sort((a,b) => {
    const ia = order.indexOf(a.slot), ib = order.indexOf(b.slot);
    if (ia === -1 && ib === -1) return 0;
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });
}

export function slotDefs(format){
  const sect = (format === "one_set" && state.cfg.oneset) ? state.cfg.oneset : state.cfg;
  const slots = (sect.slots||[]).map(s => ({ key:s.key, label:s.label, pts:s.points, type:s.type||s.key }));
  for (let i=1; i<=(sect.flat_picks||0); i++) slots.push({ key:"flat"+i, label:"Pick "+i, pts:sect.flat_points ?? state.cfg.flat_points ?? 1, flat:true });
  return slots;
}

export async function renderPickSheet(show){
  let mine = [];
  try{ mine = await rpc("get_my_picks", { p_name:state.session.name, p_pin:state.session.pin, p_bracket_id:state.currentBracketId, p_show_id:show.id }); }catch(e){}
  const dKey = draftKey(show.id);
  const draft = JSON.parse(localStorage.getItem(dKey) || "null");
  const val = k => esc((draft && draft[k] != null ? draft[k] : (mine.find(p => p.slot===k)||{}).songname) || "");
  const slots = slotDefs(show.format);
  const slotHtml = s => `
    <div class="slotline autocomplete">
      <label>${esc(s.label)}</label>
      <input data-slot="${s.key}" data-type="${s.type||s.key}" value="${val(s.key)}" placeholder="${(s.type||s.key)==="cover_pick"?"a cover…":"song…"}" autocomplete="off" spellcheck="false">
      <span class="pts">${s.pts} pt${s.pts===1?"":"s"}</span>
    </div>`;
  const structured = slots.filter(s=>!s.flat), flats = slots.filter(s=>s.flat);
  $("#main").innerHTML = `
    <p style="margin-top:14px"><button class="btn ghost small" onclick="renderShows()">← shows</button></p>
    <div class="sheet">
      <h2>${esc(show.venue||"TBA")}</h2>
      <div class="sub">${fmtDate(show.showdate)} · ${esc(show.city||"")}${show.state?", "+esc(show.state):""}${show.format==='one_set' ? " · FESTIVAL SET" : ""}</div>
      ${structured.map(slotHtml).join("")}
      ${flats.length ? `<div class="divider">Anywhere in the show</div>${flats.map(slotHtml).join("")}` : ""}
      <button class="savebtn" id="save">Lock 'em in</button>
      <div class="countbig">${state.cfg.voting_override==='open' ? 'Admin override — voting open' : `Locks ${fmtCutoff(show.cutoff_at)} · <b id="cd"></b>`}</div>
      <div class="err" id="p-err" style="text-align:center"></div>
    </div>
    ${footerHtml()}`;
  document.querySelectorAll(".slotline input").forEach(attachAutocomplete);
  document.querySelectorAll(".slotline input").forEach(inp => inp.addEventListener("input", () => {
    const d = {};
    document.querySelectorAll(".slotline input").forEach(i => { if (i.value.trim()) d[i.dataset.slot] = i.value; });
    localStorage.setItem(dKey, JSON.stringify(d));
  }));
  $("#save").onclick = savePicks;
  if (state.cfg.voting_override !== 'open' && show.cutoff_at) state.timers.push(setInterval(() => {
    const cd = countdown(show.cutoff_at);
    if (cd) $("#cd").textContent = cd + " left";
    else { toast("Picks are locked — enjoy the show 🥚"); openShow(show.id); }
  }, 1000));
}

export function attachAutocomplete(input){
  let list = null, sel = -1;
  const close = () => { list?.remove(); list = null; sel = -1; };
  input.addEventListener("input", () => {
    close();
    const q = input.value.trim().toLowerCase();
    if (q.length < 1) return;
    const coverOnly = input.dataset.type === "cover_pick";
    const pool = coverOnly ? state.songList.filter(s => s.is_original === false) : state.songList;
    const wc = [];
    if (!coverOnly && (state.cfg.wildcards?.debut ?? true) && ("any debut".includes(q) || "debut".includes(q)))
      wc.push({ songname: "Any Debut", times_played: "★" });
    const hits = [...wc, ...pool.filter(s => s.songname.toLowerCase().includes(q))].slice(0, 8);
    if (!hits.length) return;
    list = document.createElement("div"); list.className = "acc-list";
    hits.forEach(h => {
      const d = document.createElement("div");
      d.innerHTML = `${esc(h.songname)} <small>${h.times_played ?? "–"}×</small>`;
      d.onmousedown = e => { e.preventDefault(); input.value = h.songname; input.dispatchEvent(new Event("input")); close(); };
      list.appendChild(d);
    });
    input.parentElement.appendChild(list);
  });
  input.addEventListener("keydown", e => {
    if (!list) return;
    const items = [...list.children];
    if (e.key === "ArrowDown"){ sel = Math.min(sel+1, items.length-1); }
    else if (e.key === "ArrowUp"){ sel = Math.max(sel-1, 0); }
    else if (e.key === "Enter"){ e.preventDefault(); if (sel>=0){ input.value = items[sel].textContent.replace(/\s*\S*×$/,"").trim(); input.dispatchEvent(new Event("input")); } close(); return; }
    else return;
    items.forEach((it,i) => it.classList.toggle("sel", i===sel));
  });
  input.addEventListener("blur", () => setTimeout(close, 150));
}

export async function savePicks(){
  $("#p-err").textContent = "";
  const picks = [...document.querySelectorAll(".slotline input")]
    .map(i => ({ slot: i.dataset.slot, songname: i.value.trim() }))
    .filter(p => p.songname);
  // warn on unknown songs (typos) but allow — could be a debut call
  const unknown = picks.filter(p => !isWildcard(p.songname) && !state.songList.some(s => s.songname.toLowerCase() === p.songname.toLowerCase()));
  if (unknown.length && !confirm(`Not in the catalog (typo, or a bold debut call?):\n${unknown.map(u=>u.songname).join("\n")}\n\nSave anyway?`)) return;
  try{
    await rpc("submit_picks", { p_name:state.session.name, p_pin:state.session.pin, p_bracket_id:state.currentBracketId, p_show_id:state.currentShow.id, p_picks:picks });
    localStorage.removeItem(draftKey(state.currentShow.id));
    toast("Picks saved ✔", "score");
  }catch(e){ $("#p-err").textContent = e.message; }
}

export async function renderShowDetail(show){
  clearTimers();
  const [{ data: setlist }, picks, scores] = await Promise.all([
    db.from("setlist_songs").select("*").eq("show_id", show.id).order("position"),
    rpc("get_show_picks", { p_bracket_id: state.currentBracketId, p_show_id: show.id }).catch(() => []),
    rpc("get_bracket_scores", { p_name:state.session.name, p_pin:state.session.pin, p_bracket_id:state.currentBracketId, p_show_id: show.id })
      .then(rows => (rows||[]).sort((a,b) => b.points - a.points)),
  ]);
  const pname = Object.fromEntries((scores||[]).map(s => [s.player_id, s.player_name]));
  const mineHits = new Set((picks||[]).filter(p => p.player_id === state.session.id).map(p => p.songname.toLowerCase()));
  let lastSet = null;
  const setHtml = (setlist||[]).map(s => {
    const label = s.is_encore ? "Encore" : "Set " + (s.setnumber || "1");
    const brk = label !== lastSet ? `<div class="setbreak">${esc(label)}</div>` : "";
    lastSet = label;
    return brk + `
    <div class="songrow ${mineHits.has(s.songname.toLowerCase()) ? "hitmine" : ""}">
      <span class="pos">${s.position}</span>
      <span class="name">${esc(s.songname)}</span>
    </div>`;
  }).join("");
  const attribution = (setlist||[]).length ? `<p class="muted" style="text-align:center">Setlist data from ${
    show.permalink ? `<a href="${CARTON_SITE_BASE}/${esc(show.permalink)}" target="_blank" rel="noopener">The Carton</a>` : "The Carton"
  }.</p>` : "";
  const { order: brkOrder, label: brkLabel } = breakdownSlotInfo(show.format);
  // Only surface the explainer when it's actually relevant — a closer-family
  // pick is currently sitting on provisional off-slot points because the
  // encore (or the show) hasn't confirmed it yet. Keeps the note out of the
  // way once nothing's ambiguous, so it doesn't read as boilerplate.
  const hasUndetermined = (scores||[]).some(sc => (sc.breakdown||[]).some(b => (b.reason||"").includes("slot undetermined")));
  const scoreHtml = (scores||[]).map(sc => `
    <div class="panel" style="padding:12px">
      <div class="row"><b>${esc(pname[sc.player_id] || "?")}</b>
        <span class="pts" style="margin-left:auto;font-family:var(--mono);color:var(--yolk)">${sc.points} pts</span></div>
      ${sortBySlotOrder(sc.breakdown||[], brkOrder).map(b => `
        <div class="pickres ${b.points>0?"hit":b.hit?"":"miss"}">
          <span class="sl">${esc(brkLabel[b.slot] || prettifySlotKey(b.slot))}</span><span>${esc(b.songname)}</span>
          <span class="pt">${b.points>0?"+"+b.points:"·"} <small class="muted">${esc(b.reason)}</small></span>
        </div>`).join("")}
    </div>`).join("");
  // pre-scoring pick board: cutoff has passed, picks are public, but no scores yet
  let pickBoard = "";
  if (!(scores||[]).length && (picks||[]).length){
    const slotOrder = slotDefs(show.format).map(sl => sl.key);
    const slotLabel = Object.fromEntries(slotDefs(show.format).map(sl => [sl.key, sl.label]));
    const byName = {};
    for (const p of picks) (byName[p.player_name] ??= []).push(p);
    pickBoard = `<h2 style="margin:18px 4px 4px">The picks are in</h2>` +
      Object.entries(byName).sort((a,b) => a[0].localeCompare(b[0])).map(([name, pp]) => `
        <div class="panel" style="padding:12px"><div class="row"><b>${esc(name)}</b></div>
          ${pp.sort((a,b) => slotOrder.indexOf(a.slot) - slotOrder.indexOf(b.slot)).map(p => `
            <div class="pickres"><span class="sl">${esc(slotLabel[p.slot] || p.slot)}</span>
              <span>${esc(p.songname)}</span></div>`).join("")}
        </div>`).join("");
  }
  $("#main").innerHTML = `
    <p style="margin-top:14px"><button class="btn ghost small" onclick="renderShows()">← shows</button>
      <span class="pill ${showState(show)==='live'?'live':'final'}">${showState(show)==='final'?'complete':showState(show)}</span></p>
    ${(() => {
      if (show.status!=='final' || !(scores||[]).length) return "";
      const top = scores[0].points;
      if (top <= 0) return `<div class="panel"><h2>No winner</h2><p class="muted">Nobody scored on this one.</p></div>`;
      const champs = scores.filter(x => x.points === top).map(x => esc(pname[x.player_id]||"?"));
      return `<div class="panel" style="border-color:var(--yolk)">
        <h2>${winBadge(64)} ${champs.join(" & ")} ${champs.length>1?"tie for it":"takes it"}</h2>
        <p class="muted">${top} points${champs.length>1?" apiece":""}</p></div>`;
    })()}
    <div class="panel"><h2>${esc(show.venue||"")} <span class="muted" style="font-size:.85rem">${fmtDate(show.showdate)}</span></h2>
      ${currentBracket()?.bracket_kind === "official" ? `<div class="row" style="justify-content:center;gap:10px;margin:4px 0 12px">${trophy(26)}<span style="font-family:'Fraunces',serif;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:var(--yolk);font-size:.85rem">Official</span>${trophy(26)}</div>` : ""}
      ${setHtml || '<p class="muted">No setlist yet. It shows up here song-by-song once the tapers get typing.</p>'}</div>${attribution}
    ${pickBoard}
    <h2 style="margin:18px 4px 4px">Scores</h2>
    ${hasUndetermined ? `<p class="muted" style="text-align:center;margin:0 4px 8px">Closer-type picks show off-slot points (if enabled) until the encore starts (or the show ends) — full points lock in once determined.</p>` : ""}
    ${scoreHtml || '<p class="muted" style="margin:8px 4px">No scores yet — they appear with the first song.</p>'}
    ${footerHtml()}`;
}
