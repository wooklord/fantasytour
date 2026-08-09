// Regression test: a catalog entry with real leading/trailing whitespace
// (confirmed live: 7 of 363 songs_cache rows today, e.g. "Time Escaping ")
// used to pass autocomplete's substring filter but fail the save-time
// "not in catalog" check, because the save-time comparison trimmed the
// input value but not the catalog string it was compared against. See
// normSong in src/features/picks.js — both lookups now route through it.
//
//   npm test   (this file runs via package.json's pretest/posttest chain —
//   or directly: node test/autocomplete-catalog.test.mjs)

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runCatalogWhitespaceScenario } from "./harness.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

function inlineScripts(html){
  const out = [];
  const re = /<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) out.push(m[1]);
  return out;
}

const html = readFileSync(join(root, "index.html"), "utf8");
const appJs = readFileSync(join(root, "app.js"), "utf8");
const scripts = [...inlineScripts(html), appJs];

const failures = [];
function check(label, cond, detail){
  if (!cond) failures.push(detail ? `${label}\n  ${detail}` : label);
}

const res = await runCatalogWhitespaceScenario({ html, scripts, mode: "mobile" });

check("autocomplete actually offered the padded catalog entries (proves the test exercises the real bug, not a no-op)",
  res.openerValue === "Layla " && res.coverValue === "Time Escaping ",
  `openerValue: ${JSON.stringify(res.openerValue)}, coverValue: ${JSON.stringify(res.coverValue)}`);

check("selecting a padded song from autocomplete in a REGULAR slot never triggers the 'not in catalog' confirm",
  res.confirmCalls.length === 0,
  `confirmCalls: ${JSON.stringify(res.confirmCalls)}`);

check("the saved picks were trimmed before being submitted (no trailing space persisted)",
  res.savedPicks.some(p => p.slot === "opener" && p.songname === "Layla") &&
  res.savedPicks.some(p => p.slot === "cover1" && p.songname === "Time Escaping"),
  `savedPicks: ${JSON.stringify(res.savedPicks)}`);

if (!failures.length){
  console.log(`PASS — autocomplete/save-time catalog-match checks passed.`);
} else {
  console.log(`FAIL — ${failures.length} failure(s):`);
  for (const f of failures) console.log("  " + f.replace(/\n/g, "\n  "));
}
process.exit(failures.length ? 1 : 0);
