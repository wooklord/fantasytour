import { $, esc } from "./dom.js";
import { db } from "./supabaseClient.js";
import { state } from "./state.js";
import { renderAuth } from "../features/auth.js";
import { subscribeRealtime } from "./realtime.js";
import { renderAll } from "./layout.js";
import { APP_NAME } from "./config.js";
import { loadConfig, resolveLeagues, renderSwitcher, isCurrentLeagueAdmin } from "./switcher.js";

export { loadConfig };

export async function loadSongs(){
  const { data, error } = await db.from("songs_cache").select("*").order("times_played",{ascending:false});
  if (error) throw new Error("Couldn't load song catalog: " + error.message);
  state.songList = data || [];
}
export function renderWho(){
  $("#whoami").innerHTML = state.session
    ? `<b>${esc(state.session.name)}</b> <button class="linkbtn" onclick="logout()">log out</button>` : "";
}
export function logout(){ state.session = null; localStorage.removeItem("ft_session"); location.reload(); }

function renderNoLeague(){
  $("#main").innerHTML = `<div class="panel" style="margin-top:30px">
    <h2>You're not in a league yet</h2>
    <p class="muted">Ask a league admin to add you — they'll need your player name.</p>
    <button class="btn ghost" onclick="logout()">Log out</button>
  </div>`;
}

export async function boot(){
  document.title = APP_NAME;
  const nameEl = document.getElementById("appName");
  if (nameEl) nameEl.textContent = APP_NAME;
  renderWho();
  if (!state.session){ renderAuth(); return; }
  try{
    const hasLeague = await resolveLeagues();
    if (!hasLeague){ renderNoLeague(); return; }
    $("#tabs").style.display = "flex";
    if (isCurrentLeagueAdmin()) $("#admintab").style.display = "";
    renderSwitcher();
    await Promise.all([loadConfig(), loadSongs()]);
    subscribeRealtime();
    await renderAll();
  }catch(e){
    console.error(e);
    $("#main").innerHTML = `<div class="panel" style="margin-top:30px;border-color:var(--coral)">
      <h2>Something broke loading the app</h2>
      <p class="muted" style="word-break:break-word">${esc(e.message || String(e))}</p>
      <div class="row" style="margin-top:10px">
        <button class="btn" onclick="location.reload()">Reload</button>
        <button class="btn ghost" onclick="logout()">Log out</button>
      </div></div>`;
  }
}
