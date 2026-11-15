// Static self-consistency of sql/stage_aa_audit_action_adjust_verdict.sql, the
// Stage X/Y/Z way: its footer quotes value lists and a column list that the
// dev compares against the live database before (STEP 0: Stage X's) and after
// (STEP 2: Stage AA's) the apply, and STEP R restores Stage X's check. A list
// edited in one place and not the others would pass every other test, so this
// recomputes them from this file and from Stage X's. It also holds the file
// to the one thing it is allowed to do, and to carrying no player identity.
// Plain Node. Record: docs/decisions/score-corrections.md.
//
//   node test/stageAA.test.mjs

import { readFileSync } from "node:fs";

const failures = [];
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) failures.push(`${label}\n  expected: ${e}\n  actual:   ${a}`);
}
const readSql = f => readFileSync(new URL(`../sql/${f}`, import.meta.url), "utf8");
const AA = readSql("stage_aa_audit_action_adjust_verdict.sql"), X = readSql("stage_x_signup_clear_and_remove.sql");
const NAME = "admin_audit_log_action_check";

const footerAt = AA.indexOf("/*");
const head = AA.slice(0, footerAt), footer = AA.slice(footerAt);
const between = (a, b) => footer.slice(footer.indexOf(a), footer.indexOf(b));
const step0 = between("-- STEP 0 BEGIN", "-- STEP 0 END");
const step2 = between("-- STEP 2 BEGIN", "-- STEP 2 END");
const stepR = between("-- STEP R BEGIN", "-- STEP R END");
const code = s => s.split("\n").filter(l => !l.trimStart().startsWith("--")).join("\n");
// The values of a "check (action in (...))" clause, in file order.
const inList = s => [...(s.match(/check\s*\(\s*action\s+in\s*\(([^)]*)\)/i)?.[1] ?? "").matchAll(/'([^']+)'/g)].map(m => m[1]);
// What a footer check compares the constraint's literals against: "vals.v = '<list>'".
const expectedVals = s => s.match(/vals\.v = '([^']+)'/)?.[1] ?? null;
const sortedC = a => [...a].sort((p, q) => (p < q ? -1 : p > q ? 1 : 0)).join(", ");

// ---------- structure ----------
const markers = ["-- STEP 0 BEGIN", "-- STEP 0 END", "-- STEP 2 BEGIN", "-- STEP 2 END", "-- STEP R BEGIN", "-- STEP R END"];
check("the footer holds every step marker once, in order",
  [markers.map(m => footer.split(m).length - 1), markers.map(m => footer.indexOf(m)).every((p, i, a) => p > 0 && (i === 0 || p > a[i - 1]))],
  [markers.map(() => 1), true]);
check("pasting the whole file runs one begin…commit; the footer is ONE block comment that runs to the end of the file",
  [(code(head).match(/^begin;$/gm) ?? []).length, (code(head).match(/^commit;$/gm) ?? []).length,
   AA.split("/*").length - 1, AA.split("*/").length - 1, AA.trimEnd().endsWith("*/")],
  [1, 1, 1, 1, true]);

// ---------- the one thing it does ----------
const statements = code(head).split(";").map(s => s.replace(/\s+/g, " ").trim()).filter(Boolean);
check("the apply is begin, ONE alter table on admin_audit_log, commit, and nothing else",
  [statements.length, statements[0], statements[2], /^alter table admin_audit_log drop constraint \S+, add constraint \S+ check \(/.test(statements[1])],
  [3, "begin", "commit", true]);
check("it drops and re-adds the constraint under the one name Stage X's inline check received (<table>_<column>_check)",
  [[...code(head).matchAll(/constraint (\w+)/g)].map(m => m[1]), /action\s+text not null check \(action in/.test(X)],
  [[NAME, NAME], true]);

// ---------- the lists ----------
const xList = inList(X), aaList = inList(code(head));
check("Stage X's list is the one this stage starts from", xList, ["remove_account"]);
check("Stage AA keeps every Stage X value, in order, and adds exactly adjust_verdict", aaList, [...xList, "adjust_verdict"]);
check("STEP 0 expects Stage X's list, as the constraint's literals sort", expectedVals(step0), sortedC(xList));
check("STEP 2 expects Stage AA's list, as the constraint's literals sort", expectedVals(step2), sortedC(aaList));
check("STEP R restores Stage X's list verbatim, under the same name, in one statement",
  [inList(code(stepR)), [...code(stepR).matchAll(/constraint (\w+)/g)].map(m => m[1]), code(stepR).split(";").filter(s => s.trim()).length],
  [xList, [NAME, NAME], 1]);
check("STEP 2's 'no row yet' check counts the value Stage AA adds",
  step2.match(/filter \(where action = '([^']+)'\)/)?.[1], aaList.at(-1));

// ---------- the table shape both steps expect ----------
const xCols = X.slice(X.indexOf("create table admin_audit_log ("), X.indexOf(");", X.indexOf("create table admin_audit_log (")))
  .split("\n").slice(1).map(l => l.trim().split(/\s+/)[0]).filter(Boolean).join(", ");
const colsExpected = s => s.match(/shp\.cols = '([^']+)'/)?.[1] ?? null;
check("STEP 0 and STEP 2 expect Stage X's column list, in order", [colsExpected(step0), colsExpected(step2)], [xCols, xCols]);

// ---------- hygiene ----------
check("every \"char\" catalog column is cast ::text (the Stage X lesson)",
  (footer.match(/\bcontype\b(?!::text)/g) ?? []).length, 0);
check("STEP 0 and STEP 2 are read-only: one statement each, starting with 'with'",
  [step0, step2].map(s => [code(s).split(";").filter(x => x.trim()).length, /^\s*with\b/.test(code(s))]),
  [[1, true], [1, true]]);
check("no player identity: the file holds no uuid", /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(AA), false);

if (failures.length) {
  console.error(`FAIL — ${failures.length} Stage AA file check(s):\n\n` + failures.join("\n\n"));
  process.exit(1);
}
console.log("PASS — all Stage AA file checks passed.");
