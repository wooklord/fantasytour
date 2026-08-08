import { $, isDesktop } from "./dom.js";
import { state } from "./state.js";
import { isCurrentLeagueAdmin } from "./switcher.js";
import { renderShows, enterShowsTab } from "../features/shows.js";
import { renderBoard } from "../features/standings.js";
import { renderAdmin } from "../features/admin.js";
import { renderSettings } from "../features/settings.js";
import { renderAuth } from "../features/auth.js";

// The third tab/column is a shared slot: Admin for league admins, Settings
// for everyone else — not two separate destinations.
export const renderAdminOrSettings = () => isCurrentLeagueAdmin() ? renderAdmin() : renderSettings();

export function markTab(){
  document.querySelectorAll("nav.tabs button").forEach(b => b.classList.toggle("on", b.dataset.tab === state.tab));
}
document.querySelectorAll("nav.tabs button").forEach(b => b.onclick = () => {
  ({ shows: enterShowsTab, board: renderBoard, admin: renderAdminOrSettings })[b.dataset.tab]();
});

// desktop: paint every column; keep `tab` pointed so each render targets its own container
export async function renderAll(){
  if (!isDesktop()){ await renderShows(); return; }
  applyLayout();
  const savedShow = state.currentShow;
  await renderBoard();
  await renderShows();
  await renderAdminOrSettings();
  state.currentShow = savedShow;
}
// Third column is always shown now — it's Admin or Settings, never empty.
export function applyLayout(){
  const desk = isDesktop();
  $("#cols") && ($("#cols").style.display = desk ? "grid" : "none");
  const c = document.getElementById("cols");
  if (c){
    document.getElementById("col-admin").style.display = desk ? "" : "none";
    c.style.gridTemplateColumns = "1fr 1.15fr 1fr";
  }
}
let _lastDesk = isDesktop();
window.addEventListener("resize", () => {
  const now = isDesktop();
  if (now === _lastDesk) return;
  _lastDesk = now;
  applyLayout(); // always — #cols visibility must track the breakpoint even pre-login
  if (state.session) renderAll();
  else renderAuth(); // re-render into whichever container is now current
});
