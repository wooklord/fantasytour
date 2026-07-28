import { $, esc, footerHtml } from "../core/dom.js";
import { rpc } from "../core/supabaseClient.js";
import { state } from "../core/state.js";
import { fetchShows } from "../core/leagueShows.js";
import { fmtDate, countdown, clearTimersFor, showState } from "../core/format.js";
import { winBadge } from "../core/trophy.js";
import { markTab } from "../core/layout.js";
import { currentBracket } from "../core/switcher.js";

export async function renderShows(){
  clearTimersFor("shows"); state.tab = "shows"; state.currentShow = null; markTab();
  const todayStr = new Date().toLocaleDateString('sv');
  const graceStr = new Date(Date.now() - 2*864e5).toISOString().slice(0,10);
  const [up, past, seas] = await Promise.all([
    fetchShows(q => q.gte("showdate", graceStr).order("showdate")),
    fetchShows(q => q.lt("showdate", graceStr).order("showdate",{ascending:false}).limit(12)),
    rpc("get_bracket_seasons", { p_bracket_id: state.currentBracketId }),
  ]);
  const seasonOf = d => (seas||[]).find(se => se.start_date <= d && d <= se.end_date);
  const isOfficial = currentBracket()?.bracket_kind === "official";
  const isRecent = s => s.showdate < todayStr || s.status === "final";
  const upcoming = (up||[]).filter(s => !isRecent(s));
  const justPlayed = (up||[]).filter(isRecent);
  const finals = [...(up||[]), ...(past||[])].filter(s => s.status === "final").map(s => s.id);
  const winners = {};
  if (finals.length){
    const sc = await rpc("get_bracket_scores", { p_name:state.session.name, p_pin:state.session.pin, p_bracket_id: state.currentBracketId });
    const relevant = (sc||[]).filter(s => finals.includes(s.show_id));
    const best = {};
    for (const s of relevant){
      if (s.points <= 0) continue;
      if (!best[s.show_id] || s.points > best[s.show_id]) best[s.show_id] = s.points;
    }
    for (const s of relevant){
      if (s.points > 0 && s.points === best[s.show_id])
        (winners[s.show_id] ??= { points: s.points, names: [] }).names.push(s.player_name || "?");
    }
  }
  // Official-without-a-covering-season is visible up front (greyed row),
  // not just discovered after tapping Pick — but the Pick button and the
  // existing "tap through, see the reason, link to Casual" flow stay as-is.
  const row = s => {
    const st = showState(s);
    const cls = { open:"open", live:"live", locked:"locked", final:"final", played:"final" }[st] || "";
    const cd = st === "open" ? countdown(s.cutoff_at) : null;
    const txt = st === "final" ? "complete" : (st === "open" && cd ? "locks in " + cd : st);
    const win = st === "final" && winners[s.id]
      ? ` <span style="color:var(--yolk);font-size:.82rem">${winBadge(36)} ${winners[s.id].names.map(esc).join(" & ")} · ${winners[s.id].points}</span>` : "";
    const noSeason = isOfficial && !seasonOf(s.showdate);
    return `<div class="showrow${noSeason ? " unavailable" : ""}">
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
  // Roster/opt-in ineligibility (as opposed to "no season covers this show")
  // applies uniformly to every show in the season, not per-row — so it's one
  // banner for the whole view rather than greying every row. Detected via
  // whichever show currently has a covering season, since the reason is a
  // property of the player's season membership, not the specific show.
  let rosterBanner = "";
  if (isOfficial){
    const covered = [...upcoming, ...justPlayed].find(s => seasonOf(s.showdate));
    if (covered){
      try{
        const [gate] = await rpc("can_submit_picks", { p_name:state.session.name, p_pin:state.session.pin, p_bracket_id:state.currentBracketId, p_show_id:covered.id });
        if (gate && !gate.ok && /roster/i.test(gate.reason || "")) rosterBanner = gate.reason;
      }catch(e){ /* fail open — no banner rather than a confusing error here */ }
    }
  }
  $("#main").innerHTML = `
    ${rosterBanner ? `<div class="noticebox">${esc(rosterBanner)}</div>` : ""}
    ${justPlayed.length ? `<div class="panel"><h2>Just played</h2>${justPlayed.map(row).join("")}</div>` : ""}
    <div class="panel"><h2>Upcoming</h2>${withSeasons(upcoming) || '<p class="muted">No shows synced yet — admin can sync from The Carton.</p>'}</div>
    <div class="panel"><h2>Recent</h2>${withSeasons(past||[]) || '<p class="muted">Nothing yet.</p>'}</div>
    ${footerHtml()}`;
  state.timers.push(setInterval(() => {
    document.querySelectorAll("[data-cd]").forEach(el => {
      if (!el.dataset.cd) return;
      const cd = countdown(el.dataset.cd);
      el.textContent = cd ? "locks in " + cd : "locked";
    });
  }, 1000));
}
