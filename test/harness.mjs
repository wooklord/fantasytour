import { JSDOM, VirtualConsole } from "jsdom";
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
  // Mirrors the live RPC (stage_c1 + stage_t): trim, min 2, max 20, and the
  // stored name is the TRIMMED one. The fake has to be at least as strict
  // as the real thing, or a dropped client check would pass against it.
  register_player: async ({ p_name }) => {
    const nm = String(p_name ?? "").trim();
    if (nm.length < 2) throw new Error("Name too short");
    if (nm.length > 20) throw new Error("Name must be 20 characters or fewer");
    return { id: "p3", name: nm, is_global_admin: false };
  },
  my_leagues: async ({ p_name }, tables) => {
    const player = tables.players_public.find(p => p.name === p_name);
    if (!player) return [];
    return tables.league_members.filter(lm => lm.player_id === player.id).flatMap(lm => {
      const league = tables.leagues.find(l => l.id === lm.league_id);
      return tables.brackets.filter(b => b.league_id === lm.league_id).map(b => ({
        league_id: league.id, league_name: league.name, is_league_admin: lm.is_league_admin,
        bracket_id: b.id, bracket_kind: b.kind, bracket_name: b.name, official_opt_in: lm.official_opt_in,
        // Stage S: l.config->>'fb_url' / 'discord_url' — null when the
        // league has no config at all, exactly as the real RPC returns.
        fb_url: league.config?.fb_url ?? null, discord_url: league.config?.discord_url ?? null,
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
    // Mirrors the real RPC's cutoff gate:
    //   and ls.cutoff_at is not null and now() >= ls.cutoff_at
    // PERMANENT, not a probe. Its absence is what let saveConfig's
    // mode-change orphan check pass its tests for years while being dead in
    // production: the check only ever queries shows that are OPEN (cutoff in
    // the future), which this RPC refuses by design, so it returned zero
    // rows every time and the warning never fired. The fake returned rows
    // regardless, so five assertions went green against a control that could
    // not work. Removing this line re-opens exactly that hole.
    const lsRow = (tables.league_shows || []).find(l => l.show_id === p_show_id && l.league_id === brk.league_id);
    if (!lsRow || !lsRow.cutoff_at || new Date(lsRow.cutoff_at) > new Date()) return [];
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
    // Mirrors the real RPC's schedule/cutoff block (sql/stage_o_ranked_
    // submit_picks.sql), in the real order and with the real messages.
    // Until 2026-10-11 this fake had NO schedule check at all, so a league
    // with zero league_shows rows — Green Eggs' state for two months — could
    // "save" picks here that production rejects. A fake more permissive than
    // the RPC is the shape that hid the orphan-check bug; this closes the
    // same gap for the overlay row. (can_submit_picks is deliberately NOT
    // given this check: the real one runs only _official_gate and never
    // reads league_shows, so adding it there would make the fake STRICTER
    // than production — the opposite error.)
    const brk = tables.brackets.find(b => b.id === p_bracket_id);
    if (!brk) throw new Error("Bracket not found");
    const sh = tables.shows.find(s => s.id === p_show_id);
    if (!sh) throw new Error("Show not found");
    const ls = tables.league_shows.find(l => l.league_id === brk.league_id && l.show_id === p_show_id);
    if (!ls) throw new Error("This show is not on this league's schedule");
    const ov = (brk.config && brk.config.voting_override) || "auto";
    if (ov === "locked") throw new Error("Voting is locked by the admin");
    if (ov === "open"){
      if (sh.showdate < new Date().toLocaleDateString("sv")) throw new Error("That show already happened");
    } else {
      if (!ls.cutoff_at) throw new Error("Picks are not open for this show yet");
      if (Date.now() >= new Date(ls.cutoff_at).getTime()) throw new Error("Picks are locked for this show");
    }
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
    // last_saved is max(updated_at) in the real RPC — null only when there
    // are no picks. A null here for a player WITH picks used to render the
    // epoch date, which no assertion ever looked at.
    return Object.entries(byPlayer).map(([player_name, picks_count]) => ({ player_name, picks_count, last_saved: picks_count ? new Date().toISOString() : null }));
  },
  // Persists p_data into the fixture's brackets row instead of discarding it.
  // A handler that swallows the payload can't prove anything about
  // saveConfig(): the read-through fallbacks that preserve fields whose
  // inputs aren't rendered are only observable in what actually got written.
  admin_update_config: async (args, tables) => {
    // Stage V gate (sql/stage_v_ranked_ladder_gate.sql): ranked mode needs a
    // non-empty ladder. The fake must be at least as strict as the RPC, or
    // a client that ships an empty ladder passes against nothing.
    const d = args.p_data || {};
    if (d.mode === "ranked_choice" && !(Array.isArray(d.ranked?.ladder) && d.ranked.ladder.length)) throw new Error("A ranked-choice bracket needs at least one rank");
    const br = (tables.brackets || []).find(b => b.id === args.p_bracket_id);
    if (br) br.config = args.p_data;
    return { ok: true };
  },
  admin_set_cutoff: async () => ({ ok: true }),
  // Stage U (sql/stage_u_show_sync.sql): any league admin or global; logs
  // what was cleared, then nulls the flag; a null flag logs nothing. Real
  // join against league_members, not a fixed stub, so a dropped client
  // check or a wrong argument name fails here the way it would live.
  admin_clear_sync_flag: async ({ p_name, p_pin, p_show_id }, tables) => {
    if (p_pin == null) throw new Error("Wrong name or PIN");
    const me = tables.players_public.find(p => p.name === p_name);
    const isAdmin = !!me && tables.league_members.some(m => m.player_id === me.id && m.is_league_admin === true);
    if (!isAdmin) throw new Error("League admins only");
    const sh = tables.shows.find(s => s.id === p_show_id);
    if (!sh) throw new Error("Show not found");
    if (sh.sync_flag == null) return { ok: true, cleared: false };
    (tables.sync_flag_clears ??= []).push({ show_id: p_show_id, cleared_by: me.id, note: sh.sync_flag });
    sh.sync_flag = null;
    return { ok: true, cleared: true };
  },
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
    // Stage R (sql/stage_r_seed_league_shows_on_create.sql): the real RPC
    // seeds one league_shows row per existing show, so the fake must too —
    // a fake that leaves the new league with no overlay rows is MORE
    // permissive than production and would hide exactly the bug Stage R
    // fixes (Green Eggs ran two months with zero rows). Same lesson as the
    // get_show_picks cutoff gate: the fake has to be at least as strict as
    // the real thing. Cutoff is a stand-in (22:00Z), not venueCutoffISO —
    // the test asserts presence and shape, not the hour.
    const today = new Date().toLocaleDateString("sv");
    const stamp = new Date().toISOString();
    let seeded = 0;
    for (const s of tables.shows){
      const past = s.showdate < today;
      tables.league_shows.push({
        league_id: id, show_id: s.id, cutoff_at: `${s.showdate}T22:00:00.000Z`,
        format: "standard", status: past ? "final" : "upcoming",
        remind_sent: past ? stamp : null, lock_sent: past ? stamp : null, winner_sent: past ? stamp : null,
      });
      seeded++;
    }
    return { ok: true, league_id: id, shows_seeded: seeded };
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
// `mutate(tables)` runs before the window exists — the Stage S login-screen
// checks use it to give a league links, or to make the leagues read throw
// (a getter that throws is the only way to produce an error from the fake
// builder, which otherwise treats a missing table as empty).
export async function runLoggedOutBoot({ html, scripts, mode, mutate = () => {} }){
  const { tables } = makeFixtures();
  mutate(tables);
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

  // Stage S pre-auth community block (features/auth.js loadAuthCommunity).
  const block = window.document.getElementById("auth-links");
  const linksPresent = !!block;
  const anchors = block ? [...block.querySelectorAll("a")].map(a => ({ href: a.getAttribute("href"), text: a.textContent, rel: a.getAttribute("rel"), target: a.getAttribute("target") })) : [];
  const blockText = block ? block.textContent : "";
  const mainText = mainHTML(window, mode);

  return { colsDisplay, authFormPresent, authFormInVisibleContainer, linksPresent, anchors, blockText, mainText };
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

  // Stage R: a created league must be on the schedule immediately — one
  // league_shows row per show, every cutoff set. Shape is asserted against
  // the fixture's show count (coverage, not a magic number) and against
  // null cutoffs specifically, because "no cutoff" is the exact state that
  // left Green Eggs unplayable for two months. Compared to the shows table
  // rather than to a literal so the check follows the fixture.
  const newLeagueOverlay = tables.league_shows.filter(ls => ls.league_id === newLeagueId);
  const newLeagueOverlayRows = newLeagueOverlay.length;
  const newLeagueOverlayShowIds = newLeagueOverlay.map(ls => ls.show_id).sort();
  const fixtureShowIds = tables.shows.map(s => s.id).sort();
  const newLeagueOverlayNullCutoffs = newLeagueOverlay.filter(ls => !ls.cutoff_at).length;

  return { adminHtml, sharedTabLabel, leagueCountAfterCreate, appointResultsHtml, wandererIsAdminOfNewLeague,
           newLeagueOverlayRows, newLeagueOverlayShowIds, fixtureShowIds, newLeagueOverlayNullCutoffs };
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
// Stage S — community links on the no-league screen. Three page loads, one
// per shape of leagues.config, because the empty-set case is the one that
// regresses silently (docs/decisions/testing-harness.md: a set-valued
// computation needs an empty-set case):
//   withLinks  — one league with both URLs, one with none: the first renders
//                two anchors under its name, the second contributes nothing.
//   noLinks    — no league has config at all: the whole #nl-links block is
//                absent, not an empty heading.
//   badScheme  — a javascript: URL in config: must NOT become an href.
// The fake builder's select() ignores its column list and returns whole
// rows, so `select("name, config")` needs no fake change — only the fixture
// row carries config.
export async function runNoLeagueLinksScenario({ html, scripts, mode }){
  const session = { id: "p3", name: "Wanderer", pin: "1234", is_global_admin: false };
  async function load(mutate){
    const { tables } = makeFixtures();
    mutate(tables);
    const calls = [];
    const dom = new JSDOM(stripScripts(html), { url: "http://localhost/", runScripts: "outside-only", pretendToBeVisual: true });
    const w = dom.window;
    installGlobals(w, mode, tables, RPC_HANDLERS, calls, {});
    w.localStorage.setItem("ft_session", JSON.stringify(session));
    for (const src of scripts) w.eval(src);
    await tick(); await tick();
    const block = w.document.getElementById("nl-links");
    return {
      html: mainHTML(w, mode),
      blockPresent: !!block,
      anchors: block ? [...block.querySelectorAll("a")].map(a => ({ href: a.getAttribute("href"), text: a.textContent, rel: a.getAttribute("rel"), target: a.getAttribute("target") })) : [],
      blockText: block ? block.textContent : "",
    };
  }
  const withLinks = await load(t => {
    t.leagues[0].config = { fb_url: "https://example.invalid/fb-group", discord_url: "https://example.invalid/discord-invite" };
    t.leagues.push({ id: 99, name: "Linkless League" });
  });
  const noLinks = await load(() => {});
  const badScheme = await load(t => {
    t.leagues[0].config = { fb_url: "javascript:alert(1)", discord_url: "HTTPS://example.invalid/upper-ok" };
  });
  return { withLinks, noLinks, badScheme };
}

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
// The no-league POLL. Deliberately a different shape from
// runNoLeagueScenario, which models a reload as a second page load: here the
// transition must happen in ONE window with no reload at all, which is the
// whole point of the feature.
//
// It is driven by dispatching visibilitychange rather than waiting out the
// 15s interval — that path exists precisely because foregrounding is the
// case that actually happens (they message an admin, get added, switch back),
// and it makes the test deterministic instead of timing-dependent.
// Builds a no-league window with setInterval/clearInterval STUBBED, so the
// poll can be driven deterministically instead of waited out.
//
// Timers are stubbed rather than the poll function being exported: making
// pollNoLeague public would prove the body while proving nothing about the
// interval, and "the poll stops" means the interval is CLEARED, not merely
// that a transition happened. Counting clearInterval calls is the only way to
// assert that from outside. The stub goes in before window.eval because
// startNoLeaguePolling runs during boot(), which the eval triggers.
function noLeagueWindow({ html, scripts, mode, tables, calls, hidden = false }){
  const dom = new JSDOM(stripScripts(html), { url: "http://localhost/", runScripts: "outside-only", pretendToBeVisual: true });
  const { window } = dom;
  installGlobals(window, mode, tables, RPC_HANDLERS, calls, {});
  window.localStorage.setItem("ft_session", JSON.stringify(
    { id: "p3", name: "Wanderer", pin: "1234", is_global_admin: false }));
  // BOTH must be set. In a real browser `document.hidden` derives from
  // visibilityState, but jsdom implements it as its own getter, so
  // overriding visibilityState alone leaves hidden === false and the poll's
  // guard never trips. Found by this assertion failing at baseline.
  Object.defineProperty(window.document, "visibilityState",
    { value: hidden ? "hidden" : "visible", configurable: true });
  Object.defineProperty(window.document, "hidden",
    { value: hidden, configurable: true });
  const timers = { cb: null, sets: 0, clears: 0 };
  window.setInterval = (fn) => { timers.cb = fn; timers.sets++; return 1; };
  window.clearInterval = () => { timers.clears++; };
  for (const src of scripts) window.eval(src);
  return { window, timers };
}

export async function runNoLeaguePollScenario({ html, scripts, mode }){
  const { tables } = makeFixtures();
  const calls = [];
  const { window } = noLeagueWindow({ html, scripts, mode, tables, calls });
  await tick(); await tick();

  const mainHtmlNow = () => mainHTML(window, mode);
  const before = {
    html: mainHtmlNow(),
    status: window.document.getElementById("nl-status")?.textContent || "",
  };

  // Foreground with membership still absent — must NOT transition, and must
  // not claim it stopped. This is what proves the poll checks rather than
  // simply firing boot() on any visibility event.
  window.document.dispatchEvent(new window.Event("visibilitychange"));
  await tick(); await tick();
  const stillWaiting = {
    html: mainHtmlNow(),
    myLeaguesCalls: calls.filter(c => c.type === "rpc" && c.fn === "my_leagues").length,
  };

  // The admin adds them. Same server-side effect admin_add_league_member has.
  tables.league_members.push({ league_id: 1, player_id: "p3", is_league_admin: false, official_opt_in: true });

  // Foreground again — now it must transition, in this window, no reload.
  window.document.dispatchEvent(new window.Event("visibilitychange"));
  await tick(); await tick(); await tick();
  const afterAdd = {
    html: mainHtmlNow(),
    tabsDisplay: window.document.getElementById("tabs")?.style.display || "",
  };

  return { before, stillWaiting, afterAdd };
}

// The three properties the visibilitychange-driven scenario above cannot
// reach: that the interval is actually CLEARED on success, that the attempt
// cap renders its stopped state with a working button, and that a hidden tab
// makes no request at all.
export async function runNoLeaguePollTimersScenario({ html, scripts, mode }){
  const out = {};

  // --- 1. Interval cleared when a league appears. Asserted by counting
  // clearInterval, not by observing the transition: a transition proves
  // boot() ran, not that the timer stopped, and a surviving interval would
  // keep firing against a screen that no longer exists.
  {
    const { tables } = makeFixtures();
    const calls = [];
    const { window, timers } = noLeagueWindow({ html, scripts, mode, tables, calls });
    await tick(); await tick();
    const clearsBefore = timers.clears;
    tables.league_members.push({ league_id: 1, player_id: "p3", is_league_admin: false, official_opt_in: true });
    await timers.cb();                       // one poll tick, driven directly
    await tick(); await tick(); await tick();
    out.onSuccess = {
      cleared: timers.clears > clearsBefore,
      html: mainHTML(window, mode),
      tabsDisplay: window.document.getElementById("tabs")?.style.display || "",
    };
  }

  // --- 2. Attempt cap. Fired well past any plausible cap so the assertion
  // does not encode the constant — NO_LEAGUE_MAX_POLLS can change without
  // rewriting this. The Check again button must survive as the manual
  // fallback, which is the whole point of stopping rather than spinning.
  {
    const { tables } = makeFixtures();
    const calls = [];
    const { window, timers } = noLeagueWindow({ html, scripts, mode, tables, calls });
    await tick(); await tick();
    for (let i = 0; i < 400; i++){ await timers.cb(); }
    await tick(); await tick();
    const btn = [...window.document.querySelectorAll("button")]
      .map(b => b.outerHTML).find(h => /Check again/.test(h)) || "";
    out.cap = {
      status: window.document.getElementById("nl-status")?.textContent || "",
      cleared: timers.clears > 0,
      buttonHtml: btn,
      // Capped, so the call count must be far below the number of ticks.
      myLeaguesCalls: calls.filter(c => c.type === "rpc" && c.fn === "my_leagues").length,
    };
  }

  // --- 3. Hidden tab makes NO request. This is the abandoned-overnight case.
  {
    const { tables } = makeFixtures();
    const calls = [];
    const { timers } = noLeagueWindow({ html, scripts, mode, tables, calls, hidden: true });
    await tick(); await tick();
    const before = calls.filter(c => c.type === "rpc" && c.fn === "my_leagues").length;
    for (let i = 0; i < 5; i++){ await timers.cb(); }
    await tick(); await tick();
    out.hidden = {
      callsAdded: calls.filter(c => c.type === "rpc" && c.fn === "my_leagues").length - before,
    };
  }

  return out;
}

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
  // Pick rows render only in Detail (standings-ux.md 2a, Compact is the
  // default) — switch before reading the breakdown labels.
  window.setScoresView("detail");
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
  // Repointed 2026-08-21: the orphan check counts via admin_pick_status now,
  // not get_show_picks — the latter is cutoff-gated and returned nothing for
  // the open shows this check examines, which is why it was dead. Throwing
  // on the old RPC would simulate a failure the code no longer performs.
  const origPickStatus = RPC_HANDLERS.admin_pick_status;
  RPC_HANDLERS.admin_pick_status = async () => { throw new Error("simulated lookup failure"); };
  const failedLookupConfirms = [];
  window.confirm = (m) => { failedLookupConfirms.push(m); return false; }; // cancel
  q("c-mode").value = "slots";
  window.onModeChange();
  await tick();
  await window.saveMasterSwitch();
  await tick(); await tick();
  window.confirm = () => true;
  RPC_HANDLERS.admin_pick_status = origPickStatus;
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
  // Own-row marker, checked BOTH ways (standings-ux.md 3): the session
  // player's row has .me, and no other row does. Read off the DOM, not
  // inferred from the snapshot html.
  log.push({ label: "standings-me",
    // table.lb:not(.compact) — the Nerd stats table below the board is
    // also table.lb and also marks the own row; this checks the board.
    me: [...window.document.querySelectorAll("table.lb:not(.compact) tr.me td.pname .nm")].map(e => e.textContent),
    others: [...window.document.querySelectorAll("table.lb:not(.compact) tr:not(.me) td.pname .nm")].map(e => e.textContent) });

  // admin tab (fixture session is a league admin, not global)
  clickTab(window, "admin");
  await tick(); await tick();
  snap("admin");
  // Settings links, empty-set case: the fixture league has no config, so
  // the block beneath the league selector must be absent (standings-ux.md 1).
  log.push({ label: "settings-links", present: !!window.document.getElementById("settings-links") });

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

// A league with members and a LIVE Official season but NO league_shows rows
// — the exact state Green Eggs sat in from 2026-08-17 to 2026-10-11, found
// only when a player noticed every button said "Score" three days before the
// season started. Every other fixture has overlay rows, so this path had
// never rendered in the suite.
//
// What this pins, and what it cannot:
//   * Client: showState() returns "no cutoff" when the overlay row is absent
//     (cutoff_at undefined), shows.js labels the button "Score", the pill
//     reads "no cutoff", the show is still LISTED (it comes from the global
//     shows table), and openShow() renders the detail view, never the pick
//     sheet.
//   * RPC fake: submit_picks rejects with the real RPC's message. Calling the
//     fake directly asserts the FAKE's fidelity, not the SQL — stated rather
//     than dressed up as coverage. The positive control (same call succeeds
//     once a row exists) is what makes the negative meaningful: it proves the
//     rejection is BECAUSE of the missing row, not for some unrelated reason.
//   * Scorer: NOT exercised. eligibleLeagueShows() lives in index.ts (Deno)
//     and filters league_shows rows; with no rows there is nothing to score.
//     That stays verified by reading until venueCutoffISO/scoring helpers
//     move to a shared module in the post-first-show batch.
export async function runNoOverlayScenario({ html, scripts, mode }){
  const { tables } = makeFixtures();
  const calls = [];
  const originalOverlay = tables.league_shows.slice();
  tables.league_shows.length = 0; // the zero-overlay state
  // A live Official season, so "no season" cannot be the reason anything is
  // withheld. Dates off the real clock, never hardcoded.
  const now = Date.now();
  const d = (off) => new Date(now + off * 864e5).toISOString().slice(0, 10);
  tables.seasons.push({ id: 503, bracket_id: 11, name: "Live Season", start_date: d(-3), end_date: d(3), roster_locked_at: null });

  const dom = new JSDOM(stripScripts(html), { url: "http://localhost/", runScripts: "outside-only", pretendToBeVisual: true });
  const { window } = dom;
  installGlobals(window, mode, tables, RPC_HANDLERS, calls, {});
  window.localStorage.setItem("ft_session", JSON.stringify(
    { id: "p1", name: "Wooklord", pin: "1234", is_global_admin: false }));
  for (const src of scripts) window.eval(src);
  await tick(); await tick();
  clickTab(window, "shows");
  await tick(); await tick();

  const rows = [...window.document.querySelectorAll(".showrow")];
  const list = {
    rowCount: rows.length,
    venues: rows.map(r => r.querySelector(".venue")?.textContent || ""),
    pills: rows.map(r => r.querySelector(".pill")?.textContent.trim() || ""),
    buttonLabels: rows.map(r => r.querySelector("button")?.textContent.trim() || ""),
  };

  window.openShow(1);
  await tick(); await tick();
  const detail = {
    sheetInputCount: window.document.querySelectorAll(".slotline input").length,
    html: mainHTML(window, mode),
  };

  // Direct calls against the fake — see the header comment for what this
  // does and does not prove. Casual bracket (10) so _official_gate cannot
  // be the reason either way.
  const picks = [{ slot: "opener", songname: "Rambling Boy" }];
  let submitErrorNoRow = null;
  try{ await RPC_HANDLERS.submit_picks({ p_name: "Wooklord", p_bracket_id: 10, p_show_id: 1, p_picks: picks }, tables); }
  catch(e){ submitErrorNoRow = e.message; }
  // Positive control: restore show 1's row and the identical call succeeds.
  tables.league_shows.push(originalOverlay.find(l => l.show_id === 1));
  let submitWithRow = null;
  try{ submitWithRow = await RPC_HANDLERS.submit_picks({ p_name: "Wooklord", p_bracket_id: 10, p_show_id: 1, p_picks: picks }, tables); }
  catch(e){ submitWithRow = { error: e.message }; }

  return { list, detail, submitErrorNoRow, submitWithRow };
}

// ---------------------------------------------------------------------
// 2026-10-25 batch — docs/decisions/standings-ux.md and admin-panel.md
// "Who's Picked". Each scenario below boots its own window(s).
// ---------------------------------------------------------------------

// Settings community links (standings-ux.md 1): the CURRENT league's
// links beneath the league selector, sourced from state.leagues — so no
// `leagues` table read may happen for it. Boots a non-admin (the
// standalone Settings tab) and an admin (the panel embedded in the admin
// tab, where the redundancy with the Community editor is accepted).
export async function runSettingsLinksScenario({ html, scripts, mode }){
  async function load(session){
    const { tables } = makeFixtures();
    tables.leagues[0].config = { fb_url: "https://example.invalid/fb-group", discord_url: "https://example.invalid/discord-invite" };
    const calls = [];
    const dom = new JSDOM(stripScripts(html), { url: "http://localhost/", runScripts: "outside-only", pretendToBeVisual: true });
    const w = dom.window;
    installGlobals(w, mode, tables, RPC_HANDLERS, calls, {});
    w.localStorage.setItem("ft_session", JSON.stringify(session));
    for (const src of scripts) w.eval(src);
    await tick(); await tick();
    clickTab(w, "admin");
    await tick(); await tick();
    const block = w.document.getElementById("settings-links");
    const slot = w.document.getElementById("leagueLinks");
    return {
      present: !!block,
      slotAfterSelector: !!slot && slot.previousElementSibling?.id === "leagueSelect",
      anchors: block ? [...block.querySelectorAll("a")].map(a => ({ href: a.getAttribute("href"), text: a.textContent, rel: a.getAttribute("rel"), target: a.getAttribute("target") })) : [],
      blockText: block ? block.textContent : "",
      leagueReads: calls.filter(c => c.type === "query" && c.table === "leagues").length,
    };
  }
  return {
    nonAdmin: await load({ id: "p2", name: "EggHead", pin: "1234", is_global_admin: false }),
    admin: await load({ id: "p1", name: "Wooklord", pin: "1234", is_global_admin: false }),
  };
}

// Tie groups on the standings board (standings-ux.md item 5, approved
// 2026-10-26). The per-row tiebreak lines are gone; a tie renders as a
// bracketed group with a tag row and an expandable sub-row. Fixture base:
// a live season on Official, show 3 final three days ago, a roster; each
// case supplies its own stack and scores. The toggle is INVOKED, not just
// asserted present. `read()` returns DOM facts only — jsdom is blind to
// CSS, so the bracket/outline coexistence is checked statically against
// styles.css in scenario.test.mjs, and phone-width LAYOUT is not proven
// here at all (a stated seam: check it on a device).
export async function runStandingsTiebreakScenario({ html, scripts, mode }){
  const day = o => new Date(Date.now() + o*864e5).toISOString().slice(0,10);
  async function load({ scores, stack = ["fewest_zeros"], preset, bracket = "official", roster = ["p1", "p2"], thirdShow = false }){
    const { tables, ids } = makeFixtures();
    tables.shows.push({ id: 3, showdate: day(-3), venue: "Side Room", city: "Kingston", state: "NY", sync_flag: null });
    tables.league_shows.push({ league_id: ids.LEAGUE_ID, show_id: 3, cutoff_at: new Date(Date.now()-3*864e5).toISOString(), format: "standard", status: "final", remind_sent: null, lock_sent: null, winner_sent: null });
    // Only the three-way case: a third final show, so a second layer can
    // split a pair that the first left together (two shows summing to one
    // total cannot separate equal-high players on zeros). Not pushed for
    // the other cases — an extra show changes everyone's zero count.
    if (thirdShow){
      tables.shows.push({ id: 4, showdate: day(-2), venue: "Back Room", city: "Kingston", state: "NY", sync_flag: null });
      tables.league_shows.push({ league_id: ids.LEAGUE_ID, show_id: 4, cutoff_at: new Date(Date.now()-2*864e5).toISOString(), format: "standard", status: "final", remind_sent: null, lock_sent: null, winner_sent: null });
    }
    tables.seasons.push({ id: 502, bracket_id: ids.OFFICIAL_ID, name: "Live Season", start_date: day(-30), end_date: day(30), roster_locked_at: null });
    for (const id of roster) tables.season_rosters.push({ season_id: 502, player_id: id, added_at: day(-30) + "T00:00:00Z" });
    const off = tables.brackets.find(b => b.id === ids.OFFICIAL_ID);
    off.config = { ...off.config, tiebreakers: stack };
    tables.scores = scores(ids);
    const calls = [];
    const dom = new JSDOM(stripScripts(html), { url: "http://localhost/", runScripts: "outside-only", pretendToBeVisual: true });
    const w = dom.window;
    installGlobals(w, mode, tables, RPC_HANDLERS, calls, {});
    w.localStorage.setItem("ft_session", JSON.stringify({ id: "p1", name: "Wooklord", pin: "1234", is_global_admin: false }));
    w.localStorage.setItem("ft_bracket_id", String(bracket === "official" ? ids.OFFICIAL_ID : ids.CASUAL_ID));
    if (preset) w.localStorage.setItem("ft_board_view", preset); // a leftover key from 1a74cee must be ignored
    for (const src of scripts) w.eval(src);
    await tick(); await tick();
    clickTab(w, "board");
    await tick(); await tick(); await tick();
    const read = () => {
      const tbl = w.document.querySelector("table.lb:not(.compact)");
      const q = sel => tbl ? [...tbl.querySelectorAll(sel)] : [];
      return {
        chipPresent: !!w.document.getElementById("boardview"),
        setterOnWindow: typeof w.setBoardView,
        toggleOnWindow: typeof w.toggleTieGroup,
        names: q("td.pname .nm").map(e => e.textContent),
        nameCellDivs: q("td.pname div").length,
        tgRows: q("tr.tg").map(tr => ({ name: tr.querySelector(".nm")?.textContent, rank: tr.querySelector(".rank")?.textContent,
          me: tr.classList.contains("me"), first: tr.classList.contains("tg-first"), last: tr.classList.contains("tg-last"), key: tr.dataset.tg })),
        meRows: q("tr.me").map(tr => tr.querySelector(".nm")?.textContent),
        tags: q("tr.tg-tag").map(tr => ({ key: tr.dataset.tg, text: tr.querySelector(".tg-text")?.textContent,
          plus: tr.querySelector(".tg-plus")?.textContent ?? null, expanded: tr.querySelector(".tg-plus")?.getAttribute("aria-expanded") ?? null,
          onclick: tr.querySelector(".tg-plus")?.getAttribute("onclick") ?? "", none: tr.querySelector(".tg-none")?.textContent ?? null,
          me: tr.classList.contains("me"), tg: tr.classList.contains("tg") })),
        // LAYOUT B grid (standings-ux.md item 5 correction): header cells
        // (.tg-h.tg-col, one per configured layer) then member rows of
        // rank · name · one value per layer, flat in the grid — chunked
        // here by the header count. `stray` must be 0 (no partial row).
        subs: q("tr.tg-sub").map(tr => {
          const grid = tr.querySelector(".tg-grid");
          const headers = grid ? [...grid.querySelectorAll(".tg-h.tg-col")] : [];
          const w = 2 + headers.length;
          const cells = grid ? [...grid.children].slice(w) : [];
          const rows = [];
          for (let i = 0; i + w <= cells.length; i += w) rows.push(cells.slice(i, i + w));
          return {
            key: tr.dataset.tg, hidden: tr.classList.contains("hidden"), tg: tr.classList.contains("tg"),
            cols: grid?.getAttribute("style") ?? "",
            headers: headers.map(h => ({ layer: h.dataset.layer, label: h.firstChild?.textContent ?? "", deciding: h.classList.contains("deciding"), decidedMark: !!h.querySelector(".tg-decided") })),
            rows: rows.map(r => ({ rank: r[0].textContent, name: r[1].querySelector(".nm")?.textContent, title: r[1].querySelector(".nm")?.getAttribute("title"),
              vals: r.slice(2).map(cell => ({ layer: cell.dataset.layer, value: cell.textContent, deciding: cell.classList.contains("deciding") })) })),
            stray: cells.length % w,
          };
        }),
        rpcCount: calls.filter(c => c.type === "rpc").length,
        storageKeys: Object.keys(dumpLocalStorage(w)).sort(),
        placeholderPodium: !!w.document.querySelector(".podium") && w.document.querySelectorAll(".podium .nm").length === 0,
        // The "Tiebreakers" footer under the board (amendment B: Title
        // Case short labels there too). textContent flattens the <br>.
        footer: [...w.document.querySelectorAll(".panel p.muted")].find(p => /^Tiebreakers/.test(p.textContent))?.textContent ?? "",
      };
    };
    return { w, read };
  }
  const O = (ids, pid, show, points) => ({ player_id: pid, bracket_id: ids.OFFICIAL_ID, show_id: show, points, breakdown: [] });
  // p1 4+1 = 5 with no zeros; p2 5+0 = 5 with one zero → fewest_zeros splits them.
  const resolved = ids => [O(ids, "p1", 2, 4), O(ids, "p1", 3, 1), O(ids, "p2", 2, 5), O(ids, "p2", 3, 0)];
  // Each wins one show; most_wins ties 1–1 and nothing else is configured → shared.
  const sharedWins = ids => [O(ids, "p1", 2, 5), O(ids, "p1", 3, 0), O(ids, "p2", 2, 0), O(ids, "p2", 3, 5)];
  // p2 one point behind → no tie at all.
  const noTie = ids => [O(ids, "p1", 2, 4), O(ids, "p1", 3, 1), O(ids, "p2", 2, 4), O(ids, "p2", 3, 0)];
  // Three-way at 6 over three shows (amendment 2026-10-26's recorded
  // example): p1 (6,0,0) has the high score and splits off at High Score;
  // p2 (3,3,0) and p4 (3,2,1) share high 3, and Fewest zeros then splits
  // them (p4 none, p2 one). Each wins one show, so Most wins is 1–1 and
  // never reached. Expected: High Score cells tinted for all three,
  // Fewest zeros tinted for the pair only, p1's Fewest zeros cell plain,
  // Most wins plain; ranks p1 1, p4 2, p2 3.
  const threeWay = ids => [O(ids, "p1", 2, 6), O(ids, "p2", 2, 3), O(ids, "p2", 3, 3), O(ids, "p4", 2, 3), O(ids, "p4", 3, 2), O(ids, "p4", 4, 1)];
  // Fresh season: everyone at 0 → hasAnyScore false → the gate.
  const allZero = ids => [O(ids, "p1", 2, 0), O(ids, "p1", 3, 0), O(ids, "p2", 2, 0), O(ids, "p2", 3, 0)];
  // Casual: no seasons → All time → empty stack; equal career points.
  const casualTie = ids => [{ ...O(ids, "p1", 2, 3), bracket_id: ids.CASUAL_ID }, { ...O(ids, "p2", 2, 3), bracket_id: ids.CASUAL_ID }];

  const a = await load({ scores: resolved });
  const collapsed = a.read();
  const key = collapsed.tags[0]?.key;
  if (collapsed.toggleOnWindow === "function") a.w.toggleTieGroup(key);
  await tick();
  const expanded = a.read();
  if (collapsed.toggleOnWindow === "function") a.w.toggleTieGroup(key);
  await tick();
  const collapsedAgain = a.read();
  if (collapsed.toggleOnWindow === "function") a.w.toggleTieGroup(key);
  await tick();
  // A re-render (tab away and back) rebuilds the table from scratch; the
  // open group must come back open — the state lives in memory, not in
  // the DOM that was just thrown away — and localStorage must gain nothing.
  clickTab(a.w, "shows");
  await tick(); await tick();
  clickTab(a.w, "board");
  await tick(); await tick(); await tick();
  const afterRerender = a.read();

  const shared = (await load({ scores: sharedWins, stack: ["most_wins"] })).read();
  const none = (await load({ scores: noTie })).read();
  // Three-layer stack: the header tint must stay on the FIRST splitting
  // layer only, and the cell tints must follow each member's own path.
  const threeLoad = await load({ scores: threeWay, roster: ["p1", "p2", "p4"], stack: ["highest_single_show", "fewest_zeros", "most_wins"], thirdShow: true });
  const three = threeLoad.read();
  // Same Official bracket, admin tab (p1 is the league admin): the Season
  // tiebreakers help prose must use the select's own wording — "Most
  // laurels", never "Most wins" (item 5 amendment B addendum, follow-up).
  // The section body renders even while collapsed, so textContent reads it.
  clickTab(threeLoad.w, "admin");
  await tick(); await tick(); await tick();
  const tbSec = threeLoad.w.document.getElementById("sec-tiebreakers");
  const adminTiebreak = { present: !!tbSec,
    help: [...(tbSec?.querySelectorAll("p.muted") ?? [])].map(p => p.textContent).find(t => /^Fewest zeros —/.test(t)) ?? "",
    options: [...(tbSec?.querySelectorAll("#tb-0 option") ?? [])].map(o => o.textContent) };
  const zero = (await load({ scores: allZero })).read();
  const casual = (await load({ scores: casualTie, bracket: "casual" })).read();
  const leftoverKey = (await load({ scores: resolved, preset: "compact" })).read();
  return { collapsed, expanded, collapsedAgain, afterRerender, shared, none, three, adminTiebreak, zero, casual, leftoverKey };
}

// Scores page View chip + own-entry outline (standings-ux.md 2a/3a).
// Fixture show 2 is final with scores for p1 (5, one breakdown row) and
// p2 (2, one breakdown row). Compact must render the cards with NO pick
// rows; Detail must render them; the own card is the session player's
// and only theirs — checked from two sessions so "mine" is proven to
// follow the viewer, not a fixed row.
export async function runScoresViewScenario({ html, scripts, mode }){
  async function load({ session, preset, mutate = () => {} }){
    const { tables } = makeFixtures();
    mutate(tables);
    const calls = [];
    const dom = new JSDOM(stripScripts(html), { url: "http://localhost/", runScripts: "outside-only", pretendToBeVisual: true });
    const w = dom.window;
    installGlobals(w, mode, tables, RPC_HANDLERS, calls, {});
    w.localStorage.setItem("ft_session", JSON.stringify(session));
    if (preset) w.localStorage.setItem("ft_scores_view", preset);
    for (const src of scripts) w.eval(src);
    await tick(); await tick();
    w.openShow(2);
    await tick(); await tick(); await tick();
    const read = () => {
      const chip = w.document.getElementById("scoresview");
      return {
        chipPresent: !!chip,
        on: chip ? [...chip.querySelectorAll(".switcher-btn.on")].map(b => b.textContent) : [],
        entries: w.document.querySelectorAll(".scoreentry").length,
        pickRows: w.document.querySelectorAll(".scoreentry .pickres").length,
        mine: [...w.document.querySelectorAll(".scoreentry.mine .nm")].map(e => e.textContent),
        notMine: [...w.document.querySelectorAll(".scoreentry:not(.mine) .nm")].map(e => e.textContent),
        titled: w.document.querySelectorAll(".scoreentry .nm[title]").length,
        stored: w.localStorage.getItem("ft_scores_view"),
        rpcCalls: calls.filter(c => c.type === "rpc").length,
        html: mainHTML(w, mode),
      };
    };
    return { w, read };
  }
  const p1 = { id: "p1", name: "Wooklord", pin: "1234", is_global_admin: false };
  const p2 = { id: "p2", name: "EggHead", pin: "1234", is_global_admin: false };
  const a = await load({ session: p1 });
  const compact = a.read();
  a.w.setScoresView("detail");
  await tick(); await tick();
  const detail = a.read();
  a.w.setScoresView("compact");
  await tick(); await tick();
  const backToCompact = a.read();
  a.w.setScoresView("sideways"); // unknown value: ignored, nothing written
  await tick();
  const afterBogus = a.read();
  const b = await load({ session: p1, preset: "detail" });
  const presetDetail = b.read();
  const c = await load({ session: p2 });
  const asP2 = c.read();
  // Zero entries: no scores for show 2 and no picks either, so neither the
  // score cards nor the pre-scoring board render — the chip still must.
  const d = await load({ session: p1, mutate: t => {
    t.scores = t.scores.filter(s => s.show_id !== 2);
    t.picks = t.picks.filter(p => p.show_id !== 2);
  }});
  const empty = d.read();
  return { compact, detail, backToCompact, afterBogus, presetDetail, asP2, empty };
}

// Long-name case (standings-ux.md 4): a 27-character invented nickname
// (the live maximum) must render in full inside a .nm cell with the full
// name in title everywhere it appears — standings table, podium, Who's
// Picked, Members. CSS does the truncation; jsdom can't measure it, so
// scenario.test.mjs checks the stylesheet rule statically alongside this.
export async function runLongNameScenario({ html, scripts, mode }){
  const LONG = "Eggbertinawellingtonthe3rdX"; // 27 chars, no spaces, not a real nickname
  const { tables } = makeFixtures();
  tables.players_public.find(p => p.id === "p2").name = LONG;
  const calls = [];
  const dom = new JSDOM(stripScripts(html), { url: "http://localhost/", runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window;
  installGlobals(w, mode, tables, RPC_HANDLERS, calls, {});
  w.localStorage.setItem("ft_session", JSON.stringify({ id: "p1", name: "Wooklord", pin: "1234", is_global_admin: false }));
  for (const src of scripts) w.eval(src);
  await tick(); await tick();
  clickTab(w, "board");
  await tick(); await tick(); await tick();
  const cell = w.document.querySelector(`table.lb:not(.compact) td.pname .nm[title="${LONG}"]`);
  const pod = w.document.querySelector(`.pod .nm[title="${LONG}"], .pod-names .nm[title="${LONG}"]`);
  clickTab(w, "admin");
  await tick(); await tick(); await tick(); await tick();
  const roster = w.document.querySelector(`#roster .roster-row .nm[title="${LONG}"]`);
  // Members rows use .mname (full width, never truncated — admin-panel.md
  // → "Members panel cleanup"), not the ellipsis class .nm.
  const member = w.document.querySelector(`#playerlist .mname[title="${LONG}"]`);
  return {
    LONG,
    cellText: cell?.textContent ?? null,
    podText: pod?.textContent ?? null,
    rosterText: roster?.textContent ?? null,
    memberText: member?.textContent ?? null,
  };
}

// Who's Picked (admin-panel.md → "Who's Picked"): two-line rows with a
// status pill derived like pickButtonInfo (saved vs slotDefs(format).length
// — standard = 5 in the fixture), a Show chip defaulting to Needs picks,
// the verbatim line-two text with the "1 pick" grammar fix, and the
// empty-set message when everyone is done.
export async function runWhosPickedScenario({ html, scripts, mode }){
  async function load(mutate = () => {}){
    const { tables, ids } = makeFixtures();
    mutate(tables, ids);
    const calls = [];
    const dom = new JSDOM(stripScripts(html), { url: "http://localhost/", runScripts: "outside-only", pretendToBeVisual: true });
    const w = dom.window;
    installGlobals(w, mode, tables, RPC_HANDLERS, calls, {});
    w.localStorage.setItem("ft_session", JSON.stringify({ id: "p1", name: "Wooklord", pin: "1234", is_global_admin: false }));
    for (const src of scripts) w.eval(src);
    await tick(); await tick();
    clickTab(w, "admin");
    await tick(); await tick(); await tick(); await tick();
    const read = () => {
      const r = w.document.getElementById("roster");
      return {
        summary: r?.querySelector("p.muted")?.textContent || "",
        on: r ? [...r.querySelectorAll(".switcher-btn.on")].map(b => b.textContent) : [],
        rows: r ? [...r.querySelectorAll(".roster-row")].map(x => ({
          name: x.querySelector(".nm")?.textContent, status: x.dataset.status,
          pill: x.querySelector(".pill")?.textContent, pillClass: x.querySelector(".pill")?.className ?? "",
          l2: x.querySelector(".roster-l2")?.textContent,
          // Refinement 2026-10-26 (admin-panel.md → Who's Picked): the row
          // still carries .miss for no-picks; the name must sit outside
          // every dimmed element (pill, line two) and must not be the
          // row's first span (that is the mark, which IS dimmed).
          miss: x.classList.contains("miss"),
          nameInDimmed: !!x.querySelector(".nm")?.closest(".pill, .roster-l2"),
          nameIsFirstSpan: x.firstElementChild === x.querySelector(".nm") })) : [],
        empty: r?.querySelector("#roster-empty")?.textContent || "",
        html: r?.innerHTML || "",
      };
    };
    const selectShow = async id => {
      w.document.getElementById("roster-show").value = String(id);
      await w.loadRoster();
      await tick(); await tick();
    };
    return { w, read, selectShow };
  }
  // p2 gets exactly one pick on show 1 (the "1 pick" grammar case); p1 has
  // 2 of 5 there (Partial) and 5 of 5 on show 2 (Done).
  const a = await load((t, ids) => {
    t.picks.push({ player_id: "p2", bracket_id: ids.CASUAL_ID, show_id: 1, slot: "opener", songname: "Distraction" });
  });
  const show1Needs = a.read();
  await a.selectShow(2);
  const show2Needs = a.read();
  a.w.setRosterFilter("all");
  await tick(); await tick(); await tick();
  const show2All = a.read();
  // A re-render (tab away and back) must reopen on Needs picks.
  clickTab(a.w, "shows");
  await tick(); await tick();
  clickTab(a.w, "admin");
  await tick(); await tick(); await tick(); await tick();
  const afterRerender = a.read();
  // Everyone done: p1 is the only member and has 5 of 5 on show 2.
  const b = await load(t => { t.league_members = t.league_members.filter(m => m.player_id === "p1"); });
  await b.selectShow(2);
  const everyoneDone = b.read();
  b.w.setRosterFilter("all");
  await tick(); await tick(); await tick();
  const everyoneDoneAll = b.read();
  return { show1Needs, show2Needs, show2All, afterRerender, everyoneDone, everyoneDoneAll };
}

// Registration length cap (standings-ux.md 4): 21 characters rejected
// before any RPC (the client check) AND by the fake (the server mirror);
// 20 accepted; 22 with padding accepted because both sides trim first.
// The fake's success path ends in location.reload(), which jsdom reports
// as "not implemented" on the virtual console — a silent VirtualConsole
// keeps that noise out of the run; nothing else is expected to log.
export async function runRegisterLengthScenario({ html, scripts, mode }){
  async function attempt(name){
    const { tables } = makeFixtures();
    const calls = [];
    const dom = new JSDOM(stripScripts(html), { url: "http://localhost/", runScripts: "outside-only", pretendToBeVisual: true, virtualConsole: new VirtualConsole() });
    const w = dom.window;
    installGlobals(w, mode, tables, RPC_HANDLERS, calls, {});
    for (const src of scripts) w.eval(src);
    await tick(); await tick();
    w.document.getElementById("a-name").value = name;
    w.document.getElementById("a-pin").value = "1234";
    await w.doRegister();
    await tick(); await tick();
    return {
      err: w.document.getElementById("a-err")?.textContent || "",
      registerCalls: calls.filter(c => c.type === "rpc" && c.fn === "register_player").map(c => c.args.p_name),
      session: JSON.parse(w.localStorage.getItem("ft_session") || "null"),
    };
  }
  return {
    over: await attempt("Z".repeat(21)),
    max: await attempt("Z".repeat(20)),
    padded: await attempt("  " + "Z".repeat(20) + "  "),
  };
}

// Show-sync flag notice (docs/show_sync_plan.md → Admin Shows section): a
// show carrying shows.sync_flag renders a .noticebox.sync-flag under its
// row head in "Shows: cutoffs & finalizing", with a Clear button wired to
// clearSyncFlag → admin_clear_sync_flag → re-render. The fake mirrors the
// Stage U RPC (any league admin, allow-plus-log). The handler is INVOKED,
// not just asserted present — the "does anything invoke this?" rule in
// testing-harness.md. The no-flag case is the untouched base fixture, so
// it is a genuine empty-set check rather than a mutation of the flagged one.
export async function runSyncFlagScenario({ html, scripts, mode }){
  async function load(mutate = () => {}){
    const { tables } = makeFixtures();
    mutate(tables);
    const calls = [];
    const dom = new JSDOM(stripScripts(html), { url: "http://localhost/", runScripts: "outside-only", pretendToBeVisual: true });
    const w = dom.window;
    installGlobals(w, mode, tables, RPC_HANDLERS, calls, {});
    w.localStorage.setItem("ft_session", JSON.stringify({ id: "p1", name: "Wooklord", pin: "1234", is_global_admin: false }));
    for (const src of scripts) w.eval(src);
    await tick(); await tick();
    clickTab(w, "admin");
    await tick(); await tick(); await tick(); await tick();
    const read = () => {
      const sec = w.document.getElementById("sec-shows");
      const notices = sec ? [...sec.querySelectorAll(".noticebox.sync-flag")] : [];
      return {
        sectionPresent: !!sec,
        rowCount: sec ? sec.querySelectorAll(".arow").length : 0,
        notices: notices.map(n => ({
          show: n.dataset.show,
          text: n.textContent.replace(/\s+/g, " ").trim(),
          onclick: n.querySelector("button")?.getAttribute("onclick") || "",
          // Under its own row head, not floating elsewhere in the section.
          underRowHead: n.previousElementSibling?.classList.contains("arow-head") === true,
        })),
      };
    };
    return { w, tables, calls, read };
  }
  const flagText = "Carton changed showdate (2026-11-01 → 2026-11-02); not applied — finalized in 1 league(s)";
  const a = await load(t => { t.shows[0].sync_flag = flagText; });
  const flagged = a.read();
  const btn = a.w.document.querySelector("#sec-shows .noticebox.sync-flag button");
  const handlerOnWindow = typeof a.w.clearSyncFlag === "function";
  if (handlerOnWindow) await a.w.clearSyncFlag(1, btn);
  await tick(); await tick();
  const cleared = a.read();
  const rpcCalls = a.calls.filter(c => c.type === "rpc" && c.fn === "admin_clear_sync_flag").map(c => c.args);
  const b = await load();
  const none = b.read();
  return {
    flagText, flagged, cleared, rpcCalls, handlerOnWindow,
    tableFlagAfter: a.tables.shows[0].sync_flag,
    clearLog: a.tables.sync_flag_clears ?? [],
    none,
  };
}

// Stats panel (standings-ux.md item 6, LOCKED 2026-10-26). Same fixture
// shape as the tiebreak scenario — a live Official season, three final
// shows, p1/p2/p4 rostered — with scores chosen so avg, zeros and shows
// all differ while wins tie three ways:
//   p1 (7,–,–): shows 1, avg 7.0, high 7, zeros 2, wins 1 (show 2)
//   p2 (3,3,–): shows 2, avg 3.0, high 3, zeros 1, wins 1 (show 3)
//   p4 (1,2,4): shows 3, avg 2.3, high 4, zeros 0, wins 1 (show 4)
// Totals are p1 7, p4 7, p2 6, so the standings order the panel receives
// is GlobalAdmin, Wooklord, EggHead — NOT alphabetical. That is
// deliberate: the first fixture had all three on equal points, the board's
// own tie sort handed the panel an alphabetical list, and a stable sort
// with the name tiebreak REMOVED reproduced it — the mutation passed on
// the board and only the unit test caught it. With this order the
// all-tied wins column must visibly re-sort to EggHead, GlobalAdmin,
// Wooklord. The tap handler is INVOKED (setStatsSort on window). Reads
// are DOM facts only; the bold/arrow CSS is asserted statically.
export async function runStatsScenario({ html, scripts, mode }){
  const day = o => new Date(Date.now() + o*864e5).toISOString().slice(0,10);
  async function load({ scores, preset, allTime = false, roster = ["p1", "p2", "p4"], mutate = () => {} }){
    const { tables, ids } = makeFixtures();
    mutate(tables, ids);
    tables.shows.push({ id: 3, showdate: day(-3), venue: "Side Room", city: "Kingston", state: "NY", sync_flag: null });
    tables.shows.push({ id: 4, showdate: day(-2), venue: "Back Room", city: "Kingston", state: "NY", sync_flag: null });
    for (const [sid, off] of [[3, -3], [4, -2]]) tables.league_shows.push({ league_id: ids.LEAGUE_ID, show_id: sid, cutoff_at: new Date(Date.now()+off*864e5).toISOString(), format: "standard", status: "final", remind_sent: null, lock_sent: null, winner_sent: null });
    tables.seasons.push({ id: 502, bracket_id: ids.OFFICIAL_ID, name: "Live Season", start_date: day(-30), end_date: day(30), roster_locked_at: null });
    for (const id of roster) tables.season_rosters.push({ season_id: 502, player_id: id, added_at: day(-30) + "T00:00:00Z" });
    tables.scores = scores(ids);
    const calls = [];
    const dom = new JSDOM(stripScripts(html), { url: "http://localhost/", runScripts: "outside-only", pretendToBeVisual: true });
    const w = dom.window;
    installGlobals(w, mode, tables, RPC_HANDLERS, calls, {});
    w.localStorage.setItem("ft_session", JSON.stringify({ id: "p1", name: "Wooklord", pin: "1234", is_global_admin: false }));
    w.localStorage.setItem("ft_bracket_id", String(ids.OFFICIAL_ID));
    if (preset != null) w.localStorage.setItem("ft_stats_sort", preset);
    for (const src of scripts) w.eval(src);
    await tick(); await tick();
    clickTab(w, "board");
    await tick(); await tick(); await tick();
    if (allTime){ w.setBoardSeason("all"); await tick(); await tick(); await tick(); }
    const read = () => {
      const p = w.document.getElementById("statspanel");
      const tbl = p?.querySelector("table.lb.compact");
      return {
        heading: p?.querySelector("h2")?.textContent.replace(/\s+/g, " ").trim() ?? "",
        headers: tbl ? [...tbl.querySelectorAll("th")].map(t => ({
          text: (t.textContent || "").replace(/[▲▼]/g, "").trim(), sortable: t.classList.contains("sortable"),
          active: t.classList.contains("active"), arrow: t.querySelector(".arrow")?.textContent ?? "",
          ariaSort: t.getAttribute("aria-sort"), onclick: t.getAttribute("onclick") ?? "" })) : [],
        rows: tbl ? [...tbl.querySelectorAll("tr")].filter(tr => tr.querySelector("td.pname")).map(tr => ({
          name: tr.querySelector(".nm")?.textContent, me: tr.classList.contains("me"),
          nameActive: tr.querySelector("td.pname")?.classList.contains("active") ?? false,
          cells: [...tr.querySelectorAll("td.pts")].map(td => ({ v: td.textContent, active: td.classList.contains("active") })) })) : [],
        emptyRow: tbl?.querySelector("td[colspan]")?.textContent ?? null,
        leadersPresent: !!p?.querySelector(".leaders"),
        // Stacked rows (amendment 2026-10-26): every listed name, the
        // "and N more" tail if any, and the value.
        leaders: p ? [...p.querySelectorAll(".leader")].map(l => ({ key: l.dataset.key, label: l.querySelector(".lbl")?.textContent,
          names: [...l.querySelectorAll(".nm")].map(e => e.textContent), more: l.querySelector("small")?.textContent ?? null,
          plus: /\+\d/.test(l.textContent), value: l.querySelector("b")?.textContent })) : [],
        // Truncation fix (item 6): the names cell's class (must never be the
        // header's global .who), the entry count, and whether "and N more"
        // sits inside the last entry (null when there is none).
        leaderCells: p ? [...p.querySelectorAll(".leader")].map(l => {
          const cell = l.children[1];
          const entries = cell ? [...cell.querySelectorAll(":scope > .ldr-name")] : [];
          const small = l.querySelector("small");
          return { cls: cell?.className ?? null, entries: entries.length,
            moreInLastEntry: small ? (entries.length > 0 && small.parentElement === entries[entries.length - 1]) : null };
        }) : [],
        legend: p?.querySelector("p.muted")?.textContent ?? "",
        stored: w.localStorage.getItem("ft_stats_sort"),
        rpcCount: calls.filter(c => c.type === "rpc").length,
        setterOnWindow: typeof w.setStatsSort,
      };
    };
    return { w, read };
  }
  const O = (ids, pid, show, points) => ({ player_id: pid, bracket_id: ids.OFFICIAL_ID, show_id: show, points, breakdown: [] });
  const three = ids => [O(ids, "p1", 2, 7), O(ids, "p2", 2, 3), O(ids, "p2", 3, 3), O(ids, "p4", 2, 1), O(ids, "p4", 3, 2), O(ids, "p4", 4, 4)];

  const a = await load({ scores: three });
  const dflt = a.read();
  if (dflt.setterOnWindow === "function") a.w.setStatsSort("zeros");
  await tick();
  const zerosAsc = a.read();
  if (dflt.setterOnWindow === "function") a.w.setStatsSort("zeros");
  await tick();
  const zerosDesc = a.read();
  const presetWins = (await load({ scores: three, preset: "wins:desc" })).read();
  const presetBogus = (await load({ scores: three, preset: "bogus" })).read();
  const empty = (await load({ scores: () => [] })).read();
  const allTime = (await load({ scores: three, allTime: true })).read();
  const b = await load({ scores: three, preset: "zeros:asc", allTime: true });
  const allTimeZerosPreset = b.read();
  if (allTimeZerosPreset.setterOnWindow === "function") b.w.setStatsSort("zeros");
  await tick();
  const allTimeZerosTap = b.read();

  // Player sort (amendment 2026-10-26, item 5): A–Z on the first tap, Z–A
  // on the second, on a fresh default load.
  const pl = await load({ scores: three });
  if (dflt.setterOnWindow === "function") pl.w.setStatsSort("player");
  await tick();
  const playerAsc = pl.read();
  if (dflt.setterOnWindow === "function") pl.w.setStatsSort("player");
  await tick();
  const playerDesc = pl.read();

  // Two-way ties (amendment item 2): p1 (3,3) and p2 (3,3) share avg 3.0
  // and two laurels each (both top show 2 and show 3); p4 (1,2,4) alone on
  // high 4, shows 3 and zeros 0. Both names must list, no "+".
  const twoWayScores = ids => [O(ids, "p1", 2, 3), O(ids, "p1", 3, 3), O(ids, "p2", 2, 3), O(ids, "p2", 3, 3), O(ids, "p4", 2, 1), O(ids, "p4", 3, 2), O(ids, "p4", 4, 4)];
  const twoWay = (await load({ scores: twoWayScores })).read();

  // Six-way ties (the cap): three invented extra members, everyone scores
  // 2 on show 2 only, so every row ties six ways → five names in name
  // order plus "and 1 more". Invented nicknames, not real ones.
  const extras = [["p5", "Marigold"], ["p6", "Quartz"], ["p7", "Tumbleweed"]];
  const sixScores = ids => ["p1", "p2", "p4", "p5", "p6", "p7"].map(pid => O(ids, pid, 2, 2));
  const sixWay = (await load({
    scores: sixScores, roster: ["p1", "p2", "p4", "p5", "p6", "p7"],
    mutate: (t, ids) => { for (const [id, name] of extras){
      t.players_public.push({ id, name, created_at: "2026-01-05" });
      t.league_members.push({ league_id: ids.LEAGUE_ID, player_id: id, is_league_admin: false, official_opt_in: true });
    } },
  })).read();
  return { dflt, zerosAsc, zerosDesc, presetWins, presetBogus, empty, allTime, allTimeZerosPreset, allTimeZerosTap, playerAsc, playerDesc, twoWay, sixWay };
}

// Members panel rows (admin-panel.md → "Members panel cleanup", LOCKED
// 2026-10-26, ROWS A). Boots the league admin (p1) and reads #playerlist
// structurally: per row the mark, the name (text and title), the small
// markers on line one, the pill, the line-two buttons and their onclick
// wiring, and whether the word "Official" appears anywhere in the row.
// p2 is the fixture's one official_opt_in:false member (since Stage A) —
// the only row that may carry the pill. A 27-character invented name on
// p4 proves the name class is the full-width .mname, not the truncating
// .nm. jsdom cannot measure width; scenario.test.mjs checks the
// stylesheet statically alongside.
export async function runMembersPanelScenario({ html, scripts, mode }){
  const LONG = "Eggbertinawellingtonthe3rdX";
  const { tables } = makeFixtures();
  tables.players_public.find(p => p.id === "p4").name = LONG;
  const calls = [];
  const dom = new JSDOM(stripScripts(html), { url: "http://localhost/", runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window;
  installGlobals(w, mode, tables, RPC_HANDLERS, calls, {});
  w.localStorage.setItem("ft_session", JSON.stringify({ id: "p1", name: "Wooklord", pin: "1234", is_global_admin: false }));
  for (const src of scripts) w.eval(src);
  await tick(); await tick();
  clickTab(w, "admin");
  await tick(); await tick(); await tick(); await tick();
  const list = w.document.getElementById("playerlist");
  const rows = list ? [...list.querySelectorAll(".member-row")] : [];
  return {
    LONG,
    rowCount: rows.length,
    legacyRows: list ? list.querySelectorAll(".pickres:not(.member-row)").length : -1,
    rows: rows.map(r => ({
      mark: r.querySelector(".member-mark")?.textContent ?? null,
      name: r.querySelector(".mname")?.textContent ?? null,
      title: r.querySelector(".mname")?.getAttribute("title") ?? null,
      usesNm: !!r.querySelector(".nm"),
      markers: [...r.querySelectorAll(".member-l1 small")].map(s => s.textContent),
      pill: r.querySelector(".pill")?.textContent ?? null,
      pillClass: r.querySelector(".pill")?.className ?? null,
      official: /Official/.test(r.textContent),
      lineTwo: !!r.querySelector(".member-l2"),
      buttons: [...r.querySelectorAll(".member-l2 button")].map(b => b.textContent.trim()),
      onclicks: [...r.querySelectorAll(".member-l2 button")].map(b => b.getAttribute("onclick") ?? ""),
    })),
  };
}

// Empty ranked ladder (admin-panel.md → "EMPTY RANKED LADDER", LOCKED
// 2026-10-26; incident docs/history/2026-10-26-empty-ranked-ladder.md).
// Three loads, all on the Casual bracket (slots mode in the base fixture):
//   flip, no ranked key   — the league-creation shape;
//   flip, ranked:{ladder:[]} — the shape a slots-mode Save rules leaves;
//   notice               — the incident state itself (ranked, ladder []).
// A flip sets the mode select, calls onModeChange (the region previews the
// default ladder), calls saveMasterSwitch and presses NOTHING else, then
// opens a show. Both scenarios are the empty-set case the ranked scenario
// skipped (its fixture stores a five-value ladder). The handlers are
// INVOKED; the fake admin_update_config carries the Stage V gate, and a
// direct call proves the gate rather than assuming it.
export async function runEmptyLadderScenario({ html, scripts, mode }){
  async function boot(mutate){
    const { tables, ids } = makeFixtures();
    mutate(tables, ids);
    const calls = [];
    const dom = new JSDOM(stripScripts(html), { url: "http://localhost/", runScripts: "outside-only", pretendToBeVisual: true });
    const w = dom.window;
    installGlobals(w, mode, tables, RPC_HANDLERS, calls, {});
    w.localStorage.setItem("ft_session", JSON.stringify({ id: "p1", name: "Wooklord", pin: "1234", is_global_admin: false }));
    w.localStorage.setItem("ft_bracket_id", String(ids.CASUAL_ID));
    for (const src of scripts) w.eval(src);
    await tick(); await tick();
    return { w, tables, ids, calls };
  }
  const openShow1 = async w => {
    clickTab(w, "shows");
    await tick(); await tick();
    w.openShow(1);
    await tick(); await tick(); await tick();
    return {
      rows: w.document.querySelectorAll(".slotline").length,
      saveBtn: !!w.document.getElementById("save"),
      revert: !!w.document.getElementById("revert-link"),
      sheetNotice: w.document.getElementById("ladder-missing")?.textContent ?? null,
      rulesNotice: w.document.querySelector(".rules-sheet .sheetnote")?.textContent ?? null,
      ruleTerms: [...w.document.querySelectorAll(".rd-term")].map(e => e.textContent),
      sheetHasAppClass: !!w.document.querySelector(".sheet .noticebox, .sheet .pill, .sheet .muted"),
    };
  };
  async function flip(mutate){
    const b = await boot(mutate);
    const { w, calls } = b;
    clickTab(w, "admin");
    await tick(); await tick(); await tick(); await tick();
    w.document.getElementById("c-mode").value = "ranked_choice";
    w.onModeChange();
    const previewed = [...w.document.querySelectorAll("#rankladder .rank-pts")].map(i => Number(i.value));
    const flagShown = !!w.document.getElementById("ladder-unsaved");
    await w.saveMasterSwitch();
    await tick(); await tick();
    const payloads = calls.filter(c => c.type === "rpc" && c.fn === "admin_update_config").map(c => c.args.p_data);
    const stored = b.tables.brackets.find(x => x.id === b.ids.CASUAL_ID).config;
    return {
      previewed, flagShown, payloads,
      msErr: w.document.getElementById("ms-err")?.textContent ?? "",
      flagAfterSave: !!w.document.getElementById("ladder-unsaved"),
      storedMode: stored.mode, storedLadder: stored.ranked?.ladder ?? null,
      show: await openShow1(w),
    };
  }
  const noKey = await flip(() => {});
  const emptyKey = await flip(t => { const c = t.brackets.find(x => x.kind === "casual"); c.config = { ...c.config, ranked: { ladder: [] } }; });

  const n = await boot(t => { const c = t.brackets.find(x => x.kind === "casual"); c.config = { ...c.config, mode: "ranked_choice", ranked: { ladder: [] } }; });
  const notice = await openShow1(n.w);
  clickTab(n.w, "admin");
  await tick(); await tick(); await tick(); await tick();
  const adminFlag = {
    present: !!n.w.document.getElementById("ladder-unsaved"),
    text: n.w.document.getElementById("ladder-unsaved")?.textContent ?? "",
    editorRows: n.w.document.querySelectorAll("#rankladder .rank-pts").length,
  };
  let gateError = null, gateOk = null;
  try{ await RPC_HANDLERS.admin_update_config({ p_bracket_id: n.ids.CASUAL_ID, p_data: { mode: "ranked_choice", ranked: { ladder: [] } } }, n.tables); }
  catch(e){ gateError = e.message; }
  try{ gateOk = await RPC_HANDLERS.admin_update_config({ p_bracket_id: n.ids.CASUAL_ID, p_data: { mode: "ranked_choice", ranked: { ladder: [3] } } }, n.tables); }
  catch(e){ gateOk = { error: e.message }; }
  return { noKey, emptyKey, notice, adminFlag, gateError, gateOk };
}
