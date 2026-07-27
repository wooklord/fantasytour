import { $, esc, footerHtml } from "../core/dom.js";
import { rpc } from "../core/supabaseClient.js";
import { state } from "../core/state.js";
import { fetchShows } from "../core/leagueShows.js";
import { clearTimersFor } from "../core/format.js";
import { trophy, winBadge } from "../core/trophy.js";
import { markTab } from "../core/layout.js";

// Bound to the standings-select onchange (see renderBoard below) — replaces the
// original inline `boardSeason=this.value; renderBoard();` now that boardSeason
// lives on the shared state object instead of a bare global.
export function setBoardSeason(v){ state.boardSeason = v; renderBoard(); }

export async function renderBoard(){
  clearTimersFor("board"); state.tab = "board"; markTab();
  const [sc, allShows, seasons] = await Promise.all([
    rpc("get_bracket_scores", { p_name:state.session.name, p_pin:state.session.pin, p_bracket_id: state.currentBracketId }),
    fetchShows(q => q),
    rpc("get_bracket_seasons", { p_bracket_id: state.currentBracketId }),
  ]);
  const pname = Object.fromEntries((sc||[]).map(s => [s.player_id, s.player_name]));
  const showById = Object.fromEntries((allShows||[]).map(sh => [sh.id, sh]));
  const today = new Date().toLocaleDateString('sv');
  if (state.boardSeason === null){
    const cur = (seasons||[]).find(se => se.start_date <= today && today <= se.end_date)
      || (seasons||[]).slice(-1)[0];
    state.boardSeason = cur ? String(cur.id) : "all";
  }
  const season = (seasons||[]).find(se => String(se.id) === state.boardSeason);
  const inScope = row => {
    if (!season) return true;
    const sh = showById[row.show_id]; if (!sh) return false;
    return sh.showdate >= season.start_date && sh.showdate <= season.end_date;
  };
  const T = {};
  for (const row of (sc||[])){
    const t = (T[row.player_id] ??= { career:0, scoped:0, shows:0, high:0, highShow:null, wins:0 });
    t.career += row.points;
    if (inScope(row)){
      t.scoped += row.points; t.shows++;
      if (row.points > t.high){ t.high = row.points; t.highShow = showById[row.show_id]; }
    }
  }
  // wins: every top scorer of each finalized show in scope
  const byShow = {};
  for (const row of (sc||[])) if (inScope(row) && showById[row.show_id]?.status === "final")
    (byShow[row.show_id] ??= []).push(row);
  for (const arr of Object.values(byShow)){
    const mx = Math.max(...arr.map(x => x.points));
    if (mx > 0) for (const x of arr) if (x.points === mx) T[x.player_id].wins++;
  }
  const rows = Object.entries(T).sort((a,b) => b[1].scoped - a[1].scoped || b[1].career - a[1].career);
  const opts = [...(seasons||[]).map(se =>
      `<option value="${se.id}" ${state.boardSeason===String(se.id)?"selected":""}>${esc(se.name)}</option>`),
    `<option value="all" ${state.boardSeason==="all"?"selected":""}>All time</option>`].join("");
  const scopeName = season ? esc(season.name) : "All time";
  const podOrder = [1,0,2].filter(i => rows[i]);
  const podium = rows.length ? `<div class="podium">${podOrder.map(i => {
    const [pid, r] = rows[i];
    return `<div class="pod ${i===0?"first":""}">${trophy(i===0?118:82, ["gold","silver","bronze"][i])}
      <b>${esc(pname[pid]||"?")}</b><span class="podpts">${r.scoped} pts</span></div>`;
  }).join("")}</div>` : "";
  const statRows = rows.filter(([,r]) => r.shows > 0)
    .sort((a,b) => b[1].scoped/b[1].shows - a[1].scoped/a[1].shows);
  $("#main").innerHTML = `
    <div class="panel">
      <div class="row"><h2 style="margin:0">Standings</h2>
        <select onchange="setBoardSeason(this.value)"
          style="margin-left:auto;background:var(--pit);border:1px solid var(--line2);color:var(--cream);border-radius:8px;padding:6px 8px;font-size:.82rem">${opts}</select></div>
      ${podium}
      <div style="overflow-x:auto"><table class="lb"><tr><th></th><th>Player</th><th style="text-align:right">Score</th></tr>
      ${rows.map(([id,r],i) => `<tr class="${id===state.session.id?"me":""}">
        <td class="rank">${i+1}</td><td>${esc(pname[id]||"?")}</td>
        <td class="pts">${season ? r.scoped : r.career}</td></tr>`).join("")
        || '<tr><td colspan="3" class="muted">No scores yet — pick some songs.</td></tr>'}
      </table></div>
    </div>
    <div class="panel"><h2>Nerd stats <span class="muted" style="font-size:.78rem">· ${scopeName}</span></h2>
      <div style="overflow-x:auto"><table class="lb compact"><tr><th>Player</th><th style="text-align:right">Shows</th><th style="text-align:right">Avg</th><th style="text-align:right">High</th><th style="text-align:right">${winBadge(18)}</th></tr>
      ${statRows.map(([id,r]) => `<tr class="${id===state.session.id?"me":""}">
        <td>${esc(pname[id]||"?")}</td><td class="pts">${r.shows}</td>
        <td class="pts">${(r.scoped/r.shows).toFixed(1)}</td>
        <td class="pts" title="${esc(r.highShow?.venue||"")}">${r.high}</td>
        <td class="pts">${r.wins||0}</td></tr>`).join("")
        || '<tr><td colspan="5" class="muted">Stats appear once shows score.</td></tr>'}
      </table></div>
      <p class="muted" style="margin-top:8px;font-size:.75rem">Avg = points per show played · High = best single show (venue on hover) · wreath = shows won</p>
    </div>
    ${footerHtml()}`;
}
