// Pure setlist-check logic for Fantasy Eggy: no Supabase client, no Deno
// APIs, no network I/O. Same isolation as scoring.js and showSync.js: the Deno
// edge function (index.ts) fetches rows, calls these functions and applies the
// writes they return; test/scoring.test.mjs imports this same file under plain
// Node, and so does tools/replay_setlist_check.mjs. crypto.subtle is a global
// in Node >= 20 and in Deno.
//
// Decision record: docs/decisions/setlist-check.md. Build plan:
// docs/setlist_check_plan.md, sections 2, 3 and 5.

import { norm, deriveSlotFacts, scorePicks } from "./scoring.js";
import { dailyGateDue, easternDateOf } from "./showSync.js";

// The prefix makes a future projection change a deliberate re-baseline event
// (bump the constant, null the four columns in a migration) rather than a mass
// kind A.
export const PROJECTION_VERSION = "setlist-v1";
// setlist_flags.kind. test/stageZ.test.mjs checks the check constraint against
// this list.
export const KINDS = ["scoring", "drift"];
// setlist_flags.carton_hash when the stored date returned no rows at all: the
// column is part of the unique key and so cannot be null.
export const ABSENT = "absent";
// The sync_state row; the Stage Z file seeds this key.
export const DAILY_SETLIST_KEY = "daily_setlist_check";
// The dedup key: the Stage Z unique constraint's columns, and the onConflict
// string deploy B passes.
export const FLAG_DEDUP_KEY = "league_id,show_id,kind,carton_hash";

// ---------- The Carton row mapping ----------

// Carton's text fields (venue/city/song names/footnotes) arrive with HTML
// entities already baked in (e.g. "Blues &amp; Brews Festival") — decoding
// here keeps the DB holding real characters, since the frontend's esc() is
// the only place display text should ever be HTML-encoded. Left undecoded,
// esc() re-encodes the leading & of "&amp;" into "&amp;amp;", which the
// browser then renders as the literal text "&amp;" instead of an ampersand.
// &amp; is decoded last so it can't cascade into re-triggering the other
// patterns (none of which decode back into "&", so this order is safe).
export function decodeEntities(s) {
  if (s == null) return s;
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

// The rows at a date → this show's mapped songs, in the shape setlist_songs
// stores. The rows carrying the stored Carton id win; with none, every row at
// the date is used (the fallback), and `matched` says which it was. Moved here
// from scoreShow in index.ts (as of efb088b); it sorts a copy, where that code
// sorted the fetched array in place and read nothing from it afterwards.
export function mapSetlistRows(show, rows) {
  const mine = rows.filter((r) => Number(r.show_id) === Number(show.id));
  const use = mine.length ? mine : rows;
  const songs = [...use]
    .sort((a, b) => Number(a.position) - Number(b.position))
    .map((r) => ({
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
    }))
    .filter((s) => s.songname);
  return { songs, matched: mine.length > 0 };
}

// ---------- The final pass ----------

// What a final pass that produced no baseline writes. All four are named, so a
// re-finalize after a reopen cannot leave an old baseline behind for the daily
// check to compare against: the row goes to the null-hash branch instead, which
// re-derives the frozen verdicts first. Plan section 3, the 2026-11-02 correction.
const NO_BASELINE = Object.freeze({
  setlist_hash_scoring: null,
  setlist_hash_full: null,
  setlist_projection_scoring: null,
  setlist_projection_full: null,
});

// The one update a final pass makes, given what scoreShow returned, or null if
// it threw. The baseline lands in the same write as the status flip.
export function finalUpdatePatch(res) {
  return { status: "final", ...(res?.baseline ?? NO_BASELINE) };
}

// What scoreShow returns. A cron tick is not final and gets the result untouched,
// so the cron response keeps its shape and hashes nothing. A final pass adds
// `baseline`: the four column values when the rows carried the stored id, null
// when they were the fallback, because no baseline is ever written from fallback
// rows. A hash failure rejects, which the callers catch to null.
export async function withFinalBaseline(result, { isFinal, matched, songs }) {
  if (!isFinal) return result;
  return { ...result, baseline: matched ? await hashSetlist(songs) : null };
}

// ---------- Projection and hash ----------

// Two canonical strings. Each row is an ARRAY in fixed order, so there is no
// key-order question. The scoring row is what scoring reads; the full row adds
// the display facts.
export function projectSetlist(songs) {
  const sorted = [...songs].sort((a, b) => Number(a.position) - Number(b.position));
  const scoring = [];
  const full = [];
  for (const s of sorted) {
    const row = [
      s.position,
      s.setnumber,
      s.is_encore,
      norm(s.songname),
      s.is_cover ?? null,
      /debut/i.test(s.footnote ?? ""),
    ];
    scoring.push(row);
    full.push([...row, s.songname, !!s.segue, s.footnote ?? null]);
  }
  return {
    scoring: `${PROJECTION_VERSION}:${JSON.stringify(scoring)}`,
    full: `${PROJECTION_VERSION}:${JSON.stringify(full)}`,
  };
}

// SHA-256 over the UTF-8 bytes, lowercase hex.
export async function sha256Hex(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// The four league_shows column values for a list of mapped songs.
export async function hashSetlist(songs) {
  const { scoring, full } = projectSetlist(songs);
  return {
    setlist_hash_scoring: await sha256Hex(scoring),
    setlist_hash_full: await sha256Hex(full),
    setlist_projection_scoring: scoring,
    setlist_projection_full: full,
  };
}

// The rows of a stored projection, or null when the prefix is not the current
// version or the text does not parse (the caller treats the row as never
// baselined).
export function parseProjection(text) {
  const prefix = `${PROJECTION_VERSION}:`;
  if (typeof text !== "string" || !text.startsWith(prefix)) return null;
  try {
    const rows = JSON.parse(text.slice(prefix.length));
    return Array.isArray(rows) ? rows : null;
  } catch {
    return null;
  }
}

// ---------- Diff ----------

const POSITION = 0;
const NORM_NAME = 3;
const RAW_NAME = 6;
// Compared on every matched pair. Position is left out because a shift caused
// by an insert or a removal is not a change, and the norm name is what the
// pair was matched on. The full-only fields are absent from a scoring row, so
// the `in` test below keeps them out of a scoring diff.
const COMPARED_FIELDS = [
  [1, "setnumber"],
  [2, "is_encore"],
  [4, "is_cover"],
  [5, "has_debut"],
  [RAW_NAME, "songname"],
  [7, "segue"],
  [8, "footnote"],
];

// Longest common subsequence of two name lists, as [baselineIndex,
// currentIndex] pairs in order. A sandwich aligns as a sequence, not a set.
function alignBySong(names, otherNames) {
  const n = names.length;
  const m = otherNames.length;
  const best = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      best[i][j] = names[i] === otherNames[j]
        ? best[i + 1][j + 1] + 1
        : Math.max(best[i + 1][j], best[i][j + 1]);
    }
  }
  const pairs = [];
  for (let i = 0, j = 0; i < n && j < m;) {
    if (names[i] === otherNames[j]) { pairs.push([i, j]); i++; j++; }
    else if (best[i + 1][j] >= best[i][j + 1]) i++;
    else j++;
  }
  return pairs;
}

const songOf = (row) => row[RAW_NAME] ?? row[NORM_NAME];

// Baseline and current are stored projection texts of the same kind. Returns
// the field-level difference, or null when either side fails to parse. Pass 1
// aligns on the norm name, so a position shift is not reported. Pass 2 pairs
// what is left on both sides with the same norm name: those moved. Pass 3 is
// the rest. Every matched pair then has its remaining fields compared.
export function diffProjections(baseline, current) {
  const base = parseProjection(baseline);
  const cur = parseProjection(current);
  if (!base || !cur) return null;

  const baseNames = base.map((r) => r[NORM_NAME]);
  const curNames = cur.map((r) => r[NORM_NAME]);
  const pairs = alignBySong(baseNames, curNames);

  const usedBase = new Set(pairs.map(([i]) => i));
  const usedCur = new Set(pairs.map(([, j]) => j));
  const moved = [];
  const movedPairs = [];
  base.forEach((row, i) => {
    if (usedBase.has(i)) return;
    const j = cur.findIndex((other, k) => !usedCur.has(k) && other[NORM_NAME] === row[NORM_NAME]);
    if (j === -1) return;
    usedBase.add(i);
    usedCur.add(j);
    movedPairs.push([i, j]);
    moved.push({ song: songOf(cur[j]), from: row[POSITION], to: cur[j][POSITION] });
  });

  const removed = base.flatMap((row, i) => (usedBase.has(i) ? [] : [{ position: row[POSITION], song: songOf(row) }]));
  const added = cur.flatMap((row, j) => (usedCur.has(j) ? [] : [{ position: row[POSITION], song: songOf(row) }]));

  const changed = [];
  for (const [i, j] of [...pairs, ...movedPairs].sort((a, b) => a[1] - b[1])) {
    const was = base[i];
    const now = cur[j];
    for (const [index, field] of COMPARED_FIELDS) {
      if (!(index in was) && !(index in now)) continue;
      if (was[index] !== now[index]) {
        changed.push({ position: now[POSITION], song: songOf(now), field, from: was[index], to: now[index] });
      }
    }
  }
  return { added, removed, moved, changed };
}

// ---------- The daily gate ----------

// The shared daily gate, plus "today's daily_show_sync.ran_at is set", so stored
// dates are current before they are fetched. Eastern calendar date on both
// sides. A manual "Sync shows" stamps ran_at too and so counts.
export function setlistCheckDue({ ranAt, attemptedAt, showSyncRanAt, now }) {
  return dailyGateDue({ ranAt, attemptedAt, now })
    && showSyncRanAt != null
    && easternDateOf(showSyncRanAt) === easternDateOf(now);
}

// ---------- Verdict re-derivation (enrichment on kind A) ----------

// The bonus and partial-credit suffixes depend on the bracket's config, not on
// the setlist, so they are not part of the verdict being compared.
export function stripReason(reason) {
  return String(reason ?? "").replace(/ \(no partial credit\)$/, "").replace(/ \+cover| \+debut/g, "");
}

// A config that re-derives one slot under the mode its stored key implies, not
// under today's config. A slot key is its own slot type, except cover1.
export function syntheticConfig(slot) {
  if (/^rank\d+$/.test(slot)) {
    return { mode: "ranked_choice", ranked: { ladder: Array(24).fill(1) }, bonuses: {} };
  }
  return {
    mode: "slots",
    flat_points: 1,
    partial_credit: true,
    partial_points: 1,
    bonuses: {},
    slots: /^flat\d*$/.test(slot) ? [] : [{ key: slot, type: slot === "cover1" ? "cover_pick" : slot, points: 1 }],
  };
}

// Frozen verdicts against today's setlist. `rows` are breakdown elements with
// their bracket_id (and an optional multiplicity n); anything else on a row is
// ignored and never echoed, so a stray player_id cannot reach the output.
// Returns { "<bracket_id>": { hit_flips, reason_flips, pairs, total_rows } }.
// A flip count counts distinct verdicts; each pair's n says how many sheets
// carried that verdict, and total_rows counts sheets' rows.
export function rederiveVerdicts({ rows, songs, format }) {
  const groups = new Map();
  for (const r of rows) {
    if (r.slot === "bonus") continue;
    const reason = stripReason(r.reason);
    const key = JSON.stringify([r.bracket_id, r.slot, r.songname, r.hit, reason]);
    const n = Number(r.n ?? 1);
    const group = groups.get(key);
    if (group) group.n += n;
    else groups.set(key, { bracket_id: r.bracket_id, slot: r.slot, songname: r.songname, hit: r.hit, reason, n });
  }

  const facts = deriveSlotFacts(songs, true);
  const out = {};
  for (const g of groups.values()) {
    const bracket = (out[g.bracket_id] ??= { hit_flips: 0, reason_flips: 0, pairs: [], total_rows: 0 });
    bracket.total_rows += g.n;
    const now = scorePicks({
      picks: [{ slot: g.slot, songname: g.songname }],
      songs,
      slotFacts: facts,
      cfg: syntheticConfig(g.slot),
      format,
    }).breakdown[0];
    const reason = stripReason(now.reason);
    const hitFlip = now.hit !== g.hit;
    if (!hitFlip && reason === g.reason) continue;
    if (hitFlip) bracket.hit_flips += 1;
    else bracket.reason_flips += 1;
    bracket.pairs.push({
      slot: g.slot,
      song: g.songname,
      from: { hit: g.hit, reason: g.reason },
      to: { hit: now.hit, reason },
      n: g.n,
    });
  }
  return out;
}
