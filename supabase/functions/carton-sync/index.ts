// ============================================================
// FANTASY EGGY — carton-sync edge function (Deno / Supabase)
// v7 (Stage B, multi-tenant): global show/song sync now also creates and
//     refreshes a per-league league_shows overlay (auto-defaulted 6 PM
//     venue-local cutoffs) for every league; permalink is mapped from
//     Carton and kept in sync (updated, not insert-ignored) since a
//     corrected venue name regenerates the slug; a season-activation step
//     snapshots the frozen Official roster the moment a season starts;
//     scoring fetches each show's setlist ONCE and scores every bracket of
//     every league against that bracket's own config — Official reads the
//     frozen season_rosters snapshot (never the live opt-in flag), Casual
//     scores whoever picked (no seasons, no roster gate). Every pass scores
//     fresh off the current setlist snapshot (no merge against a previously-
//     stored result — see scoring.js for why that used to latch a wrong
//     positional slot in permanently). Set 1 Closer / Set 2 Closer / Show
//     Closer are the exception: each is `slotNotYetDetermined` until there's
//     real structural evidence the relevant set/show is over (Set 1 Closer:
//     set 2 or the encore starts; Set 2 Closer: the encore starts; Show
//     Closer: only at finalize, no earlier signal exists), and until then a
//     played pick in one of those slots gets consolation credit and an
//     honest "undetermined" label instead of a premature exact/wrong-slot
//     verdict. Carries forward the v6 batch (Cover Pick, Any Debut, "slot not
//     played" wording). Reopen un-finalizes a show, wipes that league's
//     scores for it (a genuine correction needs a clean re-score, not a
//     merge against wrong data), resets winner_sent, and announces.
//     Live toasts tag only slots that are unambiguous the instant they
//     happen (opener, set 2 opener, encore) plus debuts; closers are
//     positional and only ever shown after the fact. Discord is broadcast
//     (never personal/DMed), per-league webhook, deduped so a show that
//     scores under two brackets of the same league only posts once.
//     `reopen`, `cutoff_changed`, and `finalize` are name/PIN-authenticated
//     (verified against `_auth_player` + `_is_league_admin_or_global`, the
//     same guard the SQL RPCs use) — these mutate/notify per-league and must
//     not be callable by anyone holding the public anon key alone.
// Actions (POST JSON body {action, ...}):
//   sync_shows | sync_songs | score (default)
//   | reopen {p_name,p_pin,league_id,show_id}
//   | cutoff_changed {p_name,p_pin,league_id,show_id}
//   | finalize {p_name,p_pin,league_id,show_id}
// ============================================================

import { createClient } from "npm:@supabase/supabase-js@2";
import { norm, deriveSlotFacts, scorePicks } from "./scoring.js";

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

// Carton's text fields (venue/city/song names/footnotes) arrive with HTML
// entities already baked in (e.g. "Blues &amp; Brews Festival") — decoding
// here keeps the DB holding real characters, since the frontend's esc() is
// the only place display text should ever be HTML-encoded. Left undecoded,
// esc() re-encodes the leading & of "&amp;" into "&amp;amp;", which the
// browser then renders as the literal text "&amp;" instead of an ampersand.
// &amp; is decoded last so it can't cascade into re-triggering the other
// patterns (none of which decode back into "&", so this order is safe).
function decodeEntities<T extends string | null | undefined>(s: T): T {
  if (s == null) return s;
  return (s as string)
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&") as T;
}

// Discord is broadcast per league, never personal/DMed. There's no DB column
// for a per-league webhook yet, so this reads DISCORD_WEBHOOK_<LEAGUE NAME>
// first (e.g. DISCORD_WEBHOOK_AMBASSADORS) and falls back to the single
// DISCORD_WEBHOOK secret that already exists — keeps Ambassadors working
// with no new secret, and a future league just needs one more env var, no
// schema change, until that stops scaling.
function leagueWebhookEnvKey(leagueName: string) {
  return "DISCORD_WEBHOOK_" + leagueName.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}
async function notifyLeague(leagueName: string, msg: string) {
  if (!msg) return;
  const hook = Deno.env.get(leagueWebhookEnvKey(leagueName || "")) || Deno.env.get("DISCORD_WEBHOOK");
  if (!hook) return;
  await fetch(hook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: msg.slice(0, 1900) }),
  }).catch(() => {});
}

// scores/league_shows have zero public RLS SELECT policies by design (see
// sql/stage_j_realtime_ping.sql) — their own postgres_changes events never
// reach an anon-key client. This is the one write path for the ping table
// that tells such a client "this league+show changed, go refetch" without
// exposing anything real over the public channel. Called once per real
// state change (score writes that actually differ, a status flip, a
// remind/lock/winner_sent stamp, a reopen) — never unconditionally per
// poll — so a quiet cron tick with nothing new doesn't spam a refetch,
// the same discipline this file already applies to setlist_songs/scores
// writes themselves (diff first, write/notify only on a real change).
async function pingRealtime(leagueId: number, showId: number) {
  // Best-effort, same as this file's other secondary writes (e.g. the shows
  // upsert in syncShows) — supabase-js resolves {data,error} rather than
  // rejecting, so there's nothing to catch; a failed ping just doesn't ping,
  // it doesn't fail the scoring/notify pass it's reporting on.
  await supa.from("realtime_pings").upsert(
    { league_id: leagueId, show_id: showId, updated_at: new Date().toISOString() },
    { onConflict: "league_id,show_id" },
  );
}

// Tagged with `status` so the router's catch-all can tell "wrong name/PIN"
// (401) and "valid player, not authorized for this league" (403) apart from
// a genuine server error (500) — previously all three collapsed into the
// same generic 500, which is fine functionally but makes it impossible to
// tell an auth failure from a real bug from the response alone.
class AuthError extends Error { status = 401; }
class ForbiddenError extends Error { status = 403; }

// Admin-triggered actions (reopen, cutoff_changed, finalize) must not be
// callable by anyone holding just the public anon key. This calls the same
// two SQL helpers the RPC layer uses — `_auth_player` (PIN check) and
// `_is_league_admin_or_global` (spec §3's shared guard) — via the service-role
// client, which is granted access to both specifically for this purpose (see
// sql/stage_c1_rpcs.sql). Throws on either failure; callers should let that
// propagate to the router's catch-all error response.
async function requireLeagueAdmin(name: string, pin: string, leagueId: number) {
  const { data: player, error: authErr } = await supa.rpc("_auth_player", { p_name: name, p_pin: pin });
  if (authErr || !player?.id) throw new AuthError("Wrong name or PIN");
  const { data: ok, error: scopeErr } = await supa.rpc("_is_league_admin_or_global", {
    p_player_id: player.id, p_league_id: leagueId,
  });
  if (scopeErr || !ok) throw new ForbiddenError("Not authorized for this league");
  return player;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function etHour(): number {
  return Number(new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", hour: "numeric", hour12: false,
  }).format(new Date()));
}

function easternDate(offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 864e5);
  return new Intl.DateTimeFormat("sv", { timeZone: "America/New_York" }).format(d);
}

function groupBy<T>(rows: T[], key: (r: T) => number | string): Map<number | string, T[]> {
  const m = new Map<number | string, T[]>();
  for (const r of rows) {
    const k = key(r);
    const arr = m.get(k) ?? [];
    arr.push(r);
    m.set(k, arr);
  }
  return m;
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
// No fallback — null means the state genuinely didn't map, which callers
// that persist this (syncShows, for the admin panel's venue-local display)
// need to know explicitly rather than silently inheriting a guessed zone.
function resolveVenueTz(state: string | null): string | null {
  const key = (state ?? "").trim().toUpperCase();
  return STATE_TZ[key] ?? STATE_TZ[key.slice(0, 2)] ?? null;
}
// venueCutoffISO (below) always needs SOME zone to compute a default
// cutoff, so it keeps the old fallback-to-Eastern behavior via this wrapper.
function venueTz(state: string | null): string {
  return resolveVenueTz(state) ?? "America/New_York";
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

// ---------- sync shows (global) + per-league league_shows overlay ----------
async function syncShows() {
  const rows = await carton(`/shows.json?order_by=showdate&direction=desc&limit=200`);
  const floor = new Date(Date.now() - 14 * 864e5).toISOString().slice(0, 10);
  const incoming = rows
    .filter((r: any) => r.showdate >= floor)
    .map((r: any) => ({
      id: Number(r.show_id),
      showdate: r.showdate,
      venue: decodeEntities(r.venuename ?? r.venue ?? null),
      city: decodeEntities(r.city ?? null),
      state: r.state ?? null,
      // The slug embeds the venue name, so a corrected venue name regenerates
      // it — upsert (not insert-ignore) means a later sync always carries a
      // corrected permalink forward instead of leaving a stale, 404-ing one.
      permalink: r.permalink ?? null,
      // Resolved once here (not duplicated into the frontend) so the admin
      // panel can read a venue's real IANA zone as data. Null when `state`
      // doesn't map — self-heals on a later sync if the state gets
      // corrected or STATE_TZ gains a mapping, same as permalink above.
      timezone: resolveVenueTz(r.state ?? null),
    }));
  for (const s of incoming) {
    await supa.from("shows").upsert(s, { onConflict: "id" });
  }

  // Festival-tagged shows default to one_set format (promote only — a manual
  // admin toggle back to standard is never overwritten by a later sync).
  let festIds: number[] = [];
  try {
    const fest = await carton(`/shows.json?show_tag=festival&order_by=showdate&direction=desc&limit=100`);
    festIds = fest.map((r: any) => Number(r.show_id)).filter(Boolean);
  } catch (_) { /* tag not in use — fine */ }

  // Every league needs an overlay row for every show — not just at Stage A
  // migration time, but ongoing, so a brand-new league (the FB league) or a
  // brand-new show both get covered automatically on the next sync.
  const { data: leagues } = await supa.from("leagues").select("id");
  let overlaysCreated = 0, cutoffsDefaulted = 0;
  for (const lg of leagues ?? []) {
    const { data: existing } = await supa.from("league_shows")
      .select("show_id").eq("league_id", lg.id);
    const have = new Set((existing ?? []).map((r: any) => r.show_id));
    const missing = incoming.filter((s: any) => !have.has(s.id));
    for (const s of missing) {
      await supa.from("league_shows").insert({
        league_id: lg.id,
        show_id: s.id,
        cutoff_at: venueCutoffISO(s.showdate, s.state),
        format: festIds.includes(s.id) ? "one_set" : "standard",
      });
      overlaysCreated++; cutoffsDefaulted++;
    }
    if (festIds.length) {
      await supa.from("league_shows").update({ format: "one_set" })
        .eq("league_id", lg.id).in("show_id", festIds).eq("format", "standard");
    }
    // Default cutoff (6 PM venue-local) wherever nobody's set one yet.
    const { data: blank } = await supa.from("league_shows")
      .select("show_id").eq("league_id", lg.id).is("cutoff_at", null);
    for (const row of blank ?? []) {
      const s = incoming.find((x: any) => x.id === row.show_id);
      if (!s) continue;
      await supa.from("league_shows")
        .update({ cutoff_at: venueCutoffISO(s.showdate, s.state) })
        .eq("league_id", lg.id).eq("show_id", row.show_id);
      cutoffsDefaulted++;
    }
  }
  return { synced: incoming.length, overlays_created: overlaysCreated, cutoffs_defaulted: cutoffsDefaulted };
}

// ---------- sync songs (global catalog — unchanged by the multi-tenant split) ----------
async function syncSongs() {
  const rows = await carton(`/songs.json`);
  const upserts = rows.map((r: any) => ({
    songname: decodeEntities(r.name ?? r.songname),
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

// ---------- season activation ----------
// Any Official season whose start date has arrived and hasn't been snapshot
// yet gets its roster written once, from whoever is currently opted in (and
// not banned) in that season's league. From then on scoring reads ONLY this
// snapshot, never the live opt-in flag — frozen in both directions, so an
// opt-out or a boot mid-season leaves that player on the board.
//
// Confirmed live (season 6, "Test 2"): a plain `.insert(rows)` with no
// conflict handling and no error check silently wrote ZERO roster rows for
// an entire season, because one row in the batch already existed (an admin
// had pre-added a player to that season's roster before it activated) —
// Postgres aborts the WHOLE multi-row INSERT on a single primary-key
// conflict, and roster_locked_at got stamped on the very next line
// regardless, turning a recoverable error into a permanent, invisible one.
// Fixed two ways: (1) upsert with ignoreDuplicates instead of a bare
// insert, so an already-present (season_id,player_id) row is skipped, not
// fatal to the batch — and left untouched, not overwritten, so a manual
// pre-add's own added_at survives; (2) roster_locked_at is now stamped
// ONLY if the write actually succeeded — on error, this season is left
// with roster_locked_at still null, so the next cron run retries it
// instead of the failure being recorded as a silent success. Any failure
// also logs (console.error) and is returned in `failed`, threaded into
// scoreShows()'s response, so it's visible without a forensic query.
async function activateSeasons() {
  const today = easternDate(0);
  const { data: seasons } = await supa.from("seasons")
    .select("id,bracket_id,name").lte("start_date", today).is("roster_locked_at", null);
  let activated = 0;
  const failed: string[] = [];
  for (const se of seasons ?? []) {
    const { data: bracket } = await supa.from("brackets").select("league_id").eq("id", se.bracket_id).single();
    if (!bracket) continue;
    const { data: members } = await supa.from("league_members").select("player_id")
      .eq("league_id", bracket.league_id).eq("official_opt_in", true).eq("banned", false);
    const joinedAt = new Date().toISOString();
    const rows = (members ?? []).map((m: any) => ({ season_id: se.id, player_id: m.player_id, added_at: joinedAt }));
    let insertError = null;
    if (rows.length) {
      const { error } = await supa.from("season_rosters")
        .upsert(rows, { onConflict: "season_id,player_id", ignoreDuplicates: true });
      insertError = error;
    }
    if (insertError) {
      console.error(`activateSeasons: season ${se.id} (${se.name}) roster write failed, will retry next run:`, insertError);
      failed.push(`${se.id}:${se.name}`);
      continue; // roster_locked_at stays null -- next run retries this season
    }
    await supa.from("seasons").update({ roster_locked_at: new Date().toISOString() }).eq("id", se.id);
    activated++;
  }
  return { activated, failed };
}

// ---------- eligible league_shows for scoring ----------
// A show becomes eligible the moment ANY league's overlay says cutoff has
// passed and it isn't final yet — leagues finalize/reopen the same global
// show independently of each other.
async function eligibleLeagueShows() {
  const { data: ls, error } = await supa.from("league_shows").select("*")
    .neq("status", "final").not("cutoff_at", "is", null)
    .lte("cutoff_at", new Date().toISOString());
  if (error) throw error;
  if (!ls?.length) return [];
  const floor = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
  const showIds = [...new Set(ls.map((r: any) => r.show_id))];
  const { data: shows } = await supa.from("shows").select("*").in("id", showIds).gte("showdate", floor);
  const showById = new Map((shows ?? []).map((s: any) => [s.id, s]));
  return ls.filter((r: any) => showById.has(r.show_id))
    .map((r: any) => ({ ...r, show: showById.get(r.show_id) }));
}

function isLiveWindow(show: any) {
  return show.showdate === easternDate(0) || show.showdate === easternDate(-1);
}

async function playerNames() {
  const { data } = await supa.from("players").select("id,name");
  return Object.fromEntries((data ?? []).map((p: any) => [p.id, p.name]));
}

// Shows close themselves at 8 AM ET the morning after (if no admin finalized
// them), per league: after 8 AM, everything dated before today finalizes;
// before 8 AM, only older shows.
async function autoFinalize() {
  const cut = etHour() >= 8 ? easternDate(0) : easternDate(-1);
  const rows = await eligibleLeagueShows();
  let n = 0;
  for (const r of rows) {
    if (r.show.showdate >= cut) continue; // not old enough to auto-close yet
    await scoreShow(r.show, [r], true).catch(() => {}); // one last score against the final setlist
    await supa.from("league_shows").update({ status: "final" })
      .eq("league_id", r.league_id).eq("show_id", r.show_id);
    n++;
  }
  return n;
}

// ---------- announcements (per league) ----------
async function announcements() {
  const nowIso = new Date().toISOString();
  const soonIso = new Date(Date.now() + 60 * 60_000).toISOString();
  const { data: leagues } = await supa.from("leagues").select("id,name");
  const leagueName = new Map((leagues ?? []).map((l: any) => [l.id, l.name]));

  // (a) 1-hour warning, naming whoever hasn't picked in either bracket yet
  {
    const { data: lsRows } = await supa.from("league_shows").select("*")
      .is("remind_sent", null).gt("cutoff_at", nowIso).lte("cutoff_at", soonIso).neq("status", "final");
    for (const ls of lsRows ?? []) {
      const { data: show } = await supa.from("shows").select("venue,showdate").eq("id", ls.show_id).single();
      const [{ data: members }, { data: brackets }] = await Promise.all([
        supa.from("league_members").select("player_id").eq("league_id", ls.league_id).eq("banned", false),
        supa.from("brackets").select("id").eq("league_id", ls.league_id),
      ]);
      const bracketIds = (brackets ?? []).map((b: any) => b.id);
      const { data: picks } = await supa.from("picks").select("player_id")
        .eq("show_id", ls.show_id).in("bracket_id", bracketIds.length ? bracketIds : [-1]);
      const voted = new Set((picks ?? []).map((p: any) => p.player_id));
      const pn = await playerNames();
      const missing = (members ?? []).filter((m: any) => !voted.has(m.player_id))
        .map((m: any) => pn[m.player_id]).filter(Boolean);
      const label = show?.venue ?? show?.showdate ?? `show ${ls.show_id}`;
      await notifyLeague(leagueName.get(ls.league_id) ?? "", missing.length
        ? `⏰ **1 hour to lock** — ${label}. Still waiting on: ${missing.join(", ")}`
        : `⏰ **1 hour to lock** — ${label}. Everyone's in \u{1F95A}`);
      await supa.from("league_shows").update({ remind_sent: nowIso })
        .eq("league_id", ls.league_id).eq("show_id", ls.show_id);
      await pingRealtime(ls.league_id, ls.show_id);
    }
  }
  // (b) lock announcement
  {
    const { data: lsRows } = await supa.from("league_shows").select("*")
      .is("lock_sent", null).not("cutoff_at", "is", null).lte("cutoff_at", nowIso);
    for (const ls of lsRows ?? []) {
      const { data: show } = await supa.from("shows").select("venue,showdate").eq("id", ls.show_id).single();
      if (!show || show.showdate < easternDate(-1)) continue; // don't spam-lock ancient shows on first sync
      const { data: brackets } = await supa.from("brackets").select("id").eq("league_id", ls.league_id);
      const bracketIds = (brackets ?? []).map((b: any) => b.id);
      const { data: picks } = await supa.from("picks").select("player_id")
        .eq("show_id", ls.show_id).in("bracket_id", bracketIds.length ? bracketIds : [-1]);
      const n = new Set((picks ?? []).map((p: any) => p.player_id)).size;
      const label = show.venue ?? show.showdate;
      await notifyLeague(leagueName.get(ls.league_id) ?? "",
        `\u{1F512} **Picks are locked** for ${label} — ${n} sheets in. Boards are live in the app.`);
      await supa.from("league_shows").update({ lock_sent: nowIso })
        .eq("league_id", ls.league_id).eq("show_id", ls.show_id);
      await pingRealtime(ls.league_id, ls.show_id);
    }
  }
  // (c) show winner (fires within a minute of finalize, manual or auto) —
  // one message per league, bundling every bracket that league runs.
  {
    const { data: lsRows } = await supa.from("league_shows").select("*")
      .is("winner_sent", null).eq("status", "final");
    for (const ls of lsRows ?? []) {
      const { data: show } = await supa.from("shows").select("venue,showdate").eq("id", ls.show_id).single();
      if (!show || show.showdate < easternDate(-7)) {
        // Too old to be worth announcing (e.g. first sync after a long gap) —
        // still flag it so this loop doesn't keep revisiting it forever.
        await supa.from("league_shows").update({ winner_sent: nowIso })
          .eq("league_id", ls.league_id).eq("show_id", ls.show_id);
        await pingRealtime(ls.league_id, ls.show_id);
        continue;
      }
      const { data: brackets } = await supa.from("brackets").select("id,name").eq("league_id", ls.league_id);
      const pn = await playerNames();
      const parts: string[] = [];
      for (const b of brackets ?? []) {
        const { data: sc } = await supa.from("scores").select("player_id,points")
          .eq("bracket_id", b.id).eq("show_id", ls.show_id).order("points", { ascending: false });
        if (!sc?.length) continue;
        const top = sc[0].points;
        if (top <= 0) continue;
        const winners = sc.filter((x: any) => x.points === top).map((x: any) => pn[x.player_id]);
        parts.push(`**${b.name}**: ${winners.join(" & ")} · ${top} pts`);
      }
      const label = show.venue ?? show.showdate;
      if (parts.length) {
        await notifyLeague(leagueName.get(ls.league_id) ?? "", `\u{1F3C6} **${label}** is final\n${parts.join("\n")}`);
      }
      await supa.from("league_shows").update({ winner_sent: nowIso })
        .eq("league_id", ls.league_id).eq("show_id", ls.show_id);
      await pingRealtime(ls.league_id, ls.show_id);
    }
  }
  // (d) season champion, once every show in range is final for that bracket's league
  {
    const { data: seasons } = await supa.from("seasons").select("*")
      .is("winner_sent", null).lt("end_date", easternDate(0));
    for (const se of seasons ?? []) {
      const { data: bracket } = await supa.from("brackets").select("league_id").eq("id", se.bracket_id).single();
      if (!bracket) continue;
      const { data: sshows } = await supa.from("shows").select("id")
        .gte("showdate", se.start_date).lte("showdate", se.end_date);
      const showIds = (sshows ?? []).map((x: any) => x.id);
      if (showIds.length) {
        const { data: lsStatus } = await supa.from("league_shows").select("status")
          .eq("league_id", bracket.league_id).in("show_id", showIds);
        if ((lsStatus ?? []).some((x: any) => x.status !== "final")) continue; // not settled yet
        const { data: sc } = await supa.from("scores").select("player_id,points")
          .eq("bracket_id", se.bracket_id).in("show_id", showIds);
        const totals: Record<string, number> = {};
        for (const r of sc ?? []) totals[r.player_id] = (totals[r.player_id] ?? 0) + r.points;
        const ranked = Object.entries(totals).sort((a, b) => b[1] - a[1]);
        if (ranked.length) {
          const pn = await playerNames();
          const podium = ranked.slice(0, 3).map(([id, p], i) =>
            `${["\u{1F947}", "\u{1F948}", "\u{1F949}"][i]} ${pn[id]} · ${p}`).join("   ");
          await notifyLeague(leagueName.get(bracket.league_id) ?? "", `\u{1F451} **${se.name} is in the books!**\n${podium}`);
        }
      }
      await supa.from("seasons").update({ winner_sent: nowIso }).eq("id", se.id);
    }
  }
}

// ---------- scoring ----------
async function scoreShows() {
  const seasonActivation = await activateSeasons();
  const autoclosed = await autoFinalize();
  await announcements();
  let rows = await eligibleLeagueShows();
  if (!rows.length) return {
    scored: [], autoclosed, seasons_activated: seasonActivation.activated,
    season_activation_failures: seasonActivation.failed, note: "no eligible shows",
  };

  const live = rows.some((r: any) => isLiveWindow(r.show));
  const roundsN = live ? BURST_POLLS : 1;
  let results: any[] = [];
  for (let i = 0; i < roundsN; i++) {
    if (i > 0) { await sleep(BURST_GAP_MS); rows = await eligibleLeagueShows(); }
    results = [];
    const byShow = groupBy(rows, (r: any) => r.show_id);
    for (const showRows of byShow.values()) {
      results.push(await scoreShow(showRows[0].show, showRows));
    }
  }
  return {
    scored: results, burst: live, autoclosed, seasons_activated: seasonActivation.activated,
    season_activation_failures: seasonActivation.failed,
  };
}

// One setlist fetch for the whole show, then every bracket of every league
// that has it active gets scored against the same shared setlist. `isFinal`
// must be true when this call is the closing pass of a finalize (manual or
// auto) — it's the fallback signal deriveSlotFacts uses for Show Closer (and
// Set 1/Set 2 Closer on the rare show that never gives an earlier signal).
async function scoreShow(show: any, leagueShowRows: any[], isFinal = false) {
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
    songname: decodeEntities(r.songname ?? r.song ?? ""),
    is_cover: r.isoriginal != null ? !Number(r.isoriginal) : null,
    footnote: decodeEntities([r.footnote, Array.isArray(r.footnotes) ? r.footnotes.join("; ") : null]
      .filter(Boolean).join("; ") || null),
    // Carton's own `transition` text is the connector it would print after
    // this song ("," no segue, " > " segue, "->" direct segue, or blank at
    // a set/show break). Keyed on the arrow character itself, not
    // `transition_id` — that numeric id isn't a stable cross-show enum (the
    // same "no continuation" case showed up as three different ids across
    // one real 2-set show, one per set boundary), so it's not safe to
    // hardcode against. Display-only: doesn't feed slot determination (see
    // deriveSlotFacts) — set/show boundaries are already known unambiguously
    // from position/setnumber, and a blank transition can't distinguish
    // "set's over" from "not transcribed yet".
    segue: />/.test(String(r.transition ?? "")),
  })).filter((s: any) => s.songname);
  if (!songs.length) return { show: show.id, note: "empty setlist" };

  // ---- diff against what's stored; write ONLY changes (toast-storm fix) ----
  const { data: prevRows } = await supa.from("setlist_songs")
    .select("position,songname,setnumber,is_encore,segue").eq("show_id", show.id);
  const prevByPos = new Map((prevRows ?? []).map((r: any) => [r.position, r]));
  const changed = songs.filter((s: any) => {
    const p = prevByPos.get(s.position);
    return !p || p.songname !== s.songname || p.setnumber !== s.setnumber || !!p.is_encore !== s.is_encore || !!p.segue !== s.segue;
  });
  if (changed.length) {
    await supa.from("setlist_songs").upsert(changed, { onConflict: "show_id,position" });
  }
  const maxPos = Math.max(...songs.map((s: any) => s.position));
  if ((prevRows ?? []).some((r: any) => r.position > maxPos)) {
    await supa.from("setlist_songs").delete().eq("show_id", show.id).gt("position", maxPos);
  }

  // ---- derive show-level structural facts — global, computed once, shared
  //      by every bracket's scoring below (pure logic lives in scoring.js) ----
  const slotFacts = deriveSlotFacts(songs, isFinal);
  const { set2, encore, played, slotSong, slotImpossible, anyDebut } = slotFacts;

  // ---- announce genuinely new songs, once per LEAGUE (not once per bracket
  //      — a league running Casual + Official must only get one message) ----
  const prevSet = new Set((prevRows ?? []).map((r: any) => norm(r.songname)));
  const newSongs = songs.filter((s: any) => !prevSet.has(norm(s.songname)));
  if (newSongs.length && (prevSet.size > 0 || isLiveWindow(show))) {
    const firstEncorePos = encore.length ? Math.min(...encore.map((s: any) => s.position)) : null;
    const set2FirstPos = set2.length ? set2[0].position : null;
    const lines = newSongs.map((s: any) => {
      // Only tag slots that are unambiguous the instant they happen — closer,
      // show_closer and set1_closer can't be known until nothing else
      // follows, so they never show up here, only in the after-the-fact
      // setlist view.
      const tags: string[] = [];
      if (!s.is_encore && s.position === songs[0].position) tags.push("Opener");
      if (set2FirstPos != null && s.position === set2FirstPos) tags.push("Set 2 Opener");
      if (firstEncorePos != null && s.position === firstEncorePos) tags.push("Encore");
      else if (s.is_encore) tags.push("encore");
      if (/debut/i.test(s.footnote ?? "")) tags.push("DEBUT \u{1F95A}");
      const tag = tags.length ? ` — *${tags.join(", ")}*` : "";
      return `\u{1F3B5} **${s.songname}**${tag}`;
    });
    const head = prevSet.size === 0 ? `\u{1F95A} **Show's on** — ${show.venue ?? show.showdate}\n` : "";
    const msg = head + lines.join("\n");
    const seenLeagues = new Set<number>();
    for (const r of leagueShowRows) {
      if (seenLeagues.has(r.league_id)) continue;
      seenLeagues.add(r.league_id);
      const { data: lg } = await supa.from("leagues").select("name").eq("id", r.league_id).single();
      if (lg) await notifyLeague(lg.name, msg);
    }
  }

  // ---- score every bracket of every league that has this show active ----
  const perBracket: any[] = [];
  const seenBrackets = new Set<number>();
  for (const lsRow of leagueShowRows) {
    const { data: brackets } = await supa.from("brackets").select("*").eq("league_id", lsRow.league_id);
    // Pings only when something in THIS league+show actually changed this
    // pass — a real score write (scoreBracket already diffs against the
    // previous row and skips an unchanged one) or a status flip — not on
    // every poll regardless. Same diff-before-notify discipline this file
    // already applies to setlist_songs/scores writes, just extended to the
    // ping too, so a quiet cron tick during a live show doesn't spam
    // refetches on every client watching this bracket.
    let changed = false;
    for (const bracket of brackets ?? []) {
      if (seenBrackets.has(bracket.id)) continue;
      seenBrackets.add(bracket.id);
      const res = await scoreBracket({ show, lsRow, bracket, songs, slotFacts });
      perBracket.push(res);
      if (res.score_writes) changed = true;
    }
    if (lsRow.status === "upcoming") {
      await supa.from("league_shows").update({ status: "live" })
        .eq("league_id", lsRow.league_id).eq("show_id", lsRow.show_id);
      changed = true;
    }
    if (changed) await pingRealtime(lsRow.league_id, lsRow.show_id);
  }

  return { show: show.id, songs: songs.length, new: newSongs.length, brackets: perBracket };
}

async function scoreBracket(ctx: { show: any; lsRow: any; bracket: any; songs: any[]; slotFacts: any }) {
  const { show, lsRow, bracket, songs, slotFacts } = ctx;
  const cfg = bracket.config;

  // ---- who's in scope for this bracket ----
  // Official reads the frozen season_rosters snapshot, never the live
  // opt-in flag. Casual has no seasons, so nobody is filtered out — anyone
  // with picks in this bracket for this show gets scored.
  let allowedPlayerIds: Set<string> | null = null;
  if (bracket.kind === "official") {
    const { data: season } = await supa.from("seasons").select("id")
      .eq("bracket_id", bracket.id).lte("start_date", show.showdate).gte("end_date", show.showdate)
      .maybeSingle();
    if (!season) return { bracket: bracket.id, kind: bracket.kind, note: "no active season — not scored" };
    const { data: roster } = await supa.from("season_rosters").select("player_id").eq("season_id", season.id);
    allowedPlayerIds = new Set((roster ?? []).map((r: any) => r.player_id));
  }

  const { data: picks } = await supa.from("picks").select("*")
    .eq("bracket_id", bracket.id).eq("show_id", show.id);
  const byPlayer: Record<string, any[]> = {};
  for (const p of picks ?? []) {
    if (allowedPlayerIds && !allowedPlayerIds.has(p.player_id)) continue;
    (byPlayer[p.player_id] ??= []).push(p);
  }

  const { data: prevScores } = await supa.from("scores")
    .select("player_id,points,breakdown").eq("bracket_id", bracket.id).eq("show_id", show.id);
  const prevScore = new Map((prevScores ?? []).map((r: any) => [r.player_id, r]));

  let writes = 0;
  for (const [playerId, ppicks] of Object.entries(byPlayer)) {
    const prev = prevScore.get(playerId);
    // All the actual scoring — slot matching, partial credit, bonuses,
    // wildcards, closer-family determinacy — lives in scoring.js as pure
    // data-in/data-out logic; this loop only handles the DB read/write.
    // `prev` is used only below, to skip a write when nothing changed.
    const { breakdown, total } = scorePicks({
      picks: ppicks, songs, slotFacts, cfg, format: lsRow.format,
    });

    if (!prev || prev.points !== total || JSON.stringify(prev.breakdown) !== JSON.stringify(breakdown)) {
      await supa.from("scores").upsert({
        bracket_id: bracket.id, player_id: playerId, show_id: show.id, points: total,
        breakdown, updated_at: new Date().toISOString(),
      }, { onConflict: "player_id,bracket_id,show_id" });
      writes++;
    }
  }
  return { bracket: bracket.id, kind: bracket.kind, players: Object.keys(byPlayer).length, score_writes: writes };
}

// ---------- reopen (un-finalize so corrected Carton data re-scores) ----------
async function reopenShow(name: string, pin: string, leagueId: number, showId: number) {
  await requireLeagueAdmin(name, pin, leagueId);
  const { data: brackets } = await supa.from("brackets").select("id").eq("league_id", leagueId);
  const bracketIds = (brackets ?? []).map((b: any) => b.id);
  // Best-result-across-replays must NOT lock in points earned against
  // setlist data that's since been corrected on The Carton — a genuine
  // correction needs a clean re-score, not a merge that preserves the old,
  // wrong best result forever. Wipe this league's scores for the show.
  if (bracketIds.length) {
    await supa.from("scores").delete().eq("show_id", showId).in("bracket_id", bracketIds);
  }
  await supa.from("league_shows").update({ status: "live", winner_sent: null })
    .eq("league_id", leagueId).eq("show_id", showId);
  await pingRealtime(leagueId, showId);
  const { data: lg } = await supa.from("leagues").select("name").eq("id", leagueId).single();
  const { data: show } = await supa.from("shows").select("venue,showdate").eq("id", showId).single();
  if (lg) {
    await notifyLeague(lg.name,
      `\u{1F504} **Scores reopened** for ${show?.venue ?? show?.showdate ?? showId} — corrected setlist, re-scoring now.`);
  }
  return { ok: true, league_id: leagueId, show_id: showId };
}

// ---------- cutoff-changed notice ----------
async function cutoffChanged(name: string, pin: string, leagueId: number, showId: number) {
  await requireLeagueAdmin(name, pin, leagueId);
  const { data: ls } = await supa.from("league_shows").select("cutoff_at")
    .eq("league_id", leagueId).eq("show_id", showId).single();
  const { data: lg } = await supa.from("leagues").select("name").eq("id", leagueId).single();
  const { data: show } = await supa.from("shows").select("venue,showdate").eq("id", showId).single();
  if (!lg || !ls) return { ok: false, error: "league or show not found" };
  const when = ls.cutoff_at
    ? new Date(ls.cutoff_at).toLocaleString("en-US", { timeZone: "America/New_York", dateStyle: "medium", timeStyle: "short" }) + " ET"
    : "cleared";
  await notifyLeague(lg.name, `\u{1F553} **Cutoff changed** for ${show?.venue ?? show?.showdate ?? showId} — now ${when}.`);
  return { ok: true };
}

// ---------- finalize (score one last time, then lock) ----------
// The careful live/upcoming -> final transition: one last scoring pass against
// the current setlist (so the frozen breakdown reflects the complete show,
// not a stale mid-show snapshot), then lock the status, then let
// announcements() fire the winner notice immediately rather than waiting for
// the next scheduled cycle (harmless to call — it's gated on winner_sent
// being null either way). This replaces the old app's finalizeShow(), which
// ran an unauthenticated edge-function score() call followed by an
// unauthenticated admin_set_show_status RPC.
async function finalizeShow(name: string, pin: string, leagueId: number, showId: number) {
  await requireLeagueAdmin(name, pin, leagueId);
  const { data: lsRow } = await supa.from("league_shows").select("*")
    .eq("league_id", leagueId).eq("show_id", showId).single();
  if (!lsRow) return { ok: false, error: "show not found for this league" };
  const { data: show } = await supa.from("shows").select("*").eq("id", showId).single();
  if (!show) return { ok: false, error: "show not found" };
  await scoreShow(show, [lsRow], true).catch(() => {}); // best effort — a missing/stale setlist shouldn't block finalizing
  await supa.from("league_shows").update({ status: "final" })
    .eq("league_id", leagueId).eq("show_id", showId);
  await announcements();
  return { ok: true, league_id: leagueId, show_id: showId };
}

// ---------- router ----------
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const body = await req.json().catch(() => ({ action: "score" }));
    const { action, league_id, show_id, p_name, p_pin } = body ?? {};
    let out;
    if (action === "sync_shows") out = await syncShows();
    else if (action === "sync_songs") out = await syncSongs();
    else if (action === "reopen") out = await reopenShow(p_name, p_pin, Number(league_id), Number(show_id));
    else if (action === "cutoff_changed") out = await cutoffChanged(p_name, p_pin, Number(league_id), Number(show_id));
    else if (action === "finalize") out = await finalizeShow(p_name, p_pin, Number(league_id), Number(show_id));
    else out = await scoreShows();
    return Response.json({ ok: true, ...out }, { headers: cors });
  } catch (e) {
    const status = (e instanceof AuthError || e instanceof ForbiddenError) ? e.status : 500;
    return Response.json({ ok: false, error: String(e) }, { status, headers: cors });
  }
});
