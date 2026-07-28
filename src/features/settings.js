import { $, footerHtml } from "../core/dom.js";
import { state } from "../core/state.js";
import { clearTimersFor } from "../core/format.js";
import { markTab } from "../core/layout.js";
import { renderBracketToggle, renderLeagueSelector } from "../core/switcher.js";

// Shared between the standalone Settings tab (non-admins) and a section
// inside the Admin tab (admins) — one panel, two mounting points, so the
// toggle/league-selector/logout/credits never has to be kept in sync twice.
export function settingsPanelHtml(){
  return `<div class="panel"><h2>Settings</h2>
    <div class="field"><label>Bracket</label><div class="switcher" id="bracketToggle"></div></div>
    <div id="leagueSelect"></div>
    <button class="btn ghost" onclick="logout()">Log out</button>
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
