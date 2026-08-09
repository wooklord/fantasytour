import { $, esc, footerHtml } from "../core/dom.js";
import { rpc } from "../core/supabaseClient.js";
import { state } from "../core/state.js";
import { fetchShows } from "../core/leagueShows.js";
import { fmtDateParts, countdown, clearTimersFor, showState } from "../core/format.js";
import { winBadge } from "../core/trophy.js";
import { markTab } from "../core/layout.js";
import { currentBracket } from "../core/switcher.js";
import { slotDefs, draftKey, openShow } from "./picks.js";

// The Shows nav-tab entry point — deliberately distinct from renderShows()
// itself, which the "← shows" back-link inside a pick sheet/detail view
// calls directly and always wants the list, clearing state.currentShow on
// its way there. Returning to the Shows tab after visiting Standings or
// Settings isn't the same gesture as tapping "back" — it should resume
// whatever show was open, not drop back to the list underneath it.
// openShow() re-fetches fresh, so a show that finalized or a bracket that
// got switched while away both resolve correctly on their own: finalizing
// just makes showState() return "final" now, rendering the results view
// instead of a stale pick sheet; switching brackets already nulls
// currentShow itself (switcher.js's switchToBracket), so there's nothing
// left to resume by the time this runs and it falls through to the list.
export function enterShowsTab(){
  if (state.currentShow) openShow(state.currentShow.id);
  else renderShows();
}
export async function renderShows(){
  clearTimersFor("shows"); state.tab = "shows"; state.currentShow = null; markTab();
  const todayStr = new Date().toLocaleDateString('sv');
  const graceStr = new Date(Date.now() - 2*864e5).toISOString().slice(0,10);
  const [up, past, seas, myCounts] = await Promise.all([
    fetchShows(q => q.gte("showdate", graceStr).order("showdate")),
    fetchShows(q => q.lt("showdate", graceStr).order("showdate",{ascending:false}).limit(12)),
    rpc("get_bracket_seasons", { p_bracket_id: state.currentBracketId }),
    rpc("get_my_pick_counts", { p_name:state.session.name, p_pin:state.session.pin, p_bracket_id: state.currentBracketId }),
  ]);
  const savedCountOf = Object.fromEntries((myCounts||[]).map(c => [c.show_id, c.pick_count]));
  // Pick/Scores button: label, marker, and layout for one show — folded
  // into the button itself, no separate row element (every earlier
  // layout, a floating circle, a stacked column, reserved its own slot;
  // this doesn't). "Scores" covers every post-cutoff case (locked/live/
  // final) uniformly, keyed on showState()+status rather than on whether
  // setlist data actually exists — there's never an empty-setlist label
  // problem to solve this way, and no batch setlist query needed.
  //
  // A completed sheet still replaces the label outright pre-lock (a bare
  // checkmark can't say "incomplete," so amber/warn keep the label and
  // stack the marker under it instead — stacking pins the button's width
  // to the label alone, since the marker can only add height). Post-
  // cutoff, "done" isn't notable anymore — no label replacement AND no
  // marker at all once picks are in; only "saved but incomplete" survives
  // the deadline, de-emphasized (quiet) since it's informational there,
  // not the actionable thing.
  //
  // The draft-derived exclamation is deliberately only ever consulted
  // pre-lock (`st === "open"`) — a stale draft key sitting in localStorage
  // past cutoff is worthless (submission's closed), so it's not read at
  // all once the show isn't open, regardless of whether it later
  // finalizes. Circled specifically because a bare "!" alone on its own
  // small stacked line reads as too faint to be deliberate — the checks
  // don't have that problem bare, so they're untouched.
  const pickButtonInfo = s => {
    const st = showState(s);
    const label = st === "open" ? "Pick" : "Scores";
    if (s.status === "final") return { label, markerHtml: "" };
    const target = slotDefs(s.format).length;
    const saved = savedCountOf[s.id] || 0;
    if (st === "open"){
      const hasDraft = !!localStorage.getItem(draftKey(s.id));
      if (hasDraft){
        const title = target > 0 && saved >= target
          ? "Saved picks are complete, but you have unsaved local changes on this device — save again to keep them"
          : "Draft in progress — not yet saved";
        return { label, stacked: true, markerHtml: `<span class="pickmark warn" title="${title}">!</span>` };
      }
      if (target > 0 && saved >= target)
        return { label: "", markerHtml: `<span class="pickmark done" title="Picks saved — complete">✔</span>` };
      if (saved > 0)
        return { label, stacked: true, markerHtml: `<span class="pickmark progress" title="Picks saved but incomplete">✓</span>` };
      return { label, markerHtml: "" };
    }
    // Post-cutoff (live/locked/played, or a past-dated no-cutoff show —
    // the Live bucket): draft ignored entirely, done shows nothing.
    if (target > 0 && saved > 0 && saved < target)
      return { label, stacked: true, quiet: true, markerHtml: `<span class="pickmark progress" title="Picks saved but incomplete">✓</span>` };
    return { label, markerHtml: "" };
  };
  const seasonOf = d => (seas||[]).find(se => se.start_date <= d && d <= se.end_date);
  const labelOf = d => seasonOf(d)?.name || null;
  const isOfficial = currentBracket()?.bracket_kind === "official";
  // Game number = chronological position within the season, computed once
  // across every show this call actually fetched (up ∪ past) — so the same
  // show carries the same number whether it's rendered in Upcoming or
  // Recent, and a number never shifts as the season progresses (every show
  // in the season counts, not just already-played ones). Scoped to what's
  // fetched here (unbounded future + last 2 days, plus the 12 most recent
  // past shows) — fine at this app's scale, where a season's shows
  // practically always fall inside that window, but a season with more
  // already-played shows than the "past" fetch's 12-show cap would
  // undercount its earliest games.
  const gameNumberOf = {};
  for (const se of (seas||[])){
    [...(up||[]), ...(past||[])]
      .filter(sh => se.start_date <= sh.showdate && sh.showdate <= se.end_date)
      .sort((a,b) => a.showdate.localeCompare(b.showdate))
      .forEach((sh, i) => { gameNumberOf[sh.id] = i + 1; });
  }
  // Keys on finalization, not date — a show belongs in "Just played" only
  // once league_shows.status flips to 'final'. The old rule (`showdate <
  // todayStr || status === 'final'`) treated the calendar date rolling
  // over at midnight as "played," which yanks a show that's still
  // mid-set — a normal jam show running late, not an edge case — into
  // Just Played hours before it's actually over.
  // showState() already knows open/live/locked/final/played/no-cutoff
  // from cutoff_at + status, so bucketing leans on it instead of
  // re-deriving date logic. The one case it genuinely can't resolve
  // without a date: no cutoff_at configured at all means there's nothing
  // to compare "now" against, so that alone falls back to showdate —
  // future/today stays Upcoming, past falls into Live (surfaced, not
  // hidden in Upcoming as if nothing's happening).
  const bucketOf = s => {
    if (s.status === "final") return "final";
    const st = showState(s);
    if (st === "open") return "upcoming";
    if (st === "no cutoff") return s.showdate >= todayStr ? "upcoming" : "live";
    return "live"; // live, locked, played — cutoff's passed, not final yet
  };
  const upcoming = (up||[]).filter(s => bucketOf(s) === "upcoming");
  // The show people most want to reach: cutoff's passed, maybe mid-
  // setlist, not finalized yet. Nothing date-based moves it out of here —
  // only finalizing does, into Just played. Rendered below Just played
  // (see the panel order at the render call) so game numbering reads
  // consistently top to bottom; a halo (styles.css's .live-halo) carries
  // the "this one's urgent" signal instead of top position.
  const liveNow = (up||[]).filter(s => bucketOf(s) === "live");
  // "Just played" is the single most recently FINALIZED show, not
  // everything still inside the 2-day grace window — a two-night run or
  // festival weekend can put more than one already-final show in that
  // window. `id` is Carton's own show_id (see schema.sql's comment on the
  // column) — the closest thing to a same-day sequence this data has, so
  // ties on showdate break on it rather than an invented rule.
  const finalCandidates = (up||[]).filter(s => bucketOf(s) === "final")
    .sort((a,b) => b.showdate.localeCompare(a.showdate) || b.id - a.id);
  const justPlayed = finalCandidates.slice(0, 1);
  // Finalized, but not THE most recent — used to just vanish: excluded
  // from Upcoming (it's final), capped out of Just played (top-1 only),
  // and not old enough for the separate `past` fetch (showdate < graceStr)
  // to have picked it up either. A two-night run's earlier night belongs
  // in Recent, same as any other already-finished show — it was only
  // ever missing because Recent's data source didn't reach back into the
  // last-2-days window at all. Every entry here is inside that window
  // (showdate >= graceStr) and `past` is strictly older, so prepending
  // this ahead of `past` at the render call keeps Recent's newest-first
  // order correct with no re-sort needed.
  const extraRecent = finalCandidates.slice(1);
  const finals = [...(up||[]), ...(past||[])].filter(s => s.status === "final").map(s => s.id);
  const winners = {};
  if (finals.length){
    const sc = await rpc("get_bracket_scores", { p_name:state.session.name, p_pin:state.session.pin, p_bracket_id: state.currentBracketId });
    const relevant = (sc||[]).filter(s => finals.includes(s.show_id));
    const best = {};
    for (const s of relevant){
      if (s.points <= 0) continue;
      if (!best[s.show_id] || s.points > best[s.show_id]) best[s.show_id] = s.points;
    }
    for (const s of relevant){
      if (s.points > 0 && s.points === best[s.show_id])
        (winners[s.show_id] ??= { points: s.points, names: [] }).names.push(s.player_name || "?");
    }
  }
  // Official-without-a-covering-season is visible up front (greyed row),
  // not just discovered after tapping Pick — but the Pick button and the
  // existing "tap through, see the reason, link to Casual" flow stay as-is.
  // seasonLast is omitted for the "Just played" list below, which renders
  // outside withSeasons() and stays un-sectioned by design — no season
  // header or closing rule there either. gameNumber IS passed through
  // (see the call site) — a show's game number is intrinsic to it, not a
  // property of which list happens to be rendering it right now.
  const row = (s, { gameNumber, seasonLast } = {}) => {
    const st = showState(s);
    const cls = { open:"open", live:"live", locked:"locked", final:"final", played:"final" }[st] || "";
    const cd = st === "open" ? countdown(s.cutoff_at) : null;
    const txt = st === "final" ? "complete" : (st === "open" && cd ? "cutoff in " + cd : st);
    // Always its own line under city/pill, everywhere (Just Played, Recent,
    // and in practice never Upcoming since nothing's final yet there) —
    // used to be Just-Played-only on the theory that Recent's longer list
    // couldn't afford the extra line, but inline was wrapping into the
    // city/pill text on real phone widths, which is worse.
    const winHtml = st === "final" && winners[s.id]
      ? `<div class="win-line">${winBadge(28)} ${winners[s.id].names.map(esc).join(" & ")}</div>` : "";
    const noSeason = isOfficial && !seasonOf(s.showdate);
    const { wk, md } = fmtDateParts(s.showdate);
    return `<div class="showrow${noSeason ? " unavailable" : ""}${seasonLast ? " season-last" : ""}">
      <div class="date"><span class="wk">${wk}</span><span>${md}</span>${gameNumber ? `<span class="gamenum">${gameNumber}</span>` : ""}</div>
      <div class="v"><div class="venue">${esc(s.venue||"TBA")}</div>
        <div class="loc">${esc(s.city||"")}${s.state?", "+esc(s.state):""}
          <span class="pill ${cls}" data-cd="${st==='open'?s.cutoff_at:''}">${txt}</span></div>
        ${winHtml}</div>
      ${(() => {
        const btn = pickButtonInfo(s);
        const cls = [btn.stacked && "stacked", btn.quiet && "quiet"].filter(Boolean).join(" ");
        return `<button onclick="openShow(${s.id})"${cls ? ` class="${cls}"` : ""}>${btn.label}${btn.markerHtml}</button>`;
      })()}
    </div>`;
  };
  // Shows outside any season get NO divider at all (not a "Between tours"
  // label, not a bare rule) — they just continue in the list. Casual never
  // has seasons, so seasonOf() is always null there and this list renders
  // with zero dividers, ever. A season's own heading only appears the moment
  // a show inside it is reached, and reappears if the list re-enters that
  // season after a gap (so resuming a season after an uncovered stretch
  // still gets its heading back, rather than staying silent because `last`
  // matched from before the gap).
  const withSeasons = list => {
    let last;
    return list.map((sh, i) => {
      const label = labelOf(sh.showdate);
      const brk = (label && label !== last) ? `<div class="season-break">Season: ${esc(label)}</div>` : "";
      // "Last of this season's group" = the very next row (in whatever
      // order this list is already in — chronological or reversed, doesn't
      // matter) belongs to a different season or none, or there is no next
      // row. Marks where the closing .season-end rule goes.
      const nextLabel = list[i+1] ? labelOf(list[i+1].showdate) : null;
      const seasonLast = label && label !== nextLabel;
      last = label;
      return brk + row(sh, { gameNumber: label ? gameNumberOf[sh.id] : null, seasonLast })
        + (seasonLast ? '<div class="season-end"></div>' : "");
    }).join("");
  };
  // Roster/opt-in ineligibility (as opposed to "no season covers this show")
  // applies uniformly to every show in the season, not per-row — so it's one
  // banner for the whole view rather than greying every row. Detected via
  // whichever show currently has a covering season, since the reason is a
  // property of the player's season membership, not the specific show.
  let rosterBanner = "";
  if (isOfficial){
    const covered = [...upcoming, ...liveNow, ...justPlayed, ...extraRecent].find(s => seasonOf(s.showdate));
    if (covered){
      try{
        const [gate] = await rpc("can_submit_picks", { p_name:state.session.name, p_pin:state.session.pin, p_bracket_id:state.currentBracketId, p_show_id:covered.id });
        if (gate && !gate.ok && /roster/i.test(gate.reason || "")) rosterBanner = gate.reason;
      }catch(e){ /* fail open — no banner rather than a confusing error here */ }
    }
  }
  $("#main").innerHTML = `
    ${rosterBanner ? `<div class="noticebox">${esc(rosterBanner)}</div>` : ""}
    ${justPlayed.length ? `<div class="panel"><h2>Just played</h2>${justPlayed.map(s => row(s, { gameNumber: labelOf(s.showdate) ? gameNumberOf[s.id] : null })).join("")}</div>` : ""}
    ${liveNow.length ? `<div class="panel live-halo"><h2>Live</h2>${liveNow.map(s => row(s, { gameNumber: labelOf(s.showdate) ? gameNumberOf[s.id] : null })).join("")}</div>` : ""}
    <div class="panel"><h2>Upcoming</h2>${withSeasons(upcoming) || '<p class="muted">No shows synced yet — admin can sync from The Carton.</p>'}</div>
    <div class="panel"><h2>Recent</h2>${withSeasons([...extraRecent, ...(past||[])]) || '<p class="muted">Nothing yet.</p>'}</div>
    ${footerHtml()}`;
  state.timers.push(setInterval(() => {
    document.querySelectorAll("[data-cd]").forEach(el => {
      if (!el.dataset.cd) return;
      const cd = countdown(el.dataset.cd);
      el.textContent = cd ? "cutoff in " + cd : "locked";
    });
  }, 1000));
}
