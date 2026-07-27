// ============================================================
// FANTASY TOUR — carton-sync edge function (Deno / Supabase)
// v3: six slot types (opener, set1_closer, set2_opener, closer,
//     encore, show_closer) · diff-only setlist/score writes so
//     realtime events fire once per actual change (toast fix) ·
//     default cutoff 6 PM ET on new shows · burst polling ·
//     Discord webhook announcements.
// Actions (POST JSON body {action: ...}):
//   sync_shows | sync_songs | score (default)
// ============================================================

import { createClient } from "npm:@supabase/supabase-js@2";

// Instance constant: setlist data source.
const CARTON = "https://thecarton.net/api/v2";
const BURST_POLLS = 3;
const BURST_GAP_MS = 18_000;
const DEFAULT_CUTOFF_HOUR_ET = 18; // 6 PM Eastern

const supa = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
};

async function carton(path: string) {
  const res = await fetch(`${CARTON}${path}`);
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); }
  catch { throw new Error(`Carton ${path} returned non-JSON: ${text.slice(0, 120)}`); }
  if (body.error) throw new Error(`Carton ${path}: ${body.error_message}`);
  return body.data ?? [];
}

async function notify(msg: string) {
  const hook = Deno.env.get("DISCORD_WEBHOOK");
  if (!hook || !msg) return;
  await fetch(hook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: msg.slice(0, 1900) }),
  }).catch(() => {});
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const norm = (s: string) =>
  (s || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ").trim();

function etHour(): number {
  return Number(new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", hour: "numeric", hour12: false,
  }).format(new Date()));
}

function easternDate(offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 864e5);
  return new Intl.DateTimeFormat("sv", { timeZone: "America/New_York" }).format(d);
}

// ---- venue-local default cutoffs ----
const STATE_TZ: Record<string, string> = {
  CT:"America/New_York", DE:"America/New_York", DC:"America/New_York", FL:"America/New_York",
  GA:"America/New_York", IN:"America/Indiana/Indianapolis", KY:"America/New_York", ME:"America/New_York",
  MD:"America/New_York", MA:"America/New_York", MI:"America/Detroit", NH:"America/New_York",
  NJ:"America/New_York", NY:"America/New_York", NC:"America/New_York", OH:"America/New_York",
  PA:"America/New_York", RI:"America/New_York", SC:"America/New_York", VT:"America/New_York",
  VA:"America/New_York", WV:"America/New_York",
  AL:"America/Chicago", AR:"America/Chicago", IL:"America/Chicago", IA:"America/Chicago",
  KS:"America/Chicago", LA:"America/Chicago", MN:"America/Chicago", MS:"America/Chicago",
  MO:"America/Chicago", NE:"America/Chicago", ND:"America/Chicago", OK:"America/Chicago",
  SD:"America/Chicago", TN:"America/Chicago", TX:"America/Chicago", WI:"America/Chicago",
  AZ:"America/Phoenix", CO:"America/Denver", ID:"America/Boise", MT:"America/Denver",
  NM:"America/Denver", UT:"America/Denver", WY:"America/Denver",
  CA:"America/Los_Angeles", NV:"America/Los_Angeles", OR:"America/Los_Angeles", WA:"America/Los_Angeles",
  AK:"America/Anchorage", HI:"Pacific/Honolulu",
  ON:"America/Toronto", QC:"America/Toronto", BC:"America/Vancouver", AB:"America/Edmonton",
};
function venueTz(state: string | null): string {
  const key = (state ?? "").trim().toUpperCase();
  return STATE_TZ[key] ?? STATE_TZ[key.slice(0, 2)] ?? "America/New_York";
}

// "6 PM local at the venue on <showdate>" as a UTC timestamp, DST-aware.
function venueCutoffISO(showdate: string, state: string | null, hour = DEFAULT_CUTOFF_HOUR_ET): string {
  const tz = venueTz(state);
  let offMin = -240; // fallback EDT
  try {
    const probe = new Date(`${showdate}T12:00:00Z`);
    const val = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "shortOffset" })
      .formatToParts(probe).find((p) => p.type === "timeZoneName")?.value ?? "GMT-4";
    const m = val.match(/GMT([+-]\d+)(?::(\d+))?/);
    if (m) offMin = parseInt(m[1]) * 60 + (parseInt(m[1]) < 0 ? -1 : 1) * parseInt(m[2] ?? "0");
  } catch (_) { /* keep fallback */ }
  const utcMs = Date.parse(`${showdate}T${String(hour).padStart(2, "0")}:00:00Z`) - offMin * 60_000;
  return new Date(utcMs).toISOString();
}

// ---------- sync shows ----------
async function syncShows() {
  const rows = await carton(`/shows.json?order_by=showdate&direction=desc&limit=200`);
  const floor = new Date(Date.now() - 14 * 864e5).toISOString().slice(0, 10);
  const incoming = rows
    .filter((r: any) => r.showdate >= floor)
    .map((r: any) => ({
      id: Number(r.show_id),
      showdate: r.showdate,
      venue: r.venuename ?? r.venue ?? null,
      city: r.city ?? null,
      state: r.state ?? null,
    }));
  for (const s of incoming) {
    await supa.from("shows").upsert(s, { onConflict: "id" });
  }
  // Festival-tagged shows default to one_set format (promote only — a manual
  // admin toggle back to standard is never overwritten by later syncs... unless
  // synced again; toggle after the show list is stable).
  try {
    const fest = await carton(`/shows.json?show_tag=festival&order_by=showdate&direction=desc&limit=100`);
    const festIds = fest.map((r: any) => Number(r.show_id)).filter(Boolean);
    if (festIds.length) {
      await supa.from("shows").update({ format: "one_set" })
        .in("id", festIds).eq("format", "standard");
    }
  } catch (_) { /* tag not in use — fine */ }
  // Default cutoff (6 PM ET on show day) wherever the admin hasn't set one.
  const { data: blank } = await supa.from("shows")
    .select("id,showdate,state").is("cutoff_at", null).gte("showdate", floor);
  let defaulted = 0;
  for (const s of blank ?? []) {
    await supa.from("shows").update({ cutoff_at: venueCutoffISO(s.showdate, s.state) }).eq("id", s.id);
    defaulted++;
  }
  return { synced: incoming.length, cutoffs_defaulted: defaulted };
}

// ---------- sync songs ----------
async function syncSongs() {
  const rows = await carton(`/songs.json`);
  const upserts = rows.map((r: any) => ({
    songname: r.name ?? r.songname,
    times_played: Number(r.times_played ?? 0) || null,
    last_played: r.last_played || null,
    is_original: r.isoriginal != null ? Boolean(Number(r.isoriginal)) : null,
  })).filter((r: any) => r.songname);
  for (let i = 0; i < upserts.length; i += 500) {
    const { error } = await supa.from("songs_cache")
      .upsert(upserts.slice(i, i + 500), { onConflict: "songname" });
    if (error) throw error;
  }
  return { songs: upserts.length };
}

// ---------- scoring ----------
async function eligibleShows() {
  const floor = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
  const { data, error } = await supa.from("shows")
    .select("*").gte("showdate", floor).neq("status", "final")
    .not("cutoff_at", "is", null).lte("cutoff_at", new Date().toISOString());
  if (error) throw error;
  return data ?? [];
}

function isLiveWindow(show: any) {
  return show.showdate === easternDate(0) || show.showdate === easternDate(-1);
}

// Shows close themselves at 8 AM ET the morning after (if no admin finalized them):
// after 8 AM, everything dated before today finalizes; before 8 AM, only older shows.
async function autoFinalize() {
  const cut = etHour() >= 8 ? easternDate(0) : easternDate(-1);
  const { data } = await supa.from("shows")
    .select("*").lt("showdate", cut).neq("status", "final");
  let n = 0;
  for (const s of data ?? []) {
    if (s.cutoff_at) await scoreOne(s).catch(() => {});
    await supa.from("shows").update({ status: "final" }).eq("id", s.id);
    n++;
  }
  return n;
}

async function playerNames() {
  const { data } = await supa.from("players").select("id,name");
  return Object.fromEntries((data ?? []).map((p: any) => [p.id, p.name]));
}

async function announcements() {
  const nowIso = new Date().toISOString();
  const soonIso = new Date(Date.now() + 60 * 60_000).toISOString();

  // (a) 1-hour warning, naming the unvoted
  {
    const { data: shows } = await supa.from("shows").select("*")
      .is("remind_sent", null).gt("cutoff_at", nowIso).lte("cutoff_at", soonIso).neq("status", "final");
    for (const sh of shows ?? []) {
      const [pn, { data: picks }] = await Promise.all([
        playerNames(),
        supa.from("picks").select("player_id").eq("show_id", sh.id),
      ]);
      const voted = new Set((picks ?? []).map((p: any) => p.player_id));
      const missing = Object.entries(pn).filter(([id]) => !voted.has(id)).map(([, n]) => n);
      await notify(missing.length
        ? `\u23F0 **1 hour to lock** \u2014 ${sh.venue ?? sh.showdate}. Still waiting on: ${missing.join(", ")}`
        : `\u23F0 **1 hour to lock** \u2014 ${sh.venue ?? sh.showdate}. Everyone's in \u{1F95A}`);
      await supa.from("shows").update({ remind_sent: nowIso }).eq("id", sh.id);
    }
  }
  // (b) lock announcement
  {
    const { data: shows } = await supa.from("shows").select("*")
      .is("lock_sent", null).not("cutoff_at", "is", null)
      .lte("cutoff_at", nowIso).gte("showdate", easternDate(-1));
    for (const sh of shows ?? []) {
      const { data: picks } = await supa.from("picks").select("player_id").eq("show_id", sh.id);
      const n = new Set((picks ?? []).map((p: any) => p.player_id)).size;
      await notify(`\u{1F512} **Picks are locked** for ${sh.venue ?? sh.showdate} \u2014 ${n} sheets in. Boards are live in the app.`);
      await supa.from("shows").update({ lock_sent: nowIso }).eq("id", sh.id);
    }
  }
  // (c) show winner (fires within a minute of finalize, manual or auto)
  {
    const { data: shows } = await supa.from("shows").select("*")
      .is("winner_sent", null).eq("status", "final").gte("showdate", easternDate(-7));
    for (const sh of shows ?? []) {
      const { data: sc } = await supa.from("scores").select("player_id,points")
        .eq("show_id", sh.id).order("points", { ascending: false });
      if (sc?.length) {
        const pn = await playerNames();
        const top = sc[0].points;
        const winners = sc.filter((x: any) => x.points === top).map((x: any) => pn[x.player_id]);
        const runner = sc.find((x: any) => x.points < top);
        await notify(`\u{1F3C6} **${sh.venue ?? sh.showdate}** is final \u2014 **${winners.join(" & ")}** take${winners.length > 1 ? "" : "s"} it with **${top} pts**${runner ? ` (next: ${pn[runner.player_id]} \u00B7 ${runner.points})` : ""}`);
      }
      await supa.from("shows").update({ winner_sent: nowIso }).eq("id", sh.id);
    }
  }
  // (d) season champion, once every show in range is final
  {
    const { data: seasons } = await supa.from("seasons").select("*")
      .is("winner_sent", null).lt("end_date", easternDate(0));
    for (const se of seasons ?? []) {
      const { data: sshows } = await supa.from("shows").select("id,status")
        .gte("showdate", se.start_date).lte("showdate", se.end_date);
      if ((sshows ?? []).some((x: any) => x.status !== "final")) continue; // not settled yet
      const ids = (sshows ?? []).map((x: any) => x.id);
      if (ids.length) {
        const { data: sc } = await supa.from("scores").select("player_id,points").in("show_id", ids);
        const totals: Record<string, number> = {};
        for (const r of sc ?? []) totals[r.player_id] = (totals[r.player_id] ?? 0) + r.points;
        const ranked = Object.entries(totals).sort((a, b) => b[1] - a[1]);
        if (ranked.length) {
          const pn = await playerNames();
          const podium = ranked.slice(0, 3).map(([id, p], i) =>
            `${["\u{1F947}", "\u{1F948}", "\u{1F949}"][i]} ${pn[id]} \u00B7 ${p}`).join("   ");
          await notify(`\u{1F451} **${se.name} is in the books!**\n${podium}`);
        }
      }
      await supa.from("seasons").update({ winner_sent: nowIso }).eq("id", se.id);
    }
  }
}

async function scoreShows() {
  const autoclosed = await autoFinalize();
  await announcements();
  let shows = await eligibleShows();
  if (!shows.length) return { scored: [], autoclosed, note: "no eligible shows" };
  const live = shows.some(isLiveWindow);
  const rounds = live ? BURST_POLLS : 1;
  let results: any[] = [];
  for (let i = 0; i < rounds; i++) {
    if (i > 0) { await sleep(BURST_GAP_MS); shows = await eligibleShows(); }
    results = [];
    for (const show of shows) results.push(await scoreOne(show));
  }
  return { scored: results, burst: live, autoclosed };
}

async function scoreOne(show: any) {
  const rows = await carton(`/setlists/showdate/${show.showdate}.json`);
  const mine = rows.filter((r: any) => Number(r.show_id) === Number(show.id));
  const use = mine.length ? mine : rows;
  if (!use.length) return { show: show.id, note: "no setlist yet" };

  use.sort((a: any, b: any) => Number(a.position) - Number(b.position));
  const songs = use.map((r: any) => ({
    show_id: show.id,
    position: Number(r.position),
    setnumber: String(r.setnumber ?? ""),
    is_encore: /e/i.test(String(r.setnumber ?? "")) || /encore/i.test(String(r.settype ?? "")),
    songname: r.songname ?? r.song ?? "",
    is_cover: r.isoriginal != null ? !Number(r.isoriginal) : null,
    footnote: [r.footnote, Array.isArray(r.footnotes) ? r.footnotes.join("; ") : null]
      .filter(Boolean).join("; ") || null,
  })).filter((s: any) => s.songname);
  if (!songs.length) return { show: show.id, note: "empty setlist" };

  // ---- DIFF against what's stored; write ONLY changes (toast-storm fix) ----
  const { data: prevRows } = await supa.from("setlist_songs")
    .select("position,songname,setnumber,is_encore").eq("show_id", show.id);
  const prevByPos = new Map((prevRows ?? []).map((r: any) => [r.position, r]));
  const changed = songs.filter((s: any) => {
    const p = prevByPos.get(s.position);
    return !p || p.songname !== s.songname || p.setnumber !== s.setnumber || !!p.is_encore !== s.is_encore;
  });
  if (changed.length) {
    await supa.from("setlist_songs").upsert(changed, { onConflict: "show_id,position" });
  }
  const maxPos = Math.max(...songs.map((s: any) => s.position));
  if ((prevRows ?? []).some((r: any) => r.position > maxPos)) {
    await supa.from("setlist_songs").delete().eq("show_id", show.id).gt("position", maxPos);
  }

  // announce genuinely new songs (skip full-setlist backfills of past shows)
  const prevSet = new Set((prevRows ?? []).map((r: any) => norm(r.songname)));
  const newSongs = songs.filter((s: any) => !prevSet.has(norm(s.songname)));
  if (newSongs.length && (prevSet.size > 0 || isLiveWindow(show))) {
    const head = prevSet.size === 0 ? `🥚 **Show's on** — ${show.venue ?? show.showdate}\n` : "";
    await notify(head + newSongs.map((s: any) =>
      `🎵 **${s.songname}**${s.is_encore ? " *(encore)*" : ""}`).join("\n"));
  }

  // ---- derive slot targets ----
  const nonEncore = songs.filter((s: any) => !s.is_encore);
  const encore = songs.filter((s: any) => s.is_encore);
  // group non-encore songs into sets by first-seen setnumber (naming-agnostic)
  const setOrder: string[] = [];
  const setGroups: Record<string, any[]> = {};
  for (const s of nonEncore) {
    if (!(s.setnumber in setGroups)) { setGroups[s.setnumber] = []; setOrder.push(s.setnumber); }
    setGroups[s.setnumber].push(s);
  }
  const set1 = setGroups[setOrder[0]] ?? [];
  const set2 = setGroups[setOrder[1]] ?? [];
  const opener = nonEncore[0]?.songname ?? songs[0].songname;
  const closer = nonEncore.length ? nonEncore[nonEncore.length - 1].songname : null;
  const encoreSet = new Set(encore.map((s: any) => norm(s.songname)));
  const played = new Set(songs.map((s: any) => norm(s.songname)));
  const eq = (a: string, b: string | null) => b != null && norm(a) === norm(b);
  const slotSong: Record<string, (pick: string) => boolean> = {
    opener:      (p) => eq(p, opener),
    set1_closer: (p) => eq(p, set1.length ? set1[set1.length - 1].songname : null),
    set2_opener: (p) => eq(p, set2.length ? set2[0].songname : null),
    closer:      (p) => eq(p, closer),
    encore:      (p) => encoreSet.has(norm(p)),
    show_closer: (p) => eq(p, songs[songs.length - 1].songname),
    second_song: (p) => songs.length > 1 && eq(p, songs[1].songname),
    cover_call:  (p) => songs.some((s: any) => s.is_cover === true && norm(s.songname) === norm(p)),
    debut_call:  (p) => songs.some((s: any) => /debut/i.test(s.footnote ?? "") && norm(s.songname) === norm(p)),
  };
  // slots whose target doesn't exist in this show's structure (e.g. set 2 at a one-setter)
  const slotImpossible: Record<string, boolean> = {
    set2_opener: set2.length === 0,
    set1_closer: set1.length === 0,
    encore: encore.length === 0,
    second_song: songs.length < 2,
    cover_call: !songs.some((s: any) => s.is_cover === true),
    debut_call: !songs.some((s: any) => /debut/i.test(s.footnote ?? "")),
  };

  // ---- config + picks ----
  const { data: cfgRow } = await supa.from("game_config").select("data").eq("id", 1).single();
  const cfg = cfgRow!.data;
  const sect = (show.format === "one_set" && cfg.oneset) ? cfg.oneset : cfg;
  const flatPts = Number(sect.flat_points ?? cfg.flat_points ?? 1);
  const slotPoints: Record<string, number> = {};
  const slotType: Record<string, string> = {};
  for (const s of sect.slots ?? []) {
    slotPoints[s.key] = Number(s.points ?? 2);
    slotType[s.key] = s.type ?? s.key;
  }

  const { data: picks } = await supa.from("picks").select("*").eq("show_id", show.id);
  const byPlayer: Record<string, any[]> = {};
  for (const p of picks ?? []) (byPlayer[p.player_id] ??= []).push(p);

  // existing scores, so we only write on change (second half of toast fix)
  const { data: prevScores } = await supa.from("scores")
    .select("player_id,points,breakdown").eq("show_id", show.id);
  const prevScore = new Map((prevScores ?? []).map((r: any) => [r.player_id, r]));

  let writes = 0;
  for (const [playerId, ppicks] of Object.entries(byPlayer)) {
    let total = 0;
    const breakdown: any[] = [];
    const anyDebut = songs.some((x: any) => /debut/i.test(x.footnote ?? ""));
    for (const p of ppicks) {
      let pts = 0, hit = false, reason = "not played";
      const isSlot = p.slot in slotPoints;
      if (norm(p.songname) === "any debut") {
        if (anyDebut) { pts = isSlot ? slotPoints[p.slot] : flatPts; hit = true; reason = "a debut was played"; }
        else reason = "no debut this show";
        total += pts;
        breakdown.push({ slot: p.slot, songname: p.songname, hit, points: pts, reason });
        continue;
      }
      const stype = slotType[p.slot] ?? p.slot;
      const exactHit = stype === "cover_pick"
        ? songs.some((x: any) => x.is_cover === true && norm(x.songname) === norm(p.songname))
        : slotSong[stype]?.(p.songname);
      if (isSlot && exactHit) {
        pts = slotPoints[p.slot]; hit = true;
        reason = stype === "cover_pick" ? "cover played" : `${stype} — exact`;
      } else if (played.has(norm(p.songname))) {
        hit = true;
        if (isSlot) {
          const why = slotImpossible[stype] ? "slot not played"
            : stype === "cover_pick" ? "played, but it's an original" : "played, wrong slot";
          if (cfg.partial_credit) { pts = Number(cfg.partial_points ?? 1); reason = why; }
          else reason = why + " (no partial credit)";
        } else { pts = flatPts; reason = "played"; }
      }
      if (hit && pts > 0) {
        const row = songs.find((s: any) => norm(s.songname) === norm(p.songname));
        const b = cfg.bonuses ?? {};
        if (row?.is_cover && Number(b.cover)) { pts += Number(b.cover); reason += " +cover"; }
        if (/debut/i.test(row?.footnote ?? "") && Number(b.debut)) { pts += Number(b.debut); reason += " +debut"; }
      }
      total += pts;
      breakdown.push({ slot: p.slot, songname: p.songname, hit, points: pts, reason });
    }
    const expected = (sect.slots?.length ?? 0) + Number(sect.flat_picks ?? 0);
    const perf = Number((cfg.bonuses ?? {}).perfect ?? 0);
    if (perf > 0 && expected > 0 && ppicks.length === expected && breakdown.every((x: any) => x.hit)) {
      total += perf;
      breakdown.push({ slot: "bonus", songname: "Perfect sheet", hit: true, points: perf, reason: "every pick hit" });
    }
    const prev = prevScore.get(playerId);
    if (!prev || prev.points !== total || JSON.stringify(prev.breakdown) !== JSON.stringify(breakdown)) {
      await supa.from("scores").upsert({
        player_id: playerId, show_id: show.id, points: total,
        breakdown, updated_at: new Date().toISOString(),
      }, { onConflict: "player_id,show_id" });
      writes++;
    }
  }

  if (show.status === "upcoming") {
    await supa.from("shows").update({ status: "live" }).eq("id", show.id);
  }
  return { show: show.id, songs: songs.length, new: newSongs.length, score_writes: writes };
}

// ---------- router ----------
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const { action } = await req.json().catch(() => ({ action: "score" }));
    const out =
      action === "sync_shows" ? await syncShows() :
      action === "sync_songs" ? await syncSongs() :
      await scoreShows();
    return Response.json({ ok: true, ...out }, { headers: cors });
  } catch (e) {
    return Response.json({ ok: false, error: String(e) }, { status: 500, headers: cors });
  }
});
