import { esc, isDesktop } from "./dom.js";
import { db, rpc } from "./supabaseClient.js";
import { state } from "./state.js";
import { toast } from "./toast.js";
import { showState } from "./format.js";
import { renderAll, renderAdminOrSettings } from "./layout.js";
import { renderShows } from "../features/shows.js";
import { openShow } from "../features/picks.js";
import { renderBoard } from "../features/standings.js";

const myLastPts = {};
let channel = null;
let visListenerAttached = false;

// Teardown-and-rebuildable: called once at boot and again on every bracket
// switch, so it always tears down the previous subscription first — no
// stacking of stale channels for a bracket the player isn't looking at
// anymore.
export function subscribeRealtime(){
  if (channel) db.removeChannel(channel);
  channel = db.channel(`live-${state.currentBracketId}`)
    .on("postgres_changes", { event:"INSERT", schema:"public", table:"setlist_songs" }, p => {
      const s = p.new;
      toast(`🎵 ${esc(s.songname)}${s.is_encore ? " (encore)" : ""}`, "", `song:${s.show_id}:${(s.songname||"").toLowerCase()}`);
      if (state.currentShow && state.tab !== "admin" && s.show_id === state.currentShow.id) openShow(state.currentShow.id);
    })
    // remind_sent/lock_sent/winner_sent live on league_shows now (Stage A
    // moved them off `shows`), and that table has a real league_id column,
    // so the filter applies server-side. The payload no longer carries
    // venue/showdate, so a shows lookup fills in the toast text.
    .on("postgres_changes", { event:"UPDATE", schema:"public", table:"league_shows", filter:`league_id=eq.${state.currentLeagueId}` }, async p => {
      const ls = p.new;
      const fresh = ts => ts && (Date.now() - new Date(ts).getTime()) < 3*60e3;
      if (!fresh(ls.remind_sent) && !fresh(ls.lock_sent) && !fresh(ls.winner_sent)) return;
      const { data: sh } = await db.from("shows").select("*").eq("id", ls.show_id).single();
      if (!sh) return;
      if (fresh(ls.remind_sent)){
        let mine = [];
        try{ mine = await rpc("get_my_picks", { p_name:state.session.name, p_pin:state.session.pin, p_bracket_id:state.currentBracketId, p_show_id:sh.id }); }catch(e){}
        toast(mine.length
          ? `⏰ 1 hour to cutoff — ${esc(sh.venue||sh.showdate)}. Your picks are in ✔`
          : `⏰ 1 hour to cutoff — ${esc(sh.venue||sh.showdate)}. You haven't voted!`, "", `remind:${sh.id}`);
      }
      if (fresh(ls.lock_sent))
        toast(`\u{1F512} All picks locked — ${esc(sh.venue||sh.showdate)}. Boards are public.`, "", `lock:${sh.id}`);
      if (fresh(ls.winner_sent)){
        try{
          const sc = await rpc("get_bracket_scores", { p_name:state.session.name, p_pin:state.session.pin, p_bracket_id:state.currentBracketId, p_show_id: sh.id });
          const top = (sc||[]).slice().sort((a,b) => b.points - a.points)[0];
          if (top) toast(`\u{1F3C6} ${esc(top.player_name||"?")} takes ${esc(sh.venue||sh.showdate)} with ${top.points} pts`, "score", `win:${sh.id}`);
        }catch(e){}
      }
    })
    // seasons/scores only have bracket_id, not league_id — still a real
    // column on both, so this filters server-side rather than subscribing
    // unfiltered and checking client-side.
    .on("postgres_changes", { event:"UPDATE", schema:"public", table:"seasons", filter:`bracket_id=eq.${state.currentBracketId}` }, p => {
      const se = p.new;
      if (se.winner_sent && (Date.now() - new Date(se.winner_sent).getTime()) < 3*60e3)
        toast(`\u{1F451} ${esc(se.name)} is in the books — check Standings for the podium`, "score", `season:${se.id}`);
    })
    .on("postgres_changes", { event:"*", schema:"public", table:"scores", filter:`bracket_id=eq.${state.currentBracketId}` }, p => {
      if (p.new?.player_id === state.session?.id && myLastPts[p.new.show_id] !== p.new.points){
        myLastPts[p.new.show_id] = p.new.points;
        toast(`You're at ${p.new.points} pts for this show`, "score");
      }
      if (state.tab === "board") renderBoard();
    })
    // This class of failure is invisible by design otherwise: a channel
    // whose postgres_changes registration silently fails (e.g. subscribing
    // to a table absent from the publication — see the CLAUDE.md gotcha)
    // still reports SUBSCRIBED, since that status only reflects the
    // channel/socket join, not whether change events are actually being
    // delivered. A warning on any OTHER status is the only client-visible
    // signal something's wrong.
    .subscribe((status, err) => { if (status !== "SUBSCRIBED") console.warn("[realtime] channel status:", status, err || ""); });
  // Only ever attached once — subscribeRealtime() itself runs again on every
  // bracket switch, and a second document listener would fire refreshCurrent()
  // multiple times per visibility change.
  if (!visListenerAttached){
    visListenerAttached = true;
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && state.session) refreshCurrent();
    });
  }
}
export function refreshCurrent(){
  if (state.tab === "shows" && state.currentShow && showState(state.currentShow) === "open") return; // never wipe an in-progress pick sheet
  if (isDesktop()){ renderAll(); return; }
  if (state.tab === "board") renderBoard();
  // "admin" is the shared third-tab slot — Admin for league admins,
  // Settings for everyone else (same sentinel value either way, see
  // settings.js's renderSettings). Calling renderAdmin() directly here
  // instead of the role-aware dispatcher rendered the admin-only panel
  // (and its admin-gated RPC calls) for a NON-admin on the Settings tab —
  // happened to look correct in every admin-tested session since
  // isCurrentLeagueAdmin() made the two calls equivalent for an admin.
  else if (state.tab === "admin") renderAdminOrSettings();
  else if (state.currentShow) openShow(state.currentShow.id);
  else renderShows();
}
