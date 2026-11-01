// Discord hint — docs/decisions/discord-routing.md → "Per-league split"
// (D1, D3–D6) and "Part 2 build record: APPROVED 2026-11-01" (the dev's
// seven calls). One slim bar on the shows list, reusing the install bar's
// classes (.installbar / .installhow, no new CSS), pointing a league's
// players at its Discord. It shows only where ALL of these hold:
//   * the edge function's daily check says the league's webhook is live
//     (D1: server-written, read off the my_leagues row as discord_live —
//     a success within 2 days and no dead status, the refined rule);
//   * the league has an https invite (leagues.config.discord_url, through
//     community.js's one guard);
//   * nobody has dismissed it on this device for THIS league (D5);
//   * neither the install bar nor the welcome card is on screen (D6: one
//     hint at a time, install first).
// It shows everywhere, desktop included (D4).
//
// The rule is a pure function (discordHintApplies) so the harness drives it
// through the DOM and each mutation has one target:
//   M4 the hint ignores the install bar;  M5 Join doesn't set the flag;
//   M6 the hint ignores discord_live;      M7 the flag is device-wide;
//   M8 discord_live ignores a stale check (the SQL side, mirrored in the
//      harness fake; the live expression is proven by Stage Y's STEP 2B).
//
// Handover is NEXT RENDER (the dev's call 3): dismissing the install bar or
// the welcome card never renders this bar — nothing here is called from
// their dismissals — it appears the next time the shows list is built. Only
// this bar's own controls act at once: ✕ and Join clear the slot, and the
// Settings switch re-renders it under the same rule.
import { state } from "./state.js";
import { currentBracket } from "./switcher.js";
import { discordLinkOf } from "./community.js";
import { esc } from "./dom.js";
import { DISCORD_FLAG_PREFIX } from "./config.js";

// D5: per league, per device. "<prefix><leagueId>" = "1".
export const discordFlagKey = leagueId => `${DISCORD_FLAG_PREFIX}${leagueId}`;
export function discordDismissed(leagueId){
  if (leagueId == null) return true;
  try { return localStorage.getItem(discordFlagKey(leagueId)) === "1"; } catch { return false; }
}
function setDismissed(leagueId, on){
  if (leagueId == null) return;
  try { on ? localStorage.setItem(discordFlagKey(leagueId), "1") : localStorage.removeItem(discordFlagKey(leagueId)); }
  catch { /* storage blocked: nothing to persist */ }
}

// The rule. `row` is the current my_leagues row. discord_live must be
// STRICTLY true: an older my_leagues without the column (undefined), or any
// non-boolean, never shows the bar.
export function discordHintApplies({ row, dismissed, installOnScreen, welcomeOnScreen }){
  if (!row || row.discord_live !== true) return false;
  if (!discordLinkOf(row)) return false;
  if (dismissed) return false;
  if (installOnScreen || welcomeOnScreen) return false;
  return true;
}
// Could the Settings switch ever matter for this league: it has a valid
// link. Live or not — the switch undoes a dismissal, and a webhook that is
// down today may be back tomorrow.
export function discordTipsPossible(row = currentBracket()){ return !!discordLinkOf(row); }

const DONT = "Don't show again";
export const DISCORD_BAR_TEXT = "Get show reminders and scores in Discord";
// D3: a plain-text tip in the "How?" expander; the role ping stays deferred.
export const DISCORD_TIP = "After you join, open the channel's notification settings and pick All Messages. Discord only buzzes for mentions otherwise.";
// Join is an anchor, never window.open (the dev's call 4: in-app browsers
// block window.open). Its onclick counts as a dismissal (D5).
function barHtml(url){
  return `<div class="installbar discordbar"><span class="ib-text">${DISCORD_BAR_TEXT}</span>
    <a class="linkbtn ib-join" href="${esc(url)}" target="_blank" rel="noopener noreferrer" onclick="joinDiscord()">Join</a>
    <button class="linkbtn ib-how" id="discord-how-btn" onclick="toggleDiscordHow()" aria-expanded="false">How?</button>
    <button class="linkbtn ib-x" onclick="dismissDiscord()" aria-label="${DONT}" title="${DONT}">✕</button></div>
    <div class="installhow hidden" id="discord-how"><p class="ih-step">${DISCORD_TIP}</p></div>`;
}
// D6 reads the DOM: the install bar in its slot, or the card's install
// section (which only exists inside the welcome card).
function installOnScreen(){
  return !!document.querySelector("#install-bar .installbar") || !!document.getElementById("install-section");
}

// Fills #discord-bar. renderShows calls this once per build of the list,
// AFTER renderInstallSlots(), so the install bar has already claimed its
// slot when the rule reads the DOM. Nothing else calls it except this
// module's own controls.
export function renderDiscordSlot(){
  const slot = document.getElementById("discord-bar");
  if (!slot) return;
  const row = currentBracket();
  const applies = discordHintApplies({
    row, dismissed: discordDismissed(row?.league_id),
    installOnScreen: installOnScreen(), welcomeOnScreen: !!document.getElementById("welcome-card"),
  });
  slot.innerHTML = applies ? barHtml(discordLinkOf(row)) : "";
  syncSwitch();
}
function clearSlot(){ const slot = document.getElementById("discord-bar"); if (slot) slot.innerHTML = ""; }
// The Settings switch, when it is on screen (the wide layout renders
// Settings beside the list): checked = tips allowed for the CURRENT league;
// removed where the league has no link.
function syncSwitch(){
  const box = document.getElementById("discord-tips");
  if (!box) return;
  if (discordTipsPossible()) box.checked = !discordDismissed(state.currentLeagueId);
  else box.closest(".tips-switch")?.remove();
}

export function dismissDiscord(){ setDismissed(state.currentLeagueId, true); clearSlot(); syncSwitch(); }
// Join counts as a permanent dismissal (D5). The anchor itself opens the
// invite; the slot is cleared on the NEXT tick, because an anchor removed
// from the document while its click is still dispatching cannot navigate.
export function joinDiscord(){
  setDismissed(state.currentLeagueId, true);
  setTimeout(() => { clearSlot(); syncSwitch(); }, 0);
}
// The undo, for the current league only. Acts on its own slot at once (as
// the install switch does); on a tab without the list there is no slot and
// the next build of the list picks the flag up.
export function setDiscordTips(on){ setDismissed(state.currentLeagueId, !on); renderDiscordSlot(); }
export function toggleDiscordHow(){
  const el = document.getElementById("discord-how");
  if (!el) return;
  const open = !el.classList.toggle("hidden");
  document.getElementById("discord-how-btn")?.setAttribute("aria-expanded", String(open));
}

// ---------- the admin Community editor's read-only line (the dev's call 7) ----------
// What the server last recorded for this league, off the same my_leagues
// row — no RPC. Relative time, coarse on purpose; `nowMs` is injected for
// the harness.
export function relativeTime(iso, nowMs = Date.now()){
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "at an unknown time";
  const s = Math.max(0, Math.round((nowMs - t) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} minute${m === 1 ? "" : "s"} ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} hour${h === 1 ? "" : "s"} ago`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? "" : "s"} ago`;
}
// "Posting: OK, checked <when>" / "Not posting (<status>), checked <when>" /
// "Never checked". A stale success reads "Not posting (ok), checked 3 days
// ago": the status word is what was stored, the time says why it is not live.
export function discordStatusLine(row, nowMs = Date.now()){
  if (!row?.discord_checked_at) return "Never checked";
  const when = relativeTime(row.discord_checked_at, nowMs);
  return row.discord_live === true
    ? `Posting: OK, checked ${when}`
    : `Not posting (${row.discord_status ?? "unknown"}), checked ${when}`;
}
