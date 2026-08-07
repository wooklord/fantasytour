import { $, esc, footerHtml } from "../core/dom.js";
import { rpc } from "../core/supabaseClient.js";
import { state } from "../core/state.js";
import { fetchShows } from "../core/leagueShows.js";
import { clearTimersFor } from "../core/format.js";
import { trophy, rankNumeral, winBadge } from "../core/trophy.js";
import { markTab } from "../core/layout.js";
import { currentBracket } from "../core/switcher.js";
import { computeStandings, rankStandings, TIEBREAK_SHORT_LABELS } from "../core/tiebreak.js";

// Bound to the standings-select onchange (see renderBoard below) — replaces the
// original inline `boardSeason=this.value; renderBoard();` now that boardSeason
// lives on the shared state object instead of a bare global.
export function setBoardSeason(v){ state.boardSeason = v; renderBoard(); }

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
  const narrow = window.matchMedia("(max-width:420px)").matches;
  const bigPx = narrow ? 76 : 118, smallPx = narrow ? 54 : 82;
  // .podium is align-items:flex-end with .pod.first only bumping trophy/
  // name size (styles.css) — there's no absolute positioning or flex
  // `order` trick, so "elevated" is purely "this box is taller than its
  // neighbors while every box's bottom lines up." That means big=true can
  // go on ANY position (left/center/right) and the flex layout renders the
  // intended shape on its own — no per-position CSS needed here. Casual has
  // no seasons/tiebreakers to signify, so it gets a plain rank numeral in
  // the same spot instead of the trophy graphic — same rank/tier/
  // arrangement logic throughout, only what renders inside the box differs.
  const podBox = (o, big) => `<div class="pod ${big?"first":""}">${
      isOfficial ? trophy(big?bigPx:smallPx, tierFor(o)) : rankNumeral(big?bigPx:smallPx, tierFor(o), o.rank)
    }<b>${esc(pname[o.id]||"?")}</b><span class="podpts">${T[o.id].scoped} pts</span></div>`;
  const gold = order.filter(o => o.rank === 1);
  const silver = order.filter(o => o.rank === 2);
  const bronze = order.filter(o => o.rank === 3);
  // Elevation is a direct function of resolved rank and how many players
  // hold rank 1 — nothing about a box's position in the concatenated
  // left/center/right array or its index ever factors in, by construction.
  const isElevated = o => o.rank === 1 && gold.length <= 2;
  // Arrangement encodes RANK; colors (above) encode ties. The two are
  // independent — gold/silver/bronze and gold/silver/silver use the exact
  // same shape below, only tierFor's colors differ.
  let left = [], center = [], right = [];
  if (gold.length >= 3){
    // 3+-way tie for 1st: no single top to elevate over the others, and
    // structurally nothing to flank with either (the next real rank starts
    // past however many are tied, so silver/bronze are empty regardless).
    // Show every tied player, all level — deliberately uncapped even at 4+,
    // since capping would silently drop someone who genuinely tied for the
    // top score, exactly what this whole tiebreaker feature exists to never
    // do. The standings table above is unaffected either way.
    center = gold;
  } else if (gold.length === 2){
    // Two-way tie for 1st: both flank, both elevated. Whoever holds the
    // next rank down (if anyone — two players total means nobody does)
    // sits centered at normal height as the runner-up. Competition ranking
    // (rank += group size) means rank 2 is mathematically unreachable
    // whenever exactly 2 players share rank 1 — the next occupied rank is
    // always 3 — so `silver` is always empty here and the real runner-up
    // is whoever's in `bronze`. Combining both keeps this correct without
    // hardcoding that assumption; tierFor colors them by their real rank
    // regardless (bronze in practice, never a hardcoded "silver").
    left = [gold[0]]; right = [gold[1]];
    center = [...silver, ...bronze];
  } else {
    // Solo 1st: centered, elevated. Flanked by the next-ranked players,
    // best-to-worst, alternating left/right/left/right… For exactly two
    // flank candidates this IS "rank 2 left, rank 3 right" (or "both
    // silvers, one each side" when there's no bronze) — the alternation
    // just happens to reduce to that. Uncapped past two: a tier with 3+
    // members renders every one of them rather than arbitrarily dropping
    // the extras, same reasoning as the 3+-gold case above. .podium is
    // already flex-wrap:wrap (styles.css), so anything past what fits one
    // row wraps to a second line instead of squeezing or being hidden.
    center = gold;
    const flank = [...silver, ...bronze];
    left = flank.filter((_, i) => i % 2 === 0);
    right = flank.filter((_, i) => i % 2 === 1);
  }
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
  const podium = !order.length
    ? ""
    : !hasAnyScore
    ? `<div class="podium">${placeholderBox("silver",2,false)}${placeholderBox("gold",1,true)}${placeholderBox("bronze",3,false)}</div>`
    : `<div class="podium">${[...left, ...center, ...right].map(o => podBox(o, isElevated(o))).join("")}</div>`;
  const statRows = rows.filter(([,r]) => r.shows > 0)
    .sort((a,b) => b[1].scoped/b[1].shows - a[1].scoped/a[1].shows);
  $("#main").innerHTML = `
    <div class="panel">
      <div class="row"><h2 style="margin:0">${isOfficial ? "Official Standings" : "Standings"}</h2>
        <select onchange="setBoardSeason(this.value)"
          style="margin-left:auto;background:var(--pit);border:1px solid var(--line2);color:var(--cream);border-radius:8px;padding:6px 8px;font-size:.82rem">${opts}</select></div>
      ${podium}
      <div style="overflow-x:auto"><table class="lb"><tr><th></th><th>Player</th><th style="text-align:right">Score</th></tr>
      ${order.map(o => {
        const r = T[o.id];
        // One line per layer the player's group actually went through
        // (cumulative down the stack, not just whichever one resolved
        // them), each with their own value — that's what keeps this from
        // reading as a badge: "fewest zeros (2)" for the player who LOST
        // that layer looks identical in form to a winner's line, and the
        // number is what actually explains the placement. No separate
        // "tied" line: when the stack exhausts, the last layer's values
        // are already equal on every tied row — that IS the tie, visibly.
        // Suppressed under the identical hasAnyScore check that gates the
        // placeholder podium (not a parallel condition) — a fresh season
        // where everyone's at 0 would otherwise tie through the whole
        // stack and print a "tiebreak: fewest zeros (0)" line for every
        // row, which explains nothing real.
        const layerLines = !hasAnyScore ? "" : (o.layers||[])
          .map(l => `<div class="muted" style="font-size:.72rem">tiebreak: ${esc(TIEBREAK_SHORT_LABELS[l.layer])} (${l.value})</div>`)
          .join("");
        return `<tr class="${o.id===state.session.id?"me":""}">
        <td class="rank">${o.rank}</td><td>${esc(pname[o.id]||"?")}${layerLines}</td>
        <td class="pts">${season ? r.scoped : r.career}</td></tr>`;
      }).join("")
        || '<tr><td colspan="3" class="muted">No scores yet — pick some songs.</td></tr>'}
      </table></div>
    </div>
    <div class="panel"><h2>Nerd stats <span class="muted" style="font-size:.78rem">· ${scopeName}</span></h2>
      <div style="overflow-x:auto"><table class="lb compact"><tr><th>Player</th><th style="text-align:right">Shows</th><th style="text-align:right">Avg</th><th style="text-align:right">High</th><th style="text-align:right">${winBadge(18)}</th></tr>
      ${statRows.map(([id,r]) => `<tr class="${id===state.session.id?"me":""}">
        <td>${esc(pname[id]||"?")}</td><td class="pts">${r.shows}</td>
        <td class="pts">${(r.scoped/r.shows).toFixed(1)}</td>
        <td class="pts" title="${esc(r.highShow?.venue||"")}">${r.high}</td>
        <td class="pts">${r.wins||0}</td></tr>`).join("")
        || '<tr><td colspan="5" class="muted">Stats appear once shows score.</td></tr>'}
      </table></div>
      <p class="muted" style="margin-top:8px;font-size:.75rem">Avg = points per show played · High = best single show (venue on hover) · wreath = shows won</p>
    </div>
    ${footerHtml()}`;
}
