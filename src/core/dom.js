import { state } from "./state.js";

export const isDesktop = () => window.matchMedia("(min-width:901px)").matches;
export const colMap = { shows: "#main-shows", board: "#main-board", admin: "#main-admin" };
export const $ = (sel, el=document) => {
  if (sel === "#main" && isDesktop() && el === document) return document.querySelector(colMap[state.tab] || "#main-shows");
  return el.querySelector(sel);
};
export const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

// Appended at the end of every top-level #main render — a barely-there
// colophon. The more visible credit (with the fan-project disclaimer and
// Carton/merch links) lives in the Settings panel, not here.
export const footerHtml = () => `<footer class="colophon-foot">Created by Kyle McKinley</footer>`;
