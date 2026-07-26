import { $, esc } from "../core/dom.js";
import { db } from "../core/supabaseClient.js";
import { state } from "../core/state.js";
import { fmtDate, countdown, clearTimersFor, showState } from "../core/format.js";
import { winBadge } from "../core/trophy.js";
import { markTab } from "../core/layout.js";

export async function renderShows(){
  clearTimersFor("shows"); state.tab = "shows"; state.currentShow = null; markTab();
  const todayStr = new Date().toLocaleDateString('sv');
  const graceStr = new Date(Date.now() - 2*864e5).toISOString().slice(0,10);
  const [{ data: up }, { data: past }, { data: seas }] = await Promise.all([
    db.from("shows").select("*").gte("showdate", graceStr).order("showdate"),
    db.from("shows").select("*").lt("showdate", graceStr).order("showdate",{ascending:false}).limit(12),
    db.from("seasons").select("*").order("start_date"),
  ]);
  const seasonOf = d => (seas||[]).find(se => se.start_date <= d && d <= se.end_date);
  const isRecent = s => s.showdate < todayStr || s.status === "final";
  const upcoming = (up||[]).filter(s => !isRecent(s));
  const justPlayed = (up||[]).filter(isRecent);
  const finals = [...(up||[]), ...(past||[])].filter(s => s.status === "final").map(s => s.id);
  const winners = {};
  if (finals.length){
    const [{ data: sc }, { data: pl }] = await Promise.all([
      db.from("scores").select("show_id,player_id,points").in("show_id", finals),
      db.from("players_public").select("id,name"),
    ]);
    const pn = Object.fromEntries((pl||[]).map(p => [p.id, p.name]));
    const best = {};
    for (const s of sc||[]){
      if (s.points <= 0) continue;
      if (!best[s.show_id] || s.points > best[s.show_id]) best[s.show_id] = s.points;
    }
    for (const s of sc||[]){
      if (s.points > 0 && s.points === best[s.show_id])
        (winners[s.show_id] ??= { points: s.points, names: [] }).names.push(pn[s.player_id] || "?");
    }
  }
  const row = s => {
    const st = showState(s);
    const cls = { open:"open", live:"live", locked:"locked", final:"final", played:"final" }[st] || "";
    const cd = st === "open" ? countdown(s.cutoff_at) : null;
    const txt = st === "final" ? "complete" : (st === "open" && cd ? "locks in " + cd : st);
    const win = st === "final" && winners[s.id]
      ? ` <span style="color:var(--yolk);font-size:.82rem">${winBadge(36)} ${winners[s.id].names.map(esc).join(" & ")} · ${winners[s.id].points}</span>` : "";
    return `<div class="showrow">
      <div class="date">${fmtDate(s.showdate)}</div>
      <div class="v"><div class="venue">${esc(s.venue||"TBA")}</div>
        <div class="loc">${esc(s.city||"")}${s.state?", "+esc(s.state):""}
          <span class="pill ${cls}" data-cd="${st==='open'?s.cutoff_at:''}">${txt}</span>${win}</div></div>
      <button onclick="openShow(${s.id})">${st==='open'?'Pick':'View'}</button>
    </div>`;
  };
  const withSeasons = list => {
    let last;
    return list.map(sh => {
      const se = seasonOf(sh.showdate);
      const label = se ? se.name : "Between tours";
      const brk = label !== last ? `<div class="setbreak">${esc(label)}</div>` : "";
      last = label;
      return brk + row(sh);
    }).join("");
  };
  $("#main").innerHTML = `
    ${justPlayed.length ? `<div class="panel"><h2>Just played</h2>${justPlayed.map(row).join("")}</div>` : ""}
    <div class="panel"><h2>Upcoming</h2>${withSeasons(upcoming) || '<p class="muted">No shows synced yet — admin can sync from The Carton.</p>'}</div>
    <div class="panel"><h2>Recent</h2>${withSeasons(past||[]) || '<p class="muted">Nothing yet.</p>'}</div>`;
  state.timers.push(setInterval(() => {
    document.querySelectorAll("[data-cd]").forEach(el => {
      if (!el.dataset.cd) return;
      const cd = countdown(el.dataset.cd);
      el.textContent = cd ? "locks in " + cd : "locked";
    });
  }, 1000));
}
