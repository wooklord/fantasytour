import { JSDOM } from "jsdom";
import { makeFixtures } from "./fixtures.mjs";
import { createFakeSupabase } from "./fakeSupabase.mjs";

// Strips every <script>...</script> and <script .../> tag so we can control
// exactly what executes and in what order (stub globals first, then eval).
function stripScripts(html){
  return html.replace(/<script[\s\S]*?<\/script>/gi, "");
}

function installGlobals(window, mode, tables, rpcHandlers, calls, dbHolder){
  window.matchMedia = (query) => ({
    matches: query.includes("min-width:901px") ? mode === "desktop" : false,
    addEventListener(){}, removeEventListener(){}, addListener(){}, removeListener(){},
  });
  window.confirm = () => true;
  window.alert = () => {};
  window.fetch = async () => ({ json: async () => ({ ok: true }) });
  window.supabase = { createClient: (url, key) => {
    calls.push({ type: "createClient", url, key });
    dbHolder.db = createFakeSupabase(tables, rpcHandlers, calls);
    return dbHolder.db;
  }};
}

const RPC_HANDLERS = {
  login: async ({ p_name }) => ({ id: "p1", name: p_name, is_admin: true }),
  register_player: async ({ p_name }) => ({ id: "p3", name: p_name, is_admin: false }),
  get_my_picks: async () => [],
  get_show_picks: async () => [],
  submit_picks: async () => true,
  admin_save_season: async () => true,
  admin_delete_season: async () => true,
  admin_list_bans: async () => [],
  admin_unban: async () => true,
  admin_boot_player: async () => true,
  admin_set_show_format: async () => true,
  admin_pick_status: async () => [{ player_name: "Wooklord", picks_count: 1, last_saved: "2026-07-26T00:00:00Z" }],
  admin_update_config: async () => true,
  admin_set_cutoff: async () => true,
  admin_set_show_status: async () => true,
};

export function mainHTML(window, mode){
  const d = window.document;
  if (mode === "desktop"){
    return ["main-shows","main-board","main-admin"]
      .map(id => d.getElementById(id)?.innerHTML || "")
      .join("\n---col---\n");
  }
  return d.getElementById("main")?.innerHTML || "";
}

// scripts: array of JS source strings to eval, in order, after globals are set.
export async function runScenario({ html, scripts, mode, presetSession }){
  const { tables } = makeFixtures();
  const calls = [];
  const dbHolder = {};
  const dom = new JSDOM(stripScripts(html), { url: "http://localhost/", runScripts: "outside-only", pretendToBeVisual: true });
  const { window } = dom;
  installGlobals(window, mode, tables, RPC_HANDLERS, calls, dbHolder);
  if (presetSession) window.localStorage.setItem("ft_session", JSON.stringify(presetSession));

  const log = [];
  const snap = (label) => log.push({ label, html: mainHTML(window, mode), theme: window.document.documentElement.dataset.theme });

  for (const src of scripts) window.eval(src);
  await tick(); await tick();
  snap("boot");

  // shows tab already default; open the upcoming show's pick sheet
  window.openShow(1);
  await tick(); await tick();
  snap("pick-sheet-open");

  // type a pick into the first slot input and confirm the draft persists
  const input = window.document.querySelector(".slotline input");
  let draftKeyVal = null;
  if (input){
    input.value = "Distraction";
    input.dispatchEvent(new window.Event("input", { bubbles: true }));
    draftKeyVal = window.localStorage.getItem(`ft_draft_p1_1`);
  }
  snap("pick-sheet-draft");

  // save picks
  const saveBtn = window.document.getElementById("save");
  if (saveBtn) saveBtn.onclick && await saveBtn.onclick();
  await tick();
  snap("pick-sheet-saved");

  // view a completed show's detail (final, has scores)
  window.openShow(2);
  await tick(); await tick();
  snap("show-detail-final");

  // standings tab
  clickTab(window, "board");
  await tick(); await tick();
  snap("standings");

  // admin tab (session is_admin: true)
  clickTab(window, "admin");
  await tick(); await tick();
  snap("admin");

  // theme toggle x3 (auto -> light -> dark -> auto)
  const themeSeq = [];
  window.toggleTheme(); themeSeq.push(window.document.documentElement.dataset.theme);
  window.toggleTheme(); themeSeq.push(window.document.documentElement.dataset.theme);
  window.toggleTheme(); themeSeq.push(window.document.documentElement.dataset.theme);
  log.push({ label: "theme-sequence", themeSeq, themeModeStored: window.localStorage.getItem("ft_theme2") });

  // realtime: fire a "shows" UPDATE with a fresh remind_sent, expect a toast
  const supaCall = calls.find(c => c.type === "createClient");
  log.push({ label: "supabase-created", url: supaCall?.url, key: supaCall?.key });

  dbHolder.db?._emit("shows", "UPDATE", { id: 1, venue: "The Barn", showdate: "2026-07-27", remind_sent: new Date().toISOString() });
  await tick();
  log.push({ label: "realtime-toast", toasts: window.document.getElementById("toasts")?.innerHTML || "" });

  return { log, calls, draftKeyVal, localStorage: dumpLocalStorage(window) };
}

function clickTab(window, tab){
  const btn = window.document.querySelector(`nav.tabs button[data-tab="${tab}"]`);
  if (btn) btn.onclick && btn.onclick();
}

function dumpLocalStorage(window){
  const out = {};
  for (let i = 0; i < window.localStorage.length; i++){
    const k = window.localStorage.key(i);
    out[k] = window.localStorage.getItem(k);
  }
  return out;
}

function tick(){ return new Promise(r => setTimeout(r, 0)); }
