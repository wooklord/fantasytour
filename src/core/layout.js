import { $, isDesktop } from "./dom.js";
import { state } from "./state.js";
import { renderShows } from "../features/shows.js";
import { renderBoard } from "../features/standings.js";
import { renderAdmin } from "../features/admin.js";

export function markTab(){
  document.querySelectorAll("nav.tabs button").forEach(b => b.classList.toggle("on", b.dataset.tab === state.tab));
}
document.querySelectorAll("nav.tabs button").forEach(b => b.onclick = () => {
  ({ shows: renderShows, board: renderBoard, admin: renderAdmin })[b.dataset.tab]();
});

// desktop: paint every column; keep `tab` pointed so each render targets its own container
export async function renderAll(){
  if (!isDesktop()){ await renderShows(); return; }
  applyLayout();
  const savedShow = state.currentShow;
  await renderBoard();
  await renderShows();
  if (state.session.is_admin) await renderAdmin();
  state.currentShow = savedShow;
}
export function applyLayout(){
  const desk = isDesktop();
  $("#cols") && ($("#cols").style.display = desk ? "grid" : "none");
  const c = document.getElementById("cols");
  if (c){
    const admin = !!(state.session && state.session.is_admin);
    document.getElementById("col-admin").style.display = admin && desk ? "" : "none";
    c.style.gridTemplateColumns = admin ? "1fr 1.15fr 1fr" : "1fr 1.2fr";
  }
}
let _lastDesk = isDesktop();
window.addEventListener("resize", () => {
  const now = isDesktop();
  if (now !== _lastDesk){ _lastDesk = now; if (state.session) renderAll(); }
});
