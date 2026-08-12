import { $, footerHtml } from "../core/dom.js";
import { state } from "../core/state.js";
import { rpc } from "../core/supabaseClient.js";
import { clearTimersFor } from "../core/format.js";
import { markTab } from "../core/layout.js";
import { toast } from "../core/toast.js";
import { renderBracketToggle, renderLeagueSelector } from "../core/switcher.js";

// Shared between the standalone Settings tab (non-admins) and a section
// inside the Admin tab (admins) — one panel, two mounting points, so the
// toggle/league-selector/logout/credits/PIN-change form never has to be
// kept in sync twice.
export function settingsPanelHtml(){
  return `<div class="panel"><h2>Settings</h2>
    <div class="field"><label>Bracket</label><div class="switcher" id="bracketToggle"></div></div>
    <div id="leagueSelect"></div>
    <p class="muted" style="margin-top:16px;font-weight:600">Change PIN</p>
    <div class="field"><label>Current PIN</label><input id="pin-current" inputmode="numeric" autocomplete="current-password" type="password" placeholder="••••"></div>
    <div class="field"><label>New PIN (4–8 digits)</label><input id="pin-new" inputmode="numeric" autocomplete="new-password" type="password" placeholder="••••"></div>
    <div class="field"><label>Confirm new PIN</label><input id="pin-confirm" inputmode="numeric" autocomplete="new-password" type="password" placeholder="••••"></div>
    <button class="btn ghost small" onclick="changeOwnPin()">Change PIN</button>
    <div class="err" id="pin-err"></div>
    <button class="btn ghost" style="margin-top:16px" onclick="logout()">Log out</button>
    <div class="credits">
      <p>Fantasy Eggy is an unofficial fan project — not affiliated with, endorsed by, or sponsored by Eggy or their management. Band names and song titles belong to their respective owners.</p>
      <p>Setlist data from <a href="https://thecarton.net" target="_blank" rel="noopener">The Carton</a>.</p>
      <p class="merch-plug"><a href="https://shop.eggymusic.com/" target="_blank" rel="noopener">Grab some merch</a> — it goes a long way toward keeping the band on the road.</p>
      <p class="colophon">Created by Kyle McKinley</p>
    </div>
  </div>`;
}
// Must run after the html above is in the DOM — both render targets call
// this right after setting innerHTML.
export function wireSettingsPanel(){
  renderBracketToggle();
  renderLeagueSelector();
}
export async function renderSettings(){
  clearTimersFor("admin"); state.tab = "admin"; markTab();
  $("#main").innerHTML = settingsPanelHtml() + footerHtml();
  wireSettingsPanel();
}
// Voluntary self-service PIN change — the other half of decision 3 (forgot-
// PIN: self-service change + an admin reset button). change_own_pin already
// existed for the forced interstitial (submitForcedPinChange, auth.js); this
// is the same RPC, just reachable without a pending must_change_pin flag.
// Requires and verifies the CURRENT PIN server-side (change_own_pin calls
// _auth_player(p_name, p_pin) before anything else — a wrong current PIN
// raises before any write happens), so a live session on a shared device
// can't be used to lock the account owner out.
export async function changeOwnPin(){
  $("#pin-err").textContent = "";
  const current = $("#pin-current").value;
  const next = $("#pin-new").value, confirmPin = $("#pin-confirm").value;
  if (next !== confirmPin){ $("#pin-err").textContent = "New PINs don't match."; return; }
  try{
    await rpc("change_own_pin", { p_name: state.session.name, p_pin: current, p_new_pin: next });
    state.session = { ...state.session, pin: next, must_change_pin: false };
    localStorage.setItem("ft_session", JSON.stringify(state.session));
    $("#pin-current").value = ""; $("#pin-new").value = ""; $("#pin-confirm").value = "";
    toast("PIN changed ✔", "score");
  }catch(e){ $("#pin-err").textContent = e.message; }
}
