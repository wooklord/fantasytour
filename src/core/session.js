import { $, esc } from "./dom.js";
import { db } from "./supabaseClient.js";
import { state } from "./state.js";
import { renderAuth } from "../features/auth.js";
import { subscribeRealtime } from "./realtime.js";
import { renderAll, applyLayout } from "./layout.js";
import { APP_NAME } from "./config.js";
import { loadConfig, resolveLeagues, renderHeaderChrome } from "./switcher.js";

export { loadConfig };

export async function loadSongs(){
  const { data, error } = await db.from("songs_cache").select("*").order("times_played",{ascending:false});
  if (error) throw new Error("Couldn't load song catalog: " + error.message);
  state.songList = data || [];
}
export function logout(){ state.session = null; localStorage.removeItem("ft_session"); location.reload(); }

async function renderNoLeague(){
  // leagues has a public RLS read policy (stage_a_schema.sql — needed for the
  // switcher), so this is a free read: no RPC, no auth check needed beyond
  // the session already established. Naming the actual leagues turns "ask a
  // league admin" from a dead end into an actionable next step — the player
  // didn't know a name to give, they didn't know which admin to ask.
  let names = [];
  try{
    const { data } = await db.from("leagues").select("name").order("name");
    names = (data||[]).map(l => l.name);
  }catch(e){ /* fall through to the generic copy below */ }
  $("#main").innerHTML = `<div class="panel" style="margin-top:30px">
    <h2>You're not in a league yet</h2>
    <p class="muted">Ask a league admin to add you — they'll need your player name (${esc(state.session.name)}).</p>
    ${names.length ? `<p class="muted">Leagues currently running: ${names.map(esc).join(", ")}.</p>` : ""}
    <button class="btn ghost" onclick="logout()">Log out</button>
  </div>`;
}

export async function boot(){
  document.title = APP_NAME;
  const nameEl = document.getElementById("appName");
  if (nameEl) nameEl.textContent = APP_NAME;
  renderHeaderChrome();
  // Must run before ANY render decision below, not just the logged-in path:
  // on desktop, #cols starts hidden (inline style in index.html) and only
  // becomes visible once this runs — `$("#main")` redirects to a column
  // inside it. Every one of renderAuth()/renderNoLeague()/the catch panel
  // below writes via $("#main"), so without this they silently render into
  // a hidden container on desktop. This bug predated Stage C2a entirely
  // (present since the 3-column layout's introduction, commit e7fa3ef) —
  // nobody noticed because testing almost always carried over an existing
  // localStorage session, which skipped straight past the broken branch.
  applyLayout();
  if (!state.session){ renderAuth(); return; }
  try{
    const hasLeague = await resolveLeagues();
    if (!hasLeague){ await renderNoLeague(); return; }
    $("#tabs").style.display = "flex";
    renderHeaderChrome();
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
