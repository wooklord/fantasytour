import { $, esc } from "./dom.js";
import { db } from "./supabaseClient.js";
import { state } from "./state.js";
import { renderAuth } from "../features/auth.js";
import { subscribeRealtime } from "./realtime.js";
import { renderAll } from "./layout.js";

export async function loadConfig(){
  const { data, error } = await db.from("game_config").select("data").eq("id",1).single();
  if (error) throw new Error("Couldn't load game config: " + error.message);
  state.cfg = data.data;
}
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

export async function boot(){
  renderWho();
  if (!state.session){ renderAuth(); return; }
  $("#tabs").style.display = "flex";
  if (state.session.is_admin) $("#admintab").style.display = "";
  try{
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
