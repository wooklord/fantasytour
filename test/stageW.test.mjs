// Static self-consistency of sql/stage_w_vet_first_fast_path.sql. Its
// footer quotes whitespace-collapsed md5s of the function bodies that the
// dev compares against the live database, before (STEP 0: stage_n,
// stage_q) and after (STEP 2A: Stage W) the apply. A body edited without
// its md5 would read as "not deployed" or "live differs" when it is not, so
// this recomputes every quoted md5 from the files. Plain Node. Record:
// docs/decisions/onboarding.md, decision 7.
//
//   node test/stageW.test.mjs

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const failures = [];
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) failures.push(`${label}\n  expected: ${e}\n  actual:   ${a}`);
}
const read = f => readFileSync(new URL(`../sql/${f}`, import.meta.url), "utf8");

// prosrc (the text between the body's dollar quotes) of the ONE
// non-comment definition of `fn` in `src`, collapsed the way STEP 0's
// regexp_replace(prosrc, '\s+', ' ', 'g') collapses it, then md5.
function bodyMd5(src, fn) {
  const starts = [];
  for (const nd of [`create or replace function ${fn}(`, `create function ${fn}(`])
    for (let i = src.indexOf(nd); i !== -1; i = src.indexOf(nd, i + 1)) {
      const lineStart = src.lastIndexOf("\n", i) + 1;
      if (!src.slice(lineStart, i).includes("--")) starts.push(i);
    }
  if (starts.length !== 1) return `${starts.length} definitions`;
  const open = src.indexOf("$$", starts[0]);
  const body = src.slice(open + 2, src.indexOf("$$", open + 2));
  return createHash("md5").update(body.replace(/[ \t\n\r\f\v]+/g, " "), "utf8").digest("hex");
}

const W = read("stage_w_vet_first_fast_path.sql");
const footerAt = W.indexOf("/*");
const head = W.slice(0, footerAt), footer = W.slice(footerAt);
const between = (a, b) => footer.slice(footer.indexOf(a), footer.indexOf(b));
const step0 = between("-- STEP 0 BEGIN", "-- STEP 0 END");
const step2a = between("-- STEP 2A BEGIN", "-- STEP 2A END");
const step2b = between("-- STEP 2B BEGIN", "-- STEP 2B END");
// The md5 quoted on the line after a function's name in a step's comment.
const quoted = (step, fn) => step.slice(step.indexOf(`--   ${fn}`)).match(/body_md5_ws = ([0-9a-f]{32})/)?.[1] ?? null;

check("the file is begin…commit, then ONE block comment holding the footer, with the steps in order inside it",
  [/^begin;$/m.test(head), /^commit;$/m.test(head), (W.match(/\/\*/g) || []).length, (W.match(/\*\//g) || []).length,
   W.trimEnd().endsWith("*/"),
   footer.indexOf("-- STEP 0 BEGIN") < footer.indexOf("-- STEP 0 END") && footer.indexOf("-- STEP 0 END") < footer.indexOf("-- STEP 2A BEGIN")
     && footer.indexOf("-- STEP 2A END") < footer.indexOf("-- STEP 2B BEGIN") && footer.indexOf("-- STEP 2B BEGIN") < footer.indexOf("-- STEP 2B END")],
  [true, true, 1, 1, true, true]);
check("STEP 0's md5s are the CURRENT files' bodies: stage_n's admin_add_league_member, stage_q's list",
  [quoted(step0, "admin_add_league_member"), quoted(step0, "admin_list_unaffiliated_players")],
  [bodyMd5(read("stage_n_reject_pending_pin_change_writes.sql"), "admin_add_league_member"), bodyMd5(read("stage_q_unaffiliated_players.sql"), "admin_list_unaffiliated_players")]);
check("STEP 2A's md5s are Stage W's own bodies",
  [quoted(step2a, "admin_add_league_member"), quoted(step2a, "admin_list_unaffiliated_players")],
  [bodyMd5(head, "admin_add_league_member"), bodyMd5(head, "admin_list_unaffiliated_players")]);
check("the smoke test's stated total matches its number of checks, and it always ends by raising",
  [Number(step2b.match(/STAGE W SMOKE: 0 of (\d+) FAILED/)?.[1]), (step2b.match(/^\s*lbl := lbl \|\|/gm) || []).length,
   /raise exception 'STAGE W SMOKE: % of % FAILED%/.test(step2b) && step2b.trimEnd().endsWith("end $smoke$;")],
  [(step2b.match(/^\s*lbl := lbl \|\|/gm) || []).length, 14, true]);

if (failures.length) {
  console.log(`FAIL — ${failures.length} check(s):`);
  for (const f of failures) console.log("  " + f.replace(/\n/g, "\n  "));
  process.exit(1);
} else {
  console.log("PASS — all Stage W file checks passed.");
  process.exit(0);
}
