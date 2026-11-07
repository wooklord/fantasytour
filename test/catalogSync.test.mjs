// Unit tests for the song-catalog sync's pure parts: mapSongRows
// (supabase/functions/carton-sync/setlistCheck.js) and errorText
// (supabase/functions/carton-sync/errorText.js). Plain Node — no Deno, no
// Supabase, no network — the same isolation as test/showSync.test.mjs.
//
//   node test/catalogSync.test.mjs
//
// The duplicate-title case uses the REAL Carton shape: /songs.json listed
// "When I Paint My Masterpiece " (trailing space) under two ids from
// 2026-07-18, and one upsert statement that meets the same conflict key
// twice is Postgres error 21000 — every press of Sync song catalog from
// 2026-07-18 to 2026-11-07 wrote zero rows that way (docs/decisions/
// edge-function.md, 2026-11-07).

import { mapSongRows } from "../supabase/functions/carton-sync/setlistCheck.js";
import { errorText } from "../supabase/functions/carton-sync/errorText.js";

const failures = [];
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) failures.push(`${label}\n  expected: ${e}\n  actual:   ${a}`);
}

// The Carton rows as /songs.json returns them (fields it actually sends;
// no times_played/last_played — those are dead, CLAUDE.md).
const carton = [
  { id: 1, name: "Beaming", slug: "beaming", isoriginal: 1, original_artist: "Eggy", created_at: "2021-07-28 13:48:22", updated_at: "2021-07-28 13:48:22" },
  { id: 100, name: "When I Paint My Masterpiece ", slug: "when-i-paint-my-masterpiece", isoriginal: 0, original_artist: "Bob Dylan", created_at: "2026-07-18 00:26:54", updated_at: "2026-07-18 00:26:54" },
  { id: 101, name: "When I Paint My Masterpiece ", slug: "when-i-paint-my-masterpiece-2", isoriginal: 0, original_artist: "Bob Dylan", created_at: "2026-07-18 00:38:38", updated_at: "2026-07-18 00:38:38" },
  { id: 370, name: "The Wreck of the Edmund Fitzgerald ", slug: "the-wreck-of-the-edmund-fitzg", isoriginal: 0, original_artist: "Gordon Lightfoot", created_at: "2026-10-16 21:12:44", updated_at: "2026-10-16 21:12:44" },
  { id: 371, name: "Codex", slug: "codex", isoriginal: 0, original_artist: "Radiohead", created_at: "2026-10-16 22:30:41", updated_at: "2026-10-16 22:30:41" },
];
const rows = mapSongRows(carton);

check("the duplicate Carton title collapses to ONE row: five Carton rows → four upserts", rows.length, 4);
check("every songname in the output is unique (the invariant the single-statement upsert needs)",
  new Set(rows.map((r) => r.songname)).size, rows.length);
check("first occurrence wins and order is preserved; names are the Carton's EXACT strings, trailing spaces included",
  rows.map((r) => r.songname),
  ["Beaming", "When I Paint My Masterpiece ", "The Wreck of the Edmund Fitzgerald ", "Codex"]);
check("row shape: is_original from isoriginal (1 → true, 0 → false); times_played/last_played null when the Carton sends none",
  rows[0], { songname: "Beaming", times_played: null, last_played: null, is_original: true });
check("a cover row", rows[3], { songname: "Codex", times_played: null, last_played: null, is_original: false });
check("the dedupe key is the EXACT decoded name: 'Codex' and 'Codex ' are two rows, because songs_cache conflicts on the exact string",
  mapSongRows([{ name: "Codex", isoriginal: 0 }, { name: "Codex ", isoriginal: 0 }]).map((r) => r.songname), ["Codex", "Codex "]);
check("entities are decoded BEFORE the dedupe: an encoded and a plain spelling of one title are one row",
  mapSongRows([{ name: "Don&#039;t Stop", isoriginal: 1 }, { name: "Don't Stop", isoriginal: 1 }]).map((r) => r.songname), ["Don't Stop"]);
check("a row with no name is dropped; `songname` is accepted as the fallback field",
  mapSongRows([{ name: "", isoriginal: 1 }, { songname: "Fallback", isoriginal: 1 }, {}]).map((r) => r.songname), ["Fallback"]);
check("isoriginal missing → is_original null (unknown, not false)",
  mapSongRows([{ name: "X" }])[0].is_original, null);
check("empty and missing input → no rows", [mapSongRows([]), mapSongRows(undefined)], [[], []]);
check("times_played is carried when the Carton does send it, 0 → null",
  mapSongRows([{ name: "A", times_played: 12 }, { name: "B", times_played: 0 }]).map((r) => r.times_played), [12, null]);

// errorText — the response's `error` string, which is also the toast.
check("Error → its message", errorText(new Error("boom")), "boom");
check("a PostgrestError-shaped plain object (what supabase-js throws from `throw error`) → message, code, details — never '[object Object]'",
  errorText({ message: "ON CONFLICT DO UPDATE command cannot affect row a second time", code: "21000",
    details: "Ensure that no rows proposed for insertion within the same command have duplicate constrained values.", hint: null }),
  "ON CONFLICT DO UPDATE command cannot affect row a second time (21000) — Ensure that no rows proposed for insertion within the same command have duplicate constrained values.");
check("hint is appended when present", errorText({ message: "m", hint: "h" }), "m hint: h");
check("an object without a message → its JSON", errorText({ status: 418 }), '{"status":418}');
check("a string → itself; null/undefined → their String", [errorText("plain"), errorText(null), errorText(undefined)], ["plain", "null", "undefined"]);
check("an Error subclass with a status still reports its message", (() => { class AuthError extends Error { constructor(m){ super(m); this.status = 401; } } return errorText(new AuthError("bad PIN")); })(), "bad PIN");
check("the old failure mode is gone: String(e) of the same object WAS '[object Object]'", String({ message: "m" }), "[object Object]");

if (failures.length) {
  console.log(`FAIL — ${failures.length} check(s):`);
  for (const f of failures) console.log("  " + f.replace(/\n/g, "\n  "));
  process.exit(1);
} else {
  console.log("PASS — all catalogSync checks passed.");
  process.exit(0);
}
