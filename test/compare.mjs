import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runScenario } from "./harness.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

// Returns the source of every *inline* (no src=) <script> tag, in document order.
function inlineScripts(html){
  const out = [];
  const re = /<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) out.push(m[1]);
  return out;
}

const oldHtml = readFileSync(join(root, "index.html"), "utf8");
const newHtml = readFileSync(join(root, "index.new.html"), "utf8");
const appJs = readFileSync(join(root, "app.js"), "utf8");

const oldScripts = inlineScripts(oldHtml); // [errorTrap, bigAppScript]
const newScripts = [...inlineScripts(newHtml), appJs]; // [errorTrap, appBundle]

const session = { id: "p1", name: "Wooklord", pin: "1234", is_admin: true };

// The only intentional source-level change made during the split: the inline
// `onchange="boardSeason=this.value; renderBoard();"` (a bare global mutation,
// impossible once boardSeason lives on the shared state object) became
// `onchange="setBoardSeason(this.value)"`, a tiny exported wrapper that does
// the same `state.boardSeason = v; renderBoard();`. Normalize both variants
// to the same placeholder so this known, behaviorally-identical rename
// doesn't mask any *other* unintended difference in the diff below.
//
// A second intentional, post-split change: the show-detail score breakdown
// used to print the raw slot key (`opener`); it now looks up the slot's
// configured display label (`Opener`) and sorts rows into canonical
// pick-sheet order. The old monolith is a frozen historical reference and
// is not being patched to match, so mask the `<span class="sl">` text (the
// only place this shows up) rather than the whole comparison.
//
// A third and fourth intentional, post-split addition: a small "Created by
// Kyle McKinley" footer on every screen, and a "Setlist data from The
// Carton" attribution line under the show-detail setlist panel (linked when
// the show has a permalink, plain text otherwise). Neither exists in the old
// monolith at all, so strip them from the new build's HTML rather than the
// whole comparison.
function normalize(html){
  return html
    .replace(/boardSeason=this\.value; renderBoard\(\);/g, "SEASON_SELECT")
    .replace(/setBoardSeason\(this\.value\)/g, "SEASON_SELECT")
    .replace(/<span class="sl">[^<]*<\/span>/g, '<span class="sl">SLOT_LABEL</span>')
    .replace(/\n\s*<footer class="muted" style="text-align:center;padding:20px 0 4px">Created by Kyle McKinley<\/footer>/g, "")
    .replace(/<p class="muted" style="text-align:center">Setlist data from (?:The Carton|<a href="[^"]*" target="_blank" rel="noopener">The Carton<\/a>)\.<\/p>/g, "");
}

function diffLog(oldLog, newLog){
  const mismatches = [];
  const byLabel = new Map(newLog.map(e => [e.label, e]));
  for (const oldEntry of oldLog){
    const newEntry = byLabel.get(oldEntry.label);
    if (!newEntry){ mismatches.push(`MISSING checkpoint "${oldEntry.label}" in new build`); continue; }
    for (const key of Object.keys(oldEntry)){
      if (key === "label") continue;
      const av = typeof oldEntry[key] === "string" ? normalize(oldEntry[key]) : oldEntry[key];
      const bv = typeof newEntry[key] === "string" ? normalize(newEntry[key]) : newEntry[key];
      const a = JSON.stringify(av);
      const b = JSON.stringify(bv);
      if (a !== b) mismatches.push(`MISMATCH at "${oldEntry.label}".${key}\n  OLD: ${a?.slice(0,400)}\n  NEW: ${b?.slice(0,400)}`);
    }
  }
  return mismatches;
}

async function runMode(mode){
  console.log(`\n=== mode: ${mode} ===`);
  const [oldRes, newRes] = await Promise.all([
    runScenario({ html: oldHtml, scripts: oldScripts, mode, presetSession: session }),
    runScenario({ html: newHtml, scripts: newScripts, mode, presetSession: session }),
  ]);
  const mismatches = diffLog(oldRes.log, newRes.log);

  // Also compare localStorage draft persistence and the rpc/query call shape.
  if (oldRes.draftKeyVal !== newRes.draftKeyVal)
    mismatches.push(`MISMATCH draft localStorage value: OLD=${oldRes.draftKeyVal} NEW=${newRes.draftKeyVal}`);

  const oldRpc = oldRes.calls.filter(c => c.type === "rpc").map(c => c.fn).sort();
  const newRpc = newRes.calls.filter(c => c.type === "rpc").map(c => c.fn).sort();
  if (JSON.stringify(oldRpc) !== JSON.stringify(newRpc))
    mismatches.push(`MISMATCH rpc calls made: OLD=${JSON.stringify(oldRpc)} NEW=${JSON.stringify(newRpc)}`);

  const oldTables = oldRes.calls.filter(c => c.type === "query").map(c => c.table).sort();
  const newTables = newRes.calls.filter(c => c.type === "query").map(c => c.table).sort();
  if (JSON.stringify(oldTables) !== JSON.stringify(newTables))
    mismatches.push(`MISMATCH tables queried: OLD=${JSON.stringify(oldTables)} NEW=${JSON.stringify(newTables)}`);

  if (!mismatches.length){
    console.log(`PASS — ${oldRes.log.length} checkpoints identical between old and new builds.`);
    for (const e of newRes.log) console.log(`  ✔ ${e.label}`);
  } else {
    console.log(`FAIL — ${mismatches.length} mismatch(es):`);
    for (const m of mismatches) console.log("  " + m.replace(/\n/g, "\n  "));
  }
  return mismatches;
}

const allMismatches = [];
for (const mode of ["mobile", "desktop"]) allMismatches.push(...await runMode(mode));

console.log(`\n=== summary: ${allMismatches.length === 0 ? "ALL CHECKS PASSED" : allMismatches.length + " MISMATCH(ES)"} ===`);
process.exit(allMismatches.length ? 1 : 0);
