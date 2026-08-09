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
  const ORDINAL = ["1st","2nd","3rd"];
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
  const narrow = window.matchMedia("(max-width:420px)").matches;
  const bigPx = narrow ? 76 : 118, smallPx = narrow ? 54 : 82;
  // No points line here — the table right below already shows the score,
  // so repeating it on the podium was pure noise. Casual has no
  // seasons/tiebreakers to signify, so it gets a plain rank numeral in the
  // same spot instead of the trophy graphic — same rank/tier logic
  // throughout, only what renders inside the box differs.
  const podBox = (o, big) => `<div class="pod ${big?"first":""}">${
      isOfficial ? trophy(big?bigPx:smallPx, tierFor(o)) : rankNumeral(big?bigPx:smallPx, tierFor(o), o.rank)
    }<b>${esc(pname[o.id]||"?")}</b></div>`;
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
      }<div class="pod-names">${t.items.map(o => `<div>${esc(pname[o.id]||"?")}</div>`).join("")}</div></div>`).join("")}</div>`
    : "";
  const podium = !order.length
    ? ""
    : !hasAnyScore
    ? `<div class="podium">${placeholderBox("silver",2,false)}${placeholderBox("gold",1,true)}${placeholderBox("bronze",3,false)}</div>`
    : `<div class="podium-wrap">${boxedHtml}${compactHtml}</div>`;
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
        //
        // Numbered by the layer's position in the CONFIGURED stack
        // (tiebreakers.indexOf), not by its position in this row's own
        // layers list — a layer that resolved nothing is skipped upstream
        // (resolveGroup only records a layer once it actually splits the
        // group), so a row often shows just one line, and that line has to
        // carry the ordinal it actually holds in the full stack (e.g. "3rd
        // tiebreak" when it's the third configured layer, even though it's
        // the only line this row shows).
        const layerLines = !hasAnyScore ? "" : (o.layers||[])
          .map(l => `<div class="muted" style="font-size:.72rem">${ORDINAL[tiebreakers.indexOf(l.layer)]} tiebreak: ${esc(TIEBREAK_SHORT_LABELS[l.layer])} (${l.value})</div>`)
          .join("");
        return `<tr class="${o.id===state.session.id?"me":""}">
        <td class="rank">${o.rank}</td><td>${esc(pname[o.id]||"?")}${layerLines}</td>
        <td class="pts">${season ? r.scoped : r.career}</td></tr>`;
      }).join("")
        || '<tr><td colspan="3" class="muted">No scores yet — pick some songs.</td></tr>'}
      </table></div>
      ${tiebreakers.length ? `<p class="muted" style="margin-top:8px;font-size:.75rem;text-align:center">Tiebreakers<br>${
        tiebreakers.map((l, i) => `${ORDINAL[i]}: ${esc(TIEBREAK_SHORT_LABELS[l])}`).join(" · ")
      }</p>` : ""}
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
