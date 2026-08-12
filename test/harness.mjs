import { JSDOM } from "jsdom";
import { makeFixtures, makeCatalogWhitespaceFixtures } from "./fixtures.mjs";
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
  // Batch pick-count RPC backing the shows-list marker. Computed against
  // the fixture's real picks rows, same "real join, not a fixed stub"
  // idiom as get_bracket_scores/my_leagues above.
  get_my_pick_counts: async ({ p_name, p_bracket_id }, tables) => {
    const player = tables.players_public.find(p => p.name === p_name);
    if (!player) return [];
    const counts = {};
    tables.picks
      .filter(pk => pk.bracket_id === p_bracket_id && pk.player_id === player.id)
      .forEach(pk => { counts[pk.show_id] = (counts[pk.show_id] || 0) + 1; });
    return Object.entries(counts).map(([show_id, pick_count]) => ({ show_id: Number(show_id), pick_count }));
  },
  // Mutates tables.picks (a real write, not a no-op stub) — needed so the
  // shows-list marker test below can prove a save actually refetches and
  // changes what the list shows, rather than asserting that by assumption.
  // Mirrors real submit_picks: full replace of this player/bracket/show's
  // saved slots with whatever was just submitted, not a merge.
  submit_picks: async ({ p_name, p_bracket_id, p_show_id, p_picks }, tables) => {
    const player = tables.players_public.find(p => p.name === p_name);
    tables.picks = tables.picks.filter(pk =>
      !(pk.player_id === player.id && pk.bracket_id === p_bracket_id && pk.show_id === p_show_id));
    const saved = (p_picks || []).filter(p => (p.songname || "").trim());
    saved.forEach(p => tables.picks.push({ player_id: player.id, bracket_id: p_bracket_id, show_id: p_show_id, slot: p.slot, songname: p.songname.trim() }));
    return { ok: true, saved: saved.length };
  },
  admin_save_season: async () => ({ ok: true }),
  admin_delete_season: async () => ({ ok: true }),
  admin_list_bans: async () => [],
  admin_unban: async () => ({ ok: true }),
  admin_league_boot: async () => ({ ok: true }),
  admin_set_show_format: async () => ({ ok: true }),
  // Stage C2b — member management. Computed against the fixture's
  // league_members/players_public/season_rosters, same "real join logic, not
  // a fixed stub" idiom as my_leagues/get_bracket_scores above.
  admin_list_members: async ({ p_league_id }, tables) =>
    tables.league_members.filter(lm => lm.league_id === p_league_id).map(lm => {
      const p = tables.players_public.find(pp => pp.id === lm.player_id);
      return { player_id: lm.player_id, name: p?.name, joined_at: p?.created_at,
        is_league_admin: lm.is_league_admin, official_opt_in: lm.official_opt_in };
    }),
  admin_find_players: async ({ p_league_id, p_query }, tables) => {
    const q = (p_query || "").trim().toLowerCase();
    if (q.length < 2) throw new Error("Enter at least 2 characters");
    const memberIds = new Set(tables.league_members.filter(lm => lm.league_id === p_league_id).map(lm => lm.player_id));
    return tables.players_public
      .filter(p => p.name.toLowerCase().startsWith(q) && !memberIds.has(p.id))
      .map(p => ({ player_id: p.id, name: p.name }));
  },
  admin_add_league_member: async () => ({ ok: true }),
  admin_list_season_roster: async ({ p_season_id }, tables) =>
    tables.season_rosters.filter(sr => sr.season_id === p_season_id),
  admin_set_season_roster: async () => ({ ok: true }),
  // Standings-facing counterpart to admin_list_season_roster — same
  // underlying table, membership-gated rather than admin-gated in real SQL,
  // but the fake doesn't model auth failures, only the real join.
  get_season_roster: async ({ p_season_id }, tables) =>
    tables.season_rosters.filter(sr => sr.season_id === p_season_id).map(sr => ({
      player_id: sr.player_id,
      name: tables.players_public.find(p => p.id === sr.player_id)?.name,
      added_at: sr.added_at,
    })),
  admin_pick_status: async () => [{ player_name: "Wooklord", picks_count: 1, last_saved: "2026-07-26T00:00:00Z" }],
  admin_update_config: async () => ({ ok: true }),
  admin_set_cutoff: async () => ({ ok: true }),
  // Session 4 step 2 — flips must_change_pin on the matching players_public
  // row, mirroring the real RPC's effect (real join, not a fixed stub, same
  // idiom as my_leagues/get_bracket_scores above).
  change_own_pin: async ({ p_name }, tables) => {
    const player = tables.players_public.find(p => p.name === p_name);
    if (player) player.must_change_pin = false;
    return { ok: true };
  },
  // Session 4 step 3 — real-join checked against league_members for the
  // "target not in this league" rejection, the one real authorization
  // boundary this RPC adds beyond the shared admin guard every other
  // admin_* handler already models loosely (the fakes don't model auth
  // failures generally, but this guard is new/specific enough to be worth
  // actually exercising rather than assumed).
  admin_reset_player_pin: async ({ p_league_id, p_player_id }, tables) => {
    const target = tables.players_public.find(p => p.id === p_player_id);
    if (!target) throw new Error("Player not found");
    const inLeague = tables.league_members.some(lm => lm.league_id === p_league_id && lm.player_id === p_player_id);
    if (p_league_id != null && !inLeague) throw new Error("That player is not in this league");
    target.must_change_pin = true;
    return { ok: true, name: target.name, new_pin: "135790" };
  },
  // Session 4 step 5 — Global console. Real prefix-match against the
  // fixture's players_public, same idiom as admin_find_players — unscoped
  // (no league exclusion) since global_find_players has no p_league_id.
  global_find_players: async ({ p_query }, tables) => {
    const q = (p_query || "").trim().toLowerCase();
    if (q.length < 2) throw new Error("Enter at least 2 characters");
    return tables.players_public.filter(p => p.name.toLowerCase().startsWith(q)).map(p => ({ player_id: p.id, name: p.name }));
  },
  // Mutates tables.leagues for real, so loadGlobalLeagues()'s refetch after
  // create actually reflects the new league — same "real write, not a
  // no-op stub" idiom as submit_picks above.
  global_create_league: async ({ p_league_name }, tables) => {
    const id = Math.max(0, ...tables.leagues.map(l => l.id)) + 1;
    tables.leagues.push({ id, name: p_league_name });
    return { ok: true, league_id: id };
  },
  global_appoint_league_admin: async ({ p_league_id, p_player_id }, tables) => {
    const existing = tables.league_members.find(lm => lm.league_id === p_league_id && lm.player_id === p_player_id);
    if (existing) existing.is_league_admin = true;
    else tables.league_members.push({ league_id: p_league_id, player_id: p_player_id, is_league_admin: true, official_opt_in: true });
    return { ok: true };
  },
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

// Every OTHER scenario in this file (and, until now, every scenario ever
// written for this app) presets p1 (Wooklord) — a league admin in the
// fixture. isCurrentLeagueAdmin() has therefore always been true, so any
// bug that only manifests for a genuine non-admin (like the shared
// admin/settings tab rendering the wrong thing on backgrounding — see the
// visibilitychange step below) was structurally invisible to this whole
// suite, not just under-covered. Presets p2 (EggHead), is_league_admin:
// false in the fixture, specifically to close that blind spot.
export async function runNonAdminScenario({ html, scripts, mode }){
  const { tables } = makeFixtures();
  const calls = [];
  const dbHolder = {};
  const dom = new JSDOM(stripScripts(html), { url: "http://localhost/", runScripts: "outside-only", pretendToBeVisual: true });
  const { window } = dom;
  installGlobals(window, mode, tables, RPC_HANDLERS, calls, dbHolder);
  const session = { id: "p2", name: "EggHead", pin: "1234", is_global_admin: false };
  window.localStorage.setItem("ft_session", JSON.stringify(session));

  for (const src of scripts) window.eval(src);
  await tick(); await tick();

  clickTab(window, "admin"); // the shared slot — "admin" is the only nav data-tab value either way
  await tick(); await tick();
  const settingsHtml = mainHTML(window, mode);
  const sharedTabLabel = window.document.getElementById("admintab")?.textContent
    || window.document.getElementById("col-admin-title")?.textContent || "";

  // The exact bug: backgrounding (visibilitychange -> hidden) then
  // foregrounding (-> visible) while sitting on this tab used to call
  // renderAdmin() directly instead of the role-aware dispatcher, which
  // rendered the admin-only panel (and its admin-gated RPCs) for a
  // non-admin. jsdom's document.visibilityState is a plain configurable
  // property, so it's overridden directly rather than faked through some
  // other API — this fires the app's REAL listener (core/realtime.js),
  // not a stand-in for it.
  Object.defineProperty(window.document, "visibilityState", { value: "visible", configurable: true });
  window.document.dispatchEvent(new window.Event("visibilitychange"));
  await tick(); await tick();
  const afterForegroundHtml = mainHTML(window, mode);

  return { settingsHtml, sharedTabLabel, afterForegroundHtml };
}

// Every other scenario presets either a league admin (p1) or a non-admin
// (p2) — no scenario has ever exercised a GENUINE global admin
// (is_global_admin:true), a structurally different code path from league
// admin: isCurrentLeagueAdmin() (core/switcher.js) short-circuits true on
// is_global_admin alone, independent of any league_members row. p4 still
// needs a league_members row in the fixture (is_league_admin:false there,
// deliberately, so this exercises the is_global_admin branch and not the
// league-admin branch p1 already covers) — without one, resolveLeagues()
// would render renderNoLeague() instead of the tabs at all, the same trap
// a real from-scratch global admin with no league yet would hit.
export async function runGlobalAdminScenario({ html, scripts, mode }){
  const { tables } = makeFixtures();
  const calls = [];
  const dbHolder = {};
  const dom = new JSDOM(stripScripts(html), { url: "http://localhost/", runScripts: "outside-only", pretendToBeVisual: true });
  const { window } = dom;
  installGlobals(window, mode, tables, RPC_HANDLERS, calls, dbHolder);
  const session = { id: "p4", name: "GlobalAdmin", pin: "1234", is_global_admin: true };
  window.localStorage.setItem("ft_session", JSON.stringify(session));

  for (const src of scripts) window.eval(src);
  await tick(); await tick();

  clickTab(window, "admin");
  await tick(); await tick();
  const adminHtml = mainHTML(window, mode);
  const sharedTabLabel = window.document.getElementById("admintab")?.textContent
    || window.document.getElementById("col-admin-title")?.textContent || "";

  // Session 4 step 5 — exercise the Global console end to end: create a
  // league (real write to tables.leagues via the fake global_create_league
  // handler), then search+appoint an existing player (p3, "Wanderer",
  // registered but not in any league yet) as that new league's admin.
  window.document.getElementById("gc-league-name").value = "Facebook League";
  await window.globalCreateLeague();
  await tick(); await tick();
  const leagueCountAfterCreate = tables.leagues.length;

  window.document.getElementById("gc-appoint-search").value = "wa";
  await window.globalSearchPlayers("appoint");
  await tick(); await tick();
  const appointResultsHtml = window.document.getElementById("gc-appoint-results")?.innerHTML || "";
  const newLeagueId = tables.leagues.find(l => l.name === "Facebook League")?.id;
  const appointSelect = window.document.getElementById("gc-appoint-league");
  if (appointSelect) appointSelect.value = String(newLeagueId);
  await window.globalAppointAdmin("p3", "Wanderer");
  await tick(); await tick();
  const wandererIsAdminOfNewLeague = tables.league_members.some(
    lm => lm.league_id === newLeagueId && lm.player_id === "p3" && lm.is_league_admin === true);

  return { adminHtml, sharedTabLabel, leagueCountAfterCreate, appointResultsHtml, wandererIsAdminOfNewLeague };
}

// Session 4 step 2: a session with must_change_pin:true must land on the
// forced interstitial instead of the normal tabs, and submitting a matching
// new PIN must clear the flag and resume the normal app. Direct session
// preset (like runNonAdminScenario/runGlobalAdminScenario above) is enough
// here — this doesn't need the login RPC's own must_change_pin return value
// to be realistic, since every scenario in this file already bypasses login()
// entirely by presetting ft_session.
export async function runForcedPinChangeScenario({ html, scripts, mode }){
  const { tables } = makeFixtures();
  const calls = [];
  const dbHolder = {};
  const dom = new JSDOM(stripScripts(html), { url: "http://localhost/", runScripts: "outside-only", pretendToBeVisual: true });
  const { window } = dom;
  installGlobals(window, mode, tables, RPC_HANDLERS, calls, dbHolder);
  const session = { id: "p1", name: "Wooklord", pin: "9999", is_global_admin: false, must_change_pin: true };
  window.localStorage.setItem("ft_session", JSON.stringify(session));

  for (const src of scripts) window.eval(src);
  await tick(); await tick();

  const interstitialHtml = mainHTML(window, mode);
  const tabsDisplay = window.document.getElementById("tabs")?.style.display || "";

  const newInput = window.document.querySelector("#fp-new");
  const confirmInput = window.document.querySelector("#fp-confirm");
  if (newInput) newInput.value = "4321";
  if (confirmInput) confirmInput.value = "4321";
  await window.submitForcedPinChange();
  await tick(); await tick();

  const afterHtml = mainHTML(window, mode);
  const storedSession = JSON.parse(window.localStorage.getItem("ft_session") || "null");

  return { interstitialHtml, tabsDisplay, afterHtml, storedSession };
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

  // shows-list marker must react to the draft that was just typed, even
  // though nothing's saved server-side for it yet — re-render the list
  // (simulating navigating back) and confirm it picked the draft up with
  // no reload. This replaces #main, so the pick sheet has to be reopened
  // afterward for the existing save step below to find its inputs — the
  // draft persisted in localStorage repopulates it identically.
  window.renderShows();
  await tick(); await tick();
  log.push({ label: "shows-list-with-draft", html: mainHTML(window, mode) });
  window.openShow(1);
  await tick(); await tick();

  // save picks
  const saveBtn = window.document.getElementById("save");
  if (saveBtn) saveBtn.onclick && await saveBtn.onclick();
  await tick();
  snap("pick-sheet-saved");

  // shows-list marker must also react to a save with no reload — the
  // draft is gone (savePicks clears it) and the count reflects the fresh
  // get_my_pick_counts result, not the pre-save fixture count.
  window.renderShows();
  await tick(); await tick();
  log.push({ label: "shows-list-after-save", html: mainHTML(window, mode) });

  // The actual bug this session's build fixes: a draft must stop being
  // consulted once a show locks, even though nothing clears the draft key
  // itself at that moment. Re-open show 1 (1 of 5 saved from the step
  // above), type a fresh draft, then flip ITS OWN fixture row's cutoff
  // into the past — same show, same still-incomplete saved count, same
  // still-present draft key — and confirm the marker drops the exclamation
  // for the amber check rather than either keeping the exclamation or
  // vanishing to nothing.
  window.openShow(1);
  await tick(); await tick();
  const relockInput = window.document.querySelector(".slotline input");
  if (relockInput){
    relockInput.value = "Shadow";
    relockInput.dispatchEvent(new window.Event("input", { bubbles: true }));
  }
  await tick();
  const show1Row = tables.league_shows.find(l => l.show_id === 1);
  const show1OriginalCutoff = show1Row.cutoff_at;
  show1Row.cutoff_at = new Date(Date.now() - 60000).toISOString(); // 1 minute ago
  window.renderShows();
  await tick(); await tick();
  log.push({ label: "shows-list-after-lock-with-stale-draft", html: mainHTML(window, mode) });
  // Restore immediately — this mutates the shared fixture row, and later
  // steps below (the Official-ineligible gate, the tab-resumption check)
  // both reuse show 1 assuming it's still open.
  show1Row.cutoff_at = show1OriginalCutoff;

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

  // Tab-navigation resumption (real bug, real fix): open a show, switch to
  // Standings, switch back to Shows via the actual nav tab button (not the
  // "← shows" back-link, which deliberately always wants the list) —
  // confirms the SAME show's view comes back, not the list underneath it.
  window.openShow(1);
  await tick(); await tick();
  clickTab(window, "board");
  await tick(); await tick();
  clickTab(window, "shows");
  await tick(); await tick();
  log.push({ label: "shows-tab-resumed-after-standings", html: mainHTML(window, mode) });

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

  // C2b — member search: "wa" should surface the fixture's non-member (p3,
  // "Wanderer") via admin_find_players' real prefix-match/exclude-members logic.
  const memberSearch = window.document.querySelector("#member-search");
  if (memberSearch){
    memberSearch.value = "wa";
    // Called directly rather than via dispatchEvent, same as clickTab()/
    // saveBtn.onclick() below — inline oninput/onclick HTML attributes don't
    // reliably wire up to jsdom's synthetic event dispatch under
    // runScripts:"outside-only", so every other step in this harness invokes
    // the handler function directly instead of trusting a dispatched event.
    await window.searchMembers();
    await tick(); await tick();
  }
  log.push({ label: "member-search-results", html: window.document.getElementById("member-results")?.innerHTML || "" });

  // C2b — season roster panel: expand the fixture's one season and confirm
  // it renders against admin_list_season_roster's real join (p1 is already
  // on the roster; p2 is not).
  window.toggleRoster(501);
  await tick(); await tick();
  log.push({ label: "season-roster-panel", html: window.document.getElementById("roster-panel-501")?.innerHTML || "" });

  // theme toggle x3 (auto -> light -> dark -> auto)
  const themeSeq = [];
  window.toggleTheme(); themeSeq.push(window.document.documentElement.dataset.theme);
  window.toggleTheme(); themeSeq.push(window.document.documentElement.dataset.theme);
  window.toggleTheme(); themeSeq.push(window.document.documentElement.dataset.theme);
  log.push({ label: "theme-sequence", themeSeq, themeModeStored: window.localStorage.getItem("ft_theme2") });

  const supaCall = calls.find(c => c.type === "createClient");
  log.push({ label: "supabase-created", url: supaCall?.url, key: supaCall?.key });

  // realtime, current league: expect a toast — driven by a realtime_pings
  // event now, not a direct league_shows one (that table has no public RLS
  // policy; see sql/stage_j_realtime_ping.sql). The ping payload only ever
  // carries {league_id, show_id} — handlePing() refetches league_shows
  // itself via get_league_shows, so the fixture row needs a fresh
  // remind_sent set BEFORE the ping fires, not embedded in the emit.
  tables.league_shows[0].remind_sent = new Date().toISOString();
  dbHolder.db?._emit("realtime_pings", "INSERT", { league_id: ids.LEAGUE_ID, show_id: 1 });
  await tick();
  log.push({ label: "realtime-toast-current-league", toasts: window.document.getElementById("toasts")?.innerHTML || "" });

  // realtime, a DIFFERENT league: expect no toast — locks down league-scoped
  // filtering rather than trusting the filter string compiles
  window.document.getElementById("toasts").innerHTML = "";
  dbHolder.db?._emit("realtime_pings", "INSERT", { league_id: ids.LEAGUE_ID + 999, show_id: 1 });
  await tick();
  log.push({ label: "realtime-toast-other-league", toasts: window.document.getElementById("toasts")?.innerHTML || "" });

  // realtime, setlist_songs INSERT (unfiltered — fires regardless of
  // league/bracket): confirm this binding still delivers after adding a
  // FIFTH thing to subscribe to (the ping channel above). Adding a new
  // binding without checking the old ones is exactly how this app's
  // channel-poisoning bug went unnoticed the first time (see CLAUDE.md's
  // realtime gotcha) — testing the new one in isolation and assuming the
  // rest are fine would repeat that mistake in the test suite itself.
  window.document.getElementById("toasts").innerHTML = "";
  dbHolder.db?._emit("setlist_songs", "INSERT",
    { show_id: 1, songname: "Test Song", is_encore: false, footnote: null, position: 1 });
  await tick();
  log.push({ label: "realtime-toast-setlist-song", toasts: window.document.getElementById("toasts")?.innerHTML || "" });

  // realtime, seasons UPDATE for the CURRENT bracket (Casual, per the
  // switchToBracket above) — same "still delivers" check as setlist_songs.
  window.document.getElementById("toasts").innerHTML = "";
  dbHolder.db?._emit("seasons", "UPDATE",
    { bracket_id: ids.CASUAL_ID, name: "Test Season", winner_sent: new Date().toISOString() });
  await tick();
  log.push({ label: "realtime-toast-season-current-bracket", toasts: window.document.getElementById("toasts")?.innerHTML || "" });

  // realtime, seasons UPDATE for a DIFFERENT bracket: expect no toast — same
  // bracket-scoped filter check as the league-scoped one above.
  window.document.getElementById("toasts").innerHTML = "";
  dbHolder.db?._emit("seasons", "UPDATE",
    { bracket_id: ids.OFFICIAL_ID, name: "Test Season", winner_sent: new Date().toISOString() });
  await tick();
  log.push({ label: "realtime-toast-season-other-bracket", toasts: window.document.getElementById("toasts")?.innerHTML || "" });

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

// Regression test for the autocomplete/save-time catalog-match mismatch:
// selecting a catalog song with real leading/trailing whitespace (e.g.
// "Time Escaping ") from autocomplete used to fail the save-time "not in
// catalog" warning, because the input value got trimmed before comparing
// while the catalog string it was checked against didn't. Exercises the
// REAL bundled app.js — types into a slotline input, lets the real
// attachAutocomplete populate .acc-list, fires the real mousedown handler
// to select an entry (not a hand-set input.value, which would skip the
// actual selection code path), for both a regular slot (opener) and a
// cover slot (cover_pick, which additionally filters autocomplete to
// is_original:false) — then saves and asserts window.confirm (the "not
// in catalog" prompt) was never invoked for either.
export async function runCatalogWhitespaceScenario({ html, scripts, mode }){
  const { tables, session } = makeCatalogWhitespaceFixtures();
  const calls = [];
  const dbHolder = {};
  const dom = new JSDOM(stripScripts(html), { url: "http://localhost/", runScripts: "outside-only", pretendToBeVisual: true });
  const { window } = dom;
  installGlobals(window, mode, tables, RPC_HANDLERS, calls, dbHolder);
  const confirmCalls = [];
  window.confirm = (msg) => { confirmCalls.push(msg); return true; };
  window.localStorage.setItem("ft_session", JSON.stringify(session));
  for (const src of scripts) window.eval(src);
  await tick(); await tick();
  window.openShow(1);
  await tick(); await tick();

  const selectFromAutocomplete = (slotKey, query) => {
    const input = window.document.querySelector(`.slotline input[data-slot="${slotKey}"]`);
    input.value = query;
    input.dispatchEvent(new window.Event("input", { bubbles: true }));
    const item = [...window.document.querySelectorAll(".acc-list div")]
      .find(d => d.textContent.toLowerCase().includes(query.toLowerCase()));
    if (!item) throw new Error(`autocomplete never offered a match for "${query}" in slot ${slotKey}`);
    item.dispatchEvent(new window.MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    return input.value;
  };

  const openerValue = selectFromAutocomplete("opener", "layla");
  const coverValue = selectFromAutocomplete("cover1", "time escap");

  window.document.getElementById("save").click();
  await tick(); await tick();

  return { confirmCalls, openerValue, coverValue, savedPicks: tables.picks };
}
