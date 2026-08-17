import { $, esc } from "./dom.js";
import { db } from "./supabaseClient.js";
import { state } from "./state.js";
import { renderAuth, renderForceChangePin } from "../features/auth.js";
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
  // A real player once re-registered here three times, thinking a fresh
  // account would fix "not in a league yet" — each attempt just made the
  // eventual case-insensitive-login cleanup worse. The don't-re-register
  // warning is styled as its own callout (not buried in the muted prose
  // above it) specifically because burying it is what let that happen.
  // The copy deliberately says "whoever invited you", not "a league admin":
  // there is NO league context available on this screen and there cannot be.
  // The player holds a session and a public read of `leagues` (names only);
  // admin identities are unreachable by construction, since admin_list_members
  // is gated on _is_league_admin_or_global and a league-less player fails it.
  // They also haven't chosen a league, so there is no "their" league whose
  // admins could be resolved even in principle.
  //
  // This screen previously ended the first line with "you don't need to do
  // anything else", which was false and actively harmful: state.leagues is
  // populated only by resolveLeagues() inside boot(), which runs once at page
  // load, and nothing here polls or refetches. So after an admin adds them,
  // this screen keeps saying they aren't in a league until the app is fully
  // reloaded — while telling them no further action is needed, and (rightly)
  // forbidding the one thing they'd otherwise try. The Check again button is
  // the fix: it turns "fully close and reopen the app" into one tap, using
  // the reload path that already works rather than new refresh logic.
  $("#main").innerHTML = `<div class="panel" style="margin-top:30px">
    <h2>You're not in a league yet</h2>
    <p class="muted">Someone has to add you before you can play.</p>
    <p style="color:var(--coral);font-weight:600;margin:10px 0;padding:10px;border:1px solid var(--coral);border-radius:8px">
      Don't register again — a second account can't be merged with this one.</p>
    <p class="muted">${names.length ? `Leagues currently running: ${names.map(esc).join(", ")}. ` : ""}Tell whoever invited you that your nickname is <b>${esc(state.session.name)}</b>.</p>
    <p class="muted">Once they've added you, tap <b>Check again</b> below — this screen won't update on its own.</p>
    <div class="row" style="margin-top:12px">
      <button class="btn" onclick="location.reload()">Check again</button>
      <button class="btn ghost" onclick="logout()">Log out</button>
    </div>
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
  // A relayed reset PIN forces a real change before anything else renders —
  // existing sessions from before this flag existed read must_change_pin as
  // undefined (falsy), so nobody already logged in is affected.
  if (state.session.must_change_pin){ renderForceChangePin(); return; }
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
