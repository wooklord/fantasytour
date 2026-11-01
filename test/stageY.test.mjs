// Static self-consistency of sql/stage_y_discord_status.sql, the Stage X way
// (test/stageX.test.mjs): its footer quotes whitespace-collapsed md5s of
// my_leagues bodies that the dev compares against the live database, before
// (STEP 0: Stage S's) and after (STEP 2A: Stage Y's) the apply, and STEP R
// restores Stage S's body verbatim. A body edited without its md5, a return
// type the footer no longer expects, a constraint vocabulary discord.js
// could violate, a gate-row key index.ts does not read, or a smoke count
// that drifted would pass every other test, so this recomputes all of it
// from the files. Plain Node. Record: docs/decisions/discord-routing.md,
// "Part 2 build record".
//
//   node test/stageY.test.mjs

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { postOutcome, statusPatch, NO_KEY, DEAD_STATUSES, STATUS_RE } from "../supabase/functions/carton-sync/discord.js";

const failures = [];
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) failures.push(`${label}\n  expected: ${e}\n  actual:   ${a}`);
}
const readSql = f => readFileSync(new URL(`../sql/${f}`, import.meta.url), "utf8");
const readRel = p => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const Y_FILE = "stage_y_discord_status.sql", S_FILE = "stage_s_league_config.sql";

// The ONE non-comment definition of `fn` in `src`: its prosrc (the text
// between the body's dollar quotes) and the header before it.
function definition(src, fn) {
  const starts = [];
  for (const nd of [`create or replace function ${fn}(`, `create function ${fn}(`])
    for (let i = src.indexOf(nd); i !== -1; i = src.indexOf(nd, i + 1)) {
      const lineStart = src.lastIndexOf("\n", i) + 1;
      if (!src.slice(lineStart, i).includes("--")) starts.push(i);
    }
  if (starts.length !== 1) return null;
  const open = src.indexOf("$$", starts[0]);
  return { header: src.slice(starts[0], open), body: src.slice(open + 2, src.indexOf("$$", open + 2)) };
}
// md5 of the body collapsed the way the footer's regexp_replace(prosrc, '\s+', ' ', 'g') collapses it.
const bodyMd5 = (src, fn) => {
  const d = definition(src, fn);
  return d ? createHash("md5").update(d.body.replace(/[ \t\n\r\f\v]+/g, " "), "utf8").digest("hex") : "not exactly one definition";
};
// The returns table(...) clause as pg_get_function_result prints it.
const resultType = (src, fn) => {
  const m = definition(src, fn)?.header.match(/returns\s+table\s*(\([^)]*\))/i);
  return m ? "TABLE" + m[1].replace(/\s+/g, " ").replace(/\btimestamptz\b/g, "timestamp with time zone") : null;
};

const Y = readSql(Y_FILE), S = readSql(S_FILE);
const footerAt = Y.indexOf("/*");
const head = Y.slice(0, footerAt), footer = Y.slice(footerAt);
const between = (a, b) => footer.slice(footer.indexOf(a), footer.indexOf(b));
const step0 = between("-- STEP 0 BEGIN", "-- STEP 0 END");
const step2a = between("-- STEP 2A BEGIN", "-- STEP 2A END");
const step2b = between("-- STEP 2B BEGIN", "-- STEP 2B END");
const stepR = between("-- STEP R BEGIN", "-- STEP R END");
const markers = ["-- STEP 0 BEGIN", "-- STEP 0 END", "-- STEP 2A BEGIN", "-- STEP 2A END", "-- STEP 2B BEGIN", "-- STEP 2B END", "-- STEP R BEGIN", "-- STEP R END"]
  .map(m => footer.indexOf(m));

check("structure: a begin…commit head, then ONE block comment holding the footer and ending the file, with steps 0, 2A, 2B, R in order inside it",
  [/^begin;$/m.test(head), /^commit;$/m.test(head), (Y.match(/\/\*/g) || []).length, (Y.match(/\*\//g) || []).length,
   Y.trimEnd().endsWith("*/"), markers.every((v, i) => v >= 0 && (i === 0 || v > markers[i - 1]))],
  [true, true, 1, 1, true, true]);

// ---------- my_leagues: before, after, and the way back ----------
const S_MD5 = bodyMd5(S, "my_leagues"), S_RET = resultType(S, "my_leagues");
const Y_MD5 = bodyMd5(head, "my_leagues"), Y_RET = resultType(head, "my_leagues");
check("STEP 0 expects the CURRENT Stage S my_leagues: its body md5 and its return type",
  [step0.match(/lst\.md5 = '([0-9a-f]{32})'/)?.[1] ?? null, step0.match(/lst\.ret = '(TABLE\([^']*\))'/)?.[1] ?? null], [S_MD5, S_RET]);
check("STEP 2A expects Stage Y's my_leagues: its body md5 (one definition in the head) and its new return type",
  [step2a.match(/f\.md5 = '([0-9a-f]{32})'/)?.[1] ?? null, step2a.match(/f\.ret = '(TABLE\([^']*\))'/)?.[1] ?? null], [Y_MD5, Y_RET]);
check("the new return type is Stage S's plus discord_live, discord_status, discord_checked_at, in that order (the names the client reads)",
  Y_RET, S_RET.replace(/\)$/, ", discord_live boolean, discord_status text, discord_checked_at timestamp with time zone)"));
check("the Stage Y body is not Stage S's (the drop-and-recreate changes something)", Y_MD5 === S_MD5, false);
check("STEP R restores Stage S's my_leagues verbatim: same body md5, same return type, and re-grants it",
  [bodyMd5(stepR, "my_leagues"), resultType(stepR, "my_leagues"), /grant execute on function my_leagues\(text,text\) to anon, authenticated;/.test(stepR)],
  [S_MD5, S_RET, true]);
check("the head drops my_leagues before recreating it (the return type changes: the Stage S rule)",
  head.indexOf("drop function if exists my_leagues(text,text);") > 0 && head.indexOf("drop function if exists my_leagues(text,text);") < head.indexOf("create or replace function my_leagues("), true);

// ---------- the three columns ----------
const cols = [...head.matchAll(/add column if not exists (\w+)\s+(\w+)/g)].map(m => [m[1], m[2]]);
check("the head adds exactly the three columns, in this order and with these types",
  cols, [["discord_status", "text"], ["discord_checked_at", "timestamptz"], ["discord_ok_at", "timestamptz"]]);
check("STEP 2A expects those three, nullable, with no default",
  step2a.match(/cols\.v = '([^']*)'/)?.[1] ?? null,
  cols.map(([c, t]) => `${c}:${t === "timestamptz" ? "timestamp with time zone" : t}:-`).join(", "));
check("STEP R drops exactly those three", [...stepR.matchAll(/drop column if exists (\w+)/g)].map(m => m[1]), cols.map(c => c[0]));
check("STEP 0 expects leagues WITHOUT them (the Stage S shape)", step0.match(/cols\.v = '([^']*)'/)?.[1] ?? null, "id, name, created_at, config");
check("no backfill: the head writes no value into the new columns", /update leagues set/i.test(head), false);

// ---------- the vocabulary ----------
const conRe = head.match(/discord_status ~ '([^']+)'/)?.[1] ?? null;
check("the constraint's regex is discord.js's STATUS_RE, character for character", conRe, STATUS_RE.source);
const re = conRe ? new RegExp(conRe) : null;
const words = [200, 204, 301, 400, 401, 404, 429, 500, 0, 99, 1000, null, undefined, "abc", "204", 204.5]
  .map(postOutcome).map(o => o.status).concat([NO_KEY]);
check("every word discord.js can produce satisfies the constraint (offenders)", re ? words.filter(s => !re.test(s)) : ["no regex found"], []);
check("…and words outside it are refused by the same regex", re ? ["dead", "http_NaN", "http_4", "", "OK"].filter(s => re.test(s)) : ["no regex found"], []);
check("statusPatch can never write a word the constraint refuses",
  re ? [{ ok: false, status: "dead" }, { ok: true, status: "fine" }, { ok: false, status: null }, null, undefined]
    .map(o => statusPatch(o, "2026-11-01T00:00:00.000Z").discord_status).filter(s => !re.test(s)) : ["no regex found"], []);
check("STEP 2A looks for that same regex in the live constraint", step2a.includes(`like '%${conRe}%'`), true);
check("the constraint is added only if absent (a re-run never errors) and STEP R drops it by name",
  [/if not exists \(select 1 from pg_constraint[\s\S]*conname = 'leagues_discord_status_check'\)/.test(head),
   /add constraint leagues_discord_status_check/.test(head), /drop constraint if exists leagues_discord_status_check/.test(stepR)],
  [true, true, true]);

// ---------- discord_live, the refined D1 ----------
const body = definition(head, "my_leagues")?.body ?? "";
check("discord_live: a success within 2 days (M8's SQL side: the window is there)", /discord_ok_at > now\(\) - interval '2 days'/.test(body), true);
check("discord_live: …AND the status is none of discord.js's DEAD_STATUSES — the SQL names exactly them, in order",
  body.match(/not in \(([^)]*)\)/)?.[1].split(",").map(s => s.trim().replace(/^'|'$/g, "")) ?? null, DEAD_STATUSES);
check("discord_live is never null: both sides are coalesced", (body.match(/coalesce\(/g) || []).length, 2);
check("the smoke drives the stale case (3 days), the 2-day edge both ways, a transient failure after a success, and each dead word",
  ["interval '3 days'", "+ interval '1 minute'", "- interval '1 minute'", "'http_429'", "'http_500'", "'error'", "'http_404'", "'http_401'", "'no_key'"].filter(s => !step2b.includes(s)), []);

// ---------- the gate row ----------
const sqlKey = head.match(/insert into sync_state \(key\) values \('([^']+)'\)/)?.[1] ?? null;
const tsKey = readRel("supabase/functions/carton-sync/index.ts").match(/const DAILY_DISCORD_KEY = "([^"]+)"/)?.[1] ?? null;
check("the gate row the SQL seeds is the key index.ts reads, and it is its OWN row, not the show sync's",
  [sqlKey, tsKey, sqlKey !== "daily_show_sync"], ["daily_discord_check", "daily_discord_check", true]);
check("STEP 0 expects only the show sync's row, STEP 2A checks the new row is seeded unstamped, STEP R removes it",
  [step0.includes("gate.v = 'daily_show_sync'"), step2a.includes(`key = '${sqlKey}'`), stepR.includes(`delete from sync_state where key = '${sqlKey}'`)],
  [true, true, true]);

// ---------- the smoke test ----------
const lblCount = (step2b.match(/^\s*lbl := lbl \|\|/gm) || []).length;
check("the smoke test's stated total matches its number of checks, and it always ends by raising",
  [Number(step2b.match(/STAGE Y SMOKE: 0 of (\d+)\s*\n?--\s*FAILED/)?.[1] ?? step2b.match(/STAGE Y SMOKE: 0 of (\d+)/)?.[1]),
   /raise exception 'STAGE Y SMOKE: % of % FAILED%/.test(step2b) && step2b.trimEnd().endsWith("end $smoke$;")],
  [lblCount, true]);
check("the smoke writes only to rows it created (every update names the throwaway league)",
  [...step2b.matchAll(/update leagues set[^;]*;/g)].map(m => m[0]).filter(u => !/where id = lg;$/.test(u)), []);
check("the smoke types no real PIN and no real name: throwaway tag, fixed PIN", [/v_tag text := 'zzy'/.test(step2b), /v_pin text := '4242'/.test(step2b)], [true, true]);

// ---------- "char" catalog columns (the Stage X lesson) ----------
const CHAR_COLS = ["relkind", "relpersistence", "relreplident", "contype", "confupdtype", "confdeltype", "confmatchtype",
  "prokind", "provolatile", "proparallel", "typtype", "typcategory", "typalign", "typstorage", "typdelim",
  "attalign", "attstorage", "attidentity", "attgenerated", "attcompression", "polcmd", "tgenabled", "deptype"];
const runnable = [head, step0, step2a, step2b, stepR].map(s => s.replace(/--[^\n]*/g, "")).join("\n");
const charCol = `(?:\\b\\w+\\.)?\\b(?:${CHAR_COLS.join("|")})\\b`;
check('no "char" catalog column meets || without ::text (text || "char" is ERROR 42725)',
  [...runnable.matchAll(new RegExp(`\\|\\|\\s*${charCol}(?!::text)|${charCol}(?!::text)\\s*\\|\\|`, "g"))].map(m => m[0].replace(/\s+/g, " ")), []);
check('the check above can see the footer: it finds the "char" columns that ARE cast', (runnable.match(new RegExp(`${charCol}::text`, "g")) || []).length > 0, true);

// ---------- the client reads what the SQL returns ----------
const harness = readRel("test/harness.mjs");
check("the harness fake my_leagues returns the three new columns by the SQL's names",
  ["discord_live", "discord_status", "discord_checked_at"].filter(k => !new RegExp(`\\b${k}:`).test(harness)), []);
check("the harness fake mirrors the SQL rule: the 2-day window and the same dead words",
  [/2 \* 864e5/.test(harness), /DEAD_STATUSES = \["http_404", "http_401", "no_key"\]/.test(harness)], [true, true]);
const hint = readRel("src/core/discordHint.js");
check("the client reads discord_live strictly as true (an older my_leagues without the column never shows the bar)", /row\.discord_live !== true/.test(hint), true);

if (failures.length) {
  console.log(`FAIL — ${failures.length} check(s):`);
  for (const f of failures) console.log("  " + f.replace(/\n/g, "\n  "));
  process.exit(1);
} else {
  console.log("PASS — all Stage Y file checks passed.");
  process.exit(0);
}
