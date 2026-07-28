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

// Handlers compute against the fixture's relational tables (passed as the
// second argument by fakeSupabase.rpc) rather than returning fixed stubs, so
// the scenario below is exercising real join/gating logic, not just proving
// the call happened. Table-returning RPCs (my_leagues, get_bracket_scores,
// get_league_shows, get_bracket_seasons, can_submit_picks) return arrays,
// matching what PostgREST actually returns for a `returns table(...)`
// function — a plain object would misrepresent the real shape.
const RPC_HANDLERS = {
  login: async ({ p_name }) => ({ id: "p1", name: p_name, is_global_admin: false }),
  register_player: async ({ p_name }) => ({ id: "p3", name: p_name, is_global_admin: false }),
  my_leagues: async ({ p_name }, tables) => {
    const player = tables.players_public.find(p => p.name === p_name);
    if (!player) return [];
    return tables.league_members.filter(lm => lm.player_id === player.id).flatMap(lm => {
      const league = tables.leagues.find(l => l.id === lm.league_id);
      return tables.brackets.filter(b => b.league_id === lm.league_id).map(b => ({
        league_id: league.id, league_name: league.name, is_league_admin: lm.is_league_admin,
        bracket_id: b.id, bracket_kind: b.kind, bracket_name: b.name, official_opt_in: lm.official_opt_in,
      }));
    });
  },
  get_bracket_scores: async ({ p_bracket_id, p_show_id }, tables) =>
    tables.scores.filter(s => s.bracket_id === p_bracket_id && (p_show_id == null || s.show_id === p_show_id))
      .map(s => ({ ...s, player_name: tables.players_public.find(p => p.id === s.player_id)?.name })),
  get_league_shows: async ({ p_league_id }, tables) => tables.league_shows.filter(l => l.league_id === p_league_id),
  get_bracket_seasons: async ({ p_bracket_id }, tables) => tables.seasons.filter(s => s.bracket_id === p_bracket_id),
  can_submit_picks: async ({ p_bracket_id, p_show_id }, tables) => {
    const brk = tables.brackets.find(b => b.id === p_bracket_id);
    if (!brk || brk.kind !== "official") return [{ ok: true, reason: null }];
    const show = tables.shows.find(s => s.id === p_show_id);
    const season = tables.seasons.find(se => se.bracket_id === p_bracket_id && se.start_date <= show.showdate && show.showdate <= se.end_date);
    if (!season) return [{ ok: false, reason: "No Official season covers this show yet" }];
    return [{ ok: true, reason: null }];
  },
  get_my_picks: async () => [],
  get_show_picks: async () => [],
  submit_picks: async () => ({ ok: true, saved: 1 }),
  admin_save_season: async () => ({ ok: true }),
  admin_delete_season: async () => ({ ok: true }),
  admin_list_bans: async () => [],
  admin_unban: async () => ({ ok: true }),
  admin_league_boot: async () => ({ ok: true }),
  admin_set_show_format: async () => ({ ok: true }),
  admin_pick_status: async () => [{ player_name: "Wooklord", picks_count: 1, last_saved: "2026-07-26T00:00:00Z" }],
  admin_update_config: async () => ({ ok: true }),
  admin_set_cutoff: async () => ({ ok: true }),
  // admin_boot_player / admin_set_show_status intentionally absent — both
  // were dropped in Stage C1. Any leftover call site targeting them should
  // fail loudly ("unhandled rpc"), not silently succeed against a stub.
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

// Boots with NO localStorage session at all — the renderAuth() path.
// runScenario always presets a valid session, so it never exercises this;
// a whole layout being broken specifically on this path (login form landing
// in a hidden desktop column) shipped once without either scenario catching
// it. Returns enough to check the login form actually landed somewhere
// visible, not just that it rendered *somewhere* in the DOM.
export async function runLoggedOutBoot({ html, scripts, mode }){
  const { tables } = makeFixtures();
  const calls = [];
  const dbHolder = {};
  const dom = new JSDOM(stripScripts(html), { url: "http://localhost/", runScripts: "outside-only", pretendToBeVisual: true });
  const { window } = dom;
  installGlobals(window, mode, tables, RPC_HANDLERS, calls, dbHolder);
  // deliberately no ft_session in localStorage

  for (const src of scripts) window.eval(src);
  await tick(); await tick();

  const colsDisplay = window.document.getElementById("cols")?.style.display || "";
  const authFormPresent = !!window.document.querySelector("#a-name");
  // On desktop, $("#main") redirects into #main-shows (default tab) — the
  // form has to have landed there, AND #cols itself has to actually be
  // shown (this is the exact thing that was broken: content could land in
  // the right element while that element's container stayed display:none).
  const authFormInVisibleContainer = mode === "desktop"
    ? colsDisplay === "grid" && !!window.document.querySelector("#main-shows #a-name")
    : authFormPresent;

  return { colsDisplay, authFormPresent, authFormInVisibleContainer };
}

// scripts: array of JS source strings to eval, in order, after globals are set.
export async function runScenario({ html, scripts, mode, presetSession }){
  const { tables, ids } = makeFixtures();
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

  log.push({ label: "header-chrome",
    whoami: window.document.getElementById("whoami")?.innerHTML || "",
    bracketLabel: window.document.getElementById("bracketLabel")?.textContent || "" });

  // shows tab already default; open the upcoming show's pick sheet. Default
  // bracket on first boot (no stored ft_bracket_id) is Casual — never gated.
  window.openShow(1);
  await tick(); await tick();
  snap("pick-sheet-open-casual");

  // type a pick into the first slot input and confirm the (bracket-scoped)
  // draft key persists
  const input = window.document.querySelector(".slotline input");
  let draftKeyVal = null;
  if (input){
    input.value = "Distraction";
    input.dispatchEvent(new window.Event("input", { bubbles: true }));
    draftKeyVal = window.localStorage.getItem(`ft_draft_p1_${ids.CASUAL_ID}_1`);
  }
  snap("pick-sheet-draft");

  // save picks
  const saveBtn = window.document.getElementById("save");
  if (saveBtn) saveBtn.onclick && await saveBtn.onclick();
  await tick();
  snap("pick-sheet-saved");

  // switch to Official (no season covers show 1 in the fixture) and open
  // the same show — expect the ineligible panel, not a fillable sheet
  window.switchToBracket(ids.OFFICIAL_ID);
  await tick(); await tick();
  window.openShow(1);
  await tick(); await tick();
  snap("pick-sheet-official-ineligible");
  const officialHasInputs = !!window.document.querySelector(".slotline input");

  // switch back to Casual for the rest of the scenario
  window.switchToBracket(ids.CASUAL_ID);
  await tick(); await tick();

  // view a completed show's detail (final, has scores)
  window.openShow(2);
  await tick(); await tick();
  snap("show-detail-final");

  // standings tab
  clickTab(window, "board");
  await tick(); await tick();
  snap("standings");

  // admin tab (fixture session is a league admin, not global)
  clickTab(window, "admin");
  await tick(); await tick();
  snap("admin");

  // theme toggle x3 (auto -> light -> dark -> auto)
  const themeSeq = [];
  window.toggleTheme(); themeSeq.push(window.document.documentElement.dataset.theme);
  window.toggleTheme(); themeSeq.push(window.document.documentElement.dataset.theme);
  window.toggleTheme(); themeSeq.push(window.document.documentElement.dataset.theme);
  log.push({ label: "theme-sequence", themeSeq, themeModeStored: window.localStorage.getItem("ft_theme2") });

  const supaCall = calls.find(c => c.type === "createClient");
  log.push({ label: "supabase-created", url: supaCall?.url, key: supaCall?.key });

  // realtime, current league: expect a toast
  dbHolder.db?._emit("league_shows", "UPDATE",
    { league_id: ids.LEAGUE_ID, show_id: 1, cutoff_at: tables.league_shows[0].cutoff_at, format: "standard", status: "upcoming",
      remind_sent: new Date().toISOString(), lock_sent: null, winner_sent: null });
  await tick();
  log.push({ label: "realtime-toast-current-league", toasts: window.document.getElementById("toasts")?.innerHTML || "" });

  // realtime, a DIFFERENT league: expect no toast — locks down league-scoped
  // filtering rather than trusting the filter string compiles
  window.document.getElementById("toasts").innerHTML = "";
  dbHolder.db?._emit("league_shows", "UPDATE",
    { league_id: ids.LEAGUE_ID + 999, show_id: 1, cutoff_at: null, format: "standard", status: "upcoming",
      remind_sent: new Date().toISOString(), lock_sent: null, winner_sent: null });
  await tick();
  log.push({ label: "realtime-toast-other-league", toasts: window.document.getElementById("toasts")?.innerHTML || "" });

  return { log, calls, draftKeyVal, officialHasInputs, localStorage: dumpLocalStorage(window) };
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
