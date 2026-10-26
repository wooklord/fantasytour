// Onboarding Batch 3: install help. The "Get the app" section inside the
// welcome card, the slim bar on the shows list, and the Settings undo.
// Record: docs/decisions/onboarding.md, decision 6, Batch 3 (LOCKED,
// AMENDED and APPROVED 2026-10-26). The pure parts (detectPlatform,
// isStandalone, installStepsHtml) are unit-tested in test/install.test.mjs
// against real user-agent shapes; the rest is DOM wiring the harness drives.
// No dom.js import: it pulls in state.js, which reads localStorage at load,
// and this module must import cleanly in plain Node for its unit tests. The
// only interpolated values are APP_NAME and an in-app name from
// detectPlatform's own fixed list, so there is nothing to escape.
import { APP_NAME } from "./config.js";

// ONE device flag for ALL install help: the bar AND the card's section.
// Dismissing either hides both. Permanent: only the Settings switch clears
// it. Not logout, not re-login, not switching players (item 3 amendment).
export const INSTALL_FLAG = "ft_install_dismissed";

// Classify a user agent. "phone" means a mobile OS (Android, iOS, iPadOS);
// desktop never gets install help. iPadOS 13+ Safari sends a desktop Mac
// agent, so touch support is the tell there.
// In-app browsers are checked BEFORE the plain OS branches because their
// agents carry the iPhone/Android tokens too, and Messenger before Facebook
// because Messenger's agent also carries FBAN/FBAV.
export function detectPlatform(ua, { maxTouchPoints = 0 } = {}){
  const s = String(ua || "");
  const ios = /iPhone|iPad|iPod/.test(s) || (/Macintosh/.test(s) && maxTouchPoints > 1);
  const android = !ios && /Android/.test(s);
  const os = ios ? "ios" : android ? "android" : null;
  if (!os) return { kind: "desktop", os: null, phone: false };
  const app = /Instagram/.test(s) ? "Instagram"
    : /MessengerForiOS|MessengerLiteForiOS|FBAN\/Messenger|Orca-Android/.test(s) ? "Messenger"
    : /FBAN\/|FBAV\/|FB_IAB\//.test(s) ? "Facebook"
    : null;
  if (app) return { kind: "inapp", os, app, phone: true };
  if (ios) return { kind: "ios", os, phone: true };
  return { kind: "android", os, phone: true, samsung: /SamsungBrowser\//.test(s) };
}

// Running as the installed app: display-mode standalone, or iOS's own flag.
export function isStandalone(win){
  let mm = false;
  try { mm = !!win?.matchMedia?.("(display-mode: standalone)")?.matches; } catch { mm = false; }
  return mm || win?.navigator?.standalone === true;
}

// The platform instructions, branches (a)-(d) of item 2. The in-app branch
// wins over a captured prompt: an in-app browser cannot install at all.
// Menu glyphs per approved decision 5: Samsung Internet's menu is ≡; the
// in-app browsers use ⋯ on iOS and ⋮ on Android.
export function installStepsHtml(p, { canPrompt = false } = {}){
  if (!p?.phone) return "";
  if (p.kind === "inapp"){
    const menu = p.os === "ios" ? "⋯" : "⋮";
    return `<p class="ih-step">You're in ${p.app}'s browser, which can't install apps. Tap ${menu} → Open in browser, then install from there.</p>`;
  }
  if (p.kind === "ios")
    return `<p class="ih-step">Tap Share, then Add to Home Screen.</p><p class="ih-step">You'll sign in once more inside the app, so keep your PIN handy.</p>`;
  if (canPrompt) return `<button class="btn small ih-install" onclick="promptInstall()">Install</button>`;
  return p.samsung
    ? `<p class="ih-step">Browser menu (≡) → Add page to → Home screen</p>`
    : `<p class="ih-step">Browser menu (⋮) → Install app / Add to Home screen</p>`;
}

// ---------- runtime ----------
let deferredPrompt = null;
const platformNow = () => detectPlatform(navigator.userAgent, { maxTouchPoints: navigator.maxTouchPoints || 0 });

export function installDismissed(){
  try { return localStorage.getItem(INSTALL_FLAG) === "1"; } catch { return false; }
}
function setDismissed(on){
  try { on ? localStorage.setItem(INSTALL_FLAG, "1") : localStorage.removeItem(INSTALL_FLAG); } catch { /* storage blocked: nothing to persist */ }
}
// Could install help ever show on this device? A phone, not already the
// installed app. Settings offers its switch exactly where this is true.
export function installHelpPossible(){ return platformNow().phone && !isStandalone(window); }
export function installHelpApplies(){ return installHelpPossible() && !installDismissed(); }

const DONT = "Don't show again";
function sectionHtml(p){
  return `<div class="install-help" id="install-section">
    <div class="ih-head"><b>Get the app</b><button class="linkbtn ih-dismiss" onclick="dismissInstall()" title="${DONT}">${DONT}</button></div>
    ${installStepsHtml(p, { canPrompt: !!deferredPrompt })}</div>`;
}
function barHtml(p){
  return `<div class="installbar"><span class="ib-text">Add ${APP_NAME} to your home screen</span>
    <button class="linkbtn ib-how" id="install-how-btn" onclick="toggleInstallHow()" aria-expanded="false">How?</button>
    <button class="linkbtn ib-x" onclick="dismissInstall()" aria-label="${DONT}" title="${DONT}">✕</button></div>
    <div class="installhow hidden" id="install-how">${installStepsHtml(p, { canPrompt: !!deferredPrompt })}</div>`;
}

// Fills the two slots the shows list renders: #welcome-install inside the
// welcome card, #install-bar under it. Bar rule (approved decision 6): the
// bar shows whenever install help applies AND the card's section is not on
// screen, so a player who closed the card still gets it.
export function renderInstallSlots(){
  const sec = document.getElementById("welcome-install");
  const bar = document.getElementById("install-bar");
  const applies = installHelpApplies(), p = platformNow();
  if (sec) sec.innerHTML = applies ? sectionHtml(p) : "";
  if (bar) bar.innerHTML = applies && !sec ? barHtml(p) : "";
  // The wide layout shows Settings beside the list (an iPad in landscape is
  // a "phone" here), so a dismissal must not leave the switch stale.
  const box = document.getElementById("install-tips");
  if (box) box.checked = !installDismissed();
}

export function dismissInstall(){ setDismissed(true); renderInstallSlots(); }
export function setInstallTips(on){ setDismissed(!on); renderInstallSlots(); }
export function toggleInstallHow(){
  const el = document.getElementById("install-how");
  if (!el) return;
  const open = !el.classList.toggle("hidden");
  document.getElementById("install-how-btn")?.setAttribute("aria-expanded", String(open));
}
export async function promptInstall(){
  const e = deferredPrompt;
  if (!e) return;
  deferredPrompt = null; // a captured prompt can be shown once
  try { await e.prompt(); await e.userChoice; } catch { /* refused: the menu text takes over */ }
  renderInstallSlots();
}

// Wired from main.js BEFORE boot(). Chrome fires beforeinstallprompt only
// after engagement (a tap plus ~30s on the page), so it can arrive long
// after first render; arrival re-renders the slots in place.
// preventDefault (which suppresses the browser's own install offer) runs
// only when our help will actually show, so a dismissed or desktop device
// keeps the browser's built-in offer.
export function captureInstallPrompt(){
  window.addEventListener("beforeinstallprompt", e => {
    if (!installHelpApplies()) return;
    e.preventDefault();
    deferredPrompt = e;
    renderInstallSlots();
  });
  // Approved decision 4: the device has the app now, so install help is
  // moot in this browser too. Settings can still turn tips back on.
  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    setDismissed(true);
    renderInstallSlots();
  });
}
