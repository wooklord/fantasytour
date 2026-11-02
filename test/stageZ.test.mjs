// Static self-consistency of sql/stage_z_setlist_check.sql, the Stage X and Y
// way: its footer quotes whitespace-collapsed md5s of function bodies that the
// dev compares against the live database, before (STEP 0: Stage X's helper) and
// after (STEP 2A: Stage Z's four) the apply, and STEP R restores Stage X's
// helper verbatim. A body edited without its md5, a kind or key the pure module
// does not share, or a smoke count that drifted would pass every other test, so
// this recomputes all of it from the files. Plain Node. Record:
// docs/decisions/setlist-check.md; plan: docs/setlist_check_plan.md, section 1.
//
//   node test/stageZ.test.mjs

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { ABSENT, DAILY_SETLIST_KEY, FLAG_DEDUP_KEY, KINDS } from "../supabase/functions/carton-sync/setlistCheck.js";

const failures = [];
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) failures.push(`${label}\n  expected: ${e}\n  actual:   ${a}`);
}
const readSql = f => readFileSync(new URL(`../sql/${f}`, import.meta.url), "utf8");
const Z_FILE = "stage_z_setlist_check.sql", X_FILE = "stage_x_signup_clear_and_remove.sql";

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

const Z = readSql(Z_FILE), X = readSql(X_FILE);
const footerAt = Z.indexOf("/*");
const head = Z.slice(0, footerAt), footer = Z.slice(footerAt);
const between = (a, b) => footer.slice(footer.indexOf(a), footer.indexOf(b));
const step0 = between("-- STEP 0 BEGIN", "-- STEP 0 END");
const step2a = between("-- STEP 2A BEGIN", "-- STEP 2A END");
const step2b = between("-- STEP 2B BEGIN", "-- STEP 2B END");
const stepR = between("-- STEP R BEGIN", "-- STEP R END");
const xHead = X.slice(0, X.indexOf("/*"));
const markers = ["-- STEP 0 BEGIN", "-- STEP 0 END", "-- STEP 2A BEGIN", "-- STEP 2A END", "-- STEP 2B BEGIN", "-- STEP 2B END", "-- STEP R BEGIN", "-- STEP R END"]
  .map(m => footer.indexOf(m));

check("structure: a begin…commit head, then ONE block comment holding the footer and ending the file, with steps 0, 2A, 2B, R in order inside it",
  [/^begin;$/m.test(head), /^commit;$/m.test(head), (Z.match(/\/\*/g) || []).length, (Z.match(/\*\//g) || []).length,
   Z.trimEnd().endsWith("*/"), markers.every((v, i) => v >= 0 && (i === 0 || v > markers[i - 1]))],
  [true, true, 1, 1, true, true]);
check("no placeholder is left in the file", /@@[A-Z_]+@@/.test(Z), false);

// ---------- the helper: before, after, and the way back ----------
const X_HELPER = bodyMd5(xHead, "_account_has_played");
check("STEP 0 expects the CURRENT Stage X helper: its body md5, recomputed from the Stage X file",
  step0.match(/hlp\.md5 = '([0-9a-f]{32})'/)?.[1] ?? null, X_HELPER);
check("STEP R restores Stage X's helper verbatim, and re-applies its revoke and grant",
  [bodyMd5(stepR, "_account_has_played"),
   /revoke execute on function _account_has_played\(uuid\) from public, anon, authenticated;/.test(stepR),
   /grant execute on function _account_has_played\(uuid\) to service_role;/.test(stepR)],
  [X_HELPER, true, true]);
const collapse = s => s.replace(/\s+/g, " ").trim();
check("Stage Z's helper is Stage X's body plus exactly one clause, in the shape test/stageX.test.mjs reads",
  collapse(definition(head, "_account_has_played")?.body ?? ""),
  collapse(definition(xHead, "_account_has_played")?.body ?? "").replace(/;$/, " or exists (select 1 from setlist_flags where cleared_by = p_player_id);"));
check("the helper's header is unchanged from Stage X (same arguments, volatility and security)",
  collapse(definition(head, "_account_has_played")?.header.replace("create or replace function", "create function") ?? ""),
  collapse(definition(xHead, "_account_has_played")?.header ?? ""));

// ---------- STEP 2A's md5s and return type ----------
const FNS = { _setlist_check_targets: "targets", admin_list_setlist_flags: "list", admin_clear_setlist_flag: "clear", _account_has_played: "helper" };
const quoted2a = fn => step2a.match(new RegExp(`proname = '${fn}' and n = 1 and md5 = '([0-9a-f]{32})'`))?.[1] ?? null;
check("STEP 2A's md5s are Stage Z's own bodies, one per function",
  Object.keys(FNS).map(quoted2a), Object.keys(FNS).map(fn => bodyMd5(head, fn)));
check("STEP 2A expects the list's return type",
  step2a.match(/ret = '(TABLE\([^']*\))'/)?.[1] ?? null, resultType(head, "admin_list_setlist_flags"));
check("the list returns the columns the plan's client reads, in this order",
  resultType(head, "admin_list_setlist_flags"),
  "TABLE(id bigint, show_id bigint, showdate date, venue text, kind text, found_at timestamp with time zone, detail jsonb)");

// ---------- the four columns ----------
const COLS = ["setlist_hash_scoring", "setlist_hash_full", "setlist_projection_scoring", "setlist_projection_full"];
check("the head adds exactly the four columns, in this order, as text",
  [...head.matchAll(/add column if not exists (\w+)\s+(\w+)/g)].map(m => [m[1], m[2]]), COLS.map(c => [c, "text"]));
check("each of the four has a comment", COLS.filter(c => !head.includes(`comment on column league_shows.${c} is`)), []);
check("STEP 0 looks for all four", COLS.filter(c => !step0.includes(`'${c}'`)), []);
check("STEP 2A expects them nullable with no default",
  step2a.match(/cols\.v = '([^']*)'/)?.[1] ?? null, COLS.map(c => `${c}:text:YES:-`).join(", "));
check("STEP R drops exactly those four", [...stepR.matchAll(/drop column if exists (\w+)/g)].map(m => m[1]), COLS);
check("no backfill: the head writes no value into league_shows", /update league_shows/i.test(head), false);

// ---------- setlist_flags, and what it shares with the pure module ----------
const table = head.match(/create table setlist_flags \(([\s\S]*?)\n\);/)?.[1] ?? "";
check("the kind vocabulary in the check constraint equals KINDS in setlistCheck.js",
  table.match(/check \(kind in \(([^)]*)\)\)/)?.[1].split(",").map(s => s.trim().replace(/^'|'$/g, "")) ?? null, KINDS);
check("the unique key's column list equals FLAG_DEDUP_KEY in setlistCheck.js",
  table.match(/^\s*unique \(([^)]*)\)/m)?.[1].replace(/\s+/g, "") ?? null, FLAG_DEDUP_KEY);
check("STEP 2A expects that same unique key", step2a.includes(`UNIQUE (${FLAG_DEDUP_KEY.split(",").join(", ")})`), true);
check("STEP 2A expects each kind in the check constraint", KINDS.filter(k => !step2a.includes(`''${k}''`)), []);
check("the carton_hash column comment names ABSENT, and the sentinel is what setlistCheck.js exports",
  [/comment on column setlist_flags\.carton_hash is\s+'[^;]*''absent''/.test(head), ABSENT], [true, "absent"]);
check("cleared_by holds a player and must never block a boot: on delete set null",
  /cleared_by\s+uuid references players\(id\) on delete set null,/.test(table), true);
check("RLS on, no policy created, and the table is revoked from anon and authenticated",
  [/alter table setlist_flags enable row level security;/.test(head), /create policy/i.test(head),
   /revoke all on table setlist_flags from anon, authenticated;/.test(head)], [true, false, true]);
// Every foreign key to players must be visible to the has-history coverage
// check in test/stageX.test.mjs, which only sees column lines of create table
// blocks. Comments out, exactly as that test strips them.
const stripped = Z.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--[^\n]*/g, "");
const refs = (stripped.match(/references\s+players\s*\(/gi) || []).length;
const refsInTable = [...stripped.matchAll(/create table (?:if not exists )?\w+\s*\(([\s\S]*?)\n\);/gi)]
  .flatMap(m => m[1].split("\n")).filter(l => /^\s+\w+\s+\w+.*references\s+players\s*\(/i.test(l)).length;
check("every 'references players(' is a column line inside a create table block", [refs, refsInTable], [1, 1]);

// ---------- the gate row ----------
const sqlKey = head.match(/insert into sync_state \(key\) values \('([^']+)'\)/)?.[1] ?? null;
check("the gate-row key equals DAILY_SETLIST_KEY in setlistCheck.js, its OWN row", [sqlKey, sqlKey === DAILY_SETLIST_KEY], [DAILY_SETLIST_KEY, true]);
check("STEP 0 expects the two existing rows, STEP 2A checks the new one is seeded unstamped, STEP R removes it",
  [step0.includes("gate.v = 'daily_discord_check, daily_show_sync'"), step2a.includes(`key = '${sqlKey}'`), stepR.includes(`delete from sync_state where key = '${sqlKey}'`)],
  [true, true, true]);

// ---------- auth and privileges ----------
const listBody = definition(head, "admin_list_setlist_flags")?.body ?? "";
const clearBody = definition(head, "admin_clear_setlist_flag")?.body ?? "";
check("the list is a read: _auth_player and the admin check, no must-change-PIN gate, uncleared rows of that league only",
  [/_auth_player\(p_name, p_pin\)/.test(listBody), /_reject_if_must_change_pin/.test(listBody),
   /_is_league_admin_or_global\(pl\.id, p_league_id\)/.test(listBody), /f\.league_id = p_league_id and f\.cleared_at is null/.test(listBody)],
  [true, false, true, true]);
check("clear: auth, then the must-change-PIN gate, then the flag's league, then the admin check, in that order",
  [clearBody.indexOf("_auth_player("), clearBody.indexOf("_reject_if_must_change_pin("), clearBody.indexOf("'Flag not found'"), clearBody.indexOf("_is_league_admin_or_global(pl.id, fl.league_id)")]
    .every((v, i, a) => v >= 0 && (i === 0 || v > a[i - 1])), true);
check("clear stamps only the flag row: it takes no note and touches no hash",
  [/p_note/.test(definition(head, "admin_clear_setlist_flag")?.header ?? ""), /setlist_hash|setlist_projection|league_shows/.test(clearBody)], [false, false]);
check("the two helpers' revoke and grant lines are present",
  [/revoke execute on function _setlist_check_targets\(\) from public, anon, authenticated;/.test(head),
   /grant execute on function _setlist_check_targets\(\) to service_role;/.test(head),
   /revoke execute on function _account_has_played\(uuid\) from public, anon, authenticated;/.test(head),
   /grant execute on function _account_has_played\(uuid\) to service_role;/.test(head)],
  [true, true, true, true]);
check("the two RPCs revoke public and grant anon and authenticated",
  ["admin_list_setlist_flags", "admin_clear_setlist_flag"].filter(fn =>
    !head.includes(`revoke execute on function ${fn}(text,text,bigint) from public;`)
    || !head.includes(`grant execute on function ${fn}(text,text,bigint) to anon, authenticated;`)), []);
check("the targets helper has the plan's definition: final, with a scores row in THAT league's brackets",
  [/ls\.status = 'final'/.test(definition(head, "_setlist_check_targets")?.body ?? ""),
   /b\.league_id = ls\.league_id and sc\.show_id = ls\.show_id/.test(definition(head, "_setlist_check_targets")?.body ?? "")],
  [true, true]);

// ---------- the smoke test ----------
const lblCount = (step2b.match(/^\s*lbl := lbl \|\|/gm) || []).length;
check("the smoke test's stated total matches its number of checks, the plan's 18, and it always ends by raising",
  [Number(step2b.match(/STAGE Z SMOKE: 0 of (\d+) FAILED/)?.[1]), lblCount,
   /raise exception 'STAGE Z SMOKE: % of % FAILED%/.test(step2b) && step2b.trimEnd().endsWith("end $smoke$;")],
  [lblCount, 18, true]);
check("the smoke's labels are the plan's checks", ["T1", "T2", "T3", "L1", "L2", "L3", "L4", "C1", "C2", "C3", "C4", "C5", "C6", "C7", "D1", "H1", "H2", "K1"]
  .filter(id => !new RegExp(`lbl := lbl \\|\\| \\(?'${id} `).test(step2b)), []);
check("the smoke writes only to setlist_flags rows it created: its one update names its own flag, and it deletes nothing",
  [[...step2b.matchAll(/^\s*update (\w+) set[^;]*;/gm)].map(m => m[0].trim()), /\bdelete from\b/i.test(step2b)],
  [["update setlist_flags set cleared_at = v_at where id = fl_clear;"], false]);
check("the smoke types no real PIN and no real name: throwaway tag, fixed PIN",
  [/v_tag text := 'zzz'/.test(step2b), /v_pin text := '4242'/.test(step2b)], [true, true]);
check("C2 back-dates the stamp, so an unchanged stamp is not just now() not moving inside the block",
  /v_at := now\(\) - interval '1 hour';\s+update setlist_flags set cleared_at = v_at where id = fl_clear;\s+j := admin_clear_setlist_flag\(v_tag \|\| 'adm2'/.test(step2b), true);

// ---------- "char" catalog columns (the Stage X lesson) ----------
const CHAR_COLS = ["relkind", "relpersistence", "relreplident", "contype", "confupdtype", "confdeltype", "confmatchtype",
  "prokind", "provolatile", "proparallel", "typtype", "typcategory", "typalign", "typstorage", "typdelim",
  "attalign", "attstorage", "attidentity", "attgenerated", "attcompression", "polcmd", "tgenabled", "deptype"];
const runnable = [head, step0, step2a, step2b, stepR].map(s => s.replace(/--[^\n]*/g, "")).join("\n");
const charCol = `(?:\\b\\w+\\.)?\\b(?:${CHAR_COLS.join("|")})\\b`;
check('no "char" catalog column meets || without ::text (text || "char" is ERROR 42725)',
  [...runnable.matchAll(new RegExp(`\\|\\|\\s*${charCol}(?!::text)|${charCol}(?!::text)\\s*\\|\\|`, "g"))].map(m => m[0].replace(/\s+/g, " ")), []);
check('the check above can see the footer: it finds the "char" column that IS cast', (runnable.match(new RegExp(`${charCol}::text`, "g")) || []).length > 0, true);

if (failures.length) {
  console.log(`FAIL — ${failures.length} check(s):`);
  for (const f of failures) console.log("  " + f.replace(/\n/g, "\n  "));
  process.exit(1);
} else {
  console.log("PASS — all Stage Z file checks passed.");
  process.exit(0);
}
