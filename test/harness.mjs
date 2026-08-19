import { JSDOM } from "jsdom";
import { makeFixtures, makeCatalogWhitespaceFixtures, makeRankedFixtures } from "./fixtures.mjs";
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
  // Real join against the fixture, same idiom as get_bracket_scores /
  // my_leagues rather than a fixed stub. It returned [] unconditionally
  // until 2026-08-13, which meant renderShowDetail's pre-scoring pick board
  // ("The picks are in" — cutoff passed, picks public, nothing scored yet)
  // could never render in ANY scenario, in either mode. Joins players for
  // the display name the way the real RPC does.
  // Stage P: membership-gated, and player_id is gone from the payload —
  // replaced by a server-computed is_mine. The returned row is built
  // FIELD BY FIELD rather than spreading `...p` on purpose: spreading would
  // leak player_id (and every other picks column) into the fake result, so
  // a frontend that still depended on player_id would keep passing here
  // while failing against the real RPC. The shape below is exactly the
  // real RETURNS TABLE and nothing more.
  get_show_picks: async ({ p_name, p_bracket_id, p_show_id }, tables) => {
    const me = tables.players_public.find(pl => pl.name === p_name);
    // Mirror the real membership gate so the fake fails CLOSED the way the
    // RPC does. Nothing in the app can currently reach this call site as a
    // non-member (see the known-gap note in the Stage P section of
    // CLAUDE.md), so this branch is not exercised by any scenario today —
    // it is here so that if a future change ever does call get_show_picks
    // from an unauthorised context, the suite fails loudly instead of
    // quietly handing back rows the real database would refuse.
    const brk = (tables.brackets || []).find(b => b.id === p_bracket_id);
    if (!brk) throw new Error("Bracket not found");
    const isMember = (tables.league_members || [])
      .some(lm => lm.league_id === brk.league_id && lm.player_id === (me || {}).id);
    if (!isMember) throw new Error("Not a member of this league");
    return (tables.picks || [])
      .filter(p => p.bracket_id === p_bracket_id && p.show_id === p_show_id)
      .map(p => ({
        is_mine: !!me && p.player_id === me.id,
        player_name: (tables.players_public.find(pl => pl.id === p.player_id) || {}).name || "?",
        slot: p.slot,
        songname: p.songname,
      }));
  },
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
  // Real join against the fixture, not a stub: the predicate is the whole
  // point of the RPC and is deliberately UNSCOPED ("in no league"), not
  // "not in this league" the way admin_find_players is. A stub returning a
  // fixed list would pass whichever predicate the frontend used.
  admin_list_unaffiliated_players: async (_args, tables) =>
    (tables.players_public || [])
      .filter(p => !(tables.league_members || []).some(lm => lm.player_id === p.id))
      .map(p => ({ player_id: p.id, name: p.name })),
  // Standings-facing counterpart to admin_list_season_roster — same
  // underlying table, membership-gated rather than admin-gated in real SQL,
  // but the fake doesn't model auth failures, only the real join.
  get_season_roster: async ({ p_season_id }, tables) =>
    tables.season_rosters.filter(sr => sr.season_id === p_season_id).map(sr => ({
      player_id: sr.player_id,
      name: tables.players_public.find(p => p.id === sr.player_id)?.name,
      added_at: sr.added_at,
    })),
  // Real join against the fixture, not a fixed row. toggleFormat sums
  // picks_count to decide which brackets to name in its orphan confirm, so a
  // stub returning 1 would make every bracket look equally affected and the
  // per-bracket assertions would pass against nothing.
  admin_pick_status: async ({ p_bracket_id, p_show_id }, tables) => {
    const byPlayer = {};
    for (const lm of tables.league_members || []) {
      const nm = (tables.players_public.find(p => p.id === lm.player_id) || {}).name || "?";
      byPlayer[nm] = 0;
    }
    for (const k of tables.picks || []) {
      if (k.bracket_id !== p_bracket_id || k.show_id !== p_show_id) continue;
      const nm = (tables.players_public.find(p => p.id === k.player_id) || {}).name || "?";
      byPlayer[nm] = (byPlayer[nm] || 0) + 1;
    }
    return Object.entries(byPlayer).map(([player_name, picks_count]) => ({ player_name, picks_count, last_saved: null }));
  },
  // Persists p_data into the fixture's brackets row instead of discarding it.
  // A handler that swallows the payload can't prove anything about
  // saveConfig(): the read-through fallbacks that preserve fields whose
  // inputs aren't rendered are only observable in what actually got written.
  admin_update_config: async (args, tables) => {
    const br = (tables.brackets || []).find(b => b.id === args.p_bracket_id);
    if (br) br.config = args.p_data;
    return { ok: true };
  },
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

  // Session 4 follow-up: self-service PIN change (decision 3's other half —
  // until now every PIN change routed through an admin reset, which was
  // supposed to be the fallback, not the only path). Wrong-current-PIN
  // rejection is _auth_player's existing behavior, already relied on
  // everywhere else in this app, not re-modeled here; this exercises the
  // two things that actually live in JS: the new/confirm mismatch guard,
  // and a successful change updating the stored session.
  window.document.getElementById("pin-current").value = "1234";
  window.document.getElementById("pin-new").value = "5555";
  window.document.getElementById("pin-confirm").value = "6666";
  await window.changeOwnPin();
  await tick();
  const mismatchErr = window.document.getElementById("pin-err")?.textContent || "";
  const sessionAfterMismatch = JSON.parse(window.localStorage.getItem("ft_session") || "null");

  window.document.getElementById("pin-current").value = "1234";
  window.document.getElementById("pin-new").value = "5555";
  window.document.getElementById("pin-confirm").value = "5555";
  await window.changeOwnPin();
  await tick();
  const sessionAfterPinChange = JSON.parse(window.localStorage.getItem("ft_session") || "null");

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

  return { settingsHtml, sharedTabLabel, afterForegroundHtml,
    mismatchErr, sessionAfterMismatch, sessionAfterPinChange };
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

// bootPlayer's confirm — three branches, none of which had ANY coverage
// before 2026-08-17 despite Boot being one of the two most destructive
// controls in the app. The dialog is not decoration: whether an Official
// season is RUNNING at boot time decides whether the booted player keeps
// scoring zeros against the "fewest zeros" tiebreaker for the rest of that
// season, and nothing in the app can undo that once it starts (see the boot
// entry in CLAUDE.md). So the wording is the only warning that exists, and
// the lookup that picks the wording is a hard gate on the boot itself.
//
// The live season is injected HERE rather than added to makeFixtures(),
// deliberately: the shared fixture's only season is deliberately in the past,
// and two existing checks depend on that ("Official (no covering season)
// shows the ineligible reason" and "standings defaults to All time"). Adding
// a live season to the shared fixture would break both for an unrelated
// reason.
export async function runBootScenario({ html, scripts, mode }){
  const { tables } = makeFixtures();
  const calls = [];
  const dbHolder = {};
  const dom = new JSDOM(stripScripts(html), { url: "http://localhost/", runScripts: "outside-only", pretendToBeVisual: true });
  const { window } = dom;
  installGlobals(window, mode, tables, RPC_HANDLERS, calls, dbHolder);
  window.localStorage.setItem("ft_session", JSON.stringify(
    { id: "p1", name: "Wooklord", pin: "1234", is_global_admin: false }));
  for (const src of scripts) window.eval(src);
  await tick(); await tick();
  clickTab(window, "admin");
  await tick(); await tick();

  const bootCalls = () => calls.filter(c => c.type === "rpc" && c.fn === "admin_league_boot").length;

  // ---- Case 1: no Official season running (fixture's only season is past)
  const noSeasonConfirms = [];
  window.confirm = (m) => { noSeasonConfirms.push(m); return true; };
  const bootsBeforeCase1 = bootCalls();
  await window.bootPlayer("p2", "EggHead");
  await tick(); await tick();
  const case1 = {
    firstConfirm: noSeasonConfirms[0] || "",
    booted: bootCalls() > bootsBeforeCase1,
  };

  // ---- Case 2: an Official season covering today. Dates are built off the
  // real wall clock (day()-style), never hardcoded — a fixed window silently
  // drifts into the past and this branch would stop being exercised without
  // failing.
  const today = Date.now();
  const iso = (off) => new Date(today + off * 864e5).toISOString().slice(0, 10);
  tables.seasons.push({
    id: 502, bracket_id: 11, name: "Live Season",
    start_date: iso(-3), end_date: iso(3), roster_locked_at: null,
  });
  const liveConfirms = [];
  window.confirm = (m) => { liveConfirms.push(m); return true; };
  const bootsBeforeCase2 = bootCalls();
  await window.bootPlayer("p2", "EggHead");
  await tick(); await tick();
  const case2 = {
    firstConfirm: liveConfirms[0] || "",
    booted: bootCalls() > bootsBeforeCase2,
  };

  // ---- Case 3: the season lookup fails. This is the branch added on
  // 2026-08-17 and the one where a bug is silent in the dangerous direction:
  // if the early return were dropped, the boot would proceed under whichever
  // wording the code fell through to — an irreversible action taken beneath a
  // reassurance nothing verified. Assert all three of: no confirm, no RPC,
  // and a visible toast. Same handler-swap idiom as the get_show_picks
  // lookup-failure block further down this file.
  const origSeasons = RPC_HANDLERS.get_bracket_seasons;
  RPC_HANDLERS.get_bracket_seasons = async () => { throw new Error("simulated season lookup failure"); };
  const failConfirms = [];
  window.confirm = (m) => { failConfirms.push(m); return true; };
  window.document.getElementById("toasts").innerHTML = "";
  const bootsBeforeCase3 = bootCalls();
  await window.bootPlayer("p2", "EggHead");
  await tick(); await tick();
  const case3 = {
    confirmCount: failConfirms.length,
    booted: bootCalls() > bootsBeforeCase3,
    toastHtml: window.document.getElementById("toasts")?.innerHTML || "",
  };
  RPC_HANDLERS.get_bracket_seasons = origSeasons;
  window.confirm = () => true;

  return { case1, case2, case3 };
}

// Season-roster removal — the OTHER destructive control in the admin panel,
// and the third instance of "the panel is asserted, the handler never is":
// toggleRoster(501) was already exercised below, so the roster panel rendered
// and was checked, while setRosterMember was never invoked by anything and
// admin_set_season_roster's fake was a bare {ok:true} nothing reached.
//
// What removal actually does is easy to state wrongly in both directions, so
// the assertions pin the precise claims: the player does NOT vanish from the
// standings, removal does not stop their zeros, and a later re-add resets
// added_at and silently drops accumulated zeros. Adding stays confirm-free
// (idempotent, non-destructive) and is asserted as such.
export async function runRosterScenario({ html, scripts, mode }){
  const { tables } = makeFixtures();
  const calls = [];
  const dbHolder = {};
  const dom = new JSDOM(stripScripts(html), { url: "http://localhost/", runScripts: "outside-only", pretendToBeVisual: true });
  const { window } = dom;
  installGlobals(window, mode, tables, RPC_HANDLERS, calls, dbHolder);
  window.localStorage.setItem("ft_session", JSON.stringify(
    { id: "p1", name: "Wooklord", pin: "1234", is_global_admin: false }));
  for (const src of scripts) window.eval(src);
  await tick(); await tick();
  clickTab(window, "admin");
  await tick(); await tick();

  const setCalls = () => calls.filter(c => c.type === "rpc" && c.fn === "admin_set_season_roster");

  // Fixture season 501 has roster_locked_at: null — the unlocked case.
  const unlockedConfirms = [];
  window.confirm = (m) => { unlockedConfirms.push(m); return true; };
  const beforeUnlocked = setCalls().length;
  await window.setRosterMember(501, "p1", false, "Wooklord");
  await tick(); await tick();
  const unlocked = {
    confirm: unlockedConfirms[0] || "",
    called: setCalls().length > beforeUnlocked,
  };

  // Locked: same season, roster_locked_at stamped. The extra sentence must
  // appear — activation never revisits a season whose roster_locked_at is
  // set, so removal really is permanent until a manual re-add.
  tables.seasons.find(s => s.id === 501).roster_locked_at = "2026-01-01T00:00:00Z";
  const lockedConfirms = [];
  window.confirm = (m) => { lockedConfirms.push(m); return true; };
  await window.setRosterMember(501, "p1", false, "Wooklord");
  await tick(); await tick();
  const locked = { confirm: lockedConfirms[0] || "" };

  // Cancelled confirm: the RPC must NOT fire. Without this, a confirm that
  // returned the wrong value (or was bypassed) would still look green from
  // the wording assertions alone.
  const beforeCancel = setCalls().length;
  window.confirm = () => false;
  await window.setRosterMember(501, "p1", false, "Wooklord");
  await tick(); await tick();
  const cancelled = { called: setCalls().length > beforeCancel };

  // Adding is deliberately confirm-free — assert that, so a future "add a
  // confirm to everything" pass has to make a decision rather than drift.
  const addConfirms = [];
  window.confirm = (m) => { addConfirms.push(m); return true; };
  const beforeAdd = setCalls().length;
  await window.setRosterMember(501, "p2", true, "EggHead");
  await tick(); await tick();
  const added = { confirmCount: addConfirms.length, called: setCalls().length > beforeAdd };

  // Failed season lookup blocks removal: no confirm, no RPC, a toast.
  const origSeasons = RPC_HANDLERS.get_bracket_seasons;
  RPC_HANDLERS.get_bracket_seasons = async () => { throw new Error("simulated season lookup failure"); };
  const failConfirms = [];
  window.confirm = (m) => { failConfirms.push(m); return true; };
  window.document.getElementById("toasts").innerHTML = "";
  const beforeFail = setCalls().length;
  await window.setRosterMember(501, "p1", false, "Wooklord");
  await tick(); await tick();
  const lookupFailed = {
    confirmCount: failConfirms.length,
    called: setCalls().length > beforeFail,
    toastHtml: window.document.getElementById("toasts")?.innerHTML || "",
  };
  RPC_HANDLERS.get_bracket_seasons = origSeasons;
  window.confirm = () => true;

  return { unlocked, locked, cancelled, added, lookupFailed };
}

// Session 4 step 2: a session with must_change_pin:true must land on the
// forced interstitial instead of the normal tabs, and submitting a matching
// new PIN must clear the flag and resume the normal app. Direct session
// preset (like runNonAdminScenario/runGlobalAdminScenario above) is enough
// here — this doesn't need the login RPC's own must_change_pin return value
// to be realistic, since every scenario in this file already bypasses login()
// entirely by presetting ft_session.
// Module B: a bracket running ranked-choice scoring alongside a slots-mode
// sibling. Reaches the ranked branch the way the app reaches it — a real
// renderAdmin() against a fixture whose Casual config carries
// mode:"ranked_choice" — rather than by injecting markup, because the render
// path is the part most likely to break.
//
// Three things it exists to prove, none covered elsewhere:
//   1. The ranked branch renders a ladder editor.
//   2. Slots-mode fields are ABSENT FROM THE DOM in ranked mode, not merely
//      hidden — decision 1 is that cover/debut/wildcard cannot be turned on
//      for a ranked bracket, and "you can't see it" is not that.
//   3. Saving FROM ranked mode preserves every slots-mode field. Those
//      fields have no inputs on screen, so they survive only via
//      saveConfig()'s read-through-to-state.cfg fallbacks — the one piece of
//      this work with a real data-loss failure mode.
// The registered-but-league-less empty state, and the recruitment loop that
// runs through it: register -> wait -> admin adds you -> Check again -> you
// are in the app. That loop is what ~50 people walk during Facebook League
// recruitment and it had NO coverage at all; worse, every other fixture
// deliberately prevents renderNoLeague() from firing (p4 is given a
// membership row specifically so it doesn't), so nothing was ever going to
// stumble into it.
//
// p3 ("Wanderer") is already a registered non-member in makeFixtures(), so
// my_leagues returns [] for them with no new fixture shape needed.
//
// SEAM, stated rather than hidden: the Check again button is asserted to
// exist and to carry a location.reload() handler, but its click is NOT
// exercised — jsdom does not implement navigation (that is the "Not
// implemented: navigation to another Document" line every run prints). The
// reload is modelled as what it actually is, a second page load against
// changed server state: a fresh window over the SAME tables object after
// membership is inserted. That covers the loop's behaviour; it does not
// cover the button literally navigating.
export async function runNoLeagueScenario({ html, scripts, mode }){
  const { tables } = makeFixtures();
  const calls = [];
  const session = { id: "p3", name: "Wanderer", pin: "1234", is_global_admin: false };

  // --- Page load 1: registered, in no league.
  const domA = new JSDOM(stripScripts(html), { url: "http://localhost/", runScripts: "outside-only", pretendToBeVisual: true });
  const windowA = domA.window;
  installGlobals(windowA, mode, tables, RPC_HANDLERS, calls, {});
  windowA.localStorage.setItem("ft_session", JSON.stringify(session));
  for (const src of scripts) windowA.eval(src);
  await tick(); await tick();

  const before = {
    html: mainHTML(windowA, mode),
    tabsDisplay: windowA.document.getElementById("tabs")?.style.display || "",
    // The button is the fix for the dead end — without it the copy tells the
    // player to do something the screen gives them no way to do.
    checkAgainHtml: [...windowA.document.querySelectorAll("button")]
      .map(b => b.outerHTML).find(h => /Check again/.test(h)) || "",
  };

  // --- The admin adds them. Mutating `tables` is exactly what
  // admin_add_league_member does server-side; official_opt_in is written
  // explicitly here as `true` to mirror the Stage F column default that
  // admin_add_league_member relies on without naming.
  tables.league_members.push({ league_id: 1, player_id: "p3", is_league_admin: false, official_opt_in: true });

  // --- Page load 2: the reload. Fresh window, same tables, same session.
  const domB = new JSDOM(stripScripts(html), { url: "http://localhost/", runScripts: "outside-only", pretendToBeVisual: true });
  const windowB = domB.window;
  installGlobals(windowB, mode, tables, RPC_HANDLERS, calls, {});
  windowB.localStorage.setItem("ft_session", JSON.stringify(session));
  for (const src of scripts) windowB.eval(src);
  await tick(); await tick();

  const after = {
    html: mainHTML(windowB, mode),
    tabsDisplay: windowB.document.getElementById("tabs")?.style.display || "",
  };

  return { before, after };
}

// The save-split round trip (2026-08-17). Splitting Master switch out of
// "Save all rules" exists to stop one panel's save silently reverting the
// other's fields, and NOTHING tested that: the three repointed mode-change
// assertions exercise confirmModeChange, not the payloads. This drives both
// saves in both orders and inspects what each actually PUT.
//
// The hazard is specific: admin_update_config writes the whole config object,
// so each save must merge against state.cfg rather than build from scratch.
// If saveConfig re-reads #c-bperfect, or saveMasterSwitch stops spreading
// ...state.cfg, one save clobbers the other's field and the only symptom is a
// value quietly reverting — no error, no toast, nothing on screen.
// The "Registered, not in any league" panel. p3 ("Wanderer") is the fixture's
// registered non-member, so the list must contain exactly them — and must NOT
// contain p1/p2/p4, who are all in a league. That distinction is the test:
// the predicate is "in NO league", not admin_find_players' "not in THIS
// league", and at two leagues those diverge.
// toggleFormat's orphan confirm. This is the control that caused the
// 2026-08-14 incident and it was the last destructive admin action with no
// dialog at all. Fixture geometry that makes the assertions meaningful:
// defCfg's standard section is opener/closer/encore + flat1,flat2 while its
// oneset is opener + flat1, so standard -> one_set loses closer, encore and
// flat2. Show 1 is standard/upcoming. Picks for show 1 exist ONLY in Casual,
// so Official loses the same keys but holds nothing and must be excluded by
// the n > 0 guard — that exclusion is a real assertion, not a side effect.
export async function runFormatToggleScenario({ html, scripts, mode }){
  const { tables } = makeFixtures();
  const calls = [];
  const dom = new JSDOM(stripScripts(html), { url: "http://localhost/", runScripts: "outside-only", pretendToBeVisual: true });
  const { window } = dom;
  installGlobals(window, mode, tables, RPC_HANDLERS, calls, {});
  window.localStorage.setItem("ft_session", JSON.stringify(
    { id: "p1", name: "Wooklord", pin: "1234", is_global_admin: false }));
  for (const src of scripts) window.eval(src);
  await tick(); await tick();
  clickTab(window, "admin");
  await tick(); await tick();

  const fmtCalls = () => calls.filter(c => c.type === "rpc" && c.fn === "admin_set_show_format").length;

  // --- Orphaning toggle, cancelled. Must warn AND must not write.
  const confirms = [];
  window.confirm = (m) => { confirms.push(m); return false; };
  const before = fmtCalls();
  await window.toggleFormat(1, "one_set");
  await tick(); await tick();
  const cancelled = { confirm: confirms[0] || "", wrote: fmtCalls() > before };

  // --- Same toggle, accepted. Must write.
  window.confirm = () => true;
  const beforeAccept = fmtCalls();
  await window.toggleFormat(1, "one_set");
  await tick(); await tick();
  const accepted = { wrote: fmtCalls() > beforeAccept };

  // --- HARMLESS BRANCH, slots bracket: one_set -> standard loses nothing,
  // because the fixture's oneset keys (opener, flat1) are a subset of its
  // standard keys. No dialog may fire even though Casual holds picks for
  // this show. Without this case the orphan set could be computed as "every
  // current key" rather than the difference and every other assertion here
  // would still pass — verified by mutation, which is how this case came to
  // exist.
  tables.league_shows.find(l => l.show_id === 1).format = "one_set";
  const harmlessConfirms = [];
  window.confirm = (m) => { harmlessConfirms.push(m); return true; };
  const beforeHarmless = fmtCalls();
  await window.toggleFormat(1, "standard");
  await tick(); await tick();
  const harmless = { confirmCount: harmlessConfirms.length, wrote: fmtCalls() > beforeHarmless };

  // --- Ranked bracket must be excluded entirely: rank keys live at config
  // top level and never through `oneset`, so a ranked bracket cannot be
  // orphaned by a format change. Flip Casual (the only bracket with picks)
  // to ranked and re-toggle — with Official holding no picks, nothing should
  // be at risk and NO dialog should fire.
  tables.league_shows.find(l => l.show_id === 1).format = "standard";
  tables.brackets.find(b => b.kind === "casual").config.mode = "ranked_choice";
  const rankedConfirms = [];
  window.confirm = (m) => { rankedConfirms.push(m); return true; };
  const beforeRanked = fmtCalls();
  await window.toggleFormat(1, "one_set");
  await tick(); await tick();
  const rankedExcluded = { confirmCount: rankedConfirms.length, wrote: fmtCalls() > beforeRanked };
  tables.brackets.find(b => b.kind === "casual").config.mode = "slots";

  // --- Failed lookup must BLOCK: no confirm, no write, a toast.
  tables.league_shows.find(l => l.show_id === 1).format = "standard";
  const origStatus = RPC_HANDLERS.admin_pick_status;
  RPC_HANDLERS.admin_pick_status = async () => { throw new Error("simulated pick-count failure"); };
  const failConfirms = [];
  window.confirm = (m) => { failConfirms.push(m); return true; };
  window.document.getElementById("toasts").innerHTML = "";
  const beforeFail = fmtCalls();
  await window.toggleFormat(1, "one_set");
  await tick(); await tick();
  const lookupFailed = {
    confirmCount: failConfirms.length,
    wrote: fmtCalls() > beforeFail,
    toastHtml: window.document.getElementById("toasts")?.innerHTML || "",
  };
  RPC_HANDLERS.admin_pick_status = origStatus;
  window.confirm = () => true;

  return { cancelled, accepted, harmless, rankedExcluded, lookupFailed };
}

export async function runUnaffiliatedScenario({ html, scripts, mode }){
  const { tables } = makeFixtures();
  const calls = [];
  const dom = new JSDOM(stripScripts(html), { url: "http://localhost/", runScripts: "outside-only", pretendToBeVisual: true });
  const { window } = dom;
  installGlobals(window, mode, tables, RPC_HANDLERS, calls, {});
  window.localStorage.setItem("ft_session", JSON.stringify(
    { id: "p1", name: "Wooklord", pin: "1234", is_global_admin: false }));
  for (const src of scripts) window.eval(src);
  await tick(); await tick();
  clickTab(window, "admin");
  await tick(); await tick(); await tick();

  const box = () => window.document.getElementById("unaffiliated");
  const listed = { html: box()?.innerHTML || "" };

  // Adding one must re-fetch, so the row disappears without a manual reload.
  // The fake admin_add_league_member does not mutate tables, so mutate here
  // to model the server write the real RPC performs.
  tables.league_members.push({ league_id: 1, player_id: "p3", is_league_admin: false, official_opt_in: true });
  await window.addMember("p3", "Wanderer");
  await tick(); await tick(); await tick();
  const afterAdd = { html: box()?.innerHTML || "" };

  return { listed, afterAdd };
}

export async function runSaveSplitScenario({ html, scripts, mode }){
  const { tables } = makeFixtures();
  const calls = [];
  const dom = new JSDOM(stripScripts(html), { url: "http://localhost/", runScripts: "outside-only", pretendToBeVisual: true });
  const { window } = dom;
  installGlobals(window, mode, tables, RPC_HANDLERS, calls, {});
  window.localStorage.setItem("ft_session", JSON.stringify(
    { id: "p1", name: "Wooklord", pin: "1234", is_global_admin: false }));
  for (const src of scripts) window.eval(src);
  await tick(); await tick();
  clickTab(window, "admin");
  await tick(); await tick();

  const q = (id) => window.document.getElementById(id);
  const payloads = () => calls.filter(c => c.type === "rpc" && c.fn === "admin_update_config").map(c => c.args.p_data);
  const last = () => payloads()[payloads().length - 1];

  // --- 1. Master switch save: its own two fields.
  q("c-override").value = "locked";
  q("c-bperfect").value = "9";
  await window.saveMasterSwitch();
  await tick(); await tick();
  const afterMaster = last();

  // --- 2. Rules save afterwards must NOT revert them.
  //
  // CRITICAL: dirty #c-bperfect WITHOUT saving it first, so the input and
  // state.cfg genuinely DIVERGE (input 3, saved 9). Without this the test is
  // blind: right after a Master switch save both sources agree, so reading
  // either produces the same payload and a saveConfig that wrongly re-reads
  // the input passes anyway. Verified by mutation — the earlier version of
  // this scenario did not catch exactly that regression.
  //
  // It is also the semantically correct expectation: an UNSAVED Master switch
  // edit must not be silently committed by pressing Save rules.
  q("c-bperfect").value = "3";
  const flatBefore = q("c-flat")?.value;
  if (q("c-flat")) q("c-flat").value = String(Number(flatBefore || 0) + 2);
  await window.saveConfig();
  await tick(); await tick();
  const afterRules = last();

  // --- 3. Reverse direction: a second Master switch save must not revert the
  // rules field the previous step just wrote.
  await window.saveMasterSwitch();
  await tick(); await tick();
  const afterMasterAgain = last();

  return {
    masterWrote: { voting_override: afterMaster?.voting_override, perfect: afterMaster?.bonuses?.perfect },
    // The whole point: these must still hold Master switch's values.
    rulesPreserved: { voting_override: afterRules?.voting_override, perfect: afterRules?.bonuses?.perfect },
    rulesWrote: { flat_picks: afterRules?.flat_picks },
    // ...and this must still hold the rules value.
    masterPreserved: { flat_picks: afterMasterAgain?.flat_picks },
    writes: payloads().length,
  };
}

export async function runRankedChoiceScenario({ html, scripts, mode, wildcardDebut = false, perfect = 7 }){
  const { tables } = makeRankedFixtures({ wildcardDebut, perfect });
  const casualId = tables.brackets.find(b => b.kind === "casual").id;
  const before = JSON.parse(JSON.stringify(tables.brackets.find(b => b.id === casualId).config));
  const calls = [];
  const dbHolder = {};
  const dom = new JSDOM(stripScripts(html), { url: "http://localhost/", runScripts: "outside-only", pretendToBeVisual: true });
  const { window } = dom;
  installGlobals(window, mode, tables, RPC_HANDLERS, calls, dbHolder);
  window.localStorage.setItem("ft_session", JSON.stringify({ id: "p1", name: "Wooklord", pin: "1234", is_global_admin: false }));
  // Land on the ranked bracket specifically — the remembered-bracket key, so
  // the switcher doesn't pick Official and render the slots panel instead.
  window.localStorage.setItem("ft_bracket_id", String(casualId));

  for (const src of scripts) window.eval(src);
  await tick(); await tick();

  clickTab(window, "admin");
  await tick(); await tick();

  const q = (id) => window.document.getElementById(id);
  const ladderValues = [...window.document.querySelectorAll("#rankladder .rank-pts")].map(i => i.value);
  const rankLabels = [...window.document.querySelectorAll("#rankladder label")].map(l => l.textContent);
  // Absence is the assertion, so this collects anything that leaked through
  // rather than checking a single id — a new slots-mode field added to the
  // standard section later should fail this too.
  const leakedSlotsFields = ["c-bcover","c-bdebut","c-wcdebut","c-dupes","c-flat","c-flatpts","c-partial","c-partpts","slots","slots1","c1-flat","c1-flatpts"]
    .filter(id => q(id) !== null);
  const perfectPresent = q("c-bperfect") !== null;

  // Mode switch, in-place, without a reload (admin.js's onModeChange).
  q("c-mode").value = "slots";
  window.onModeChange();
  await tick();
  const afterSwitchToSlots = { hasSlots: q("slots") !== null, hasLadder: q("rankladder") !== null, hasCover: q("c-bcover") !== null };
  // Back to ranked, so the save below happens from ranked mode.
  q("c-mode").value = "ranked_choice";
  window.onModeChange();
  await tick();
  const backToRanked = { hasLadder: q("rankladder") !== null, hasSlots: q("slots") !== null };

  // Blank-row rejection, before the good save below (so the "unchanged"
  // assertion compares against the pre-save fixture, not a saved copy).
  // Every rendered row must carry a value — clearing one is not how a rank
  // gets removed, and silently dropping it would shift every rank beneath it
  // up one with nothing telling the admin. Also covers the browser-mangled
  // case: type="number" coerces unparseable input to "" before readLadder
  // ever sees it, so this is the same code path.
  const rowsNow = window.document.querySelectorAll("#rankladder .rank-pts");
  // Captured, not hardcoded — the test shouldn't know what the fixture ladder
  // contains, or it breaks the day makeRankedFixtures changes.
  const clearedOriginal = rowsNow[2].value;
  rowsNow[2].value = "";
  const callsBeforeBlankSave = calls.filter(c => c.type === "rpc" && c.fn === "admin_update_config").length;
  await window.saveConfig();
  await tick(); await tick();
  const blankRowReject = {
    err: q("cfg-err")?.textContent || "",
    rpcCalls: calls.filter(c => c.type === "rpc" && c.fn === "admin_update_config").length - callsBeforeBlankSave,
    configUnchanged: JSON.stringify(tables.brackets.find(b => b.id === casualId).config) === JSON.stringify(before),
  };
  // Restore the cleared row so the round-trip save below is a clean one.
  rowsNow[2].value = clearedOriginal;

  // Zero rows: the ✕ button can empty the ladder entirely, and saveConfig
  // has its own guard for that separate from readLadder's per-row check.
  // Confirmed rather than assumed — a ranked bracket with no ranks would be
  // silently unusable, players filling a sheet that scores nothing.
  const savedRows = [...window.document.querySelectorAll("#rankladder .admin-slot")];
  const savedValues = [...window.document.querySelectorAll("#rankladder .rank-pts")].map(i => i.value);
  savedRows.forEach(r => r.remove());
  const callsBeforeEmptySave = calls.filter(c => c.type === "rpc" && c.fn === "admin_update_config").length;
  await window.saveConfig();
  await tick(); await tick();
  const emptyLadderReject = {
    err: q("cfg-err")?.textContent || "",
    rpcCalls: calls.filter(c => c.type === "rpc" && c.fn === "admin_update_config").length - callsBeforeEmptySave,
    configUnchanged: JSON.stringify(tables.brackets.find(b => b.id === casualId).config) === JSON.stringify(before),
    // Which branch saveConfig takes here is asserted, not inferred. Only the
    // .admin-slot children were removed, so #rankladder should still exist
    // with zero rows — that keeps saveConfig on the `if ($("#rankladder"))`
    // branch, where readLadder returns [] and the "needs at least one rank"
    // guard fires. If the container were gone instead, saveConfig would take
    // the else branch, fall back to state.cfg's ladder, save successfully,
    // and this whole case would prove nothing while still looking green.
    containerPresent: q("rankladder") !== null,
  };
  // Rebuild the ladder for the real save below.
  savedValues.forEach(() => window.addRankRow());
  [...window.document.querySelectorAll("#rankladder .rank-pts")].forEach((inp, i) => { inp.value = savedValues[i]; });

  // Recorded across the good save below, which does NOT change mode — the
  // orphan warning must stay silent here, or it would fire on every routine
  // rules edit.
  const confirmsOnUnchangedSave = [];
  window.confirm = (m) => { confirmsOnUnchangedSave.push(m); return true; };
  await window.saveConfig();
  await tick(); await tick();
  window.confirm = () => true;
  const after = tables.brackets.find(b => b.id === casualId).config;

  // ---- player-facing side: the ranked pick sheet ----
  // Show 1 is upcoming with cutoff_at +60min (open for picks); show 2 is
  // status:"final" with score rows. Both per makeFixtures.
  clickTab(window, "shows");
  await tick(); await tick();
  window.openShow(1);
  await tick(); await tick();
  const sheetInputs = [...window.document.querySelectorAll(".slotline input")];
  const sheet = {
    slotKeys: sheetInputs.map(i => i.dataset.slot),
    // Ranked rows omit the label entirely (the rank IS the points), so this
    // should be 0. Omitted rather than CSS-hidden on purpose: a hidden label
    // would still be in the DOM and this assertion would pass while nothing
    // was on screen.
    labelCount: window.document.querySelectorAll(".slotline label").length,
    rowsCarryRankedClass: [...window.document.querySelectorAll(".slotline")].every(r => r.classList.contains("ranked")),
    // NOTE: the points bubble's VISUAL left-position comes from
    // `.slotline.ranked .pts{order:-1}` in styles.css. Markup order is
    // input → .pts in both modes, so there is no DOM sequence to assert
    // here — JSDOM loads no stylesheet and cannot see flex order. That
    // half is verified by the manual browser pass.
    points: [...window.document.querySelectorAll(".slotline .pts")].map(p => p.textContent),
    // One rules row explaining the ladder, not one per rank — renderPickSheet
    // dedups by label and every rank has a distinct one.
    ruleRowCount: window.document.querySelectorAll(".ruledef").length,
    ruleText: window.document.querySelector(".ruledef .rd-desc")?.textContent || "",
    // Terms, so a test can assert WHICH rows are present rather than only
    // how many. Row count alone can't distinguish "ladder + perfect sheet"
    // from "two ladder rows", and the count is no longer a fixed 1 now that
    // the perfect-sheet row is conditional.
    ruleTerms: [...window.document.querySelectorAll(".ruledef .rd-term")].map(t => t.textContent),
    ruleDescs: [...window.document.querySelectorAll(".ruledef .rd-desc")].map(t => t.textContent),
    // The bottom-of-card note. Ranked mode renders no element at all (not
    // alternate copy), so this is null there and a string in slot mode.
    ruleNote: window.document.querySelector(".rulenote")?.textContent ?? null,
    // The "Anywhere in the show" divider belongs to flat picks, which ranked
    // mode has none of.
    hasFlatDivider: /Anywhere in the show/.test(mainHTML(window, mode)),
  };
  // Autocomplete, in two probes. The second is the assertion; the FIRST is a
  // positive control, without which a wrong selector or a dropdown that
  // never rendered would make "Any Debut is absent" trivially true.
  // One query, chosen so it is its own positive control. "d" is a substring
  // of "debut", so it satisfies attachAutocomplete's wildcard condition and
  // WOULD surface "Any Debut" in slot mode; it also matches Distraction and
  // Space Oddity in songs_cache, so the dropdown renders regardless of
  // whether the wildcard is offered.
  //
  // That second property is what makes the assertion meaningful. The
  // autocomplete returns early when nothing matches (`if (!hits.length)
  // return;`), so with a query like "debut" — which matches no fixture song
  // — no dropdown would exist at all in ranked mode, and "Any Debut is
  // absent" would be trivially true for the wrong reason. Here, a rendered
  // list containing Distraction but not Any Debut proves suppression.
  sheetInputs[0].value = "d";
  sheetInputs[0].dispatchEvent(new window.Event("input", { bubbles: true }));
  await tick();
  const accHtml = window.document.querySelector(".acc-list")?.innerHTML || "";
  sheet.autocompleteRendered = /Distraction/.test(accHtml); // positive control
  sheet.offersAnyDebut = /Any Debut/.test(accHtml);          // the assertion

  // Item 5: in ranked mode "Any Debut" is not a wildcard, just a song name
  // matching nothing, so it must get the normal not-in-catalog confirm
  // rather than the wildcard exemption. Same capture pattern as
  // runCatalogWhitespaceScenario below.
  const confirmCalls = [];
  window.confirm = (msg) => { confirmCalls.push(msg); return true; };
  sheetInputs[0].value = "Any Debut";
  sheetInputs[0].dispatchEvent(new window.Event("input", { bubbles: true }));
  await tick();
  // Clicked rather than called: savePicks is not on window (renderPickSheet
  // wires it as $("#save").onclick directly), so the button is the only
  // reachable entry point — same as runCatalogWhitespaceScenario.
  window.document.getElementById("save").click();
  await tick(); await tick();
  sheet.confirmedUnknown = confirmCalls.some(m => /Any Debut/.test(m));
  window.confirm = () => true;

  // Frozen breakdown on the already-scored show. makeRankedFixtures stores
  // those rows SHUFFLED, so the rendered order proves breakdownSlotInfo
  // supplied a real order rather than falling through to the
  // everything-compares-equal path.
  window.openShow(2);
  await tick(); await tick();
  // Scoped to the FIRST player's panel, not the whole page: renderShowDetail
  // renders one .panel per scoring player, so a page-wide selector returns
  // every player's rows concatenated and the count depends on how many
  // players the fixture scores — which is not what this is testing.
  const firstScorePanel = [...window.document.querySelectorAll(".panel")]
    .find(p => p.querySelector(".pickres"));
  const breakdownLabels = [...(firstScorePanel?.querySelectorAll(".pickres .sl") ?? [])].map(e => e.textContent.trim());

  // Pre-scoring pick board (show 3: cutoff passed, picks public, unscored).
  // This is the surface that keeps slotDefs' "Rank N" labels meaningful now
  // that the pick sheet itself omits them — nothing else asserts it, so
  // blanking the label in slotDefs would otherwise have gone unnoticed here.
  window.openShow(3);
  await tick(); await tick();
  const pickBoardHtml = mainHTML(window, mode);
  const pickBoardLabels = [...window.document.querySelectorAll(".pickres .sl")].map(e => e.textContent.trim());

  // Mode-change orphan warning, positive case. The fixture's Casual bracket
  // has picks on show 1, which is still open — so switching away from
  // ranked must warn, and cancelling must leave the config untouched.
  // Tested LAST because it mutates mode; answering false keeps it from
  // actually landing.
  clickTab(window, "admin");
  await tick(); await tick();
  const modeChangeConfirms = [];
  window.confirm = (m) => { modeChangeConfirms.push(m); return false; }; // cancel
  q("c-mode").value = "slots";
  window.onModeChange();
  await tick();
  // Repointed 2026-08-17: scoring mode is owned by saveMasterSwitch now, so
  // the orphan warning fires from there, not from saveConfig. Driving
  // saveConfig here would assert nothing — its `mode` comes from state.cfg
  // and can never differ from it.
  await window.saveMasterSwitch();
  await tick(); await tick();
  window.confirm = () => true;
  const modeWarning = {
    fired: modeChangeConfirms.some(m => /orphan/i.test(m)),
    message: modeChangeConfirms.find(m => /orphan/i.test(m)) || "",
    // Cancelling must not write. Proves the early return, not just the dialog.
    modeAfterCancel: tables.brackets.find(b => b.id === casualId).config.mode,
  };

  // Failed-lookup branch: when the pick count can't be fetched, the admin
  // gets a DIFFERENT confirm rather than a silent pass — "no picks at risk"
  // and "couldn't check" must not look the same. Exercised by making the
  // handler throw (the fake turns that into an rpc error, and rpc() throws),
  // then restoring it. The previous block cancelled, so mode is still
  // ranked_choice and this can attempt the same switch again.
  const origShowPicks = RPC_HANDLERS.get_show_picks;
  RPC_HANDLERS.get_show_picks = async () => { throw new Error("simulated lookup failure"); };
  const failedLookupConfirms = [];
  window.confirm = (m) => { failedLookupConfirms.push(m); return false; }; // cancel
  q("c-mode").value = "slots";
  window.onModeChange();
  await tick();
  await window.saveMasterSwitch();
  await tick(); await tick();
  window.confirm = () => true;
  RPC_HANDLERS.get_show_picks = origShowPicks;
  const lookupFailWarning = {
    fired: failedLookupConfirms.some(m => /Couldn't check/i.test(m)),
    // Must be the couldn't-check wording, NOT the orphan one — a lookup
    // that failed cannot know how many picks are at risk, so claiming a
    // count would be inventing one.
    claimedACount: failedLookupConfirms.some(m => /\d+ pick(s)? across/.test(m)),
    modeAfterCancel: tables.brackets.find(b => b.id === casualId).config.mode,
  };

  return {
    ladderValues, rankLabels, leakedSlotsFields, perfectPresent,
    afterSwitchToSlots, backToRanked, blankRowReject, emptyLadderReject,
    sheet, breakdownLabels, pickBoardLabels, pickBoardHtml,
    confirmsOnUnchangedSave, modeWarning, lookupFailWarning,
    savedMode: after.mode,
    savedLadder: after.ranked?.ladder,
    // Deep contents, not lengths — a regressed guard returning a different
    // non-empty array would pass a length check.
    slotsBefore: JSON.stringify(before.slots),
    slotsAfter: JSON.stringify(after.slots),
    onesetSlotsBefore: JSON.stringify(before.oneset?.slots),
    onesetSlotsAfter: JSON.stringify(after.oneset?.slots),
    preserved: {
      flat_picks: after.flat_picks, flat_points: after.flat_points,
      partial_credit: after.partial_credit, partial_points: after.partial_points,
      allow_duplicates: after.allow_duplicates,
      cover: after.bonuses?.cover, debut: after.bonuses?.debut,
      perfect: after.bonuses?.perfect,
      wildcardDebut: after.wildcards?.debut,
      onesetFlatPicks: after.oneset?.flat_picks, onesetFlatPoints: after.oneset?.flat_points,
    },
    // Deliberately NOT returning an `expected` derived from `before`: an
    // expectation computed from the fixture moves with the fixture, so a
    // corrupted fixture would silently corrupt the expectation to match and
    // the comparison would pass while proving nothing. scenario.test.mjs
    // hardcodes the literals instead.
  };
}

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

  // Slot mode's rules card, captured while the Casual sheet is open. The
  // ranked work removes the bottom-of-card rulenote in RANKED mode only —
  // it's a conditional render now rather than a ternary between two
  // strings, so the failure mode is the element disappearing everywhere.
  // Nothing else in this suite would notice: every other rules-card
  // assertion runs inside runRankedChoiceScenario, where the note is
  // supposed to be absent.
  const slotsRules = {
    terms: [...window.document.querySelectorAll(".ruledef .rd-term")].map(t => t.textContent),
    descs: [...window.document.querySelectorAll(".ruledef .rd-desc")].map(t => t.textContent),
    note: window.document.querySelector(".rulenote")?.textContent ?? null,
  };

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

  return { log, calls, draftKeyVal, officialHasInputs, slotsRules, localStorage: dumpLocalStorage(window) };
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
