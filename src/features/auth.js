import { $, footerHtml } from "../core/dom.js";
import { rpc } from "../core/supabaseClient.js";
import { state } from "../core/state.js";

export function renderAuth(){
  $("#main").innerHTML = `
    <div class="panel" style="margin-top:38px">
      <h2 class="display">Who's picking?</h2>
      <p class="muted">Name + PIN. That's the whole account.</p>
      <div class="field"><label>Name</label><input id="a-name" autocomplete="username" placeholder="Wooklord"></div>
      <div class="field"><label>PIN (4–8 digits)</label><input id="a-pin" inputmode="numeric" autocomplete="current-password" type="password" placeholder="••••"></div>
      <div class="row">
        <button class="btn" onclick="doLogin()">Log in</button>
        <button class="btn ghost" onclick="doRegister()">New player</button>
      </div>
      <div class="err" id="a-err"></div>
    </div>
    ${footerHtml()}`;
}
export async function doLogin(){ authFlow("login"); }
export async function doRegister(){ authFlow("register_player"); }
export async function authFlow(fn){
  $("#a-err").textContent = "";
  try{
    const d = await rpc(fn, { p_name: $("#a-name").value, p_pin: $("#a-pin").value });
    state.session = { ...d, pin: $("#a-pin").value };
    localStorage.setItem("ft_session", JSON.stringify(state.session));
    location.reload();
  }catch(e){ $("#a-err").textContent = e.message; }
}

// Forced interstitial for state.session.must_change_pin — a league/global
// admin just relayed a server-generated PIN via admin_reset_player_pin, and
// this is the only screen reachable until a real (self-chosen) PIN is set.
// Mirrors renderAuth()'s structure; the "Log out" escape hatch matters here
// specifically because the relayed PIN might have been typed in wrong.
export function renderForceChangePin(){
  $("#main").innerHTML = `
    <div class="panel" style="margin-top:38px">
      <h2 class="display">Set a new PIN</h2>
      <p class="muted">Your PIN was reset by an admin. Choose a new one to continue — this replaces it for good.</p>
      <div class="field"><label>New PIN (4–8 digits)</label><input id="fp-new" inputmode="numeric" autocomplete="new-password" type="password" placeholder="••••"></div>
      <div class="field"><label>Confirm new PIN</label><input id="fp-confirm" inputmode="numeric" autocomplete="new-password" type="password" placeholder="••••"></div>
      <div class="row">
        <button class="btn" onclick="submitForcedPinChange()">Set PIN</button>
        <button class="btn ghost" onclick="logout()">Log out</button>
      </div>
      <div class="err" id="fp-err"></div>
    </div>
    ${footerHtml()}`;
}
export async function submitForcedPinChange(){
  $("#fp-err").textContent = "";
  const p_new_pin = $("#fp-new").value, confirm = $("#fp-confirm").value;
  if (p_new_pin !== confirm){ $("#fp-err").textContent = "PINs don't match."; return; }
  try{
    await rpc("change_own_pin", { p_name: state.session.name, p_pin: state.session.pin, p_new_pin });
    state.session = { ...state.session, pin: p_new_pin, must_change_pin: false };
    localStorage.setItem("ft_session", JSON.stringify(state.session));
    location.reload();
  }catch(e){ $("#fp-err").textContent = e.message; }
}
