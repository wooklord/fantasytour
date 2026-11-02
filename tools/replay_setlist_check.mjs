// Replays the setlist check's pure path against frozen-verdict exports, before
// any of it is deployed. Reads two files from the gitignored .scratch/ folder,
// fetches each distinct date once from The Carton, runs mapSetlistRows →
// hashSetlist → rederiveVerdicts per (league, show), and prints what the daily
// job would compute. It writes nothing and touches no database.
//
//   node tools/replay_setlist_check.mjs [folder]     (default: .scratch)
//
//   verdict_groups.json  show, bracket, slot, songname, hit, reason, n
//   final_rows.json      league_id, show_id, showdate, format, bracket_ids
//
// The SQL for both exports selects no player_id, and this script aborts on any
// export field that names a player. Its output carries counts, dates and ids
// only: no slot, no song, no player. Plan: docs/setlist_check_plan.md, section
// 2. Expected on the 2026-10-31 data: exactly one hit flip, zero reason flips.
// The hit flip is 2026-08-14, bracket 2.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { hashSetlist, mapSetlistRows, rederiveVerdicts } from "../supabase/functions/carton-sync/setlistCheck.js";

const CARTON_BASE = "https://thecarton.net/api/v2";
const FETCH_BATCH = 5; // the daily job's width (plan, section 4)

// The rows of an export, however the SQL editor or a CLI wrapped them: a plain
// array, { rows: [...] }, or a single { result: ... } row, whose value may
// itself be JSON text.
function rowsOf(file) {
  const text = readFileSync(file, "utf8").replace(/^﻿/, "");
  let v = JSON.parse(text);
  if (v && !Array.isArray(v) && Array.isArray(v.rows)) v = v.rows;
  if (Array.isArray(v) && v.length === 1 && v[0] && typeof v[0] === "object" && "result" in v[0]) v = v[0].result;
  else if (v && !Array.isArray(v) && "result" in v) v = v.result;
  if (typeof v === "string") v = JSON.parse(v);
  if (!Array.isArray(v)) throw new Error(`${file}: expected an array of rows`);
  const offending = v.flatMap((r) => Object.keys(r ?? {})).filter((k) => /player/i.test(k));
  if (offending.length) throw new Error(`${file}: holds player fields (${[...new Set(offending)].join(", ")}); re-export without them`);
  return v;
}

// The error handling of carton() in index.ts (as of efb088b).
async function cartonDate(date) {
  const path = `/setlists/showdate/${date}.json`;
  const res = await fetch(`${CARTON_BASE}${path}`);
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); }
  catch { throw new Error(`Carton ${path} returned non-JSON: ${text.slice(0, 120)}`); }
  if (body.error) throw new Error(`Carton ${path}: ${body.error_message}`);
  return body.data ?? [];
}

const folder = process.argv[2] ?? ".scratch";
const groups = rowsOf(join(folder, "verdict_groups.json")).map((g) => ({
  show: Number(g.show ?? g.show_id),
  bracket_id: Number(g.bracket ?? g.bracket_id),
  slot: g.slot, songname: g.songname, hit: g.hit, reason: g.reason, n: Number(g.n ?? 1),
}));
const finals = rowsOf(join(folder, "final_rows.json")).map((r) => ({
  league_id: Number(r.league_id),
  show_id: Number(r.show_id),
  showdate: String(r.showdate),
  format: r.format,
  bracket_ids: (r.bracket_ids ?? []).map(Number),
})).sort((a, b) => a.showdate.localeCompare(b.showdate) || a.league_id - b.league_id);

// Each distinct date once, 5 wide. A failed date is reported on its rows and
// makes the exit code non-zero.
const dates = [...new Set(finals.map((r) => r.showdate))];
const fetched = new Map();
let fetchErrors = 0;
for (let i = 0; i < dates.length; i += FETCH_BATCH) {
  await Promise.all(dates.slice(i, i + FETCH_BATCH).map(async (date) => {
    try { fetched.set(date, await cartonDate(date)); }
    catch (e) { fetchErrors++; console.error(`fetch failed for ${date}: ${e.message}`); }
  }));
}

const totals = { rows: 0, matched: 0, fallback: 0, absent: 0, hit_flips: 0, reason_flips: 0 };
const flipped = [];
const usedGroups = new Set();
for (const row of finals) {
  totals.rows++;
  const label = `league ${row.league_id} show ${row.show_id} ${row.showdate} ${row.format}`;
  const cartonRows = fetched.get(row.showdate);
  if (!cartonRows) { console.log(`${label}\n  NOT FETCHED`); continue; }
  const { songs, matched } = mapSetlistRows({ id: row.show_id, showdate: row.showdate }, cartonRows);
  if (!cartonRows.length) totals.absent++;
  else if (matched) totals.matched++;
  else totals.fallback++;
  console.log(`${label}\n  matched=${matched} carton_rows=${cartonRows.length} songs=${songs.length}`);
  if (!cartonRows.length) { console.log("  no rows at the stored date: nothing to hash or re-derive"); continue; }

  const h = await hashSetlist(songs);
  console.log(`  lengths: hash_scoring=${h.setlist_hash_scoring.length} hash_full=${h.setlist_hash_full.length} projection_scoring=${h.setlist_projection_scoring.length} projection_full=${h.setlist_projection_full.length}`);
  console.log(`  baseline: scoring=${h.setlist_hash_scoring} full=${h.setlist_hash_full}${matched ? "" : " (fallback rows: the daily job would NOT baseline these)"}`);

  const mine = groups.filter((g) => g.show === row.show_id && row.bracket_ids.includes(g.bracket_id));
  mine.forEach((g) => usedGroups.add(g));
  const flips = rederiveVerdicts({ rows: mine, songs, format: row.format });
  const parts = row.bracket_ids.map((id) => {
    const f = flips[id];
    if (!f) return `bracket ${id}: no frozen rows`;
    totals.hit_flips += f.hit_flips;
    totals.reason_flips += f.reason_flips;
    if (f.hit_flips || f.reason_flips) flipped.push(`${row.showdate} bracket ${id}: ${f.hit_flips} hit, ${f.reason_flips} reason`);
    return `bracket ${id}: ${f.hit_flips} hit, ${f.reason_flips} reason of ${f.total_rows} rows`;
  });
  console.log(`  flips: ${parts.join("; ")}`);
}

console.log(`\nfinal rows ${totals.rows}, dates ${dates.length}, fetch errors ${fetchErrors}`);
console.log(`matched ${totals.matched}, fallback ${totals.fallback}, no rows at date ${totals.absent}`);
console.log(`hit flips ${totals.hit_flips}, reason flips ${totals.reason_flips}`);
for (const line of flipped) console.log(`  ${line}`);
const unused = groups.length - usedGroups.size;
if (unused) console.log(`verdict groups with no final row: ${unused} (a show or bracket missing from final_rows.json)`);
process.exit(fetchErrors ? 1 : 0);
