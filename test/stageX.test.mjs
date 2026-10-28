// Static self-consistency of sql/stage_x_signup_clear_and_remove.sql. Its
// footer quotes whitespace-collapsed md5s of function bodies that the dev
// compares against the live database, before (STEP 0: Stage W's list) and
// after (STEP 2A: Stage X's four functions) the apply, and it states which
// foreign keys and uuid columns sql/ has. A body edited without its md5, or
// a new table that references players without the "has history" helper
// learning about it, would pass every other test, so this recomputes all of
// it from the files. Plain Node. Record: docs/decisions/onboarding.md,
// decision 8.
//
//   node test/stageX.test.mjs

import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";

const failures = [];
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) failures.push(`${label}\n  expected: ${e}\n  actual:   ${a}`);
}
const read = f => readFileSync(new URL(`../sql/${f}`, import.meta.url), "utf8");
const X_FILE = "stage_x_signup_clear_and_remove.sql";

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
// md5 of the body collapsed the way STEP 0's regexp_replace(prosrc, '\s+', ' ', 'g') collapses it.
const bodyMd5 = (src, fn) => {
  const d = definition(src, fn);
  return d ? createHash("md5").update(d.body.replace(/[ \t\n\r\f\v]+/g, " "), "utf8").digest("hex") : "not exactly one definition";
};
// The returns table(...) clause as pg_get_function_result prints it.
const resultType = (src, fn) => {
  const m = definition(src, fn)?.header.match(/returns\s+table\s*(\([^)]*\))/i);
  return m ? "TABLE" + m[1].replace(/\s+/g, " ").replace(/\btimestamptz\b/g, "timestamp with time zone") : null;
};

const X = read(X_FILE);
const footerAt = X.indexOf("/*");
const head = X.slice(0, footerAt), footer = X.slice(footerAt);
const between = (a, b) => footer.slice(footer.indexOf(a), footer.indexOf(b));
const step0 = between("-- STEP 0 BEGIN", "-- STEP 0 END");
const step2a = between("-- STEP 2A BEGIN", "-- STEP 2A END");
const step2b = between("-- STEP 2B BEGIN", "-- STEP 2B END");
const quoted2a = fn => step2a.match(new RegExp(`proname = '${fn}' and n = 1 and md5 = '([0-9a-f]{32})'`))?.[1] ?? null;

check("the file is begin…commit, then ONE block comment holding the footer, with the steps in order inside it",
  [/^begin;$/m.test(head), /^commit;$/m.test(head), (X.match(/\/\*/g) || []).length, (X.match(/\*\//g) || []).length,
   X.trimEnd().endsWith("*/"),
   footer.indexOf("-- STEP 0 BEGIN") < footer.indexOf("-- STEP 0 END") && footer.indexOf("-- STEP 0 END") < footer.indexOf("-- STEP 2A BEGIN")
     && footer.indexOf("-- STEP 2A END") < footer.indexOf("-- STEP 2B BEGIN") && footer.indexOf("-- STEP 2B BEGIN") < footer.indexOf("-- STEP 2B END")],
  [true, true, 1, 1, true, true]);
check("STEP 0 expects the CURRENT Stage W list: its body md5 and its return type",
  [step0.match(/lst\.md5 = '([0-9a-f]{32})'/)?.[1] ?? null, step0.match(/lst\.ret = '(TABLE\([^']*\))'/)?.[1] ?? null],
  [bodyMd5(read("stage_w_vet_first_fast_path.sql"), "admin_list_unaffiliated_players"), resultType(read("stage_w_vet_first_fast_path.sql"), "admin_list_unaffiliated_players")]);
const FNS = ["admin_list_unaffiliated_players", "admin_clear_new_signups", "admin_remove_unplayed_account", "_account_has_played"];
check("STEP 2A's md5s are Stage X's own bodies, one per function",
  FNS.map(quoted2a), FNS.map(fn => bodyMd5(head, fn)));
check("STEP 2A expects the list's NEW return type",
  step2a.match(/ret = '(TABLE\([^']*\))'/)?.[1] ?? null, resultType(head, "admin_list_unaffiliated_players"));
check("the smoke test's stated total matches its number of checks, and it always ends by raising",
  [Number(step2b.match(/STAGE X SMOKE: 0 of (\d+) FAILED/)?.[1]), (step2b.match(/^\s*lbl := lbl \|\|/gm) || []).length,
   /raise exception 'STAGE X SMOKE: % of % FAILED%/.test(step2b) && step2b.trimEnd().endsWith("end $smoke$;")],
  [(step2b.match(/^\s*lbl := lbl \|\|/gm) || []).length, 26, true]);
// The catalogs' one-byte "char" columns. text || "char" has no unique
// operator in Postgres (ERROR 42725), so wherever one of these meets || it
// must carry ::text. This footer was first handed over without ever being
// run (there is no local Postgres here), and the dev's STEP 0 caught exactly
// this. The list is the "char" columns of the catalogs a footer is likely
// to read; a "char" column missing from it is not covered.
const CHAR_COLS = ["relkind", "relpersistence", "relreplident", "contype", "confupdtype", "confdeltype", "confmatchtype",
  "prokind", "provolatile", "proparallel", "typtype", "typcategory", "typalign", "typstorage", "typdelim",
  "attalign", "attstorage", "attidentity", "attgenerated", "attcompression", "polcmd", "tgenabled", "deptype"];
const runnable = [head, step0, step2a, step2b].map(s => s.replace(/--[^\n]*/g, "")).join("\n");
const charCol = `(?:\\b\\w+\\.)?\\b(?:${CHAR_COLS.join("|")})\\b`;
check('no "char" catalog column meets || without ::text (text || "char" is ERROR 42725)',
  [...runnable.matchAll(new RegExp(`\\|\\|\\s*${charCol}(?!::text)|${charCol}(?!::text)\\s*\\|\\|`, "g"))].map(m => m[0].replace(/\s+/g, " ")),
  []);
check('the check above can see the footer: it finds the "char" columns that ARE cast',
  (runnable.match(new RegExp(`${charCol}::text`, "g")) || []).length > 0, true);

// ---------- what sql/ says about player ids ----------
// Every create table block in sql/ (not archive/; the footers' block
// comments hold none), with each column line's name, type and FK target.
// Every "references players(" in the files must sit in one of those blocks,
// so a foreign key added any other way fails here instead of going unseen.
const stripComments = s => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--[^\n]*/g, "");
const files = readdirSync(new URL("../sql/", import.meta.url)).filter(f => f.endsWith(".sql")).sort();
const cols = [];
let refsInFiles = 0;
for (const f of files) {
  const src = stripComments(read(f));
  refsInFiles += (src.match(/references\s+players\s*\(/gi) || []).length;
  for (const m of src.matchAll(/create table (?:if not exists )?(\w+)\s*\(([\s\S]*?)\n\);/gi))
    for (const line of m[2].split("\n")) {
      const c = line.match(/^\s+(\w+)\s+(\w+)/);
      if (!c || /^(primary|unique|check|foreign|constraint)$/i.test(c[1])) continue;
      const ref = /references\s+players\s*\(/i.test(line);
      cols.push({ file: f, table: m[1], col: c[1], type: c[2].toLowerCase(), ref,
        del: !ref ? null : /on delete cascade/i.test(line) ? "c" : /on delete set null/i.test(line) ? "n" : "a" });
    }
}
const fks = cols.filter(c => c.ref);
const fkString = list => list.map(c => `${c.table}.${c.col}:${c.del}`).sort().join(", ");
check("every 'references players(' in sql/ is a column line inside a create table block",
  fks.length, refsInFiles);
check("STEP 0 expects exactly the foreign keys to players that sql/ held before Stage X",
  step0.match(/fk\.v = '([^']*)'/)?.[1] ?? null, fkString(fks.filter(c => c.file !== X_FILE)));
check("STEP 2A expects those plus Stage X's own",
  step2a.match(/\(select v from fk\) = '([^']*)'/)?.[1] ?? null, fkString(fks));
check("STEP 0 expects exactly the uuid columns sql/ held before Stage X (players.id aside)",
  step0.match(/uu\.v = '([^']*)'/)?.[1] ?? null,
  cols.filter(c => c.file !== X_FILE && c.type === "uuid" && !(c.table === "players" && c.col === "id")).map(c => `${c.table}.${c.col}`).sort().join(", "));
// "Never played" (decision 8, D7) must cover every table that holds a
// player id, or Remove could delete an account with history: the cascade
// would take those rows with it. These are exempt, each for a stated reason.
const EXEMPT = {
  "league_members.player_id": "Remove refuses any membership itself, before the helper runs",
  "admin_signup_clears.player_id": "a per-admin display preference that records nothing about anyone else",
  "admin_audit_log.actor_id": "a snapshot with no foreign key, by the dev's requirement: deleting the account leaves it",
  "admin_audit_log.target_id": "the same",
};
const helper = definition(head, "_account_has_played")?.body ?? "";
check("_account_has_played reads every other table with a player id, by that column (a new one fails here until the helper covers it)",
  [...new Set([...fks.map(c => `${c.table}.${c.col}`), ...cols.filter(c => c.type === "uuid" && /player|_by$|_id$/.test(c.col) && c.col !== "id").map(c => `${c.table}.${c.col}`)])]
    .filter(k => !(k in EXEMPT))
    .filter(k => { const [t, c] = k.split("."); return !new RegExp(`from ${t} where ${c} = p_player_id`).test(helper); }),
  []);
check("Remove refuses a league membership before it deletes",
  /if exists \(select 1 from league_members lm where lm\.player_id = tgt\.id\) then\s+raise exception 'This player is in a league'/.test(definition(head, "admin_remove_unplayed_account")?.body ?? ""),
  true);
// D4 and the dev's added requirement: plain snapshot columns, so neither
// deletion touches the log.
const audit = cols.filter(c => c.table === "admin_audit_log");
check("admin_audit_log references nothing, and keeps the actor's and target's id and name as plain columns",
  [audit.length > 0, audit.some(c => c.ref), /create table admin_audit_log \([^;]*references/i.test(stripComments(head)),
   ["actor_id", "actor_name", "target_id", "target_name", "league_id"].every(n => audit.some(c => c.col === n))],
  [true, false, false, true]);

if (failures.length) {
  console.log(`FAIL — ${failures.length} check(s):`);
  for (const f of failures) console.log("  " + f.replace(/\n/g, "\n  "));
  process.exit(1);
} else {
  console.log("PASS — all Stage X file checks passed.");
  process.exit(0);
}
