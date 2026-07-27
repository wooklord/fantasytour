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
