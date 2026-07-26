import { esc, isDesktop } from "./dom.js";
import { db, rpc } from "./supabaseClient.js";
import { state } from "./state.js";
import { toast } from "./toast.js";
import { showState } from "./format.js";
import { renderAll } from "./layout.js";
import { renderShows } from "../features/shows.js";
import { openShow } from "../features/picks.js";
import { renderBoard } from "../features/standings.js";
import { renderAdmin } from "../features/admin.js";

const myLastPts = {};
export function subscribeRealtime(){
  db.channel("live")
    .on("postgres_changes", { event:"INSERT", schema:"public", table:"setlist_songs" }, p => {
      const s = p.new;
      toast(`🎵 ${esc(s.songname)}${s.is_encore ? " (encore)" : ""}`, "", `song:${s.show_id}:${(s.songname||"").toLowerCase()}`);
      if (state.currentShow && state.tab !== "admin" && s.show_id === state.currentShow.id) openShow(state.currentShow.id);
    })
    .on("postgres_changes", { event:"UPDATE", schema:"public", table:"shows" }, async p => {
      const sh = p.new;
      const fresh = ts => ts && (Date.now() - new Date(ts).getTime()) < 3*60e3;
      if (fresh(sh.remind_sent)){
        let mine = [];
        try{ mine = await rpc("get_my_picks", { p_name:state.session.name, p_pin:state.session.pin, p_show_id:sh.id }); }catch(e){}
        toast(mine.length
          ? `⏰ 1 hour to lock — ${esc(sh.venue||sh.showdate)}. Your picks are in ✔`
          : `⏰ 1 hour to lock — ${esc(sh.venue||sh.showdate)}. You haven't voted!`, "", `remind:${sh.id}`);
      }
      if (fresh(sh.lock_sent))
        toast(`\u{1F512} Picks locked — ${esc(sh.venue||sh.showdate)}. Boards are public.`, "", `lock:${sh.id}`);
      if (fresh(sh.winner_sent)){
        try{
          const [{ data: sc }, { data: pl }] = await Promise.all([
            db.from("scores").select("player_id,points").eq("show_id", sh.id).order("points",{ascending:false}).limit(2),
            db.from("players_public").select("id,name"),
          ]);
          if (sc?.length){
            const pn = Object.fromEntries((pl||[]).map(x => [x.id, x.name]));
            toast(`\u{1F3C6} ${esc(pn[sc[0].player_id]||"?")} takes ${esc(sh.venue||sh.showdate)} with ${sc[0].points} pts`, "score", `win:${sh.id}`);
          }
        }catch(e){}
      }
    })
    .on("postgres_changes", { event:"UPDATE", schema:"public", table:"seasons" }, p => {
      const se = p.new;
      if (se.winner_sent && (Date.now() - new Date(se.winner_sent).getTime()) < 3*60e3)
        toast(`\u{1F451} ${esc(se.name)} is in the books — check Standings for the podium`, "score", `season:${se.id}`);
    })
    .on("postgres_changes", { event:"*", schema:"public", table:"scores" }, p => {
      if (p.new?.player_id === state.session?.id && myLastPts[p.new.show_id] !== p.new.points){
        myLastPts[p.new.show_id] = p.new.points;
        toast(`You're at ${p.new.points} pts for this show`, "score");
      }
      if (state.tab === "board") renderBoard();
    })
    .subscribe();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && state.session) refreshCurrent();
  });
}
export function refreshCurrent(){
  if (state.tab === "shows" && state.currentShow && showState(state.currentShow) === "open") return; // never wipe an in-progress pick sheet
  if (isDesktop()){ renderAll(); return; }
  if (state.tab === "board") renderBoard();
  else if (state.tab === "admin") renderAdmin();
  else if (state.currentShow) openShow(state.currentShow.id);
  else renderShows();
}
