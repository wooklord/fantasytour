import { $, esc, footerHtml } from "../core/dom.js";
import { rpc } from "../core/supabaseClient.js";
import { state } from "../core/state.js";
import { fetchShows } from "../core/leagueShows.js";
import { clearTimersFor } from "../core/format.js";
import { trophy, rankNumeral, winBadge } from "../core/trophy.js";
import { markTab } from "../core/layout.js";
import { currentBracket } from "../core/switcher.js";
import { computeStandings, rankStandings, groupTies, ordinal, layerDisplayValue, decidedByText, TIEBREAK_SHORT_LABELS } from "../core/tiebreak.js";
import { STAT_COLS, DEFAULT_STATS_SORT, statValue, fmtStat, bestDir, flipDir, sortStats, parseStatsSort, formatStatsSort, statLeaders } from "../core/stats.js";

// Bound to the standings-select onchange (see renderBoard below) — replaces the
// original inline `boardSeason=this.value; renderBoard();` now that boardSeason
// lives on the shared state object instead of a bare global.
export function setBoardSeason(v){ state.boardSeason = v; renderBoard(); }
// A View chip briefly lived here (1a74cee, 2026-10-25) and was REVERTED the
// same day: it was built against the wrong screen — the per-show Scores
// page is where Compact/Detail belongs (standings-ux.md, correction under
// item 2 and items 2a/3a). The per-row tiebreak lines that lived in the
// name cell left with item 5 (2026-10-26): a tie now renders as a GROUP —
// bracket, tag row, expandable sub-row — see groupTies in core/tiebreak.js
// and the row builder inside renderBoard.

// Expand state for tie groups: IN MEMORY ONLY (item 5 — never persisted,
// no localStorage key). Keyed on groupTies' `key`, so a realtime re-render
// of the board (realtime.js) redraws an open group open; a reload closes
// every group.
const expandedTieGroups = new Set();
// Bound to a tag row's "+" / "−" (on window via main.js). Flips the sub-row
// in place — no refetch, no re-render — and records the state so the next
// renderBoard draws it the same way. Keys are "<points>-<rank>", digits
// and a hyphen, so they are safe inside an attribute selector as-is.
export function toggleTieGroup(key){
  const open = !expandedTieGroups.has(key);
  if (open) expandedTieGroups.add(key); else expandedTieGroups.delete(key);
  const sub = document.querySelector(`tr.tg-sub[data-tg="${key}"]`);
  const btn = document.querySelector(`tr.tg-tag[data-tg="${key}"] .tg-plus`);
  if (sub) sub.classList.toggle("hidden", !open);
  if (btn){ btn.textContent = open ? "−" : "+"; btn.setAttribute("aria-expanded", String(open)); }
}

// ---------- Stats panel (standings-ux.md item 6) ----------
// Sort choice persists per device in ft_stats_sort, same posture as
// ft_scores_view: read once at load through a whitelist (parseStatsSort),
// written on every tap, never sent to the server. Default avg best-first.
let statsSort = parseStatsSort(localStorage.getItem("ft_stats_sort"));
// The last rows renderBoard computed, so a header tap re-renders the stats
// panel alone from this cache — no refetch (decision 2; the harness
// asserts the RPC count unchanged across a tap).
let lastStats = null;
// On window via main.js. Same column flips; a new column takes its
// best-first direction. Zeros is unsortable without a season (decision 1).
export function setStatsSort(col){
  if (!STAT_COLS[col]) return;
  if (lastStats && !lastStats.season && col === "zeros") return;
  statsSort = statsSort.col === col ? { col, dir: flipDir(statsSort.dir) } : { col, dir: bestDir(col) };
  localStorage.setItem("ft_stats_sort", formatStatsSort(statsSort));
  const el = document.getElementById("statspanel");
  if (el && lastStats) el.outerHTML = statsPanelHtml(lastStats);
}
const LEADER_LABELS = { avg: "Best avg", high: "High score", wins: "Most wins", zeros: "Fewest zeros" };
function statsPanelHtml(s){
  const { pname, season, scopeName } = s;
  const nameOf = id => pname[id] || "?";
  // A stored zeros sort on a no-season view falls back to the default
  // for this render only — nothing is written, so the preference survives
  // a switch back to a season.
  const sort = (!season && statsSort.col === "zeros") ? DEFAULT_STATS_SORT : statsSort;
  const rows = sortStats(s.statRows, sort.col, sort.dir, nameOf);
  // Header: sortable numeric columns carry the tap, aria-sort on the
  // active one ("none" elsewhere) and the arrow ▼/▲ on the active one
  // only (decision 3). Player is not sortable; Zeros is not without a
  // season.
  const th = (col, label) => {
    const sortable = !!STAT_COLS[col] && (season || col !== "zeros");
    const active = sortable && sort.col === col;
    const aria = active ? (sort.dir === "asc" ? "ascending" : "descending") : "none";
    const arrow = active ? (sort.dir === "asc" ? "▲" : "▼") : "";
    return `<th style="text-align:right" class="${sortable ? "sortable" : ""}${active ? " active" : ""}"${
      sortable ? ` onclick="setStatsSort('${col}')" aria-sort="${aria}" title="Sort by ${col === "zeros" ? "zeros" : col}"` : ""}>${label}<span class="arrow">${arrow}</span></th>`;
  };
  // The active column's values render bold (item 6.3) via .active.
  const td = (col, v, extra = "") => `<td class="pts${sort.col === col ? " active" : ""}"${extra}>${v}</td>`;
  const leaders = rows.length ? statLeaders(rows, nameOf, { withZeros: !!season }) : [];
  const leadersHtml = leaders.length ? `<div class="leaders">${leaders.map(l =>
    `<div class="leader" data-key="${l.key}"><span class="lbl">${LEADER_LABELS[l.key]}</span><span class="who"><span class="nm" title="${esc(nameOf(l.ids[0]))}">${esc(nameOf(l.ids[0]))}</span>${
      l.ids.length > 1 ? `<small>+${l.ids.length - 1}</small>` : ""}</span><b>${fmtStat(l.col, l.value)}</b></div>`).join("")}</div>` : "";
  return `<div class="panel" id="statspanel"><h2>Stats <span class="muted" style="font-size:.78rem">· ${scopeName}</span></h2>
      ${leadersHtml}
      <div style="overflow-x:auto"><table class="lb compact"><tr><th>Player</th>${th("shows", "Shows")}${th("avg", "Avg")}${th("high", "High")}${th("zeros", "0s")}${th("wins", winBadge(18))}</tr>
      ${rows.map(([id, r]) => `<tr class="${id===state.session.id?"me":""}">
        <td class="pname"><span class="nm" title="${esc(nameOf(id))}">${esc(nameOf(id))}</span></td>${td("shows", r.shows)}
        ${td("avg", fmtStat("avg", statValue(r, "avg")))}
        ${td("high", r.high, ` title="${esc(r.highShow?.venue||"")}"`)}
        ${td("zeros", season ? r.zeros : "—")}
        ${td("wins", r.wins||0)}</tr>`).join("")
        || '<tr><td colspan="6" class="muted">Stats appear once shows score.</td></tr>'}
      </table></div>
      <p class="muted" style="margin-top:8px;font-size:.75rem">Avg = points per show played · High = best single show (venue on hover) · 0s = scoring zeros${season ? "" : " (season views only)"} · wreath = shows won · tap a column to sort</p>
    </div>`;
}

// ---------- podium arrangement ----------
// Traditional centered-podium layout: a lone best tier centers and rises
// above flanking lower tiers (better rank flanks left — "silver left, gold
// center raised, bronze right"); a 2-way tie for best splits to flank
// instead (both raised), with whatever tier survives next centered at
// normal height as the runner-up; a 3-way tie for best has no single tier
// to raise above anything, so it renders level instead. Deliberately
// structural, not rank-literal — "top"/"flank" mean whichever tiers
// actually survive compactPodiumTiers() below, not literally gold/silver/
// bronze (an oversized gold tier can itself compact away, leaving silver as
// the surviving "top"). Medal COLOR still always follows resolved rank
// (tierFor in renderBoard), kept entirely independent of this positional
// logic.
function arrangePodium(tiers){
  if (!tiers.length) return [];
  const [top, ...rest] = tiers;
  if (top.items.length >= 3) return top.items.map(o => ({ o, elevated:false }));
  if (top.items.length === 2){
    const [left, right] = top.items;
    const runner = rest[0]?.items[0];
    const boxes = [{ o:left, elevated:true }];
    if (runner) boxes.push({ o:runner, elevated:false });
    boxes.push({ o:right, elevated:true });
    return boxes;
  }
  if (!rest.length) return [{ o:top.items[0], elevated:true }];
  if (rest.length === 1){
    const f = rest[0];
    return f.items.length === 2
      ? [{ o:f.items[0], elevated:false }, { o:top.items[0], elevated:true }, { o:f.items[1], elevated:false }]
      : [{ o:f.items[0], elevated:false }, { o:top.items[0], elevated:true }];
  }
  return [{ o:rest[0].items[0], elevated:false }, { o:top.items[0], elevated:true }, { o:rest[1].items[0], elevated:false }];
}

// The boxed podium must never wrap onto a second line — a wrap would put
// gold below a lower tier, breaking the arrangement above entirely. Fixed
// at 3 regardless of breakpoint: desktop's larger icons (bigPx/smallPx
// below) cost more row width than its larger panel gains, so a
// width-derived ceiling would need to be SMALLER on desktop than phone —
// an inconsistent payoff not worth tuning per breakpoint.
const PODIUM_ROW_MAX = 3;
// Replaces the old per-tier cap: an oversized single tier isn't a special
// case, it's just a tier already over PODIUM_ROW_MAX on its own. Compacts
// whole tiers (never splits one) until the boxed total fits; ties in size
// compact the worse (higher) rank number first, so gold survives longest.
function compactPodiumTiers(tiers){
  let boxed = tiers.slice();
  const compact = [];
  while (boxed.reduce((n,t) => n + t.items.length, 0) > PODIUM_ROW_MAX){
    let victim = boxed[0];
    for (const t of boxed){
      if (t.items.length > victim.items.length || (t.items.length === victim.items.length && t.rank > victim.rank)) victim = t;
    }
    boxed = boxed.filter(t => t !== victim);
    compact.push(victim);
  }
  compact.sort((a,b) => a.rank - b.rank);
  return { boxed, compact };
}

export async function renderBoard(){
  clearTimersFor("board"); state.tab = "board"; markTab();
  const [sc, allShows, seasons] = await Promise.all([
    rpc("get_bracket_scores", { p_name:state.session.name, p_pin:state.session.pin, p_bracket_id: state.currentBracketId }),
    fetchShows(q => q),
    rpc("get_bracket_seasons", { p_bracket_id: state.currentBracketId }),
  ]);
  let pname = Object.fromEntries((sc||[]).map(s => [s.player_id, s.player_name]));
  const showsById = Object.fromEntries((allShows||[]).map(sh => [sh.id, sh]));
  const today = new Date().toLocaleDateString('sv');
  // Default season priority: (1) a currently-active season wins outright —
  // this also covers "a new season starts during another's grace period",
  // since active is always checked first; (2) else the most recently-ended
  // season, but only within a 7-day grace window (so people can savor the
  // result) — NOT unconditionally the latest-created season, which is the
  // stale-board behavior this replaces; (3) else All time, so a tour gap
  // longer than a week doesn't keep showing a long-finished season forever.
  if (state.boardSeason === null){
    const active = (seasons||[]).find(se => se.start_date <= today && today <= se.end_date);
    const graceFloor = new Date(Date.now() - 7*864e5).toISOString().slice(0,10);
    const recentlyEnded = (seasons||[])
      .filter(se => se.end_date < today && se.end_date >= graceFloor)
      .reduce((best, se) => (!best || se.end_date > best.end_date) ? se : best, null);
    const cur = active || recentlyEnded;
    state.boardSeason = cur ? String(cur.id) : "all";
  }
  const season = (seasons||[]).find(se => String(se.id) === state.boardSeason);

  // The configured tiebreaker stack is Official-season-only — "fewest
  // zeros" needs a per-player roster join date, which only exists once
  // there IS a season. Casual and All time still get the baseline fix
  // (equal points share a placing, not an arbitrary order) via an empty
  // stack — see tiebreak.js's rankStandings.
  const tiebreakers = (currentBracket()?.bracket_kind === "official" && season) ? (state.cfg?.tiebreakers || []) : [];
  // Fetched whenever a season is active, not just when tiebreakers are
  // configured — standings used to be built ENTIRELY from get_bracket_scores
  // rows, so a roster member who'd opted in but never had a show finalize
  // while eligible was invisible rather than shown at 0. The roster is the
  // fix: every member gets seeded into computeStandings (rosterIds below),
  // and their name has to come from here now since they may have no score
  // row to source a name from at all. Casual/All time have no single
  // "roster" (Casual never has seasons; All time spans many), so this
  // stays season-gated, same as the tiebreaker stack above.
  let rosterJoinDates = {}, rosterIds = [];
  if (season && currentBracket()?.bracket_kind === "official"){
    const roster = await rpc("get_season_roster", { p_name:state.session.name, p_pin:state.session.pin, p_season_id: season.id });
    rosterJoinDates = Object.fromEntries((roster||[]).map(r => [r.player_id, String(r.added_at).slice(0,10)]));
    rosterIds = (roster||[]).map(r => r.player_id);
    // Score-derived names win on conflict (pname built above), but a
    // never-scored roster member has no score row to source a name from —
    // this is their only source.
    pname = { ...Object.fromEntries((roster||[]).map(r => [r.player_id, r.name])), ...pname };
  }

  const T = computeStandings({ scoreRows: sc||[], showsById, season, rosterJoinDates, rosterIds });
  const order = rankStandings(T, p => season ? p.scoped : p.career, tiebreakers);
  // rankStandings groups ties (equal points, or an exhausted tiebreaker
  // stack that never separated them) in whatever order Object.keys(T)
  // happened to iterate — score-row arrival order, then get_season_roster's
  // arbitrary (no ORDER BY) row order for roster-seeded entries. Neither
  // means anything, so any group sharing a rank sorts by name instead of
  // leaving that arbitrary order on display. Applies everywhere ties show
  // up — Casual's plain equal-points ties included, not just Official's.
  // sensitivity:'accent' makes this explicitly case-insensitive (real
  // roster names range from "alhooks13" to "The Judge" — a plain compare
  // would sort every capitalized name before every lowercase one) while
  // still distinguishing accented letters. This is the ONLY place
  // within-tie order gets decided: the podium below (both the boxed
  // arrangement and the compacted-tier lists) reads tiers straight off
  // this same sorted `order`, so it never needs its own tie-sort — and
  // can't drift out of sync with the table showing the same tie.
  for (let i = 0; i < order.length; ){
    let j = i;
    while (j < order.length && order[j].rank === order[i].rank) j++;
    if (j - i > 1) order.slice(i, j)
      .sort((a,b) => (pname[a.id]||"").localeCompare(pname[b.id]||"", undefined, { sensitivity:"accent" }))
      .forEach((o,k) => order[i+k] = o);
    i = j;
  }
  const rows = order.map(o => [o.id, T[o.id]]);
  const opts = [...(seasons||[]).map(se =>
      `<option value="${se.id}" ${state.boardSeason===String(se.id)?"selected":""}>${esc(se.name)}</option>`),
    `<option value="all" ${state.boardSeason==="all"?"selected":""}>All time</option>`].join("");
  const scopeName = season ? esc(season.name) : "All time";
  const isOfficial = currentBracket()?.bracket_kind === "official";
  // Medal COLOR always follows resolved rank, independent of position — a
  // tie for 1st means two or three golds (silver simply unused), never one
  // arbitrarily crowned gold and the other demoted to silver.
  const tierFor = o => o.rank === 1 ? "gold" : o.rank === 2 ? "silver" : "bronze";
  // A real narrow-phone bug: at the ORIGINAL fixed 118/82px sizing, two
  // elevated (118px) boxes plus one normal (82px) box plus gaps genuinely
  // doesn't fit a real phone's content width, so the third box wrapped to
  // its own line — and because it then sat alone with no sibling box for
  // visual comparison, it *read* as bigger than its rank-1 twin even
  // though both were pixel-identical 118px (verified: this was purely a
  // wrap-caused illusion, not a sizing bug). Shrinking both sizes on
  // narrow viewports (paired with .podium's tighter gap there, styles.css)
  // is what actually keeps 3 boxes on one row.
  //
  // A second, independent instance of the same constraint exists on
  // desktop, measured directly rather than assumed: at the narrowest real
  // desktop width (901px, the mobile/desktop breakpoint), the podium's
  // available width is 224px, but 118+82+118 is 318px of icon ALONE —
  // 94px over, before any gap is even added. No gap value can close a
  // 94px deficit, so unlike the phone case, shrinking the gap alone
  // cannot fix this one; the icons themselves have to shrink for that
  // band. Verified this holds up to 1279px (not just right at 901) —
  // 1280px+ is where 118/82/28 gets real margin again (344px available
  // vs 338px needed) and can stay exactly as-is. Below 901px the layout
  // is mobile's single-column `.wrap`, not this grid column, so it's
  // covered by the `narrow`/non-narrow phone branch above instead.
  const narrow = window.matchMedia("(max-width:420px)").matches;
  const desktopNarrow = window.matchMedia("(min-width:901px) and (max-width:1279px)").matches;
  const bigPx = narrow ? 96 : desktopNarrow ? 83 : 118;
  const smallPx = narrow ? 68 : desktopNarrow ? 58 : 82;
  // No points line here — the table right below already shows the score,
  // so repeating it on the podium was pure noise. Casual has no
  // seasons/tiebreakers to signify, so it gets a plain rank numeral in the
  // same spot instead of the trophy graphic — same rank/tier logic
  // throughout, only what renders inside the box differs.
  const podBox = (o, big) => `<div class="pod ${big?"first":""}">${
      isOfficial ? trophy(big?bigPx:smallPx, tierFor(o)) : rankNumeral(big?bigPx:smallPx, tierFor(o), o.rank)
    }<b class="nm" title="${esc(pname[o.id]||"?")}">${esc(pname[o.id]||"?")}</b></div>`;
  const podiumEntries = order.filter(o => o.rank <= 3);
  // Placeholder empty state: before ANY non-zero score exists among these
  // players (not just "before the first show finalizes" — a finalized
  // show where everyone blanked leaves the exact same all-zero tie), the
  // podium would otherwise crown an arbitrary-looking winner out of pure
  // ties-at-zero. Bare trophies/numerals, no names, no points — signals
  // "nothing decided yet" instead of pretending to rank anyone. Applies to
  // Casual too (a numbered podium showing seven 1s is just as useless).
  const hasAnyScore = order.some(o => o.points > 0);
  const placeholderBox = (tier, rank, big) => `<div class="pod ${big?"first":""}">${
      isOfficial ? trophy(big?bigPx:smallPx, tier) : rankNumeral(big?bigPx:smallPx, tier, rank)
    }</div>`;
  // Bounding a genuine tie without hiding anyone: the podium only ever
  // shows tiers 1/2/3 (podiumEntries above), so there are at most 3 tiers
  // to decide on. compactPodiumTiers() collapses whole tiers to one compact
  // column (icon + stacked names, see compactHtml below) — no per-player
  // box, no elevation — until the boxed row's total fits PODIUM_ROW_MAX
  // (this is what once rendered seven full-size golds for an all-zero tie,
  // and still would for any real tie that size). A tier that fits stays
  // fully boxed even sitting right next to a collapsed one — a 2-way tie
  // for 1st isn't penalized just because 3rd place has a crowd. The full
  // standings table below is unaffected either way.
  const tiers = [];
  for (const o of podiumEntries){
    const t = tiers[tiers.length - 1];
    if (t && t.rank === o.rank) t.items.push(o); else tiers.push({ rank: o.rank, items: [o] });
  }
  const { boxed: boxedTiers, compact: compactTiers } = compactPodiumTiers(tiers);
  const boxedHtml = boxedTiers.length
    ? `<div class="podium">${arrangePodium(boxedTiers).map(({o,elevated}) => podBox(o, elevated)).join("")}</div>`
    : "";
  // Names stack vertically under the tier's icon rather than running as one
  // comma-separated line beside it — a long line wraps mid-list at an
  // arbitrary point that shifts with viewport width, where a stacked name
  // always gets its own line regardless of width or length. Costs a couple
  // of lines' height for a small tie (2-3 names), but degrades predictably
  // for a large one instead of reflowing unpredictably.
  const compactHtml = compactTiers.length
    ? `<div class="podium-compact">${compactTiers.map(t => `<div class="pod-col">${
        isOfficial ? trophy(44, tierFor(t.items[0])) : rankNumeral(44, tierFor(t.items[0]), t.rank)
      }<div class="pod-names">${t.items.map(o => `<div class="nm" title="${esc(pname[o.id]||"?")}">${esc(pname[o.id]||"?")}</div>`).join("")}</div></div>`).join("")}</div>`
    : "";
  const podium = !order.length
    ? ""
    : !hasAnyScore
    ? `<div class="podium">${placeholderBox("silver",2,false)}${placeholderBox("gold",1,true)}${placeholderBox("bronze",3,false)}</div>`
    : `<div class="podium-wrap">${boxedHtml}${compactHtml}</div>`;
  // Rows still require shows > 0 (item 6.5); the ORDER is the stats
  // panel's business now (sortStats, persisted choice), not fixed here.
  const statRows = rows.filter(([,r]) => r.shows > 0);
  lastStats = { statRows, pname, season: season || null, scopeName: season ? esc(season.name) : "All time" };

  // ---- tie groups (standings-ux.md item 5) ----
  // One group per run of equal-points rows (groupTies), gated on the SAME
  // hasAnyScore check as the placeholder podium (approval decision 3): a
  // fresh all-zero season is one big tie that explains nothing, so it gets
  // no brackets and no tags. The name cell is the name alone; everything
  // about a tie lives in the group's tag row and sub-row below it.
  const tieGroups = hasAnyScore ? groupTies(order, tiebreakers) : [];
  const tgInfo = new Map();
  for (const g of tieGroups) g.members.forEach((m, k) => tgInfo.set(m.id, { g, first: k === 0, last: k === g.members.length - 1 }));
  // Tag row: "Tie for <place> · decided by <every layer that split anyone,
  // & -joined in stack order; 'all N tiebreaks' when the whole stack was
  // used — amendment A>" or "· shared", then the "+" / "−" expander
  // (U+2212 while open — decision 5). With no configured
  // stack (Casual, All time) the muted "no tiebreakers set" takes the
  // expander's place and there is no sub-row at all (decision 2).
  const tagRow = g => {
    const open = expandedTieGroups.has(g.key);
    const how = g.shared ? "shared" : `decided by ${esc(decidedByText(g.decidingAll, tiebreakers.length))}`;
    const ctl = tiebreakers.length
      ? `<button class="linkbtn tg-plus" onclick="toggleTieGroup('${g.key}')" aria-expanded="${open}" aria-controls="tg-sub-${g.key}" title="${open ? "Hide" : "Show"} tiebreaker values">${open ? "−" : "+"}</button>`
      : `<span class="muted tg-none">no tiebreakers set</span>`;
    return `<tr class="tg-tag" data-tg="${g.key}"><td colspan="3"><span class="muted tg-text">Tie for ${ordinal(g.place)} · ${how}</span>${ctl}</td></tr>`;
  };
  // Sub-row — LAYOUT B (correction 2026-10-26; the first flex-chip layout
  // did not read on a phone). A GRID: a header row of short layer labels
  // in stack order, then one row per member: rank, full-width name (.nm
  // ellipsis), one value per configured layer. EVERY configured layer is
  // listed, not only the ones that split (that is what a row's `layers`
  // carries): the values come from computeStandings' totals, which exist
  // for every layer. The deciding column's header AND cells carry
  // .deciding (mint tint); its header carries the "decided" mark.
  // Amendment 2026-10-26: a VALUE CELL is tinted iff its layer is in that
  // member's OWN `layers` (the layers that split their group at each
  // depth) — so a sub-split inside the group shows as tint, not only as
  // equal ranks, and the player who broke free at layer 1 shows no
  // layer-2 tint they were never measured on. Headers (amendment A +
  // its addendum): the "decided" mark sits in EVERY header the tag names
  // (decidingAll — "this column did work"); the TINT sits on the primary
  // layer only (deciding — "where the group first broke"); the cell tint
  // says for whom. Three facts, three signals. Equal ranks
  // down the rank column still show a still-shared sub-pair (decision
  // 1). Columns: auto (rank) · minmax(0,1fr) (name, min 0 so it
  // truncates instead of pushing values off-screen) · fit-content(5em)
  // per layer, so a label wraps to two lines when width is short. The
  // grid is flat (no row element); the harness chunks it by header count.
  const subRow = g => {
    if (!tiebreakers.length) return "";
    const open = expandedTieGroups.has(g.key);
    const tint = l => l === g.deciding ? " deciding" : "";       // header tint: primary layer only
    const worked = l => g.decidingAll.includes(l);                // "decided" mark: every named layer
    const cellDec = (m, l) => m.layers.some(x => x.layer === l) ? " deciding" : "";
    const cols = `grid-template-columns:auto minmax(0,1fr) repeat(${tiebreakers.length},fit-content(5em))`;
    const head = `<div class="tg-h" aria-hidden="true"></div><div class="tg-h" aria-hidden="true"></div>`
      + tiebreakers.map(l => `<div class="tg-h tg-col${tint(l)}" data-layer="${l}">${esc(TIEBREAK_SHORT_LABELS[l])}${worked(l) ? '<span class="tg-decided">decided</span>' : ""}</div>`).join("");
    const body = g.members.map(m =>
      `<div class="tg-r tg-rank">${m.rank}</div><div class="tg-r tg-name"><span class="nm" title="${esc(pname[m.id]||"?")}">${esc(pname[m.id]||"?")}</span></div>`
      + tiebreakers.map(l => `<div class="tg-r tg-v${cellDec(m, l)}" data-layer="${l}">${layerDisplayValue(T[m.id], l)}</div>`).join("")).join("");
    return `<tr class="tg-sub${open ? "" : " hidden"}" id="tg-sub-${g.key}" data-tg="${g.key}"><td colspan="3"><div class="tg-grid" style="${cols}">${head}${body}</div></td></tr>`;
  };
  $("#main").innerHTML = `
    <div class="panel">
      <div class="row"><h2 style="margin:0">${isOfficial ? "Official Standings" : "Standings"}</h2>
        <select onchange="setBoardSeason(this.value)"
          style="margin-left:auto;background:var(--pit);border:1px solid var(--line2);color:var(--cream);border-radius:8px;padding:6px 8px;font-size:.82rem">${opts}</select></div>
      ${podium}
      <div style="overflow-x:auto"><table class="lb"><tr><th></th><th>Player</th><th style="text-align:right">Score</th></tr>
      ${order.map(o => {
        const r = T[o.id];
        // .me is the own-row outline hook (styles.css) — keyed on the
        // server-issued session id against the RPC's player_id, the
        // mechanism this board has always used (standings-ux.md 3). A row
        // inside a tie group also carries .tg (+ .tg-first / .tg-last at
        // the bracket's ends); the bracket is a border-left, so it never
        // touches .me's box-shadows on the same cells. The group's tag row
        // and sub-row follow its LAST member. Name cell: .pname/.nm is the
        // ellipsis pair (decision 4), the full name rides in title, and
        // nothing else lives in it any more (item 5).
        const nm = pname[o.id]||"?";
        const tg = tgInfo.get(o.id);
        const cls = [o.id===state.session.id ? "me" : "", tg ? "tg" : "", tg?.first ? "tg-first" : "", tg?.last ? "tg-last" : ""].filter(Boolean).join(" ");
        return `<tr class="${cls}"${tg ? ` data-tg="${tg.g.key}"` : ""}>
        <td class="rank">${o.rank}</td><td class="pname"><span class="nm" title="${esc(nm)}">${esc(nm)}</span></td>
        <td class="pts">${season ? r.scoped : r.career}</td></tr>${tg?.last ? tagRow(tg.g) + subRow(tg.g) : ""}`;
      }).join("")
        || '<tr><td colspan="3" class="muted">No scores yet — pick some songs.</td></tr>'}
      </table></div>
      ${tiebreakers.length ? `<p class="muted" style="margin-top:8px;font-size:.75rem;text-align:center">Tiebreakers<br>${
        tiebreakers.map((l, i) => `${ordinal(i + 1)}: ${esc(TIEBREAK_SHORT_LABELS[l])}`).join(" · ")
      }</p>` : ""}
    </div>
    ${statsPanelHtml(lastStats)}
    ${footerHtml()}`;
}
