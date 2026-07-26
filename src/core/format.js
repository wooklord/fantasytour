import { state } from "./state.js";
import { isDesktop } from "./dom.js";

export function fmtDate(d){ return new Date(d + "T12:00:00").toLocaleDateString(undefined,{weekday:'short',month:'short',day:'numeric'}); }
export function fmtCutoff(ts){ if(!ts) return "TBD"; return new Date(ts).toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'}); }
export function countdown(ts){
  const ms = new Date(ts) - Date.now();
  if (ms <= 0) return null;
  const h = Math.floor(ms/36e5), m = Math.floor(ms%36e5/6e4), s = Math.floor(ms%6e4/1e3);
  return h > 0 ? `${h}h ${m}m` : `${m}m ${String(s).padStart(2,"0")}s`;
}
export function clearTimers(){ state.timers.forEach(clearInterval); state.timers = []; }
// desktop: only the shows column owns countdown timers; guard so board/admin re-renders don't kill them
export function clearTimersFor(which){ if (isDesktop() && which !== "shows") return; clearTimers(); }

export function showState(s){
  if (s.status === "final") return "final";
  const ov = (state.cfg && state.cfg.voting_override) || "auto";
  if (ov === "locked") return "locked";
  if (ov === "open" && s.showdate >= new Date().toLocaleDateString('sv')) return "open";
  if (!s.cutoff_at) return "no cutoff";
  if (new Date(s.cutoff_at) > new Date()) return "open";
  const twoDaysAgo = new Date(Date.now() - 2*864e5).toLocaleDateString('sv');
  if (s.showdate < twoDaysAgo) return "played";
  return s.status === "live" ? "live" : "locked";
}
