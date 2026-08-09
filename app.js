(() => {
  // src/core/state.js
  var state = {
    session: JSON.parse(localStorage.getItem("ft_session") || "null"),
    tab: "shows",
    currentShow: null,
    songList: [],
    cfg: null,
    timers: [],
    boardSeason: null,
    // null = auto-pick current season
    leagues: [],
    // raw my_leagues() rows for this session
    currentLeagueId: null,
    currentBracketId: null
  };

  // src/core/dom.js
  var isDesktop = () => window.matchMedia("(min-width:901px)").matches;
  var colMap = { shows: "#main-shows", board: "#main-board", admin: "#main-admin" };
  var $ = (sel, el = document) => {
    if (sel === "#main" && isDesktop() && el === document) return document.querySelector(colMap[state.tab] || "#main-shows");
    return el.querySelector(sel);
  };
  var esc = (s) => String(s != null ? s : "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  var footerHtml = () => `<footer class="colophon-foot">K McKinley</footer>`;

  // src/core/config.js
  var SUPABASE_URL = "https://zdfhglvjxquvkjyvophz.supabase.co";
  var SUPABASE_ANON = "sb_publishable_qN1goR6-Ss3cErnJJIJdKw_xr5nrFuo";
  var APP_NAME = "Fantasy Eggy";
  var THEME_COLOR_LIGHT = "#F4ECD9";
  var THEME_COLOR_DARK = "#171233";
  var CARTON_SITE_BASE = "https://thecarton.net/setlists";

  // src/core/theme.js
  var sysLight = matchMedia("(prefers-color-scheme: light)");
  var themeMode = localStorage.getItem("ft_theme2") || "auto";
  function applyTheme() {
    const eff = themeMode === "auto" ? sysLight.matches ? "light" : "dark" : themeMode;
    document.documentElement.dataset.theme = eff;
    const b = $("#themeBtn");
    if (b) b.textContent = themeMode === "auto" ? "\u{1F317}" : themeMode === "light" ? "\u2600\uFE0F" : "\u{1F319}";
    if (b) b.title = "theme: " + themeMode + (themeMode === "auto" ? " (follows your phone)" : "");
    const m = document.querySelector('meta[name="theme-color"]');
    if (m) m.content = eff === "light" ? THEME_COLOR_LIGHT : THEME_COLOR_DARK;
  }
  function toggleTheme() {
    themeMode = { auto: "light", light: "dark", dark: "auto" }[themeMode] || "auto";
    localStorage.setItem("ft_theme2", themeMode);
    applyTheme();
  }
  var onSysTheme = () => {
    if (themeMode === "auto") applyTheme();
  };
  if (sysLight.addEventListener) sysLight.addEventListener("change", onSysTheme);
  else sysLight.addListener(onSysTheme);
  applyTheme();

  // src/core/supabaseClient.js
  var db = supabase.createClient(SUPABASE_URL, SUPABASE_ANON);
  var FN_URL = SUPABASE_URL + "/functions/v1/carton-sync";
  async function rpc(fn, args) {
    const { data, error } = await db.rpc(fn, args);
    if (error) throw new Error(error.message.replace(/^.*?: /, ""));
    return data;
  }
  async function edgeFn(action, extra = {}) {
    const r = await fetch(FN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + SUPABASE_ANON, "apikey": SUPABASE_ANON },
      body: JSON.stringify({ action, ...extra })
    });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || "edge function failed");
    return j;
  }

  // src/features/auth.js
  function renderAuth() {
    $("#main").innerHTML = `
    <div class="panel" style="margin-top:38px">
      <h2 class="display">Who's picking?</h2>
      <p class="muted">Name + PIN. That's the whole account.</p>
      <div class="field"><label>Name</label><input id="a-name" autocomplete="username" placeholder="Wooklord"></div>
      <div class="field"><label>PIN (4\u20138 digits)</label><input id="a-pin" inputmode="numeric" autocomplete="current-password" type="password" placeholder="\u2022\u2022\u2022\u2022"></div>
      <div class="row">
        <button class="btn" onclick="doLogin()">Log in</button>
        <button class="btn ghost" onclick="doRegister()">New player</button>
      </div>
      <div class="err" id="a-err"></div>
    </div>
    ${footerHtml()}`;
  }
  async function doLogin() {
    authFlow("login");
  }
  async function doRegister() {
    authFlow("register_player");
  }
  async function authFlow(fn) {
    $("#a-err").textContent = "";
    try {
      const d = await rpc(fn, { p_name: $("#a-name").value, p_pin: $("#a-pin").value });
      state.session = { ...d, pin: $("#a-pin").value };
      localStorage.setItem("ft_session", JSON.stringify(state.session));
      location.reload();
    } catch (e) {
      $("#a-err").textContent = e.message;
    }
  }

  // src/core/toast.js
  var seenToasts = /* @__PURE__ */ new Set();
  function toast(msg, cls = "", key = null) {
    if (key) {
      if (seenToasts.has(key)) return;
      seenToasts.add(key);
    }
    const box = $("#toasts");
    while (box.children.length >= 4) box.firstChild.remove();
    const t = document.createElement("div");
    t.className = "toast " + cls;
    t.innerHTML = msg;
    t.onclick = () => t.remove();
    box.appendChild(t);
    setTimeout(() => t.remove(), 6e3);
  }

  // src/core/format.js
  function fmtDate(d) {
    return (/* @__PURE__ */ new Date(d + "T12:00:00")).toLocaleDateString(void 0, { weekday: "short", month: "short", day: "numeric" });
  }
  function fmtDateParts(d) {
    const dt = /* @__PURE__ */ new Date(d + "T12:00:00");
    return {
      wk: dt.toLocaleDateString(void 0, { weekday: "short" }).toUpperCase(),
      md: dt.toLocaleDateString(void 0, { month: "short", day: "numeric" })
    };
  }
  function fmtCutoff(ts) {
    if (!ts) return "TBD";
    return new Date(ts).toLocaleString(void 0, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" });
  }
  function countdown(ts) {
    const ms = new Date(ts) - Date.now();
    if (ms <= 0) return null;
    const h = Math.floor(ms / 36e5), m = Math.floor(ms % 36e5 / 6e4), s = Math.floor(ms % 6e4 / 1e3);
    if (h > 72) {
      const days = Math.floor(h / 24), remH = h % 24;
      return `${days}d ${remH}h ${m}m`;
    }
    return h > 0 ? `${h}h ${m}m` : `${m}m ${String(s).padStart(2, "0")}s`;
  }
  function clearTimers() {
    state.timers.forEach(clearInterval);
    state.timers = [];
  }
  function clearTimersFor(which) {
    if (isDesktop() && which !== "shows") return;
    clearTimers();
  }
  function showState(s) {
    if (s.status === "final") return "final";
    const ov = state.cfg && state.cfg.voting_override || "auto";
    if (ov === "locked") return "locked";
    if (ov === "open" && s.showdate >= (/* @__PURE__ */ new Date()).toLocaleDateString("sv")) return "open";
    if (!s.cutoff_at) return "no cutoff";
    if (new Date(s.cutoff_at) > /* @__PURE__ */ new Date()) return "open";
    const twoDaysAgo = new Date(Date.now() - 2 * 864e5).toLocaleDateString("sv");
    if (s.showdate < twoDaysAgo) return "played";
    return s.status === "live" ? "live" : "locked";
  }

  // src/core/switcher.js
  var currentBracket = () => state.leagues.find((l) => l.bracket_id === state.currentBracketId);
  var isCurrentLeagueAdmin = () => {
    if (!state.session) return false;
    if (state.session.is_global_admin) return true;
    const row = currentBracket();
    return !!(row && row.is_league_admin);
  };
  var bracketsForLeague = (leagueId) => state.leagues.filter((l) => l.league_id === leagueId);
  async function loadConfig() {
    const { data, error } = await db.from("brackets").select("config").eq("id", state.currentBracketId).single();
    if (error) throw new Error("Couldn't load bracket config: " + error.message);
    state.cfg = data.config;
  }
  async function defaultBracketFor(leagueId) {
    const rows = bracketsForLeague(leagueId);
    const casual = rows.find((l) => l.bracket_kind === "casual") || rows[0];
    const official = rows.find((l) => l.bracket_kind === "official");
    if (!official) return casual;
    try {
      const seasons = await rpc("get_bracket_seasons", { p_bracket_id: official.bracket_id });
      const today = (/* @__PURE__ */ new Date()).toLocaleDateString("sv");
      const soon = new Date(Date.now() + 14 * 864e5).toLocaleDateString("sv");
      const relevant = (seasons || []).some((se) => se.start_date <= soon && se.end_date >= today);
      return relevant ? official : casual;
    } catch (e) {
      return casual;
    }
  }
  async function resolveLeagues() {
    state.leagues = await rpc("my_leagues", { p_name: state.session.name, p_pin: state.session.pin });
    if (!state.leagues.length) return false;
    const saved = Number(localStorage.getItem("ft_bracket_id"));
    const found = state.leagues.find((l) => l.bracket_id === saved);
    const pick = found || await defaultBracketFor(state.leagues[0].league_id);
    state.currentBracketId = pick.bracket_id;
    state.currentLeagueId = pick.league_id;
    localStorage.setItem("ft_bracket_id", String(state.currentBracketId));
    return true;
  }
  function renderHeaderChrome() {
    const who = document.getElementById("whoami");
    if (who) {
      who.innerHTML = state.session ? `<b>${esc(state.session.name)}</b>${currentBracket() ? `<div class="who-league">${esc(currentBracket().league_name)}</div>` : ""}` : "";
    }
    const lbl = document.getElementById("bracketLabel");
    if (lbl) lbl.textContent = currentBracket() ? currentBracket().bracket_name : "";
    const admintab = document.getElementById("admintab");
    const title = document.getElementById("col-admin-title");
    const label = isCurrentLeagueAdmin() ? "Admin" : "Settings";
    if (admintab) admintab.textContent = label;
    if (title) title.textContent = label;
  }
  function renderBracketToggle() {
    const el = document.getElementById("bracketToggle");
    if (!el) return;
    el.innerHTML = bracketsForLeague(state.currentLeagueId).map((r) => `<button class="linkbtn switcher-btn${r.bracket_id === state.currentBracketId ? " on" : ""}"
    onclick="switchToBracket(${r.bracket_id})">${esc(r.bracket_name)}</button>`).join("");
  }
  function renderLeagueSelector() {
    const el = document.getElementById("leagueSelect");
    if (!el) return;
    const leagueIds = [...new Set(state.leagues.map((l) => l.league_id))];
    if (leagueIds.length <= 1) {
      el.innerHTML = "";
      return;
    }
    el.innerHTML = `<div class="field"><label>League</label>
    <select onchange="switchToLeague(Number(this.value))">
      ${leagueIds.map((lid) => {
      const row = state.leagues.find((l) => l.league_id === lid);
      return `<option value="${lid}" ${lid === state.currentLeagueId ? "selected" : ""}>${esc(row.league_name)}</option>`;
    }).join("")}
    </select></div>`;
  }
  async function switchToBracket(bracketId) {
    const row = state.leagues.find((l) => l.bracket_id === bracketId);
    if (!row || bracketId === state.currentBracketId) return;
    state.currentBracketId = bracketId;
    state.currentLeagueId = row.league_id;
    localStorage.setItem("ft_bracket_id", String(bracketId));
    state.tab = "shows";
    state.currentShow = null;
    await loadConfig();
    subscribeRealtime();
    renderHeaderChrome();
    await renderAll();
  }
  async function switchToLeague(leagueId) {
    var _a;
    if (leagueId === state.currentLeagueId) return;
    const rows = bracketsForLeague(leagueId);
    const curKind = (_a = currentBracket()) == null ? void 0 : _a.bracket_kind;
    const pick = rows.find((r) => r.bracket_kind === curKind) || rows.find((r) => r.bracket_kind === "casual") || rows[0];
    if (pick) await switchToBracket(pick.bracket_id);
  }

  // src/core/leagueShows.js
  async function fetchShows(queryFn) {
    const [{ data: shows }, ls] = await Promise.all([
      queryFn(db.from("shows").select("*")),
      rpc("get_league_shows", { p_league_id: state.currentLeagueId })
    ]);
    const byId = Object.fromEntries((ls || []).map((l) => [l.show_id, l]));
    return (shows || []).map((s) => ({ ...s, ...byId[s.id] }));
  }
  async function fetchShow(id) {
    const [{ data: show }, ls] = await Promise.all([
      db.from("shows").select("*").eq("id", id).single(),
      rpc("get_league_shows", { p_league_id: state.currentLeagueId })
    ]);
    if (!show) return null;
    const row = (ls || []).find((l) => l.show_id === id);
    return { ...show, ...row };
  }

  // src/core/trophy.js
  var WIN_SVG = '<svg viewBox="0 0 100 100" style="width:__S__px;height:__S__px;vertical-align:-.32em"><ellipse cx="50" cy="83" rx="36" ry="9.5" fill="#000" opacity=".13"/><path d="M0,0 C3.2,-3.4 8.3,-3.4 10.6,0 C8.3,3.4 3.2,3.4 0,0 Z" fill="none" stroke="#F2EEDC" stroke-width="3.5999999999999996" stroke-linejoin="round" transform="translate(64.9,76.7) rotate(328) scale(1,0.5)" class="h"/><path d="M0,0 C3.2,-3.4 8.3,-3.4 10.6,0 C8.3,3.4 3.2,3.4 0,0 Z" fill="#5B9E45" stroke="#1A2415" stroke-width="1.2" stroke-linejoin="round" transform="translate(64.9,76.7) rotate(328) scale(1,0.5)"/><path d="M0,0 C3.1,-3.3 8.1,-3.3 10.4,0 C8.1,3.3 3.1,3.3 0,0 Z" fill="none" stroke="#F2EEDC" stroke-width="3.5999999999999996" stroke-linejoin="round" transform="translate(29.9,77.1) rotate(353) scale(1,0.5)" class="h"/><path d="M0,0 C3.1,-3.3 8.1,-3.3 10.4,0 C8.1,3.3 3.1,3.3 0,0 Z" fill="#447A36" stroke="#1A2415" stroke-width="1.2" stroke-linejoin="round" transform="translate(29.9,77.1) rotate(353) scale(1,0.5)"/><path d="M0,0 C3.4,-3.6 8.7,-3.6 11.2,0 C8.7,3.6 3.4,3.6 0,0 Z" fill="none" stroke="#F2EEDC" stroke-width="3.5999999999999996" stroke-linejoin="round" transform="translate(35.3,77.2) rotate(26) scale(1,0.5)" class="h"/><path d="M0,0 C3.4,-3.6 8.7,-3.6 11.2,0 C8.7,3.6 3.4,3.6 0,0 Z" fill="#5B9E45" stroke="#1A2415" stroke-width="1.2" stroke-linejoin="round" transform="translate(35.3,77.2) rotate(26) scale(1,0.5)"/><path d="M0,0 C3.0,-3.2 7.8,-3.2 9.9,0 C7.8,3.2 3.0,3.2 0,0 Z" fill="none" stroke="#F2EEDC" stroke-width="3.5999999999999996" stroke-linejoin="round" transform="translate(52.1,77.3) rotate(280) scale(1,0.5)" class="h"/><path d="M0,0 C3.0,-3.2 7.8,-3.2 9.9,0 C7.8,3.2 3.0,3.2 0,0 Z" fill="#6FB457" stroke="#1A2415" stroke-width="1.2" stroke-linejoin="round" transform="translate(52.1,77.3) rotate(280) scale(1,0.5)"/><path d="M0,0 C3.0,-3.3 7.9,-3.3 10.2,0 C7.9,3.3 3.0,3.3 0,0 Z" fill="none" stroke="#F2EEDC" stroke-width="3.5999999999999996" stroke-linejoin="round" transform="translate(61.7,78.2) rotate(31) scale(1,0.5)" class="h"/><path d="M0,0 C3.0,-3.3 7.9,-3.3 10.2,0 C7.9,3.3 3.0,3.3 0,0 Z" fill="#5B9E45" stroke="#1A2415" stroke-width="1.2" stroke-linejoin="round" transform="translate(61.7,78.2) rotate(31) scale(1,0.5)"/><path d="M0,0 C3.5,-3.7 9.1,-3.7 11.7,0 C9.1,3.7 3.5,3.7 0,0 Z" fill="none" stroke="#F2EEDC" stroke-width="3.5999999999999996" stroke-linejoin="round" transform="translate(70.0,79.7) rotate(347) scale(1,0.5)" class="h"/><path d="M0,0 C3.5,-3.7 9.1,-3.7 11.7,0 C9.1,3.7 3.5,3.7 0,0 Z" fill="#447A36" stroke="#1A2415" stroke-width="1.2" stroke-linejoin="round" transform="translate(70.0,79.7) rotate(347) scale(1,0.5)"/><path d="M0,0 C3.0,-3.2 7.7,-3.2 9.9,0 C7.7,3.2 3.0,3.2 0,0 Z" fill="none" stroke="#F2EEDC" stroke-width="3.5999999999999996" stroke-linejoin="round" transform="translate(79.3,80.2) rotate(42) scale(1,0.5)" class="h"/><path d="M0,0 C3.0,-3.2 7.7,-3.2 9.9,0 C7.7,3.2 3.0,3.2 0,0 Z" fill="#5B9E45" stroke="#1A2415" stroke-width="1.2" stroke-linejoin="round" transform="translate(79.3,80.2) rotate(42) scale(1,0.5)"/><path d="M0,0 C2.8,-2.9 7.2,-2.9 9.2,0 C7.2,2.9 2.8,2.9 0,0 Z" fill="none" stroke="#F2EEDC" stroke-width="3.5999999999999996" stroke-linejoin="round" transform="translate(47.7,80.6) rotate(36) scale(1,0.5)" class="h"/><path d="M0,0 C2.8,-2.9 7.2,-2.9 9.2,0 C7.2,2.9 2.8,2.9 0,0 Z" fill="#447A36" stroke="#1A2415" stroke-width="1.2" stroke-linejoin="round" transform="translate(47.7,80.6) rotate(36) scale(1,0.5)"/><path d="M0,0 C2.9,-3.1 7.5,-3.1 9.6,0 C7.5,3.1 2.9,3.1 0,0 Z" fill="none" stroke="#F2EEDC" stroke-width="3.5999999999999996" stroke-linejoin="round" transform="translate(82.2,81.2) rotate(287) scale(1,0.5)" class="h"/><path d="M0,0 C2.9,-3.1 7.5,-3.1 9.6,0 C7.5,3.1 2.9,3.1 0,0 Z" fill="#5B9E45" stroke="#1A2415" stroke-width="1.2" stroke-linejoin="round" transform="translate(82.2,81.2) rotate(287) scale(1,0.5)"/><path d="M0,0 C3.2,-3.4 8.2,-3.4 10.6,0 C8.2,3.4 3.2,3.4 0,0 Z" fill="none" stroke="#F2EEDC" stroke-width="3.5999999999999996" stroke-linejoin="round" transform="translate(23.8,81.3) rotate(201) scale(1,0.5)" class="h"/><path d="M0,0 C3.2,-3.4 8.2,-3.4 10.6,0 C8.2,3.4 3.2,3.4 0,0 Z" fill="#6FB457" stroke="#1A2415" stroke-width="1.2" stroke-linejoin="round" transform="translate(23.8,81.3) rotate(201) scale(1,0.5)"/><path d="M0,0 C3.5,-3.7 9.0,-3.7 11.6,0 C9.0,3.7 3.5,3.7 0,0 Z" fill="none" stroke="#F2EEDC" stroke-width="3.5999999999999996" stroke-linejoin="round" transform="translate(42.1,81.7) rotate(69) scale(1,0.5)" class="h"/><path d="M0,0 C3.5,-3.7 9.0,-3.7 11.6,0 C9.0,3.7 3.5,3.7 0,0 Z" fill="#5B9E45" stroke="#1A2415" stroke-width="1.2" stroke-linejoin="round" transform="translate(42.1,81.7) rotate(69) scale(1,0.5)"/><path d="M0,0 C3.4,-3.6 8.8,-3.6 11.3,0 C8.8,3.6 3.4,3.6 0,0 Z" fill="none" stroke="#F2EEDC" stroke-width="3.5999999999999996" stroke-linejoin="round" transform="translate(24.7,81.7) rotate(47) scale(1,0.5)" class="h"/><path d="M0,0 C3.4,-3.6 8.8,-3.6 11.3,0 C8.8,3.6 3.4,3.6 0,0 Z" fill="#447A36" stroke="#1A2415" stroke-width="1.2" stroke-linejoin="round" transform="translate(24.7,81.7) rotate(47) scale(1,0.5)"/><path d="M0,0 C3.1,-3.4 8.2,-3.4 10.5,0 C8.2,3.4 3.1,3.4 0,0 Z" fill="none" stroke="#F2EEDC" stroke-width="3.5999999999999996" stroke-linejoin="round" transform="translate(82.9,81.9) rotate(42) scale(1,0.5)" class="h"/><path d="M0,0 C3.1,-3.4 8.2,-3.4 10.5,0 C8.2,3.4 3.1,3.4 0,0 Z" fill="#5B9E45" stroke="#1A2415" stroke-width="1.2" stroke-linejoin="round" transform="translate(82.9,81.9) rotate(42) scale(1,0.5)"/><path d="M0,0 C3.0,-3.2 7.8,-3.2 9.9,0 C7.8,3.2 3.0,3.2 0,0 Z" fill="none" stroke="#F2EEDC" stroke-width="3.5999999999999996" stroke-linejoin="round" transform="translate(23.1,82.0) rotate(77) scale(1,0.5)" class="h"/><path d="M0,0 C3.0,-3.2 7.8,-3.2 9.9,0 C7.8,3.2 3.0,3.2 0,0 Z" fill="#447A36" stroke="#1A2415" stroke-width="1.2" stroke-linejoin="round" transform="translate(23.1,82.0) rotate(77) scale(1,0.5)"/><path d="M0,0 C3.5,-3.8 9.2,-3.8 11.8,0 C9.2,3.8 3.5,3.8 0,0 Z" fill="none" stroke="#F2EEDC" stroke-width="3.5999999999999996" stroke-linejoin="round" transform="translate(65.1,82.0) rotate(350) scale(1,0.5)" class="h"/><path d="M0,0 C3.5,-3.8 9.2,-3.8 11.8,0 C9.2,3.8 3.5,3.8 0,0 Z" fill="#5B9E45" stroke="#1A2415" stroke-width="1.2" stroke-linejoin="round" transform="translate(65.1,82.0) rotate(350) scale(1,0.5)"/><path d="M0,0 C3.6,-3.9 9.4,-3.9 12.1,0 C9.4,3.9 3.6,3.9 0,0 Z" fill="none" stroke="#F2EEDC" stroke-width="3.5999999999999996" stroke-linejoin="round" transform="translate(52.2,82.8) rotate(109) scale(1,0.5)" class="h"/><path d="M0,0 C3.6,-3.9 9.4,-3.9 12.1,0 C9.4,3.9 3.6,3.9 0,0 Z" fill="#6FB457" stroke="#1A2415" stroke-width="1.2" stroke-linejoin="round" transform="translate(52.2,82.8) rotate(109) scale(1,0.5)"/><path d="M0,0 C3.1,-3.3 8.1,-3.3 10.4,0 C8.1,3.3 3.1,3.3 0,0 Z" fill="none" stroke="#F2EEDC" stroke-width="3.5999999999999996" stroke-linejoin="round" transform="translate(72.1,83.0) rotate(76) scale(1,0.5)" class="h"/><path d="M0,0 C3.1,-3.3 8.1,-3.3 10.4,0 C8.1,3.3 3.1,3.3 0,0 Z" fill="#5B9E45" stroke="#1A2415" stroke-width="1.2" stroke-linejoin="round" transform="translate(72.1,83.0) rotate(76) scale(1,0.5)"/><path d="M0,0 C3.4,-3.6 8.8,-3.6 11.2,0 C8.8,3.6 3.4,3.6 0,0 Z" fill="none" stroke="#F2EEDC" stroke-width="3.5999999999999996" stroke-linejoin="round" transform="translate(33.2,83.0) rotate(308) scale(1,0.5)" class="h"/><path d="M0,0 C3.4,-3.6 8.8,-3.6 11.2,0 C8.8,3.6 3.4,3.6 0,0 Z" fill="#447A36" stroke="#1A2415" stroke-width="1.2" stroke-linejoin="round" transform="translate(33.2,83.0) rotate(308) scale(1,0.5)"/><path d="M0,0 C3.7,-4.0 9.7,-4.0 12.5,0 C9.7,4.0 3.7,4.0 0,0 Z" fill="none" stroke="#F2EEDC" stroke-width="3.5999999999999996" stroke-linejoin="round" transform="translate(26.4,83.7) rotate(36) scale(1,0.5)" class="h"/><path d="M0,0 C3.7,-4.0 9.7,-4.0 12.5,0 C9.7,4.0 3.7,4.0 0,0 Z" fill="#5B9E45" stroke="#1A2415" stroke-width="1.2" stroke-linejoin="round" transform="translate(26.4,83.7) rotate(36) scale(1,0.5)"/><path d="M0,0 C3.0,-3.2 7.7,-3.2 9.9,0 C7.7,3.2 3.0,3.2 0,0 Z" fill="none" stroke="#F2EEDC" stroke-width="3.5999999999999996" stroke-linejoin="round" transform="translate(47.9,83.9) rotate(77) scale(1,0.5)" class="h"/><path d="M0,0 C3.0,-3.2 7.7,-3.2 9.9,0 C7.7,3.2 3.0,3.2 0,0 Z" fill="#447A36" stroke="#1A2415" stroke-width="1.2" stroke-linejoin="round" transform="translate(47.9,83.9) rotate(77) scale(1,0.5)"/><path d="M0,0 C3.0,-3.2 7.9,-3.2 10.2,0 C7.9,3.2 3.0,3.2 0,0 Z" fill="none" stroke="#F2EEDC" stroke-width="3.5999999999999996" stroke-linejoin="round" transform="translate(65.1,84.3) rotate(278) scale(1,0.5)" class="h"/><path d="M0,0 C3.0,-3.2 7.9,-3.2 10.2,0 C7.9,3.2 3.0,3.2 0,0 Z" fill="#5B9E45" stroke="#1A2415" stroke-width="1.2" stroke-linejoin="round" transform="translate(65.1,84.3) rotate(278) scale(1,0.5)"/><path d="M0,0 C2.8,-3.0 7.2,-3.0 9.3,0 C7.2,3.0 2.8,3.0 0,0 Z" fill="none" stroke="#F2EEDC" stroke-width="3.5999999999999996" stroke-linejoin="round" transform="translate(21.8,84.5) rotate(107) scale(1,0.5)" class="h"/><path d="M0,0 C2.8,-3.0 7.2,-3.0 9.3,0 C7.2,3.0 2.8,3.0 0,0 Z" fill="#6FB457" stroke="#1A2415" stroke-width="1.2" stroke-linejoin="round" transform="translate(21.8,84.5) rotate(107) scale(1,0.5)"/><path d="M0,0 C3.3,-3.5 8.6,-3.5 11.0,0 C8.6,3.5 3.3,3.5 0,0 Z" fill="none" stroke="#F2EEDC" stroke-width="3.5999999999999996" stroke-linejoin="round" transform="translate(43.7,85.3) rotate(32) scale(1,0.5)" class="h"/><path d="M0,0 C3.3,-3.5 8.6,-3.5 11.0,0 C8.6,3.5 3.3,3.5 0,0 Z" fill="#5B9E45" stroke="#1A2415" stroke-width="1.2" stroke-linejoin="round" transform="translate(43.7,85.3) rotate(32) scale(1,0.5)"/><path d="M0,0 C3.3,-3.6 8.7,-3.6 11.1,0 C8.7,3.6 3.3,3.6 0,0 Z" fill="none" stroke="#F2EEDC" stroke-width="3.5999999999999996" stroke-linejoin="round" transform="translate(56.0,85.4) rotate(87) scale(1,0.5)" class="h"/><path d="M0,0 C3.3,-3.6 8.7,-3.6 11.1,0 C8.7,3.6 3.3,3.6 0,0 Z" fill="#447A36" stroke="#1A2415" stroke-width="1.2" stroke-linejoin="round" transform="translate(56.0,85.4) rotate(87) scale(1,0.5)"/><path d="M0,0 C3.2,-3.4 8.3,-3.4 10.6,0 C8.3,3.4 3.2,3.4 0,0 Z" fill="none" stroke="#F2EEDC" stroke-width="3.5999999999999996" stroke-linejoin="round" transform="translate(75.0,85.6) rotate(134) scale(1,0.5)" class="h"/><path d="M0,0 C3.2,-3.4 8.3,-3.4 10.6,0 C8.3,3.4 3.2,3.4 0,0 Z" fill="#5B9E45" stroke="#1A2415" stroke-width="1.2" stroke-linejoin="round" transform="translate(75.0,85.6) rotate(134) scale(1,0.5)"/><path d="M0,0 C3.2,-3.4 8.3,-3.4 10.7,0 C8.3,3.4 3.2,3.4 0,0 Z" fill="none" stroke="#F2EEDC" stroke-width="3.5999999999999996" stroke-linejoin="round" transform="translate(59.4,86.9) rotate(345) scale(1,0.5)" class="h"/><path d="M0,0 C3.2,-3.4 8.3,-3.4 10.7,0 C8.3,3.4 3.2,3.4 0,0 Z" fill="#447A36" stroke="#1A2415" stroke-width="1.2" stroke-linejoin="round" transform="translate(59.4,86.9) rotate(345) scale(1,0.5)"/><ellipse cx="50" cy="80" rx="14" ry="3.4" fill="#000" opacity=".22"/><path d="M0,0 C3.2,-3.4 8.3,-3.4 10.6,0 C8.3,3.4 3.2,3.4 0,0 Z" fill="none" stroke="#F2EEDC" stroke-width="3.5999999999999996" stroke-linejoin="round" transform="translate(41.0,80.5) rotate(24) scale(1,0.5)" class="h"/><path d="M0,0 C3.2,-3.4 8.3,-3.4 10.6,0 C8.3,3.4 3.2,3.4 0,0 Z" fill="#6FB457" stroke="#1A2415" stroke-width="1.2" stroke-linejoin="round" transform="translate(41.0,80.5) rotate(24) scale(1,0.5)"/><path d="M0,0 C3.2,-3.4 8.3,-3.4 10.6,0 C8.3,3.4 3.2,3.4 0,0 Z" fill="none" stroke="#F2EEDC" stroke-width="3.5999999999999996" stroke-linejoin="round" transform="translate(50.0,82.5) rotate(160) scale(1,0.5)" class="h"/><path d="M0,0 C3.2,-3.4 8.3,-3.4 10.6,0 C8.3,3.4 3.2,3.4 0,0 Z" fill="#5B9E45" stroke="#1A2415" stroke-width="1.2" stroke-linejoin="round" transform="translate(50.0,82.5) rotate(160) scale(1,0.5)"/><path d="M0,0 C2.7,-2.9 6.9,-2.9 8.9,0 C6.9,2.9 2.7,2.9 0,0 Z" fill="none" stroke="#F2EEDC" stroke-width="3.8" stroke-linejoin="round" transform="translate(52.6,58.8) rotate(-33) scale(1,1.0)" class="h"/><path d="M0,0 C2.7,-2.9 6.9,-2.9 8.9,0 C6.9,2.9 2.7,2.9 0,0 Z" fill="#5B9E45" stroke="#1A2415" stroke-width="1.4" stroke-linejoin="round" transform="translate(52.6,58.8) rotate(-33) scale(1,1.0)"/><path d="M0,0 C2.5,-2.7 6.5,-2.7 8.4,0 C6.5,2.7 2.5,2.7 0,0 Z" fill="none" stroke="#F2EEDC" stroke-width="3.8" stroke-linejoin="round" transform="translate(52.6,58.8) rotate(19) scale(1,1.0)" class="h"/><path d="M0,0 C2.5,-2.7 6.5,-2.7 8.4,0 C6.5,2.7 2.5,2.7 0,0 Z" fill="#5B9E45" stroke="#1A2415" stroke-width="1.4" stroke-linejoin="round" transform="translate(52.6,58.8) rotate(19) scale(1,1.0)"/><path d="M0,0 C2.5,-2.7 6.6,-2.7 8.5,0 C6.6,2.7 2.5,2.7 0,0 Z" fill="none" stroke="#F2EEDC" stroke-width="3.8" stroke-linejoin="round" transform="translate(59.5,56.7) rotate(-53) scale(1,1.0)" class="h"/><path d="M0,0 C2.5,-2.7 6.6,-2.7 8.5,0 C6.6,2.7 2.5,2.7 0,0 Z" fill="#5B9E45" stroke="#1A2415" stroke-width="1.4" stroke-linejoin="round" transform="translate(59.5,56.7) rotate(-53) scale(1,1.0)"/><path d="M0,0 C2.4,-2.5 6.2,-2.5 8.0,0 C6.2,2.5 2.4,2.5 0,0 Z" fill="none" stroke="#F2EEDC" stroke-width="3.8" stroke-linejoin="round" transform="translate(59.5,56.7) rotate(-1) scale(1,1.0)" class="h"/><path d="M0,0 C2.4,-2.5 6.2,-2.5 8.0,0 C6.2,2.5 2.4,2.5 0,0 Z" fill="#5B9E45" stroke="#1A2415" stroke-width="1.4" stroke-linejoin="round" transform="translate(59.5,56.7) rotate(-1) scale(1,1.0)"/><path d="M0,0 C2.4,-2.6 6.3,-2.6 8.0,0 C6.3,2.6 2.4,2.6 0,0 Z" fill="none" stroke="#F2EEDC" stroke-width="3.8" stroke-linejoin="round" transform="translate(65.4,52.3) rotate(-73) scale(1,1.0)" class="h"/><path d="M0,0 C2.4,-2.6 6.3,-2.6 8.0,0 C6.3,2.6 2.4,2.6 0,0 Z" fill="#5B9E45" stroke="#1A2415" stroke-width="1.4" stroke-linejoin="round" transform="translate(65.4,52.3) rotate(-73) scale(1,1.0)"/><path d="M0,0 C2.3,-2.4 5.9,-2.4 7.5,0 C5.9,2.4 2.3,2.4 0,0 Z" fill="none" stroke="#F2EEDC" stroke-width="3.8" stroke-linejoin="round" transform="translate(65.4,52.3) rotate(-21) scale(1,1.0)" class="h"/><path d="M0,0 C2.3,-2.4 5.9,-2.4 7.5,0 C5.9,2.4 2.3,2.4 0,0 Z" fill="#5B9E45" stroke="#1A2415" stroke-width="1.4" stroke-linejoin="round" transform="translate(65.4,52.3) rotate(-21) scale(1,1.0)"/><path d="M0,0 C2.3,-2.4 5.9,-2.4 7.6,0 C5.9,2.4 2.3,2.4 0,0 Z" fill="none" stroke="#F2EEDC" stroke-width="3.8" stroke-linejoin="round" transform="translate(69.3,46.2) rotate(-93) scale(1,1.0)" class="h"/><path d="M0,0 C2.3,-2.4 5.9,-2.4 7.6,0 C5.9,2.4 2.3,2.4 0,0 Z" fill="#5B9E45" stroke="#1A2415" stroke-width="1.4" stroke-linejoin="round" transform="translate(69.3,46.2) rotate(-93) scale(1,1.0)"/><path d="M0,0 C2.1,-2.3 5.6,-2.3 7.1,0 C5.6,2.3 2.1,2.3 0,0 Z" fill="none" stroke="#F2EEDC" stroke-width="3.8" stroke-linejoin="round" transform="translate(69.3,46.2) rotate(-41) scale(1,1.0)" class="h"/><path d="M0,0 C2.1,-2.3 5.6,-2.3 7.1,0 C5.6,2.3 2.1,2.3 0,0 Z" fill="#5B9E45" stroke="#1A2415" stroke-width="1.4" stroke-linejoin="round" transform="translate(69.3,46.2) rotate(-41) scale(1,1.0)"/><path d="M0,0 C2.1,-2.3 5.6,-2.3 7.1,0 C5.6,2.3 2.1,2.3 0,0 Z" fill="none" stroke="#F2EEDC" stroke-width="3.8" stroke-linejoin="round" transform="translate(71.0,39.1) rotate(-113) scale(1,1.0)" class="h"/><path d="M0,0 C2.1,-2.3 5.6,-2.3 7.1,0 C5.6,2.3 2.1,2.3 0,0 Z" fill="#5B9E45" stroke="#1A2415" stroke-width="1.4" stroke-linejoin="round" transform="translate(71.0,39.1) rotate(-113) scale(1,1.0)"/><path d="M0,0 C2.0,-2.1 5.2,-2.1 6.7,0 C5.2,2.1 2.0,2.1 0,0 Z" fill="none" stroke="#F2EEDC" stroke-width="3.8" stroke-linejoin="round" transform="translate(71.0,39.1) rotate(-61) scale(1,1.0)" class="h"/><path d="M0,0 C2.0,-2.1 5.2,-2.1 6.7,0 C5.2,2.1 2.0,2.1 0,0 Z" fill="#5B9E45" stroke="#1A2415" stroke-width="1.4" stroke-linejoin="round" transform="translate(71.0,39.1) rotate(-61) scale(1,1.0)"/><path d="M0,0 C2.0,-2.1 5.2,-2.1 6.7,0 C5.2,2.1 2.0,2.1 0,0 Z" fill="none" stroke="#F2EEDC" stroke-width="3.8" stroke-linejoin="round" transform="translate(70.1,31.9) rotate(-133) scale(1,1.0)" class="h"/><path d="M0,0 C2.0,-2.1 5.2,-2.1 6.7,0 C5.2,2.1 2.0,2.1 0,0 Z" fill="#5B9E45" stroke="#1A2415" stroke-width="1.4" stroke-linejoin="round" transform="translate(70.1,31.9) rotate(-133) scale(1,1.0)"/><path d="M0,0 C1.9,-2.0 4.9,-2.0 6.3,0 C4.9,2.0 1.9,2.0 0,0 Z" fill="none" stroke="#F2EEDC" stroke-width="3.8" stroke-linejoin="round" transform="translate(70.1,31.9) rotate(-81) scale(1,1.0)" class="h"/><path d="M0,0 C1.9,-2.0 4.9,-2.0 6.3,0 C4.9,2.0 1.9,2.0 0,0 Z" fill="#5B9E45" stroke="#1A2415" stroke-width="1.4" stroke-linejoin="round" transform="translate(70.1,31.9) rotate(-81) scale(1,1.0)"/><path d="M0,0 C1.9,-2.0 4.9,-2.0 6.2,0 C4.9,2.0 1.9,2.0 0,0 Z" fill="none" stroke="#F2EEDC" stroke-width="3.8" stroke-linejoin="round" transform="translate(66.8,25.4) rotate(-153) scale(1,1.0)" class="h"/><path d="M0,0 C1.9,-2.0 4.9,-2.0 6.2,0 C4.9,2.0 1.9,2.0 0,0 Z" fill="#5B9E45" stroke="#1A2415" stroke-width="1.4" stroke-linejoin="round" transform="translate(66.8,25.4) rotate(-153) scale(1,1.0)"/><path d="M0,0 C1.8,-1.9 4.6,-1.9 5.9,0 C4.6,1.9 1.8,1.9 0,0 Z" fill="none" stroke="#F2EEDC" stroke-width="3.8" stroke-linejoin="round" transform="translate(66.8,25.4) rotate(-101) scale(1,1.0)" class="h"/><path d="M0,0 C1.8,-1.9 4.6,-1.9 5.9,0 C4.6,1.9 1.8,1.9 0,0 Z" fill="#5B9E45" stroke="#1A2415" stroke-width="1.4" stroke-linejoin="round" transform="translate(66.8,25.4) rotate(-101) scale(1,1.0)"/><path d="M0,0 C1.7,-1.9 4.5,-1.9 5.8,0 C4.5,1.9 1.7,1.9 0,0 Z" fill="none" stroke="#F2EEDC" stroke-width="3.8" stroke-linejoin="round" transform="translate(61.4,20.4) rotate(-173) scale(1,1.0)" class="h"/><path d="M0,0 C1.7,-1.9 4.5,-1.9 5.8,0 C4.5,1.9 1.7,1.9 0,0 Z" fill="#5B9E45" stroke="#1A2415" stroke-width="1.4" stroke-linejoin="round" transform="translate(61.4,20.4) rotate(-173) scale(1,1.0)"/><path d="M0,0 C1.6,-1.7 4.2,-1.7 5.4,0 C4.2,1.7 1.6,1.7 0,0 Z" fill="none" stroke="#F2EEDC" stroke-width="3.8" stroke-linejoin="round" transform="translate(61.4,20.4) rotate(-121) scale(1,1.0)" class="h"/><path d="M0,0 C1.6,-1.7 4.2,-1.7 5.4,0 C4.2,1.7 1.6,1.7 0,0 Z" fill="#5B9E45" stroke="#1A2415" stroke-width="1.4" stroke-linejoin="round" transform="translate(61.4,20.4) rotate(-121) scale(1,1.0)"/><path d="M0,0 C2.7,-2.9 6.9,-2.9 8.9,0 C6.9,2.9 2.7,2.9 0,0 Z" fill="none" stroke="#F2EEDC" stroke-width="3.8" stroke-linejoin="round" transform="translate(47.4,58.8) rotate(213) scale(1,1.0)" class="h"/><path d="M0,0 C2.7,-2.9 6.9,-2.9 8.9,0 C6.9,2.9 2.7,2.9 0,0 Z" fill="#5B9E45" stroke="#1A2415" stroke-width="1.4" stroke-linejoin="round" transform="translate(47.4,58.8) rotate(213) scale(1,1.0)"/><path d="M0,0 C2.5,-2.7 6.5,-2.7 8.4,0 C6.5,2.7 2.5,2.7 0,0 Z" fill="none" stroke="#F2EEDC" stroke-width="3.8" stroke-linejoin="round" transform="translate(47.4,58.8) rotate(161) scale(1,1.0)" class="h"/><path d="M0,0 C2.5,-2.7 6.5,-2.7 8.4,0 C6.5,2.7 2.5,2.7 0,0 Z" fill="#5B9E45" stroke="#1A2415" stroke-width="1.4" stroke-linejoin="round" transform="translate(47.4,58.8) rotate(161) scale(1,1.0)"/><path d="M0,0 C2.5,-2.7 6.6,-2.7 8.5,0 C6.6,2.7 2.5,2.7 0,0 Z" fill="none" stroke="#F2EEDC" stroke-width="3.8" stroke-linejoin="round" transform="translate(40.5,56.7) rotate(233) scale(1,1.0)" class="h"/><path d="M0,0 C2.5,-2.7 6.6,-2.7 8.5,0 C6.6,2.7 2.5,2.7 0,0 Z" fill="#5B9E45" stroke="#1A2415" stroke-width="1.4" stroke-linejoin="round" transform="translate(40.5,56.7) rotate(233) scale(1,1.0)"/><path d="M0,0 C2.4,-2.5 6.2,-2.5 8.0,0 C6.2,2.5 2.4,2.5 0,0 Z" fill="none" stroke="#F2EEDC" stroke-width="3.8" stroke-linejoin="round" transform="translate(40.5,56.7) rotate(181) scale(1,1.0)" class="h"/><path d="M0,0 C2.4,-2.5 6.2,-2.5 8.0,0 C6.2,2.5 2.4,2.5 0,0 Z" fill="#5B9E45" stroke="#1A2415" stroke-width="1.4" stroke-linejoin="round" transform="translate(40.5,56.7) rotate(181) scale(1,1.0)"/><path d="M0,0 C2.4,-2.6 6.3,-2.6 8.0,0 C6.3,2.6 2.4,2.6 0,0 Z" fill="none" stroke="#F2EEDC" stroke-width="3.8" stroke-linejoin="round" transform="translate(34.6,52.3) rotate(253) scale(1,1.0)" class="h"/><path d="M0,0 C2.4,-2.6 6.3,-2.6 8.0,0 C6.3,2.6 2.4,2.6 0,0 Z" fill="#5B9E45" stroke="#1A2415" stroke-width="1.4" stroke-linejoin="round" transform="translate(34.6,52.3) rotate(253) scale(1,1.0)"/><path d="M0,0 C2.3,-2.4 5.9,-2.4 7.5,0 C5.9,2.4 2.3,2.4 0,0 Z" fill="none" stroke="#F2EEDC" stroke-width="3.8" stroke-linejoin="round" transform="translate(34.6,52.3) rotate(201) scale(1,1.0)" class="h"/><path d="M0,0 C2.3,-2.4 5.9,-2.4 7.5,0 C5.9,2.4 2.3,2.4 0,0 Z" fill="#5B9E45" stroke="#1A2415" stroke-width="1.4" stroke-linejoin="round" transform="translate(34.6,52.3) rotate(201) scale(1,1.0)"/><path d="M0,0 C2.3,-2.4 5.9,-2.4 7.6,0 C5.9,2.4 2.3,2.4 0,0 Z" fill="none" stroke="#F2EEDC" stroke-width="3.8" stroke-linejoin="round" transform="translate(30.7,46.2) rotate(273) scale(1,1.0)" class="h"/><path d="M0,0 C2.3,-2.4 5.9,-2.4 7.6,0 C5.9,2.4 2.3,2.4 0,0 Z" fill="#5B9E45" stroke="#1A2415" stroke-width="1.4" stroke-linejoin="round" transform="translate(30.7,46.2) rotate(273) scale(1,1.0)"/><path d="M0,0 C2.1,-2.3 5.6,-2.3 7.1,0 C5.6,2.3 2.1,2.3 0,0 Z" fill="none" stroke="#F2EEDC" stroke-width="3.8" stroke-linejoin="round" transform="translate(30.7,46.2) rotate(221) scale(1,1.0)" class="h"/><path d="M0,0 C2.1,-2.3 5.6,-2.3 7.1,0 C5.6,2.3 2.1,2.3 0,0 Z" fill="#5B9E45" stroke="#1A2415" stroke-width="1.4" stroke-linejoin="round" transform="translate(30.7,46.2) rotate(221) scale(1,1.0)"/><path d="M0,0 C2.1,-2.3 5.6,-2.3 7.1,0 C5.6,2.3 2.1,2.3 0,0 Z" fill="none" stroke="#F2EEDC" stroke-width="3.8" stroke-linejoin="round" transform="translate(29.0,39.1) rotate(293) scale(1,1.0)" class="h"/><path d="M0,0 C2.1,-2.3 5.6,-2.3 7.1,0 C5.6,2.3 2.1,2.3 0,0 Z" fill="#5B9E45" stroke="#1A2415" stroke-width="1.4" stroke-linejoin="round" transform="translate(29.0,39.1) rotate(293) scale(1,1.0)"/><path d="M0,0 C2.0,-2.1 5.2,-2.1 6.7,0 C5.2,2.1 2.0,2.1 0,0 Z" fill="none" stroke="#F2EEDC" stroke-width="3.8" stroke-linejoin="round" transform="translate(29.0,39.1) rotate(241) scale(1,1.0)" class="h"/><path d="M0,0 C2.0,-2.1 5.2,-2.1 6.7,0 C5.2,2.1 2.0,2.1 0,0 Z" fill="#5B9E45" stroke="#1A2415" stroke-width="1.4" stroke-linejoin="round" transform="translate(29.0,39.1) rotate(241) scale(1,1.0)"/><path d="M0,0 C2.0,-2.1 5.2,-2.1 6.7,0 C5.2,2.1 2.0,2.1 0,0 Z" fill="none" stroke="#F2EEDC" stroke-width="3.8" stroke-linejoin="round" transform="translate(29.9,31.9) rotate(313) scale(1,1.0)" class="h"/><path d="M0,0 C2.0,-2.1 5.2,-2.1 6.7,0 C5.2,2.1 2.0,2.1 0,0 Z" fill="#5B9E45" stroke="#1A2415" stroke-width="1.4" stroke-linejoin="round" transform="translate(29.9,31.9) rotate(313) scale(1,1.0)"/><path d="M0,0 C1.9,-2.0 4.9,-2.0 6.3,0 C4.9,2.0 1.9,2.0 0,0 Z" fill="none" stroke="#F2EEDC" stroke-width="3.8" stroke-linejoin="round" transform="translate(29.9,31.9) rotate(261) scale(1,1.0)" class="h"/><path d="M0,0 C1.9,-2.0 4.9,-2.0 6.3,0 C4.9,2.0 1.9,2.0 0,0 Z" fill="#5B9E45" stroke="#1A2415" stroke-width="1.4" stroke-linejoin="round" transform="translate(29.9,31.9) rotate(261) scale(1,1.0)"/><path d="M0,0 C1.9,-2.0 4.9,-2.0 6.2,0 C4.9,2.0 1.9,2.0 0,0 Z" fill="none" stroke="#F2EEDC" stroke-width="3.8" stroke-linejoin="round" transform="translate(33.2,25.4) rotate(333) scale(1,1.0)" class="h"/><path d="M0,0 C1.9,-2.0 4.9,-2.0 6.2,0 C4.9,2.0 1.9,2.0 0,0 Z" fill="#5B9E45" stroke="#1A2415" stroke-width="1.4" stroke-linejoin="round" transform="translate(33.2,25.4) rotate(333) scale(1,1.0)"/><path d="M0,0 C1.8,-1.9 4.6,-1.9 5.9,0 C4.6,1.9 1.8,1.9 0,0 Z" fill="none" stroke="#F2EEDC" stroke-width="3.8" stroke-linejoin="round" transform="translate(33.2,25.4) rotate(281) scale(1,1.0)" class="h"/><path d="M0,0 C1.8,-1.9 4.6,-1.9 5.9,0 C4.6,1.9 1.8,1.9 0,0 Z" fill="#5B9E45" stroke="#1A2415" stroke-width="1.4" stroke-linejoin="round" transform="translate(33.2,25.4) rotate(281) scale(1,1.0)"/><path d="M0,0 C1.7,-1.9 4.5,-1.9 5.8,0 C4.5,1.9 1.7,1.9 0,0 Z" fill="none" stroke="#F2EEDC" stroke-width="3.8" stroke-linejoin="round" transform="translate(38.6,20.4) rotate(353) scale(1,1.0)" class="h"/><path d="M0,0 C1.7,-1.9 4.5,-1.9 5.8,0 C4.5,1.9 1.7,1.9 0,0 Z" fill="#5B9E45" stroke="#1A2415" stroke-width="1.4" stroke-linejoin="round" transform="translate(38.6,20.4) rotate(353) scale(1,1.0)"/><path d="M0,0 C1.6,-1.7 4.2,-1.7 5.4,0 C4.2,1.7 1.6,1.7 0,0 Z" fill="none" stroke="#F2EEDC" stroke-width="3.8" stroke-linejoin="round" transform="translate(38.6,20.4) rotate(301) scale(1,1.0)" class="h"/><path d="M0,0 C1.6,-1.7 4.2,-1.7 5.4,0 C4.2,1.7 1.6,1.7 0,0 Z" fill="#5B9E45" stroke="#1A2415" stroke-width="1.4" stroke-linejoin="round" transform="translate(38.6,20.4) rotate(301) scale(1,1.0)"/><g fill="#F5B93B" stroke="none"><path d="M20,30 l1.6,3 3,1.6 -3,1.6 -1.6,3 -1.6,-3 -3,-1.6 3,-1.6 Z"/><path d="M79,44 l1.2,2.3 2.3,1.2 -2.3,1.2 -1.2,2.3 -1.2,-2.3 -2.3,-1.2 2.3,-1.2 Z"/><circle cx="72" cy="20" r="1.6"/></g></svg>';
  var winBadge = (px) => WIN_SVG.replace(/__S__/g, px);
  var TROPHY_SVG = '<svg viewBox="0 0 100 100" style="width:__S__px;height:__S__px"><ellipse cx="50" cy="83" rx="36" ry="9.5" fill="#000" opacity=".13"/><path d="M0,0 C3.2,-3.4 8.3,-3.4 10.6,0 C8.3,3.4 3.2,3.4 0,0 Z" fill="#5B9E45" stroke="#1A2415" stroke-width="1.2" stroke-linejoin="round" transform="translate(64.9,76.7) rotate(328) scale(1,0.5)"/><path d="M0,0 C3.1,-3.3 8.1,-3.3 10.4,0 C8.1,3.3 3.1,3.3 0,0 Z" fill="#447A36" stroke="#1A2415" stroke-width="1.2" stroke-linejoin="round" transform="translate(29.9,77.1) rotate(353) scale(1,0.5)"/><path d="M0,0 C3.4,-3.6 8.7,-3.6 11.2,0 C8.7,3.6 3.4,3.6 0,0 Z" fill="#5B9E45" stroke="#1A2415" stroke-width="1.2" stroke-linejoin="round" transform="translate(35.3,77.2) rotate(26) scale(1,0.5)"/><path d="M0,0 C3.0,-3.2 7.8,-3.2 9.9,0 C7.8,3.2 3.0,3.2 0,0 Z" fill="#6FB457" stroke="#1A2415" stroke-width="1.2" stroke-linejoin="round" transform="translate(52.1,77.3) rotate(280) scale(1,0.5)"/><path d="M0,0 C3.0,-3.3 7.9,-3.3 10.2,0 C7.9,3.3 3.0,3.3 0,0 Z" fill="#5B9E45" stroke="#1A2415" stroke-width="1.2" stroke-linejoin="round" transform="translate(61.7,78.2) rotate(31) scale(1,0.5)"/><path d="M0,0 C3.5,-3.7 9.1,-3.7 11.7,0 C9.1,3.7 3.5,3.7 0,0 Z" fill="#447A36" stroke="#1A2415" stroke-width="1.2" stroke-linejoin="round" transform="translate(70.0,79.7) rotate(347) scale(1,0.5)"/><path d="M0,0 C3.0,-3.2 7.7,-3.2 9.9,0 C7.7,3.2 3.0,3.2 0,0 Z" fill="#5B9E45" stroke="#1A2415" stroke-width="1.2" stroke-linejoin="round" transform="translate(79.3,80.2) rotate(42) scale(1,0.5)"/><path d="M0,0 C2.8,-2.9 7.2,-2.9 9.2,0 C7.2,2.9 2.8,2.9 0,0 Z" fill="#447A36" stroke="#1A2415" stroke-width="1.2" stroke-linejoin="round" transform="translate(47.7,80.6) rotate(36) scale(1,0.5)"/><path d="M0,0 C2.9,-3.1 7.5,-3.1 9.6,0 C7.5,3.1 2.9,3.1 0,0 Z" fill="#5B9E45" stroke="#1A2415" stroke-width="1.2" stroke-linejoin="round" transform="translate(82.2,81.2) rotate(287) scale(1,0.5)"/><path d="M0,0 C3.2,-3.4 8.2,-3.4 10.6,0 C8.2,3.4 3.2,3.4 0,0 Z" fill="#6FB457" stroke="#1A2415" stroke-width="1.2" stroke-linejoin="round" transform="translate(23.8,81.3) rotate(201) scale(1,0.5)"/><path d="M0,0 C3.5,-3.7 9.0,-3.7 11.6,0 C9.0,3.7 3.5,3.7 0,0 Z" fill="#5B9E45" stroke="#1A2415" stroke-width="1.2" stroke-linejoin="round" transform="translate(42.1,81.7) rotate(69) scale(1,0.5)"/><path d="M0,0 C3.4,-3.6 8.8,-3.6 11.3,0 C8.8,3.6 3.4,3.6 0,0 Z" fill="#447A36" stroke="#1A2415" stroke-width="1.2" stroke-linejoin="round" transform="translate(24.7,81.7) rotate(47) scale(1,0.5)"/><path d="M0,0 C3.1,-3.4 8.2,-3.4 10.5,0 C8.2,3.4 3.1,3.4 0,0 Z" fill="#5B9E45" stroke="#1A2415" stroke-width="1.2" stroke-linejoin="round" transform="translate(82.9,81.9) rotate(42) scale(1,0.5)"/><path d="M0,0 C3.0,-3.2 7.8,-3.2 9.9,0 C7.8,3.2 3.0,3.2 0,0 Z" fill="#447A36" stroke="#1A2415" stroke-width="1.2" stroke-linejoin="round" transform="translate(23.1,82.0) rotate(77) scale(1,0.5)"/><path d="M0,0 C3.5,-3.8 9.2,-3.8 11.8,0 C9.2,3.8 3.5,3.8 0,0 Z" fill="#5B9E45" stroke="#1A2415" stroke-width="1.2" stroke-linejoin="round" transform="translate(65.1,82.0) rotate(350) scale(1,0.5)"/><path d="M0,0 C3.6,-3.9 9.4,-3.9 12.1,0 C9.4,3.9 3.6,3.9 0,0 Z" fill="#6FB457" stroke="#1A2415" stroke-width="1.2" stroke-linejoin="round" transform="translate(52.2,82.8) rotate(109) scale(1,0.5)"/><path d="M0,0 C3.1,-3.3 8.1,-3.3 10.4,0 C8.1,3.3 3.1,3.3 0,0 Z" fill="#5B9E45" stroke="#1A2415" stroke-width="1.2" stroke-linejoin="round" transform="translate(72.1,83.0) rotate(76) scale(1,0.5)"/><path d="M0,0 C3.4,-3.6 8.8,-3.6 11.2,0 C8.8,3.6 3.4,3.6 0,0 Z" fill="#447A36" stroke="#1A2415" stroke-width="1.2" stroke-linejoin="round" transform="translate(33.2,83.0) rotate(308) scale(1,0.5)"/><path d="M0,0 C3.7,-4.0 9.7,-4.0 12.5,0 C9.7,4.0 3.7,4.0 0,0 Z" fill="#5B9E45" stroke="#1A2415" stroke-width="1.2" stroke-linejoin="round" transform="translate(26.4,83.7) rotate(36) scale(1,0.5)"/><path d="M0,0 C3.0,-3.2 7.7,-3.2 9.9,0 C7.7,3.2 3.0,3.2 0,0 Z" fill="#447A36" stroke="#1A2415" stroke-width="1.2" stroke-linejoin="round" transform="translate(47.9,83.9) rotate(77) scale(1,0.5)"/><path d="M0,0 C3.0,-3.2 7.9,-3.2 10.2,0 C7.9,3.2 3.0,3.2 0,0 Z" fill="#5B9E45" stroke="#1A2415" stroke-width="1.2" stroke-linejoin="round" transform="translate(65.1,84.3) rotate(278) scale(1,0.5)"/><path d="M0,0 C2.8,-3.0 7.2,-3.0 9.3,0 C7.2,3.0 2.8,3.0 0,0 Z" fill="#6FB457" stroke="#1A2415" stroke-width="1.2" stroke-linejoin="round" transform="translate(21.8,84.5) rotate(107) scale(1,0.5)"/><path d="M0,0 C3.3,-3.5 8.6,-3.5 11.0,0 C8.6,3.5 3.3,3.5 0,0 Z" fill="#5B9E45" stroke="#1A2415" stroke-width="1.2" stroke-linejoin="round" transform="translate(43.7,85.3) rotate(32) scale(1,0.5)"/><path d="M0,0 C3.3,-3.6 8.7,-3.6 11.1,0 C8.7,3.6 3.3,3.6 0,0 Z" fill="#447A36" stroke="#1A2415" stroke-width="1.2" stroke-linejoin="round" transform="translate(56.0,85.4) rotate(87) scale(1,0.5)"/><path d="M0,0 C3.2,-3.4 8.3,-3.4 10.6,0 C8.3,3.4 3.2,3.4 0,0 Z" fill="#5B9E45" stroke="#1A2415" stroke-width="1.2" stroke-linejoin="round" transform="translate(75.0,85.6) rotate(134) scale(1,0.5)"/><path d="M0,0 C3.2,-3.4 8.3,-3.4 10.7,0 C8.3,3.4 3.2,3.4 0,0 Z" fill="#447A36" stroke="#1A2415" stroke-width="1.2" stroke-linejoin="round" transform="translate(59.4,86.9) rotate(345) scale(1,0.5)"/><ellipse cx="50" cy="80" rx="14" ry="3.4" fill="#000" opacity=".22"/><path d="M0,0 C3.2,-3.4 8.3,-3.4 10.6,0 C8.3,3.4 3.2,3.4 0,0 Z" fill="#6FB457" stroke="#1A2415" stroke-width="1.2" stroke-linejoin="round" transform="translate(41.0,80.5) rotate(24) scale(1,0.5)"/><path d="M0,0 C3.2,-3.4 8.3,-3.4 10.6,0 C8.3,3.4 3.2,3.4 0,0 Z" fill="#5B9E45" stroke="#1A2415" stroke-width="1.2" stroke-linejoin="round" transform="translate(50.0,82.5) rotate(160) scale(1,0.5)"/>__MEDAL__<path d="M0,0 C2.7,-2.9 6.9,-2.9 8.9,0 C6.9,2.9 2.7,2.9 0,0 Z" fill="#5B9E45" stroke="#1A2415" stroke-width="1.4" stroke-linejoin="round" transform="translate(52.6,58.8) rotate(-33) scale(1,1.0)"/><path d="M0,0 C2.5,-2.7 6.5,-2.7 8.4,0 C6.5,2.7 2.5,2.7 0,0 Z" fill="#5B9E45" stroke="#1A2415" stroke-width="1.4" stroke-linejoin="round" transform="translate(52.6,58.8) rotate(19) scale(1,1.0)"/><path d="M0,0 C2.5,-2.7 6.6,-2.7 8.5,0 C6.6,2.7 2.5,2.7 0,0 Z" fill="#5B9E45" stroke="#1A2415" stroke-width="1.4" stroke-linejoin="round" transform="translate(59.5,56.7) rotate(-53) scale(1,1.0)"/><path d="M0,0 C2.4,-2.5 6.2,-2.5 8.0,0 C6.2,2.5 2.4,2.5 0,0 Z" fill="#5B9E45" stroke="#1A2415" stroke-width="1.4" stroke-linejoin="round" transform="translate(59.5,56.7) rotate(-1) scale(1,1.0)"/><path d="M0,0 C2.4,-2.6 6.3,-2.6 8.0,0 C6.3,2.6 2.4,2.6 0,0 Z" fill="#5B9E45" stroke="#1A2415" stroke-width="1.4" stroke-linejoin="round" transform="translate(65.4,52.3) rotate(-73) scale(1,1.0)"/><path d="M0,0 C2.3,-2.4 5.9,-2.4 7.5,0 C5.9,2.4 2.3,2.4 0,0 Z" fill="#5B9E45" stroke="#1A2415" stroke-width="1.4" stroke-linejoin="round" transform="translate(65.4,52.3) rotate(-21) scale(1,1.0)"/><path d="M0,0 C2.3,-2.4 5.9,-2.4 7.6,0 C5.9,2.4 2.3,2.4 0,0 Z" fill="#5B9E45" stroke="#1A2415" stroke-width="1.4" stroke-linejoin="round" transform="translate(69.3,46.2) rotate(-93) scale(1,1.0)"/><path d="M0,0 C2.1,-2.3 5.6,-2.3 7.1,0 C5.6,2.3 2.1,2.3 0,0 Z" fill="#5B9E45" stroke="#1A2415" stroke-width="1.4" stroke-linejoin="round" transform="translate(69.3,46.2) rotate(-41) scale(1,1.0)"/><path d="M0,0 C2.1,-2.3 5.6,-2.3 7.1,0 C5.6,2.3 2.1,2.3 0,0 Z" fill="#5B9E45" stroke="#1A2415" stroke-width="1.4" stroke-linejoin="round" transform="translate(71.0,39.1) rotate(-113) scale(1,1.0)"/><path d="M0,0 C2.0,-2.1 5.2,-2.1 6.7,0 C5.2,2.1 2.0,2.1 0,0 Z" fill="#5B9E45" stroke="#1A2415" stroke-width="1.4" stroke-linejoin="round" transform="translate(71.0,39.1) rotate(-61) scale(1,1.0)"/><path d="M0,0 C2.0,-2.1 5.2,-2.1 6.7,0 C5.2,2.1 2.0,2.1 0,0 Z" fill="#5B9E45" stroke="#1A2415" stroke-width="1.4" stroke-linejoin="round" transform="translate(70.1,31.9) rotate(-133) scale(1,1.0)"/><path d="M0,0 C1.9,-2.0 4.9,-2.0 6.3,0 C4.9,2.0 1.9,2.0 0,0 Z" fill="#5B9E45" stroke="#1A2415" stroke-width="1.4" stroke-linejoin="round" transform="translate(70.1,31.9) rotate(-81) scale(1,1.0)"/><path d="M0,0 C1.9,-2.0 4.9,-2.0 6.2,0 C4.9,2.0 1.9,2.0 0,0 Z" fill="#5B9E45" stroke="#1A2415" stroke-width="1.4" stroke-linejoin="round" transform="translate(66.8,25.4) rotate(-153) scale(1,1.0)"/><path d="M0,0 C1.8,-1.9 4.6,-1.9 5.9,0 C4.6,1.9 1.8,1.9 0,0 Z" fill="#5B9E45" stroke="#1A2415" stroke-width="1.4" stroke-linejoin="round" transform="translate(66.8,25.4) rotate(-101) scale(1,1.0)"/><path d="M0,0 C1.7,-1.9 4.5,-1.9 5.8,0 C4.5,1.9 1.7,1.9 0,0 Z" fill="#5B9E45" stroke="#1A2415" stroke-width="1.4" stroke-linejoin="round" transform="translate(61.4,20.4) rotate(-173) scale(1,1.0)"/><path d="M0,0 C1.6,-1.7 4.2,-1.7 5.4,0 C4.2,1.7 1.6,1.7 0,0 Z" fill="#5B9E45" stroke="#1A2415" stroke-width="1.4" stroke-linejoin="round" transform="translate(61.4,20.4) rotate(-121) scale(1,1.0)"/><path d="M0,0 C2.7,-2.9 6.9,-2.9 8.9,0 C6.9,2.9 2.7,2.9 0,0 Z" fill="#5B9E45" stroke="#1A2415" stroke-width="1.4" stroke-linejoin="round" transform="translate(47.4,58.8) rotate(213) scale(1,1.0)"/><path d="M0,0 C2.5,-2.7 6.5,-2.7 8.4,0 C6.5,2.7 2.5,2.7 0,0 Z" fill="#5B9E45" stroke="#1A2415" stroke-width="1.4" stroke-linejoin="round" transform="translate(47.4,58.8) rotate(161) scale(1,1.0)"/><path d="M0,0 C2.5,-2.7 6.6,-2.7 8.5,0 C6.6,2.7 2.5,2.7 0,0 Z" fill="#5B9E45" stroke="#1A2415" stroke-width="1.4" stroke-linejoin="round" transform="translate(40.5,56.7) rotate(233) scale(1,1.0)"/><path d="M0,0 C2.4,-2.5 6.2,-2.5 8.0,0 C6.2,2.5 2.4,2.5 0,0 Z" fill="#5B9E45" stroke="#1A2415" stroke-width="1.4" stroke-linejoin="round" transform="translate(40.5,56.7) rotate(181) scale(1,1.0)"/><path d="M0,0 C2.4,-2.6 6.3,-2.6 8.0,0 C6.3,2.6 2.4,2.6 0,0 Z" fill="#5B9E45" stroke="#1A2415" stroke-width="1.4" stroke-linejoin="round" transform="translate(34.6,52.3) rotate(253) scale(1,1.0)"/><path d="M0,0 C2.3,-2.4 5.9,-2.4 7.5,0 C5.9,2.4 2.3,2.4 0,0 Z" fill="#5B9E45" stroke="#1A2415" stroke-width="1.4" stroke-linejoin="round" transform="translate(34.6,52.3) rotate(201) scale(1,1.0)"/><path d="M0,0 C2.3,-2.4 5.9,-2.4 7.6,0 C5.9,2.4 2.3,2.4 0,0 Z" fill="#5B9E45" stroke="#1A2415" stroke-width="1.4" stroke-linejoin="round" transform="translate(30.7,46.2) rotate(273) scale(1,1.0)"/><path d="M0,0 C2.1,-2.3 5.6,-2.3 7.1,0 C5.6,2.3 2.1,2.3 0,0 Z" fill="#5B9E45" stroke="#1A2415" stroke-width="1.4" stroke-linejoin="round" transform="translate(30.7,46.2) rotate(221) scale(1,1.0)"/><path d="M0,0 C2.1,-2.3 5.6,-2.3 7.1,0 C5.6,2.3 2.1,2.3 0,0 Z" fill="#5B9E45" stroke="#1A2415" stroke-width="1.4" stroke-linejoin="round" transform="translate(29.0,39.1) rotate(293) scale(1,1.0)"/><path d="M0,0 C2.0,-2.1 5.2,-2.1 6.7,0 C5.2,2.1 2.0,2.1 0,0 Z" fill="#5B9E45" stroke="#1A2415" stroke-width="1.4" stroke-linejoin="round" transform="translate(29.0,39.1) rotate(241) scale(1,1.0)"/><path d="M0,0 C2.0,-2.1 5.2,-2.1 6.7,0 C5.2,2.1 2.0,2.1 0,0 Z" fill="#5B9E45" stroke="#1A2415" stroke-width="1.4" stroke-linejoin="round" transform="translate(29.9,31.9) rotate(313) scale(1,1.0)"/><path d="M0,0 C1.9,-2.0 4.9,-2.0 6.3,0 C4.9,2.0 1.9,2.0 0,0 Z" fill="#5B9E45" stroke="#1A2415" stroke-width="1.4" stroke-linejoin="round" transform="translate(29.9,31.9) rotate(261) scale(1,1.0)"/><path d="M0,0 C1.9,-2.0 4.9,-2.0 6.2,0 C4.9,2.0 1.9,2.0 0,0 Z" fill="#5B9E45" stroke="#1A2415" stroke-width="1.4" stroke-linejoin="round" transform="translate(33.2,25.4) rotate(333) scale(1,1.0)"/><path d="M0,0 C1.8,-1.9 4.6,-1.9 5.9,0 C4.6,1.9 1.8,1.9 0,0 Z" fill="#5B9E45" stroke="#1A2415" stroke-width="1.4" stroke-linejoin="round" transform="translate(33.2,25.4) rotate(281) scale(1,1.0)"/><path d="M0,0 C1.7,-1.9 4.5,-1.9 5.8,0 C4.5,1.9 1.7,1.9 0,0 Z" fill="#5B9E45" stroke="#1A2415" stroke-width="1.4" stroke-linejoin="round" transform="translate(38.6,20.4) rotate(353) scale(1,1.0)"/><path d="M0,0 C1.6,-1.7 4.2,-1.7 5.4,0 C4.2,1.7 1.6,1.7 0,0 Z" fill="#5B9E45" stroke="#1A2415" stroke-width="1.4" stroke-linejoin="round" transform="translate(38.6,20.4) rotate(301) scale(1,1.0)"/><g fill="#F5B93B" stroke="none"><path d="M20,30 l1.6,3 3,1.6 -3,1.6 -1.6,3 -1.6,-3 -3,-1.6 3,-1.6 Z"/><path d="M79,44 l1.2,2.3 2.3,1.2 -2.3,1.2 -1.2,2.3 -1.2,-2.3 -2.3,-1.2 2.3,-1.2 Z"/><circle cx="72" cy="20" r="1.6"/></g></svg>';
  var MEDALS = {
    gold: ["#F5B93B", "#8F6209"],
    silver: ["#D7DBE2", "#6E7684"],
    bronze: ["#D08A4C", "#7A4A1E"]
  };
  function medalEgg(kind) {
    const [fill, edge] = MEDALS[kind] || [];
    if (!fill) return "";
    return `<g transform="translate(50,39)"><path d="M0,-11 C5.4,-11 8.6,-4.4 8.6,2.2 C8.6,8.2 4.8,11 0,11 C-4.8,11 -8.6,8.2 -8.6,2.2 C-8.6,-4.4 -5.4,-11 0,-11 Z" fill="${fill}" stroke="${edge}" stroke-width="1.6"/><ellipse cx="-2.8" cy="-3.6" rx="2" ry="3.4" fill="#FFFFFF" opacity=".8" transform="rotate(-14 -2.8 -3.6)"/></g>`;
  }
  var trophy = (px, medal) => TROPHY_SVG.replace(/__S__/g, px).replace("__MEDAL__", medalEgg(medal));
  function rankNumeral(px, tier, rank) {
    const [fill] = MEDALS[tier] || MEDALS.gold;
    return `<div style="width:${px}px;height:${px}px;display:flex;align-items:center;justify-content:center;font-family:'Fraunces',serif;font-weight:800;font-variation-settings:'SOFT' 60,'WONK' 1;font-size:${Math.round(px * 0.62)}px;line-height:1;color:${fill}">${rank}</div>`;
  }
  var SPRAY_LEAF = "M0,0 C3.2,-3.4 8.3,-3.4 10.6,0 C8.3,3.4 3.2,3.4 0,0 Z";
  var SPRAY_GREENS = ["#5B9E45", "#447A36", "#6FB457"];
  function sprayLeaf(x, y, rot, scale, fillIdx) {
    const fill = SPRAY_GREENS[fillIdx % SPRAY_GREENS.length];
    return `<path d="${SPRAY_LEAF}" fill="${fill}" stroke="#1A2415" stroke-width="${(1.3 / scale).toFixed(2)}" stroke-linejoin="round" transform="translate(${x.toFixed(1)},${y.toFixed(1)}) rotate(${rot.toFixed(1)}) scale(${scale.toFixed(2)})"/>`;
  }
  function sprayFrond(cx, cy, side, W, H, crossAmt, count, baseScale, tipScale, bareT) {
    const pos = (t) => ({
      x: cx + side * (-crossAmt + (W + crossAmt) * t),
      y: cy - H * Math.pow(t, 0.6)
    });
    let leaves = "", stemD = "";
    for (let i = 0; i <= 40; i++) {
      const t = i / 40, p = pos(t);
      stemD += (i === 0 ? "M" : "L") + p.x.toFixed(1) + "," + p.y.toFixed(1) + " ";
    }
    for (let i = 0; i < count; i++) {
      const t = bareT + i / (count - 1) * (1 - bareT);
      const p = pos(t), p2 = pos(Math.min(1, t + 0.01));
      const tangentDeg = Math.atan2(p2.y - p.y, p2.x - p.x) * 180 / Math.PI;
      const altSide = i % 2 === 0 ? 1 : -1;
      const leafT = i / (count - 1);
      const scale = baseScale + (tipScale - baseScale) * leafT;
      leaves += sprayLeaf(p.x, p.y, tangentDeg + altSide * 66, scale, i);
    }
    const stem = `<path d="${stemD}" fill="none" stroke="#1A2415" stroke-width="3.8" stroke-linecap="round"/>`;
    return stem + leaves;
  }
  function laurelSpray() {
    const cx = 260, cy = 250, W = 216, H = 224, crossAmt = 26;
    const svg = `<svg viewBox="0 0 520 260" preserveAspectRatio="none">
    ${sprayFrond(cx, cy, -1, W, H, crossAmt, 20, 5.6, 2, 0.14)}
    ${sprayFrond(cx, cy, 1, W, H, crossAmt, 20, 5.6, 2, 0.14)}
  </svg>`;
    return `<div class="laurel-spray">${svg}</div>`;
  }

  // src/core/slotTypes.js
  var SLOT_LABELS = {
    opener: "Opener",
    set1_closer: "Set 1 Closer",
    set2_opener: "Set 2 Opener",
    closer: "Set 2 Closer",
    show_closer: "Final Song",
    encore: "Encore",
    second_song: "2nd Song",
    cover_pick: "Cover"
  };
  var SLOT_TOOLTIPS = {
    opener: "First song of the show",
    set1_closer: "Last song of set 1",
    set2_opener: "First song of set 2",
    closer: "Last song before the encore",
    show_closer: "Last song of the show, encore included",
    encore: "Any encore song",
    second_song: "Second song of the show",
    cover_pick: "A cover the band has played before"
  };
  var FLAT_PICK_TOOLTIP = "Any song, any position";
  var ONE_SET_EXCLUDED_TYPES = ["set1_closer", "set2_opener"];
  function slotLabelFor(type, format) {
    if (type === "closer" && format === "one_set") return "Closer";
    return SLOT_LABELS[type] || null;
  }

  // src/features/picks.js
  var normSong = (v) => (v || "").trim().toLowerCase();
  var isWildcard = (v) => normSong(v) === "any debut";
  var UNLOCKED_ICON = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="10" rx="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></svg>';
  function draftKey(showId) {
    return `ft_draft_${state.session.id}_${state.currentBracketId}_${showId}`;
  }
  async function openShow(id) {
    if (isDesktop()) state.tab = "shows";
    clearTimersFor("shows");
    const show = await fetchShow(id);
    state.currentShow = show;
    const st = showState(show);
    if (st !== "open") {
      renderShowDetail(show);
      return;
    }
    let gate = { ok: true, reason: null };
    try {
      const [row] = await rpc("can_submit_picks", { p_name: state.session.name, p_pin: state.session.pin, p_bracket_id: state.currentBracketId, p_show_id: show.id });
      if (row) gate = row;
    } catch (e) {
    }
    if (gate.ok) renderPickSheet(show);
    else renderIneligible(show, gate.reason);
  }
  function renderIneligible(show, reason) {
    const casual = state.leagues.find((l) => l.league_id === state.currentLeagueId && l.bracket_kind === "casual");
    $("#main").innerHTML = `
    <p style="margin-top:14px"><button class="btn ghost small" onclick="renderShows()">\u2190 shows</button></p>
    <div class="sheet">
      <h2>${esc(show.venue || "TBA")}</h2>
      <div class="sub">${fmtDate(show.showdate)}</div>
      <p class="ineligible-reason">${esc(reason || "Picks aren't open for this bracket.")}</p>
      ${casual ? `<button class="btn ghost small" onclick="switchToBracket(${casual.bracket_id})">Switch to Casual</button>` : ""}
    </div>
    ${footerHtml()}`;
  }
  function prettifySlotKey(key) {
    return key.replace(/[_-]+/g, " ").replace(/([a-zA-Z])(\d)/g, "$1 $2").trim().split(/\s+/).map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ");
  }
  function breakdownSlotInfo(format) {
    const sect = format === "one_set" && state.cfg.oneset ? state.cfg.oneset : state.cfg;
    const slots = sect.slots || [];
    const coverKeys = slots.filter((s) => (s.type || s.key) === "cover_pick").map((s) => s.key);
    const order = [], label = {};
    slots.forEach((s) => {
      order.push(s.key);
      const base = slotLabelFor(s.type || s.key, format) || prettifySlotKey(s.type || s.key);
      label[s.key] = coverKeys.length > 1 && coverKeys.includes(s.key) ? `${base} ${coverKeys.indexOf(s.key) + 1}` : base;
    });
    for (let i = 1; i <= (sect.flat_picks || 0); i++) {
      order.push("flat" + i);
      label["flat" + i] = "Pick " + i;
    }
    return { order, label };
  }
  function sortBySlotOrder(items, order) {
    return [...items].sort((a, b) => {
      const ia = order.indexOf(a.slot), ib = order.indexOf(b.slot);
      if (ia === -1 && ib === -1) return 0;
      if (ia === -1) return 1;
      if (ib === -1) return -1;
      return ia - ib;
    });
  }
  function slotDefs(format) {
    var _a, _b;
    const sect = format === "one_set" && state.cfg.oneset ? state.cfg.oneset : state.cfg;
    const slots = (sect.slots || []).map((s) => {
      const type = s.type || s.key;
      return { key: s.key, label: slotLabelFor(type, format) || prettifySlotKey(type), tooltip: SLOT_TOOLTIPS[type] || null, pts: s.points, type };
    });
    for (let i = 1; i <= (sect.flat_picks || 0); i++) slots.push({ key: "flat" + i, label: "Pick " + i, tooltip: FLAT_PICK_TOOLTIP, pts: (_b = (_a = sect.flat_points) != null ? _a : state.cfg.flat_points) != null ? _b : 1, flat: true });
    return slots;
  }
  async function renderPickSheet(show) {
    var _a;
    let mine = [];
    try {
      mine = await rpc("get_my_picks", { p_name: state.session.name, p_pin: state.session.pin, p_bracket_id: state.currentBracketId, p_show_id: show.id });
    } catch (e) {
    }
    const dKey = draftKey(show.id);
    const draft = JSON.parse(localStorage.getItem(dKey) || "null");
    const savedVal = (k) => ((mine.find((p) => p.slot === k) || {}).songname || "").trim();
    const val = (k) => esc((draft && draft[k] != null ? draft[k] : savedVal(k)) || "");
    const slots = slotDefs(show.format);
    const slotHtml = (s) => `
    <div class="slotline autocomplete">
      <label${s.tooltip ? ` title="${esc(s.tooltip)}"` : ""}>${esc(s.label)}</label>
      <input data-slot="${s.key}" data-type="${s.type || s.key}" value="${val(s.key)}" placeholder="${(s.type || s.key) === "cover_pick" ? "a cover\u2026" : "song\u2026"}" autocomplete="off" spellcheck="false">
      <span class="pts">${s.pts}</span>
      <span class="unsaved" title="Unsaved change \u2014 differs from your saved pick">${UNLOCKED_ICON}</span>
    </div>`;
    const structured = slots.filter((s) => !s.flat), flats = slots.filter((s) => s.flat);
    $("#main").innerHTML = `
    <p style="margin-top:14px"><button class="btn ghost small" onclick="renderShows()">\u2190 shows</button></p>
    <div class="sheet">
      <h2>${esc(show.venue || "TBA")}</h2>
      <div class="sub">${fmtDate(show.showdate)} \xB7 ${esc(show.city || "")}${show.state ? ", " + esc(show.state) : ""}${show.format === "one_set" ? " \xB7 FESTIVAL SET" : ""}</div>
      <button class="revertlink" id="revert-link">Revert to saved</button>
      ${structured.map(slotHtml).join("")}
      ${flats.length ? `<div class="divider">Anywhere in the show</div>${flats.map(slotHtml).join("")}` : ""}
      <p style="font-size:.75rem;margin:2px 0 0;color:var(--paper-ink-soft)">numbers are points per slot</p>
      <button class="savebtn" id="save">Lock 'em in</button>
      <p style="font-size:.75rem;margin:8px 0 0;text-align:center;color:var(--paper-ink-soft)">You can change your picks any time until the cutoff.</p>
      <div class="countbig">${state.cfg.voting_override === "open" ? "Admin override \u2014 voting open" : `Cutoff ${fmtCutoff(show.cutoff_at)} \xB7 <b id="cd"></b>`}</div>
      <div class="err" id="p-err" style="text-align:center"></div>
      ${((_a = currentBracket()) == null ? void 0 : _a.bracket_kind) === "official" ? laurelSpray() : ""}
    </div>
    ${footerHtml()}`;
    document.querySelectorAll(".slotline input").forEach(attachAutocomplete);
    const sheetEl = $("#main").querySelector(".sheet");
    const syncDirty = () => {
      const snapshot = {};
      let anyDirty = false;
      document.querySelectorAll(".slotline input").forEach((inp) => {
        const dirty = inp.value.trim() !== savedVal(inp.dataset.slot);
        snapshot[inp.dataset.slot] = inp.value;
        inp.closest(".slotline").classList.toggle("dirty", dirty);
        if (dirty) anyDirty = true;
      });
      if (anyDirty) localStorage.setItem(dKey, JSON.stringify(snapshot));
      else localStorage.removeItem(dKey);
      sheetEl.classList.toggle("dirty", anyDirty);
    };
    document.querySelectorAll(".slotline input").forEach((inp) => inp.addEventListener("input", syncDirty));
    syncDirty();
    $("#save").onclick = savePicks;
    $("#revert-link").onclick = () => {
      if (!confirm("Discard your unsaved changes and revert every slot to your last saved picks?")) return;
      localStorage.removeItem(dKey);
      openShow(show.id);
    };
    if (state.cfg.voting_override !== "open" && show.cutoff_at) state.timers.push(setInterval(() => {
      const cd = countdown(show.cutoff_at);
      if (cd) $("#cd").textContent = cd + " left";
      else {
        toast("All picks are locked \u2014 enjoy the show \u{1F95A}");
        openShow(show.id);
      }
    }, 1e3));
  }
  function attachAutocomplete(input) {
    let list = null, sel = -1;
    const close = () => {
      list == null ? void 0 : list.remove();
      list = null;
      sel = -1;
    };
    input.addEventListener("input", () => {
      var _a, _b;
      close();
      const q = normSong(input.value);
      if (q.length < 1) return;
      const coverOnly = input.dataset.type === "cover_pick";
      const pool = coverOnly ? state.songList.filter((s) => s.is_original === false) : state.songList;
      const wc = [];
      if (!coverOnly && ((_b = (_a = state.cfg.wildcards) == null ? void 0 : _a.debut) != null ? _b : true) && ("any debut".includes(q) || "debut".includes(q)))
        wc.push({ songname: "Any Debut", times_played: "\u2605" });
      const hits = [...wc, ...pool.filter((s) => normSong(s.songname).includes(q))].slice(0, 8);
      if (!hits.length) return;
      list = document.createElement("div");
      list.className = "acc-list";
      hits.forEach((h) => {
        var _a2;
        const d = document.createElement("div");
        d.innerHTML = `${esc(h.songname)} <small>${(_a2 = h.times_played) != null ? _a2 : "\u2013"}\xD7</small>`;
        d.onmousedown = (e) => {
          e.preventDefault();
          input.value = h.songname;
          input.dispatchEvent(new Event("input"));
          close();
        };
        list.appendChild(d);
      });
      input.parentElement.appendChild(list);
    });
    input.addEventListener("keydown", (e) => {
      if (!list) return;
      const items = [...list.children];
      if (e.key === "ArrowDown") {
        sel = Math.min(sel + 1, items.length - 1);
      } else if (e.key === "ArrowUp") {
        sel = Math.max(sel - 1, 0);
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (sel >= 0) {
          input.value = items[sel].textContent.replace(/\s*\S*×$/, "").trim();
          input.dispatchEvent(new Event("input"));
        }
        close();
        return;
      } else return;
      items.forEach((it, i) => it.classList.toggle("sel", i === sel));
    });
    input.addEventListener("blur", () => setTimeout(close, 150));
  }
  async function savePicks() {
    $("#p-err").textContent = "";
    const picks = [...document.querySelectorAll(".slotline input")].map((i) => ({ slot: i.dataset.slot, songname: i.value.trim() })).filter((p) => p.songname);
    const unknown = picks.filter((p) => !isWildcard(p.songname) && !state.songList.some((s) => normSong(s.songname) === normSong(p.songname)));
    if (unknown.length && !confirm(`Not in the catalog (typo, or a bold debut call?):
${unknown.map((u) => u.songname).join("\n")}

Save anyway?`)) return;
    try {
      await rpc("submit_picks", { p_name: state.session.name, p_pin: state.session.pin, p_bracket_id: state.currentBracketId, p_show_id: state.currentShow.id, p_picks: picks });
      localStorage.removeItem(draftKey(state.currentShow.id));
      toast("Picks saved \u2714", "score");
      openShow(state.currentShow.id);
    } catch (e) {
      $("#p-err").textContent = e.message;
    }
  }
  async function renderShowDetail(show) {
    var _a, _b, _c;
    clearTimers();
    const [{ data: setlist }, picks, scores] = await Promise.all([
      db.from("setlist_songs").select("*").eq("show_id", show.id).order("position"),
      rpc("get_show_picks", { p_bracket_id: state.currentBracketId, p_show_id: show.id }).catch(() => []),
      rpc("get_bracket_scores", { p_name: state.session.name, p_pin: state.session.pin, p_bracket_id: state.currentBracketId, p_show_id: show.id }).then((rows) => (rows || []).sort((a, b) => b.points - a.points))
    ]);
    const pname = Object.fromEntries((scores || []).map((s) => [s.player_id, s.player_name]));
    const mineHits = new Set((picks || []).filter((p) => p.player_id === state.session.id).map((p) => p.songname.toLowerCase()));
    let lastSet = null;
    const setHtml = (setlist || []).map((s) => {
      const label = s.is_encore ? "Encore" : "Set " + (s.setnumber || "1");
      const brk = label !== lastSet ? `<div class="setbreak">${esc(label)}</div>` : "";
      lastSet = label;
      return brk + `
    <div class="songrow ${mineHits.has(s.songname.toLowerCase()) ? "hitmine" : ""}">
      <span class="pos">${s.position}</span>
      <span class="name">${esc(s.songname)}${s.segue ? ' <span class="segue">&gt;</span>' : ""}</span>
    </div>`;
    }).join("");
    const attribution = (setlist || []).length ? `<p class="muted" style="text-align:center">Setlist data from ${show.permalink ? `<a href="${CARTON_SITE_BASE}/${esc(show.permalink)}" target="_blank" rel="noopener">The Carton</a>` : "The Carton"}.</p>` : "";
    const { order: brkOrder, label: brkLabel } = breakdownSlotInfo(show.format);
    const hasUndetermined = (scores || []).some((sc) => (sc.breakdown || []).some((b) => (b.reason || "").includes("slot undetermined")));
    const scoreHtml = (scores || []).map((sc) => `
    <div class="panel" style="padding:12px">
      <div class="row"><b>${esc(pname[sc.player_id] || "?")}</b>
        <span class="pts" style="margin-left:auto;font-family:var(--mono);color:var(--yolk)">${sc.points} pts</span></div>
      ${sortBySlotOrder(sc.breakdown || [], brkOrder).map((b) => `
        <div class="pickres ${b.points > 0 ? "hit" : b.hit ? "" : "miss"}">
          <span class="sl">${esc(brkLabel[b.slot] || prettifySlotKey(b.slot))}</span><span>${esc(b.songname)}</span>
          <span class="pt">${b.points > 0 ? "+" + b.points : "\xB7"} <small class="muted">${esc(b.reason)}</small></span>
        </div>`).join("")}
    </div>`).join("");
    let pickBoard = "";
    if (!(scores || []).length && (picks || []).length) {
      const slotOrder = slotDefs(show.format).map((sl) => sl.key);
      const slotLabel = Object.fromEntries(slotDefs(show.format).map((sl) => [sl.key, sl.label]));
      const byName = {};
      for (const p of picks) ((_b = byName[_a = p.player_name]) != null ? _b : byName[_a] = []).push(p);
      pickBoard = `<h2 style="margin:18px 4px 4px">The picks are in</h2>` + Object.entries(byName).sort((a, b) => a[0].localeCompare(b[0])).map(([name, pp]) => `
        <div class="panel" style="padding:12px"><div class="row"><b>${esc(name)}</b></div>
          ${pp.sort((a, b) => slotOrder.indexOf(a.slot) - slotOrder.indexOf(b.slot)).map((p) => `
            <div class="pickres"><span class="sl">${esc(slotLabel[p.slot] || p.slot)}</span>
              <span>${esc(p.songname)}</span></div>`).join("")}
        </div>`).join("");
    }
    $("#main").innerHTML = `
    <p style="margin-top:14px"><button class="btn ghost small" onclick="renderShows()">\u2190 shows</button>
      <span class="pill ${showState(show) === "live" ? "live" : "final"}">${showState(show) === "final" ? "complete" : showState(show)}</span></p>
    ${(() => {
      if (show.status !== "final" || !(scores || []).length) return "";
      const top = scores[0].points;
      if (top <= 0) return `<div class="panel"><h2>No winner</h2><p class="muted">Nobody scored on this one.</p></div>`;
      const champs = scores.filter((x) => x.points === top).map((x) => esc(pname[x.player_id] || "?"));
      return `<div class="panel" style="border-color:var(--yolk)">
        <h2>${winBadge(64)} ${champs.join(" & ")} ${champs.length > 1 ? "tie" : "takes it"}</h2>
        <p class="muted">${top} points${champs.length > 1 ? " apiece" : ""}</p></div>`;
    })()}
    <div class="panel"><h2>${esc(show.venue || "")} <span class="muted" style="font-size:.85rem">${fmtDate(show.showdate)}</span></h2>
      ${((_c = currentBracket()) == null ? void 0 : _c.bracket_kind) === "official" ? `<div class="row" style="justify-content:center;gap:10px;margin:4px 0 12px">${trophy(26)}<span style="font-family:'Fraunces',serif;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:var(--yolk);font-size:.85rem">Official</span>${trophy(26)}</div>` : ""}
      ${setHtml || '<p class="muted">No setlist yet. It shows up here song-by-song once the tapers get typing.</p>'}</div>${attribution}
    ${pickBoard}
    <h2 style="margin:18px 4px 4px">Score</h2>
    ${hasUndetermined ? `<p class="muted" style="text-align:center;margin:0 4px 8px">Closer-type picks show off-slot points (if enabled) until the encore starts (or the show ends) \u2014 full points awarded once determined.</p>` : ""}
    ${scoreHtml || '<p class="muted" style="margin:8px 4px">No scores yet \u2014 they appear with the first song.</p>'}
    ${footerHtml()}`;
  }

  // src/features/shows.js
  function enterShowsTab() {
    if (state.currentShow) openShow(state.currentShow.id);
    else renderShows();
  }
  async function renderShows() {
    var _a, _b, _c;
    clearTimersFor("shows");
    state.tab = "shows";
    state.currentShow = null;
    markTab();
    const todayStr = (/* @__PURE__ */ new Date()).toLocaleDateString("sv");
    const graceStr = new Date(Date.now() - 2 * 864e5).toISOString().slice(0, 10);
    const [up, past, seas, myCounts] = await Promise.all([
      fetchShows((q) => q.gte("showdate", graceStr).order("showdate")),
      fetchShows((q) => q.lt("showdate", graceStr).order("showdate", { ascending: false }).limit(12)),
      rpc("get_bracket_seasons", { p_bracket_id: state.currentBracketId }),
      rpc("get_my_pick_counts", { p_name: state.session.name, p_pin: state.session.pin, p_bracket_id: state.currentBracketId })
    ]);
    const savedCountOf = Object.fromEntries((myCounts || []).map((c) => [c.show_id, c.pick_count]));
    const pickButtonInfo = (s) => {
      const st = showState(s);
      const label = st === "open" ? "Pick" : "Score";
      if (s.status === "final") return { label, markerHtml: "" };
      const target = slotDefs(s.format).length;
      const saved = savedCountOf[s.id] || 0;
      if (st === "open") {
        const hasDraft = !!localStorage.getItem(draftKey(s.id));
        if (hasDraft) {
          const title = target > 0 && saved >= target ? "Saved picks are complete, but you have unsaved local changes on this device \u2014 save again to keep them" : "Draft in progress \u2014 not yet saved";
          return { label, stacked: true, markerHtml: `<span class="pickmark warn" title="${title}">!</span>` };
        }
        if (target > 0 && saved >= target)
          return { label: "", markerHtml: `<span class="pickmark done" title="Picks saved \u2014 complete">\u2714</span>` };
        if (saved > 0)
          return { label, stacked: true, markerHtml: `<span class="pickmark progress" title="Picks saved but incomplete">\u2713</span>` };
        return { label, markerHtml: "" };
      }
      if (target > 0 && saved > 0 && saved < target)
        return { label, stacked: true, quiet: true, markerHtml: `<span class="pickmark progress" title="Picks saved but incomplete">\u2713</span>` };
      return { label, markerHtml: "" };
    };
    const seasonOf = (d) => (seas || []).find((se) => se.start_date <= d && d <= se.end_date);
    const labelOf = (d) => {
      var _a2;
      return ((_a2 = seasonOf(d)) == null ? void 0 : _a2.name) || null;
    };
    const isOfficial = ((_a = currentBracket()) == null ? void 0 : _a.bracket_kind) === "official";
    const gameNumberOf = {};
    for (const se of seas || []) {
      [...up || [], ...past || []].filter((sh) => se.start_date <= sh.showdate && sh.showdate <= se.end_date).sort((a, b) => a.showdate.localeCompare(b.showdate)).forEach((sh, i) => {
        gameNumberOf[sh.id] = i + 1;
      });
    }
    const bucketOf = (s) => {
      if (s.status === "final") return "final";
      const st = showState(s);
      if (st === "open") return "upcoming";
      if (st === "no cutoff") return s.showdate >= todayStr ? "upcoming" : "live";
      return "live";
    };
    const upcoming = (up || []).filter((s) => bucketOf(s) === "upcoming");
    const liveNow = (up || []).filter((s) => bucketOf(s) === "live");
    const finalCandidates = (up || []).filter((s) => bucketOf(s) === "final").sort((a, b) => b.showdate.localeCompare(a.showdate) || b.id - a.id);
    const justPlayed = finalCandidates.slice(0, 1);
    const extraRecent = finalCandidates.slice(1);
    const finals = [...up || [], ...past || []].filter((s) => s.status === "final").map((s) => s.id);
    const winners = {};
    if (finals.length) {
      const sc = await rpc("get_bracket_scores", { p_name: state.session.name, p_pin: state.session.pin, p_bracket_id: state.currentBracketId });
      const relevant = (sc || []).filter((s) => finals.includes(s.show_id));
      const best = {};
      for (const s of relevant) {
        if (s.points <= 0) continue;
        if (!best[s.show_id] || s.points > best[s.show_id]) best[s.show_id] = s.points;
      }
      for (const s of relevant) {
        if (s.points > 0 && s.points === best[s.show_id])
          ((_c = winners[_b = s.show_id]) != null ? _c : winners[_b] = { points: s.points, names: [] }).names.push(s.player_name || "?");
      }
    }
    const row = (s, { gameNumber, seasonLast } = {}) => {
      const st = showState(s);
      const cls = { open: "open", live: "live", locked: "locked", final: "final", played: "final" }[st] || "";
      const cd = st === "open" ? countdown(s.cutoff_at) : null;
      const txt = st === "final" ? "complete" : st === "open" && cd ? "cutoff in " + cd : st;
      const winHtml = st === "final" && winners[s.id] ? `<div class="win-line">${winBadge(28)} ${winners[s.id].names.map(esc).join(" & ")}</div>` : "";
      const noSeason = isOfficial && !seasonOf(s.showdate);
      const { wk, md } = fmtDateParts(s.showdate);
      return `<div class="showrow${noSeason ? " unavailable" : ""}${seasonLast ? " season-last" : ""}">
      <div class="date"><span class="wk">${wk}</span><span>${md}</span>${gameNumber ? `<span class="gamenum">${gameNumber}</span>` : ""}</div>
      <div class="v"><div class="venue">${esc(s.venue || "TBA")}</div>
        <div class="loc">${esc(s.city || "")}${s.state ? ", " + esc(s.state) : ""}
          <span class="pill ${cls}" data-cd="${st === "open" ? s.cutoff_at : ""}">${txt}</span></div>
        ${winHtml}</div>
      ${(() => {
        const btn = pickButtonInfo(s);
        const cls2 = [btn.stacked && "stacked", btn.quiet && "quiet"].filter(Boolean).join(" ");
        return `<button onclick="openShow(${s.id})"${cls2 ? ` class="${cls2}"` : ""}>${btn.label}${btn.markerHtml}</button>`;
      })()}
    </div>`;
    };
    const withSeasons = (list) => {
      let last;
      return list.map((sh, i) => {
        const label = labelOf(sh.showdate);
        const brk = label && label !== last ? `<div class="season-break">Season: ${esc(label)}</div>` : "";
        const nextLabel = list[i + 1] ? labelOf(list[i + 1].showdate) : null;
        const seasonLast = label && label !== nextLabel;
        last = label;
        return brk + row(sh, { gameNumber: label ? gameNumberOf[sh.id] : null, seasonLast }) + (seasonLast ? '<div class="season-end"></div>' : "");
      }).join("");
    };
    let rosterBanner = "";
    if (isOfficial) {
      const covered = [...upcoming, ...liveNow, ...justPlayed, ...extraRecent].find((s) => seasonOf(s.showdate));
      if (covered) {
        try {
          const [gate] = await rpc("can_submit_picks", { p_name: state.session.name, p_pin: state.session.pin, p_bracket_id: state.currentBracketId, p_show_id: covered.id });
          if (gate && !gate.ok && /roster/i.test(gate.reason || "")) rosterBanner = gate.reason;
        } catch (e) {
        }
      }
    }
    $("#main").innerHTML = `
    ${rosterBanner ? `<div class="noticebox">${esc(rosterBanner)}</div>` : ""}
    ${justPlayed.length ? `<div class="panel"><h2>Just played</h2>${justPlayed.map((s) => row(s, { gameNumber: labelOf(s.showdate) ? gameNumberOf[s.id] : null })).join("")}</div>` : ""}
    ${liveNow.length ? `<div class="panel live-halo"><h2>Live</h2>${liveNow.map((s) => row(s, { gameNumber: labelOf(s.showdate) ? gameNumberOf[s.id] : null })).join("")}</div>` : ""}
    <div class="panel"><h2>Upcoming</h2>${withSeasons(upcoming) || '<p class="muted">No shows synced yet \u2014 admin can sync from The Carton.</p>'}</div>
    <div class="panel"><h2>Recent</h2>${withSeasons([...extraRecent, ...past || []]) || '<p class="muted">Nothing yet.</p>'}</div>
    ${footerHtml()}`;
    state.timers.push(setInterval(() => {
      document.querySelectorAll("[data-cd]").forEach((el) => {
        if (!el.dataset.cd) return;
        const cd = countdown(el.dataset.cd);
        el.textContent = cd ? "cutoff in " + cd : "locked";
      });
    }, 1e3));
  }

  // src/core/tiebreak.js
  var TIEBREAK_LABELS = {
    fewest_zeros: "Fewest zeros",
    most_wins: "Most wins",
    highest_single_show: "Highest single-show score"
  };
  var TIEBREAK_SHORT_LABELS = {
    ...TIEBREAK_LABELS,
    highest_single_show: "High Score"
  };
  function computeStandings({ scoreRows, showsById, season, rosterJoinDates = {}, rosterIds = [] }) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k, _l;
    const inScope = (row) => {
      if (!season) return true;
      const sh = showsById[row.show_id];
      return !!sh && sh.showdate >= season.start_date && sh.showdate <= season.end_date;
    };
    const T = {};
    for (const row of scoreRows) {
      if (((_a = showsById[row.show_id]) == null ? void 0 : _a.status) !== "final") continue;
      const t = (_c = T[_b = row.player_id]) != null ? _c : T[_b] = { career: 0, scoped: 0, shows: 0, high: 0, highShow: null, wins: 0, zeros: 0 };
      t.career += row.points;
      if (inScope(row)) {
        t.scoped += row.points;
        t.shows++;
        if (row.points > t.high) {
          t.high = row.points;
          t.highShow = showsById[row.show_id] || null;
        }
      }
    }
    if (season) for (const id of rosterIds) (_d = T[id]) != null ? _d : T[id] = { career: 0, scoped: 0, shows: 0, high: 0, highShow: null, wins: 0, zeros: 0 };
    const byShow = {};
    for (const row of scoreRows) if (inScope(row) && ((_e = showsById[row.show_id]) == null ? void 0 : _e.status) === "final")
      ((_g = byShow[_f = row.show_id]) != null ? _g : byShow[_f] = []).push(row);
    for (const arr of Object.values(byShow)) {
      const mx = Math.max(...arr.map((x) => x.points));
      if (mx > 0) {
        for (const x of arr) if (x.points === mx) T[x.player_id].wins++;
      }
    }
    if (season) {
      const byPlayerShow = {};
      for (const row of scoreRows) ((_i = byPlayerShow[_h = row.player_id]) != null ? _i : byPlayerShow[_h] = {})[row.show_id] = ((_j = byPlayerShow[row.player_id][row.show_id]) != null ? _j : 0) + row.points;
      for (const playerId of Object.keys(T)) {
        const joinDate = rosterJoinDates[playerId] || season.start_date;
        const lo = joinDate > season.start_date ? joinDate : season.start_date;
        let zeros = 0;
        for (const [showId, sh] of Object.entries(showsById)) {
          if (sh.status !== "final") continue;
          if (sh.showdate < lo || sh.showdate > season.end_date) continue;
          const pts = (_l = (_k = byPlayerShow[playerId]) == null ? void 0 : _k[showId]) != null ? _l : 0;
          if (pts === 0) zeros++;
        }
        T[playerId].zeros = zeros;
      }
    }
    return T;
  }
  function layerValue(player, layer) {
    if (layer === "fewest_zeros") return -player.zeros;
    if (layer === "most_wins") return player.wins;
    if (layer === "highest_single_show") return player.high;
    throw new Error("Unknown tiebreaker layer: " + layer);
  }
  function displayValue(player, layer) {
    if (layer === "fewest_zeros") return player.zeros;
    if (layer === "most_wins") return player.wins;
    if (layer === "highest_single_show") return player.high;
    throw new Error("Unknown tiebreaker layer: " + layer);
  }
  function groupBy(ids, valueOf) {
    const byValue = /* @__PURE__ */ new Map();
    for (const id of ids) {
      const v = valueOf(id);
      if (!byValue.has(v)) byValue.set(v, []);
      byValue.get(v).push(id);
    }
    return [...byValue.keys()].sort((a, b) => b - a).map((v) => byValue.get(v));
  }
  function resolveGroup(ids, players, tiebreakers, idx, path) {
    if (idx >= tiebreakers.length) return [{ ids, resolvedBy: null, path }];
    const layer = tiebreakers[idx];
    const groups = groupBy(ids, (id) => layerValue(players[id], layer));
    if (groups.length === 1) return resolveGroup(ids, players, tiebreakers, idx + 1, path);
    const out = [];
    for (const group of groups) {
      const newPath = [...path, { layer, value: displayValue(players[group[0]], layer) }];
      if (group.length === 1) out.push({ ids: group, resolvedBy: layer, path: newPath });
      else out.push(...resolveGroup(group, players, tiebreakers, idx + 1, newPath));
    }
    return out;
  }
  function rankStandings(players, primaryMetric, tiebreakers = []) {
    const byPoints = groupBy(Object.keys(players), (id) => primaryMetric(players[id]));
    const groups = [];
    for (const ids of byPoints) {
      if (ids.length === 1 || !tiebreakers.length) {
        groups.push({ ids, resolvedBy: null, path: [] });
      } else {
        groups.push(...resolveGroup(ids, players, tiebreakers, 0, []));
      }
    }
    let rank = 1;
    const result = [];
    for (const g of groups) {
      for (const id of g.ids) result.push({ id, rank, points: primaryMetric(players[id]), tied: g.ids.length > 1, resolvedBy: g.resolvedBy, layers: g.path });
      rank += g.ids.length;
    }
    return result;
  }

  // src/features/standings.js
  function setBoardSeason(v) {
    state.boardSeason = v;
    renderBoard();
  }
  async function renderBoard() {
    var _a, _b, _c, _d;
    clearTimersFor("board");
    state.tab = "board";
    markTab();
    const [sc, allShows, seasons] = await Promise.all([
      rpc("get_bracket_scores", { p_name: state.session.name, p_pin: state.session.pin, p_bracket_id: state.currentBracketId }),
      fetchShows((q) => q),
      rpc("get_bracket_seasons", { p_bracket_id: state.currentBracketId })
    ]);
    let pname = Object.fromEntries((sc || []).map((s) => [s.player_id, s.player_name]));
    const showsById = Object.fromEntries((allShows || []).map((sh) => [sh.id, sh]));
    const today = (/* @__PURE__ */ new Date()).toLocaleDateString("sv");
    if (state.boardSeason === null) {
      const active = (seasons || []).find((se) => se.start_date <= today && today <= se.end_date);
      const graceFloor = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
      const recentlyEnded = (seasons || []).filter((se) => se.end_date < today && se.end_date >= graceFloor).reduce((best, se) => !best || se.end_date > best.end_date ? se : best, null);
      const cur = active || recentlyEnded;
      state.boardSeason = cur ? String(cur.id) : "all";
    }
    const season = (seasons || []).find((se) => String(se.id) === state.boardSeason);
    const tiebreakers = ((_a = currentBracket()) == null ? void 0 : _a.bracket_kind) === "official" && season ? ((_b = state.cfg) == null ? void 0 : _b.tiebreakers) || [] : [];
    const ORDINAL = ["1st", "2nd", "3rd"];
    let rosterJoinDates = {}, rosterIds = [];
    if (season && ((_c = currentBracket()) == null ? void 0 : _c.bracket_kind) === "official") {
      const roster = await rpc("get_season_roster", { p_name: state.session.name, p_pin: state.session.pin, p_season_id: season.id });
      rosterJoinDates = Object.fromEntries((roster || []).map((r) => [r.player_id, String(r.added_at).slice(0, 10)]));
      rosterIds = (roster || []).map((r) => r.player_id);
      pname = { ...Object.fromEntries((roster || []).map((r) => [r.player_id, r.name])), ...pname };
    }
    const T = computeStandings({ scoreRows: sc || [], showsById, season, rosterJoinDates, rosterIds });
    const order = rankStandings(T, (p) => season ? p.scoped : p.career, tiebreakers);
    for (let i = 0; i < order.length; ) {
      let j = i;
      while (j < order.length && order[j].rank === order[i].rank) j++;
      if (j - i > 1) order.slice(i, j).sort((a, b) => (pname[a.id] || "").localeCompare(pname[b.id] || "")).forEach((o, k) => order[i + k] = o);
      i = j;
    }
    const rows = order.map((o) => [o.id, T[o.id]]);
    const opts = [
      ...(seasons || []).map((se) => `<option value="${se.id}" ${state.boardSeason === String(se.id) ? "selected" : ""}>${esc(se.name)}</option>`),
      `<option value="all" ${state.boardSeason === "all" ? "selected" : ""}>All time</option>`
    ].join("");
    const scopeName = season ? esc(season.name) : "All time";
    const isOfficial = ((_d = currentBracket()) == null ? void 0 : _d.bracket_kind) === "official";
    const tierFor = (o) => o.rank === 1 ? "gold" : o.rank === 2 ? "silver" : "bronze";
    const narrow = window.matchMedia("(max-width:420px)").matches;
    const bigPx = narrow ? 76 : 118, smallPx = narrow ? 54 : 82;
    const podBox = (o, big) => `<div class="pod ${big ? "first" : ""}">${isOfficial ? trophy(big ? bigPx : smallPx, tierFor(o)) : rankNumeral(big ? bigPx : smallPx, tierFor(o), o.rank)}<b>${esc(pname[o.id] || "?")}</b></div>`;
    const podiumEntries = order.filter((o) => o.rank <= 3);
    const topGroup = podiumEntries.filter((o) => o.rank === 1);
    const isElevated = (o) => o.rank === 1 && topGroup.length <= 2;
    const hasAnyScore = order.some((o) => o.points > 0);
    const placeholderBox = (tier, rank, big) => `<div class="pod ${big ? "first" : ""}">${isOfficial ? trophy(big ? bigPx : smallPx, tier) : rankNumeral(big ? bigPx : smallPx, tier, rank)}</div>`;
    const RANK_GROUP_MAX = 4;
    const tiers = [];
    for (const o of podiumEntries) {
      const t = tiers[tiers.length - 1];
      if (t && t.rank === o.rank) t.items.push(o);
      else tiers.push({ rank: o.rank, items: [o] });
    }
    const boxedTiers = tiers.filter((t) => t.items.length <= RANK_GROUP_MAX);
    const compactTiers = tiers.filter((t) => t.items.length > RANK_GROUP_MAX);
    const boxedHtml = boxedTiers.length ? `<div class="podium">${boxedTiers.flatMap((t) => t.items).map((o) => podBox(o, isElevated(o))).join("")}</div>` : "";
    const compactHtml = compactTiers.length ? `<div class="podium-compact">${compactTiers.map((t) => `<div class="pod-row">${isOfficial ? trophy(32, tierFor(t.items[0])) : rankNumeral(32, tierFor(t.items[0]), t.rank)}<span class="pod-names">${t.items.map((o) => esc(pname[o.id] || "?")).join(", ")}</span></div>`).join("")}</div>` : "";
    const podium = !order.length ? "" : !hasAnyScore ? `<div class="podium">${placeholderBox("silver", 2, false)}${placeholderBox("gold", 1, true)}${placeholderBox("bronze", 3, false)}</div>` : `<div class="podium-wrap">${boxedHtml}${compactHtml}</div>`;
    const statRows = rows.filter(([, r]) => r.shows > 0).sort((a, b) => b[1].scoped / b[1].shows - a[1].scoped / a[1].shows);
    $("#main").innerHTML = `
    <div class="panel">
      <div class="row"><h2 style="margin:0">${isOfficial ? "Official Standings" : "Standings"}</h2>
        <select onchange="setBoardSeason(this.value)"
          style="margin-left:auto;background:var(--pit);border:1px solid var(--line2);color:var(--cream);border-radius:8px;padding:6px 8px;font-size:.82rem">${opts}</select></div>
      ${podium}
      <div style="overflow-x:auto"><table class="lb"><tr><th></th><th>Player</th><th style="text-align:right">Score</th></tr>
      ${order.map((o) => {
      const r = T[o.id];
      const layerLines = !hasAnyScore ? "" : (o.layers || []).map((l) => `<div class="muted" style="font-size:.72rem">${ORDINAL[tiebreakers.indexOf(l.layer)]} tiebreak: ${esc(TIEBREAK_SHORT_LABELS[l.layer])} (${l.value})</div>`).join("");
      return `<tr class="${o.id === state.session.id ? "me" : ""}">
        <td class="rank">${o.rank}</td><td>${esc(pname[o.id] || "?")}${layerLines}</td>
        <td class="pts">${season ? r.scoped : r.career}</td></tr>`;
    }).join("") || '<tr><td colspan="3" class="muted">No scores yet \u2014 pick some songs.</td></tr>'}
      </table></div>
      ${tiebreakers.length ? `<p class="muted" style="margin-top:8px;font-size:.75rem;text-align:center">Tiebreakers<br>${tiebreakers.map((l, i) => `${ORDINAL[i]}: ${esc(TIEBREAK_SHORT_LABELS[l])}`).join(" \xB7 ")}</p>` : ""}
    </div>
    <div class="panel"><h2>Nerd stats <span class="muted" style="font-size:.78rem">\xB7 ${scopeName}</span></h2>
      <div style="overflow-x:auto"><table class="lb compact"><tr><th>Player</th><th style="text-align:right">Shows</th><th style="text-align:right">Avg</th><th style="text-align:right">High</th><th style="text-align:right">${winBadge(18)}</th></tr>
      ${statRows.map(([id, r]) => {
      var _a2;
      return `<tr class="${id === state.session.id ? "me" : ""}">
        <td>${esc(pname[id] || "?")}</td><td class="pts">${r.shows}</td>
        <td class="pts">${(r.scoped / r.shows).toFixed(1)}</td>
        <td class="pts" title="${esc(((_a2 = r.highShow) == null ? void 0 : _a2.venue) || "")}">${r.high}</td>
        <td class="pts">${r.wins || 0}</td></tr>`;
    }).join("") || '<tr><td colspan="5" class="muted">Stats appear once shows score.</td></tr>'}
      </table></div>
      <p class="muted" style="margin-top:8px;font-size:.75rem">Avg = points per show played \xB7 High = best single show (venue on hover) \xB7 wreath = shows won</p>
    </div>
    ${footerHtml()}`;
  }

  // src/features/settings.js
  function settingsPanelHtml() {
    return `<div class="panel"><h2>Settings</h2>
    <div class="field"><label>Bracket</label><div class="switcher" id="bracketToggle"></div></div>
    <div id="leagueSelect"></div>
    <button class="btn ghost" onclick="logout()">Log out</button>
    <div class="credits">
      <p>Fantasy Eggy is an unofficial fan project \u2014 not affiliated with, endorsed by, or sponsored by Eggy or their management. Band names and song titles belong to their respective owners.</p>
      <p>Setlist data from <a href="https://thecarton.net" target="_blank" rel="noopener">The Carton</a>.</p>
      <p class="merch-plug"><a href="https://shop.eggymusic.com/" target="_blank" rel="noopener">Grab some merch</a> \u2014 it goes a long way toward keeping the band on the road.</p>
      <p class="colophon">Created by Kyle McKinley</p>
    </div>
  </div>`;
  }
  function wireSettingsPanel() {
    renderBracketToggle();
    renderLeagueSelector();
  }
  async function renderSettings() {
    clearTimersFor("admin");
    state.tab = "admin";
    markTab();
    $("#main").innerHTML = settingsPanelHtml() + footerHtml();
    wireSettingsPanel();
  }

  // src/core/venueTime.js
  function offsetMinutesAt(ms, tz) {
    var _a;
    const val = ((_a = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "shortOffset" }).formatToParts(new Date(ms)).find((p) => p.type === "timeZoneName")) == null ? void 0 : _a.value) || "GMT+0";
    const m = val.match(/GMT([+-]\d+)(?::(\d+))?/);
    if (!m) return 0;
    const h = parseInt(m[1], 10), min = parseInt(m[2] || "0", 10);
    return h * 60 + (h < 0 ? -min : min);
  }
  function venueLocalInputValue(cutoffISO, tz) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }).formatToParts(new Date(cutoffISO));
    const get = (t) => {
      var _a;
      return (_a = parts.find((p) => p.type === t)) == null ? void 0 : _a.value;
    };
    let hh = get("hour");
    if (hh === "24") hh = "00";
    return `${get("year")}-${get("month")}-${get("day")}T${hh}:${get("minute")}`;
  }
  function venueLocalToUTC(naiveLocalStr, tz) {
    const [datePart] = naiveLocalStr.split("T");
    const noonUTC = Date.parse(`${datePart}T12:00:00Z`);
    const offMin = offsetMinutesAt(noonUTC, tz);
    const asIfUTC = Date.parse(`${naiveLocalStr}:00Z`);
    return new Date(asIfUTC - offMin * 6e4).toISOString();
  }
  function venueAbbrev(cutoffISO, tz) {
    var _a;
    return ((_a = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", timeZoneName: "short" }).formatToParts(new Date(cutoffISO)).find((p) => p.type === "timeZoneName")) == null ? void 0 : _a.value) || "";
  }
  function venueLongName(cutoffISO, tz) {
    var _a;
    const val = ((_a = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", timeZoneName: "long" }).formatToParts(new Date(cutoffISO)).find((p) => p.type === "timeZoneName")) == null ? void 0 : _a.value) || "";
    if (!val || /^GMT/.test(val)) return venueAbbrev(cutoffISO, tz);
    return val.endsWith(" Time") ? val.slice(0, -5) : val;
  }
  function hasDstTransition(naiveLocalStr, tz) {
    const [datePart] = naiveLocalStr.split("T");
    const start = Date.parse(`${datePart}T00:00:00Z`);
    const end = Date.parse(`${datePart}T23:59:00Z`);
    return offsetMinutesAt(start, tz) !== offsetMinutesAt(end, tz);
  }

  // src/features/admin.js
  function officialBracketId() {
    var _a;
    return (_a = state.leagues.find((l) => l.league_id === state.currentLeagueId && l.bracket_kind === "official")) == null ? void 0 : _a.bracket_id;
  }
  var sectionState = {};
  try {
    sectionState = JSON.parse(localStorage.getItem("ft_admin_sections") || "{}");
  } catch (e) {
    sectionState = {};
  }
  function sectionOpen(key) {
    return !!sectionState[key];
  }
  function toggleSection(key) {
    sectionState[key] = !sectionOpen(key);
    localStorage.setItem("ft_admin_sections", JSON.stringify(sectionState));
    const body = $("#sec-" + key), btn = $("#sec-btn-" + key);
    if (body) body.classList.toggle("hidden", !sectionState[key]);
    if (btn) btn.textContent = sectionState[key] ? "hide" : "show";
  }
  function collapsible(key, title, bodyHtml, alwaysVisible = "") {
    const open = sectionOpen(key);
    return `<div class="panel">
    <div class="row"><h2 style="margin:0">${title}</h2>
      <button class="linkbtn" id="sec-btn-${key}" onclick="toggleSection('${key}')" style="margin-left:auto">${open ? "hide" : "show"}</button></div>
    ${alwaysVisible}
    <div id="sec-${key}" class="${open ? "" : "hidden"}">${bodyHtml}</div>
  </div>`;
  }
  async function renderAdmin() {
    var _a, _b, _c, _d, _e;
    clearTimersFor("admin");
    state.tab = "admin";
    markTab();
    await loadConfig();
    const cfg = state.cfg;
    const b = cfg.bonuses || {};
    const os = cfg.oneset || { slots: [
      { key: "opener", type: "opener", label: "Opener", points: 2 },
      { key: "closer", type: "closer", label: "Closer", points: 2 },
      { key: "cover1", type: "cover_pick", label: "Cover Pick", points: 2 }
    ], flat_picks: 3, flat_points: 1 };
    const [shows, seasonsA] = await Promise.all([
      fetchShows((q) => q.gte("showdate", new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10)).order("showdate")),
      rpc("get_bracket_seasons", { p_bracket_id: officialBracketId() })
    ]);
    const todayA = (/* @__PURE__ */ new Date()).toLocaleDateString("sv");
    const nextShow = (shows || []).find((sh) => sh.showdate >= todayA) || (shows || [])[(shows || []).length - 1];
    const uncoveredShows = (shows || []).filter((sh) => sh.showdate >= todayA && !(seasonsA || []).some((se) => se.start_date <= sh.showdate && sh.showdate <= se.end_date));
    const seasonWarning = uncoveredShows.length ? `<div class="noticebox">
      \u26A0\uFE0F Official has no season covering ${uncoveredShows.length === 1 ? "an upcoming show" : uncoveredShows.length + " upcoming shows"} \u2014
      picks will be blocked there until a season is added: ${uncoveredShows.map((sh) => {
      const [, m, d] = sh.showdate.split("-");
      return `${Number(m)}/${Number(d)}`;
    }).join(", ")}</div>` : "";
    $("#main").innerHTML = `
    <div class="panel"><h2>Who's picked</h2>
      <div class="field"><label>Show</label>
        <select id="roster-show" onchange="loadRoster()">
          ${(shows || []).map((sh) => `<option value="${sh.id}" ${nextShow && sh.id === nextShow.id ? "selected" : ""}>${fmtDate(sh.showdate)} \u2014 ${esc(sh.venue || "TBA")}</option>`).join("")}
        </select></div>
      <div id="roster"><p class="muted">Pick a show.</p></div>
    </div>
    ${collapsible("master", "Master switch", `
      <div class="field"><label>Voting override</label>
        <select id="c-override">
          <option value="auto" ${(cfg.voting_override || "auto") === "auto" ? "selected" : ""}>Auto \u2014 cutoffs decide</option>
          <option value="locked" ${cfg.voting_override === "locked" ? "selected" : ""}>Locked \u2014 nobody can vote</option>
          <option value="open" ${cfg.voting_override === "open" ? "selected" : ""}>Open \u2014 voting open for today + future shows</option>
        </select></div>
      <p class="muted">Enforced in the database, saved with the rules below. Auto is normal operation.</p>
    `)}
    ${collapsible("seasons", "Seasons", `
      <p class="muted">Named date ranges \u2014 shows sort themselves in by date.</p>
      <div id="seasonrows">${(seasonsA || []).map(seasonRow).join("")}</div>
      <button class="btn ghost small" onclick="addSeasonRow()">+ add season</button>
    `, seasonWarning)}
    ${((_a = currentBracket()) == null ? void 0 : _a.bracket_kind) === "official" ? collapsible("tiebreakers", "Season tiebreakers", `
      <p class="muted">Applies only to Official's season standings, when a season ends with players tied on points. Tried in order \u2014 the first layer that separates two players decides. Leave all "None", or exhaust every layer without a difference, and they share the placing \u2014 same as a per-show tie.</p>
      <div class="grid2">
        ${[0, 1, 2].map((i) => tiebreakerSelectRow(i, (cfg.tiebreakers || [])[i] || "")).join("")}
      </div>
      <p class="muted" style="margin-top:6px;font-size:.78rem">Fewest zeros \u2014 any show in scope worth 0 points, including one never picked at all, counts against you (scoped from when you joined the season roster, not the season's start). Most wins \u2014 per-show ties still share the crown. Highest single-show score.</p>
    `) : ""}
    ${collapsible("rules-standard", "Game rules \u2014 standard shows", `
      <p class="muted">Slotted picks (position matters):</p>
      <div id="slots">${(cfg.slots || []).map((sl) => adminSlotRow(sl, "standard")).join("")}</div>
      <button class="btn ghost small" onclick="addSlot('slots')">+ add slot</button>
      <div class="grid2" style="margin-top:14px">
        <div class="field"><label>Flat picks (count)</label><input id="c-flat" type="number" min="0" value="${cfg.flat_picks}"></div>
        <div class="field"><label>Points per flat pick</label><input id="c-flatpts" type="number" min="0" value="${cfg.flat_points}"></div>
        <div class="field"><label>Partial credit (slot song played elsewhere)</label>
          <select id="c-partial"><option value="true" ${cfg.partial_credit ? "selected" : ""}>On</option><option value="false" ${!cfg.partial_credit ? "selected" : ""}>Off</option></select></div>
        <div class="field"><label>Partial points</label><input id="c-partpts" type="number" min="0" value="${cfg.partial_points}"></div>
        <div class="field"><label>Bonus: cover</label><input id="c-bcover" type="number" min="0" value="${b.cover || 0}"></div>
        <div class="field"><label>Bonus: debut</label><input id="c-bdebut" type="number" min="0" value="${b.debut || 0}"></div>
        <div class="field"><label>Bonus: perfect sheet (every pick hits)</label><input id="c-bperfect" type="number" min="0" value="${b.perfect || 0}"></div>
        <div class="field"><label>Allow duplicate songs across picks</label>
          <select id="c-dupes"><option value="false" ${!cfg.allow_duplicates ? "selected" : ""}>No</option><option value="true" ${cfg.allow_duplicates ? "selected" : ""}>Yes</option></select></div>
        <div class="field"><label>Wildcard: "Any Debut" (hits if any debut is played)</label>
          <select id="c-wcdebut"><option value="true" ${((_c = (_b = cfg.wildcards) == null ? void 0 : _b.debut) != null ? _c : true) ? "selected" : ""}>Players may pick it</option><option value="false" ${((_e = (_d = cfg.wildcards) == null ? void 0 : _d.debut) != null ? _e : true) ? "" : "selected"}>Off</option></select></div>
      </div>
    `)}
    ${collapsible("rules-oneset", "Game rules \u2014 one-set shows", `
      <p class="muted">Used for shows toggled to "1 set" below. Festival-tagged shows sync in as 1 set automatically.</p>
      <div id="slots1">${(os.slots || []).map((sl) => adminSlotRow(sl, "one_set")).join("")}</div>
      <button class="btn ghost small" onclick="addSlot('slots1')">+ add slot</button>
      <div class="grid2" style="margin-top:14px">
        <div class="field"><label>Flat picks (count)</label><input id="c1-flat" type="number" min="0" value="${os.flat_picks}"></div>
        <div class="field"><label>Points per flat pick</label><input id="c1-flatpts" type="number" min="0" value="${os.flat_points}"></div>
      </div>
    `)}
    <div class="panel">
      <button class="btn" onclick="saveConfig()">Save all rules</button>
      <div class="err" id="cfg-err"></div>
      <p class="muted" style="margin-top:6px">Rule changes apply on the next scoring run. Don't change mid-show unless you enjoy arguments. Saves both rule sections above, whether or not they're currently expanded.</p>
    </div>
    ${collapsible("shows", "Shows & cutoffs", `
      <p class="muted">Cutoffs are shown and edited in each show's venue-local time. New shows default to 6 PM venue-local.</p>
      ${(shows || []).map((sh) => {
      const tz = sh.timezone || null;
      const inputVal = !sh.cutoff_at ? "" : tz ? venueLocalInputValue(sh.cutoff_at, tz) : new Date(new Date(sh.cutoff_at).getTime() - (/* @__PURE__ */ new Date()).getTimezoneOffset() * 6e4).toISOString().slice(0, 16);
      const zoneLabel = !sh.cutoff_at ? "" : tz ? `<div class="muted" style="font-size:.75rem;margin:8px 0 2px">Timezone: <b style="color:var(--cream)">${esc(venueLongName(sh.cutoff_at, tz))}</b>${hasDstTransition(inputVal, tz) ? ' <span style="color:var(--coral)">\u26A0 DST changes on this date \u2014 double-check this time</span>' : ""}</div>` : `<div class="muted" style="font-size:.75rem;margin:8px 0 2px"><span style="color:var(--coral)">Device time \u2014 venue timezone unknown</span></div>`;
      return `<div class="arow">
        <div class="arow-head"><span class="date">${fmtDate(sh.showdate)}</span><span class="venue">${esc(sh.venue || "TBA")}</span></div>
        ${zoneLabel}
        <input class="cutoff-in" type="datetime-local" step="900" data-show="${sh.id}" data-tz="${tz || ""}" value="${inputVal}">
        <div class="switcher" style="margin-bottom:8px" title="pick sheet format">
          <button class="linkbtn switcher-btn${sh.format !== "one_set" ? " on" : ""}" onclick="toggleFormat(${sh.id}, 'standard')">2 set</button>
          <button class="linkbtn switcher-btn${sh.format === "one_set" ? " on" : ""}" onclick="toggleFormat(${sh.id}, 'one_set')">1 set</button>
        </div>
        <div class="arow-btns">
          <button onclick="saveCutoff(${sh.id}, this)">Change cutoff</button>
          ${sh.status !== "final" && sh.cutoff_at && new Date(sh.cutoff_at) < /* @__PURE__ */ new Date() ? '<button onclick="finalizeShow(' + sh.id + ', this)" style="border-color:var(--coral);color:var(--coral)">Finalize</button>' : ""}
          ${sh.status === "final" ? '<button onclick="reopenShow(' + sh.id + ', this)" style="border-color:var(--coral);color:var(--coral)">Reopen</button>' : ""}
        </div>
      </div>`;
    }).join("") || '<p class="muted">No shows \u2014 sync first.</p>'}
    `)}
    ${collapsible("members", "Members", `
      <div class="field"><label>Add a member</label>
        <input id="member-search" placeholder="Search registered players by name\u2026" oninput="searchMembers()" autocomplete="off"></div>
      <div id="member-results"></div>
      <div id="playerlist"><p class="muted">Loading\u2026</p></div>
      <button class="linkbtn" id="banToggle" onclick="toggleBans()" style="margin-top:8px">show ban list</button>
      <div id="banlist" class="hidden" style="margin-top:6px"></div>
    `)}
    ${collapsible("data", "Data", `
      <div class="row">
        <button class="btn ghost small" onclick="runEdge('sync_shows', this)">Sync shows</button>
        <button class="btn ghost small" onclick="runEdge('sync_songs', this)">Sync song catalog</button>
        <button class="btn ghost small" onclick="runEdge('score', this)">Run scoring now</button>
      </div>
      <p class="muted" style="margin-top:8px">Scoring also runs automatically on the cron schedule. These are manual overrides.</p>
    `)}
    ${settingsPanelHtml()}
    ${footerHtml()}`;
    if ((shows || []).length) loadRoster();
    loadMembers();
    wireSettingsPanel();
  }
  async function loadMembers() {
    const rows = await rpc("admin_list_members", { p_name: state.session.name, p_pin: state.session.pin, p_league_id: state.currentLeagueId });
    $("#playerlist").innerHTML = (rows || []).map((p) => `
    <div class="pickres hit"><span>${p.is_league_admin ? "\u2605" : "\xB7"}</span>
      <span>${esc(p.name)}${p.official_opt_in ? ' <small class="muted">Official</small>' : ""}</span>
      <span class="pt">${p.player_id === state.session.id ? '<small class="muted">you</small>' : (p.is_league_admin ? '<small class="muted">admin</small> ' : "") + `<button class="btn ghost small" onclick="bootPlayer('` + p.player_id + "', '" + esc(p.name).replace(/'/g, "\\'") + `')" style="border-color:var(--coral);color:var(--coral)">Boot</button>`}</span>
    </div>`).join("") || '<p class="muted">Nobody here yet.</p>';
  }
  async function searchMembers() {
    const q = $("#member-search").value.trim();
    if (q.length < 2) {
      $("#member-results").innerHTML = "";
      return;
    }
    try {
      const rows = await rpc("admin_find_players", { p_name: state.session.name, p_pin: state.session.pin, p_league_id: state.currentLeagueId, p_query: q });
      $("#member-results").innerHTML = (rows || []).map((p) => `
      <div class="pickres">
        <span>${esc(p.name)}</span>
        <span class="pt"><button class="btn ghost small" onclick="addMember('${p.player_id}', '${esc(p.name).replace(/'/g, "\\'")}')">Add</button></span>
      </div>`).join("") || '<p class="muted">No matches.</p>';
    } catch (e) {
      $("#member-results").innerHTML = `<p class="err">${esc(e.message)}</p>`;
    }
  }
  async function addMember(id, name) {
    try {
      await rpc("admin_add_league_member", { p_name: state.session.name, p_pin: state.session.pin, p_league_id: state.currentLeagueId, p_player_id: id });
      toast(`${name} added`, "score");
      $("#member-search").value = "";
      $("#member-results").innerHTML = "";
      loadMembers();
    } catch (e) {
      toast(esc(e.message));
    }
  }
  function seasonRow(se) {
    const v = se || { id: "", name: "", start_date: "", end_date: "" };
    return `<div class="admin-slot" data-season="${v.id}">
    <input class="k" placeholder="Name (e.g. Summer Tour 2026)" value="${esc(v.name)}">
    <input type="date" value="${v.start_date}" style="width:130px">
    <input type="date" value="${v.end_date}" style="width:130px">
    <button class="btn ghost small" onclick="saveSeason(this.parentElement)">Save</button>
    ${v.id ? `<button class="btn ghost small" onclick="deleteSeason(${v.id})" style="border-color:var(--coral);color:var(--coral)">\u2715</button>` : ""}
  </div>
  ${v.id ? `<div style="margin:0 0 10px">
    <button class="linkbtn" id="roster-toggle-${v.id}" onclick="toggleRoster(${v.id})">manage roster</button>
    <div id="roster-panel-${v.id}" class="hidden" style="margin-top:6px"></div>
  </div>` : ""}`;
  }
  var rosterOpen = {};
  async function renderRosterPanel(seasonId) {
    const panel = $("#roster-panel-" + seasonId);
    if (!panel) return;
    panel.innerHTML = '<p class="muted">Loading\u2026</p>';
    try {
      const [members, roster] = await Promise.all([
        rpc("admin_list_members", { p_name: state.session.name, p_pin: state.session.pin, p_league_id: state.currentLeagueId }),
        rpc("admin_list_season_roster", { p_name: state.session.name, p_pin: state.session.pin, p_season_id: seasonId })
      ]);
      const onRoster = new Set((roster || []).map((r) => r.player_id));
      panel.innerHTML = (members || []).map((m) => `
      <div class="pickres ${onRoster.has(m.player_id) ? "hit" : "miss"}">
        <span>${onRoster.has(m.player_id) ? "\u2714" : "\u2014"}</span><span>${esc(m.name)}</span>
        <span class="pt"><button class="btn ghost small" onclick="setRosterMember(${seasonId}, '${m.player_id}', ${!onRoster.has(m.player_id)})">${onRoster.has(m.player_id) ? "Remove" : "Add"}</button></span>
      </div>`).join("") || '<p class="muted">No members in this league yet.</p>';
    } catch (e) {
      panel.innerHTML = `<p class="err">${esc(e.message)}</p>`;
    }
  }
  async function toggleRoster(seasonId) {
    rosterOpen[seasonId] = !rosterOpen[seasonId];
    const toggleBtn = $("#roster-toggle-" + seasonId), panel = $("#roster-panel-" + seasonId);
    if (toggleBtn) toggleBtn.textContent = rosterOpen[seasonId] ? "hide roster" : "manage roster";
    if (panel) panel.classList.toggle("hidden", !rosterOpen[seasonId]);
    if (rosterOpen[seasonId]) renderRosterPanel(seasonId);
  }
  async function setRosterMember(seasonId, playerId, add) {
    try {
      await rpc("admin_set_season_roster", { p_name: state.session.name, p_pin: state.session.pin, p_season_id: seasonId, p_player_id: playerId, p_add: add });
      toast(add ? "Added to roster" : "Removed from roster", "score");
      renderRosterPanel(seasonId);
    } catch (e) {
      toast(esc(e.message));
    }
  }
  function addSeasonRow() {
    $("#seasonrows").insertAdjacentHTML("beforeend", seasonRow(null));
  }
  async function saveSeason(row) {
    const [name, start, end] = [...row.querySelectorAll("input")].map((i) => i.value);
    const id = row.dataset.season ? Number(row.dataset.season) : null;
    try {
      await rpc("admin_save_season", { p_name: state.session.name, p_pin: state.session.pin, p_bracket_id: officialBracketId(), p_id: id, p_sname: name, p_start: start || null, p_end: end || null });
      toast("Season saved \u2714", "score");
      state.boardSeason = null;
      renderAdmin();
    } catch (e) {
      toast(esc(e.message));
    }
  }
  async function deleteSeason(id) {
    if (!confirm("Delete this season? Scores are untouched \u2014 only the grouping goes away.")) return;
    try {
      await rpc("admin_delete_season", { p_name: state.session.name, p_pin: state.session.pin, p_id: id });
      toast("Season deleted", "score");
      state.boardSeason = null;
      renderAdmin();
    } catch (e) {
      toast(esc(e.message));
    }
  }
  var bansOpen = false;
  async function toggleBans() {
    bansOpen = !bansOpen;
    $("#banToggle").textContent = bansOpen ? "hide ban list" : "show ban list";
    $("#banlist").classList.toggle("hidden", !bansOpen);
    if (!bansOpen) return;
    $("#banlist").innerHTML = '<p class="muted">Loading\u2026</p>';
    try {
      const rows = await rpc("admin_list_bans", { p_name: state.session.name, p_pin: state.session.pin, p_league_id: state.currentLeagueId });
      $("#banlist").innerHTML = (rows || []).map((r) => `
      <div class="pickres miss"><span>\u26D4</span><span>${esc(r.name)}</span>
        <span class="pt"><small class="muted">${new Date(r.banned_at).toLocaleDateString()}</small>
          <button class="btn ghost small" onclick="unban('${esc(r.name).replace(/'/g, "\\'")}')">Unban</button></span>
      </div>`).join("") || '<p class="muted">Nobody is banned. A peaceful kingdom.</p>';
    } catch (e) {
      $("#banlist").innerHTML = `<p class="err">${esc(e.message)}</p>`;
    }
  }
  async function unban(name) {
    if (!confirm(`Unban "${name}"? The name becomes registerable again.`)) return;
    try {
      await rpc("admin_unban", { p_name: state.session.name, p_pin: state.session.pin, p_league_id: state.currentLeagueId, p_banned: name });
      toast(`${name} unbanned`, "score");
      bansOpen = false;
      toggleBans();
    } catch (e) {
      toast(esc(e.message));
    }
  }
  async function bootPlayer(id, name) {
    if (!confirm(`Remove ${name} from this league? Their past picks/scores stay on the books \u2014 they just stop being able to submit new ones.`)) return;
    const ban = confirm(`Also block the name "${name}" from rejoining this league?

OK = remove + ban \xB7 Cancel = remove only`);
    try {
      await rpc("admin_league_boot", { p_name: state.session.name, p_pin: state.session.pin, p_league_id: state.currentLeagueId, p_player_id: id, p_ban: ban });
      toast(`${name} removed${ban ? " and banned" : ""}`, "score");
      loadMembers();
      loadRoster();
    } catch (e) {
      toast(esc(e.message));
    }
  }
  async function toggleFormat(showId, next) {
    try {
      await rpc("admin_set_show_format", { p_name: state.session.name, p_pin: state.session.pin, p_league_id: state.currentLeagueId, p_show_id: showId, p_format: next });
      toast("Format: " + (next === "one_set" ? "1 set" : "2 set"), "score");
      renderAdmin();
    } catch (e) {
      toast(esc(e.message));
    }
  }
  async function loadRoster() {
    const showId = Number($("#roster-show").value);
    if (!showId) return;
    try {
      const rows = await rpc("admin_pick_status", { p_name: state.session.name, p_pin: state.session.pin, p_bracket_id: state.currentBracketId, p_show_id: showId });
      const total = rows.length, done = rows.filter((r) => r.picks_count > 0).length;
      $("#roster").innerHTML = `
      <p class="muted" style="margin-bottom:6px"><b style="color:var(--mint)">${done}</b> of ${total} players have picks in</p>
      ${rows.map((r) => `<div class="pickres ${r.picks_count > 0 ? "hit" : "miss"}">
        <span>${r.picks_count > 0 ? "\u2714" : "\u2014"}</span><span>${esc(r.player_name)}</span>
        <span class="pt">${r.picks_count > 0 ? r.picks_count + " picks \xB7 saved " + new Date(r.last_saved).toLocaleString(void 0, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "no picks yet"}</span>
      </div>`).join("")}`;
    } catch (e) {
      $("#roster").innerHTML = `<p class="err">${esc(e.message)}</p>`;
    }
  }
  function adminSlotRow(sl, format) {
    const t = sl.type || sl.key;
    const excluded = format === "one_set" ? ONE_SET_EXCLUDED_TYPES : [];
    let opts = Object.keys(SLOT_LABELS).filter((k) => !excluded.includes(k)).map((k) => `<option value="${k}" ${k === t ? "selected" : ""}>${esc(slotLabelFor(k, format))} \u2014 ${esc(SLOT_TOOLTIPS[k])}</option>`).join("");
    if (t && !(t in SLOT_LABELS)) opts += `<option value="${esc(t)}" selected>${esc(t)} (legacy)</option>`;
    return `<div class="admin-slot">
    <select class="k" title="which position this slot scores against">${opts}</select>
    <input class="p" type="number" min="0" value="${sl.points}">
    <button class="btn ghost small" onclick="this.parentElement.remove()">\u2715</button></div>`;
  }
  function addSlot(target) {
    const format = target === "slots1" ? "one_set" : "standard";
    $("#" + target).insertAdjacentHTML("beforeend", adminSlotRow({ key: "encore", points: 2 }, format));
  }
  function readSlots(containerId) {
    let coverN = 0;
    return [...document.querySelectorAll("#" + containerId + " .admin-slot")].map((r) => {
      const type = r.querySelector("select.k").value;
      const points = Number(r.querySelector("input.p").value);
      const key = type === "cover_pick" ? "cover" + ++coverN : type;
      return { key, type, points };
    }).filter((sl) => sl.type);
  }
  function tiebreakerSelectRow(idx, current) {
    const opts = ["", ...Object.keys(TIEBREAK_LABELS)].map((k) => `<option value="${k}" ${k === current ? "selected" : ""}>${k ? esc(TIEBREAK_LABELS[k]) : "None"}</option>`).join("");
    return `<div class="field"><label>${["1st", "2nd", "3rd"][idx]} tiebreaker</label><select id="tb-${idx}">${opts}</select></div>`;
  }
  function readTiebreakers() {
    const els = [0, 1, 2].map((i) => $("#tb-" + i));
    if (!els[0]) return void 0;
    const seen = /* @__PURE__ */ new Set(), list = [];
    for (const el of els) {
      const v = el.value;
      if (v && !seen.has(v)) {
        seen.add(v);
        list.push(v);
      }
    }
    return list;
  }
  async function saveConfig() {
    $("#cfg-err").textContent = "";
    const slots = readSlots("slots"), slots1 = readSlots("slots1");
    for (const arr of [slots, slots1]) {
      const types = arr.filter((sl) => sl.type !== "cover_pick").map((sl) => sl.type);
      if (new Set(types).size !== types.length) {
        $("#cfg-err").textContent = "Each slot type (except Cover pick) can only be used once per section.";
        return;
      }
    }
    const tiebreakers = readTiebreakers();
    const data = {
      slots,
      flat_picks: Number($("#c-flat").value),
      flat_points: Number($("#c-flatpts").value),
      partial_credit: $("#c-partial").value === "true",
      partial_points: Number($("#c-partpts").value),
      allow_duplicates: $("#c-dupes").value === "true",
      voting_override: $("#c-override").value,
      bonuses: { cover: Number($("#c-bcover").value), debut: Number($("#c-bdebut").value), perfect: Number($("#c-bperfect").value), jamchart: 0 },
      wildcards: { debut: $("#c-wcdebut").value === "true" },
      oneset: { slots: slots1, flat_picks: Number($("#c1-flat").value), flat_points: Number($("#c1-flatpts").value) },
      ...tiebreakers !== void 0 ? { tiebreakers } : {}
    };
    try {
      await rpc("admin_update_config", { p_name: state.session.name, p_pin: state.session.pin, p_bracket_id: state.currentBracketId, p_data: data });
      state.cfg = data;
      toast("Rules saved \u2714", "score");
    } catch (e) {
      $("#cfg-err").textContent = e.message;
    }
  }
  async function saveCutoff(showId, btn) {
    const input = document.querySelector(`input[data-show="${showId}"]`);
    if (!input.value) return;
    const tz = input.dataset.tz;
    const cutoffISO = tz ? venueLocalToUTC(input.value, tz) : new Date(input.value).toISOString();
    try {
      await rpc("admin_set_cutoff", { p_name: state.session.name, p_pin: state.session.pin, p_league_id: state.currentLeagueId, p_show_id: showId, p_cutoff: cutoffISO });
      btn.textContent = "\u2714";
      setTimeout(() => btn.textContent = "Change cutoff", 1500);
    } catch (e) {
      toast(esc(e.message));
    }
  }
  async function finalizeShow(showId, btn) {
    if (!confirm("Run final scoring and mark this show complete? Picks and scores lock for good.")) return;
    btn.disabled = true;
    btn.textContent = "\u2026";
    try {
      await edgeFn("finalize", { p_name: state.session.name, p_pin: state.session.pin, league_id: state.currentLeagueId, show_id: showId });
      toast("Show finalized \u{1F3C1}", "score");
      renderAdmin();
    } catch (e) {
      toast(esc(e.message));
      btn.disabled = false;
      btn.textContent = "Finalize";
    }
  }
  async function reopenShow(showId, btn) {
    if (!confirm("Reopen this show? This league's scores for it are wiped and it goes back to live so scoring can run again \u2014 use this after correcting the setlist on The Carton, then Finalize once it's right.")) return;
    btn.disabled = true;
    btn.textContent = "\u2026";
    try {
      await edgeFn("reopen", { p_name: state.session.name, p_pin: state.session.pin, league_id: state.currentLeagueId, show_id: showId });
      toast("Show reopened", "score");
      renderAdmin();
    } catch (e) {
      toast(esc(e.message));
      btn.disabled = false;
      btn.textContent = "Reopen";
    }
  }
  async function runEdge(action, btn) {
    btn.disabled = true;
    const old = btn.textContent;
    btn.textContent = "\u2026";
    try {
      const r = await edgeFn(action);
      toast(esc(JSON.stringify(r).slice(0, 120)), "score");
      if (action === "sync_songs") loadSongs();
    } catch (e) {
      toast(esc(e.message));
    }
    btn.disabled = false;
    btn.textContent = old;
  }

  // src/core/layout.js
  var renderAdminOrSettings = () => isCurrentLeagueAdmin() ? renderAdmin() : renderSettings();
  function markTab() {
    document.querySelectorAll("nav.tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === state.tab));
  }
  document.querySelectorAll("nav.tabs button").forEach((b) => b.onclick = () => {
    ({ shows: enterShowsTab, board: renderBoard, admin: renderAdminOrSettings })[b.dataset.tab]();
  });
  async function renderAll() {
    if (!isDesktop()) {
      await renderShows();
      return;
    }
    applyLayout();
    const savedShow = state.currentShow;
    await renderBoard();
    await renderShows();
    await renderAdminOrSettings();
    state.currentShow = savedShow;
  }
  function applyLayout() {
    const desk = isDesktop();
    $("#cols") && ($("#cols").style.display = desk ? "grid" : "none");
    const c = document.getElementById("cols");
    if (c) {
      document.getElementById("col-admin").style.display = desk ? "" : "none";
      c.style.gridTemplateColumns = "1fr 1.15fr 1fr";
    }
  }
  var _lastDesk = isDesktop();
  window.addEventListener("resize", () => {
    const now = isDesktop();
    if (now === _lastDesk) return;
    _lastDesk = now;
    applyLayout();
    if (state.session) renderAll();
    else renderAuth();
  });

  // src/core/realtime.js
  var myLastPts = {};
  var channel = null;
  var visListenerAttached = false;
  function subscribeRealtime() {
    if (channel) db.removeChannel(channel);
    channel = db.channel(`live-${state.currentBracketId}`).on("postgres_changes", { event: "INSERT", schema: "public", table: "setlist_songs" }, (p) => {
      const s = p.new;
      toast(`\u{1F3B5} ${esc(s.songname)}${s.is_encore ? " (encore)" : ""}`, "", `song:${s.show_id}:${(s.songname || "").toLowerCase()}`);
      if (state.currentShow && state.tab !== "admin" && s.show_id === state.currentShow.id) openShow(state.currentShow.id);
    }).on("postgres_changes", { event: "UPDATE", schema: "public", table: "league_shows", filter: `league_id=eq.${state.currentLeagueId}` }, async (p) => {
      const ls = p.new;
      const fresh = (ts) => ts && Date.now() - new Date(ts).getTime() < 3 * 6e4;
      if (!fresh(ls.remind_sent) && !fresh(ls.lock_sent) && !fresh(ls.winner_sent)) return;
      const { data: sh } = await db.from("shows").select("*").eq("id", ls.show_id).single();
      if (!sh) return;
      if (fresh(ls.remind_sent)) {
        let mine = [];
        try {
          mine = await rpc("get_my_picks", { p_name: state.session.name, p_pin: state.session.pin, p_bracket_id: state.currentBracketId, p_show_id: sh.id });
        } catch (e) {
        }
        toast(mine.length ? `\u23F0 1 hour to cutoff \u2014 ${esc(sh.venue || sh.showdate)}. Your picks are in \u2714` : `\u23F0 1 hour to cutoff \u2014 ${esc(sh.venue || sh.showdate)}. You haven't voted!`, "", `remind:${sh.id}`);
      }
      if (fresh(ls.lock_sent))
        toast(`\u{1F512} All picks locked \u2014 ${esc(sh.venue || sh.showdate)}. Boards are public.`, "", `lock:${sh.id}`);
      if (fresh(ls.winner_sent)) {
        try {
          const sc = await rpc("get_bracket_scores", { p_name: state.session.name, p_pin: state.session.pin, p_bracket_id: state.currentBracketId, p_show_id: sh.id });
          const top = (sc || []).slice().sort((a, b) => b.points - a.points)[0];
          if (top) toast(`\u{1F3C6} ${esc(top.player_name || "?")} takes ${esc(sh.venue || sh.showdate)} with ${top.points} pts`, "score", `win:${sh.id}`);
        } catch (e) {
        }
      }
    }).on("postgres_changes", { event: "UPDATE", schema: "public", table: "seasons", filter: `bracket_id=eq.${state.currentBracketId}` }, (p) => {
      const se = p.new;
      if (se.winner_sent && Date.now() - new Date(se.winner_sent).getTime() < 3 * 6e4)
        toast(`\u{1F451} ${esc(se.name)} is in the books \u2014 check Standings for the podium`, "score", `season:${se.id}`);
    }).on("postgres_changes", { event: "*", schema: "public", table: "scores", filter: `bracket_id=eq.${state.currentBracketId}` }, (p) => {
      var _a, _b;
      if (((_a = p.new) == null ? void 0 : _a.player_id) === ((_b = state.session) == null ? void 0 : _b.id) && myLastPts[p.new.show_id] !== p.new.points) {
        myLastPts[p.new.show_id] = p.new.points;
        toast(`You're at ${p.new.points} pts for this show`, "score");
      }
      if (state.tab === "board") renderBoard();
    }).subscribe();
    if (!visListenerAttached) {
      visListenerAttached = true;
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible" && state.session) refreshCurrent();
      });
    }
  }
  function refreshCurrent() {
    if (state.tab === "shows" && state.currentShow && showState(state.currentShow) === "open") return;
    if (isDesktop()) {
      renderAll();
      return;
    }
    if (state.tab === "board") renderBoard();
    else if (state.tab === "admin") renderAdminOrSettings();
    else if (state.currentShow) openShow(state.currentShow.id);
    else renderShows();
  }

  // src/core/session.js
  async function loadSongs() {
    const { data, error } = await db.from("songs_cache").select("*").order("times_played", { ascending: false });
    if (error) throw new Error("Couldn't load song catalog: " + error.message);
    state.songList = data || [];
  }
  function logout() {
    state.session = null;
    localStorage.removeItem("ft_session");
    location.reload();
  }
  async function renderNoLeague() {
    let names = [];
    try {
      const { data } = await db.from("leagues").select("name").order("name");
      names = (data || []).map((l) => l.name);
    } catch (e) {
    }
    $("#main").innerHTML = `<div class="panel" style="margin-top:30px">
    <h2>You're not in a league yet</h2>
    <p class="muted">An admin has to add you before you can play \u2014 you don't need to do anything else.</p>
    <p style="color:var(--coral);font-weight:600;margin:10px 0;padding:10px;border:1px solid var(--coral);border-radius:8px">
      Don't register again \u2014 a second account can't be merged with this one.</p>
    <p class="muted">${names.length ? `Leagues currently running: ${names.map(esc).join(", ")}. ` : ""}Tell a league admin your name is <b>${esc(state.session.name)}</b> and ask them to add you.</p>
    <button class="btn ghost" onclick="logout()">Log out</button>
  </div>`;
  }
  async function boot() {
    document.title = APP_NAME;
    const nameEl = document.getElementById("appName");
    if (nameEl) nameEl.textContent = APP_NAME;
    renderHeaderChrome();
    applyLayout();
    if (!state.session) {
      renderAuth();
      return;
    }
    try {
      const hasLeague = await resolveLeagues();
      if (!hasLeague) {
        await renderNoLeague();
        return;
      }
      $("#tabs").style.display = "flex";
      renderHeaderChrome();
      await Promise.all([loadConfig(), loadSongs()]);
      subscribeRealtime();
      await renderAll();
    } catch (e) {
      console.error(e);
      $("#main").innerHTML = `<div class="panel" style="margin-top:30px;border-color:var(--coral)">
      <h2>Something broke loading the app</h2>
      <p class="muted" style="word-break:break-word">${esc(e.message || String(e))}</p>
      <div class="row" style="margin-top:10px">
        <button class="btn" onclick="location.reload()">Reload</button>
        <button class="btn ghost" onclick="logout()">Log out</button>
      </div></div>`;
    }
  }

  // src/main.js
  Object.assign(window, {
    toggleTheme,
    logout,
    doLogin,
    doRegister,
    openShow,
    renderShows,
    setBoardSeason,
    loadRoster,
    addSeasonRow,
    saveSeason,
    deleteSeason,
    addSlot,
    saveConfig,
    toggleFormat,
    saveCutoff,
    finalizeShow,
    reopenShow,
    toggleBans,
    unban,
    runEdge,
    bootPlayer,
    searchMembers,
    addMember,
    toggleRoster,
    setRosterMember,
    toggleSection,
    switchToBracket,
    switchToLeague
  });
  boot();
})();
//# sourceMappingURL=app.js.map
