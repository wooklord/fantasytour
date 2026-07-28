// Boots the real app (against a stubbed Supabase client, real bundled code)
// and asserts fixed expectations — NOT a diff against a second run. Replaces
// test/compare.mjs: that harness diffed the current build against
// legacy-index.html, a pre-2.0 monolith frozen specifically for the
// index.html-splitting refactor. Once Stage C2 makes the app deliberately
// different (switcher, Official gating, bracket-scoped data), "identical to
// the old build" stops being the thing worth proving — this file asserts
// what the NEW behavior should actually be instead.
//
//   npm test   (or: node test/scenario.test.mjs)

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runScenario, runLoggedOutBoot } from "./harness.mjs";

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
const session = { id: "p1", name: "Wooklord", pin: "1234", is_global_admin: false };

const failures = [];
function check(label, cond, detail){
  if (!cond) failures.push(detail ? `${label}\n  ${detail}` : label);
}
function byLabel(log, label){ return log.find(e => e.label === label); }

async function runMode(mode){
  console.log(`\n=== mode: ${mode} ===`);
  const res = await runScenario({ html, scripts, mode, presetSession: session });
  const { log, calls } = res;
  const rpcCalls = calls.filter(c => c.type === "rpc");
  const rpcFns = rpcCalls.map(c => c.fn);

  const switcher = byLabel(log, "switcher-rendered");
  check("switcher renders both Casual and Official",
    switcher && /Casual/.test(switcher.html) && /Official/.test(switcher.html),
    `switcher html: ${switcher?.html}`);

  const casualSheet = byLabel(log, "pick-sheet-open-casual");
  check("Casual pick sheet renders fillable inputs (never gated)",
    casualSheet && /slotline/.test(casualSheet.html));

  check("draft persists under the bracket-scoped key",
    res.draftKeyVal && JSON.parse(res.draftKeyVal).opener === "Distraction",
    `draftKeyVal: ${res.draftKeyVal}`);

  check("submit_picks called with p_bracket_id",
    rpcCalls.some(c => c.fn === "submit_picks" && c.args?.p_bracket_id != null),
    `rpc calls: ${JSON.stringify(rpcFns)}`);

  const officialGate = byLabel(log, "pick-sheet-official-ineligible");
  check("Official (no covering season) shows the ineligible reason, not a form",
    res.officialHasInputs === false && /No Official season covers this show yet/.test(officialGate?.html || ""),
    `official gate html: ${officialGate?.html}`);

  check("standings reads via get_bracket_scores rather than a raw scores table query",
    rpcFns.includes("get_bracket_scores"),
    `rpc calls: ${JSON.stringify(rpcFns)}`);

  const admin = byLabel(log, "admin");
  check("admin tab renders admin content for a league admin",
    admin && /Seasons|Master switch/.test(admin.html),
    `admin html present: ${!!admin?.html}`);

  // Only themeMode itself (the stored preference) cycles through the literal
  // 3 states — the *rendered* dataset.theme value for "auto" resolves via
  // matchMedia("prefers-color-scheme"), which the harness stubs to always
  // report "not light", so the third toggle's visible theme is legitimately
  // "dark" again, not the string "auto". Assert against the stored
  // preference, which is the thing that actually cycles.
  const themeEntry = byLabel(log, "theme-sequence");
  check("theme cycles light -> dark -> back to the auto preference",
    themeEntry?.themeSeq?.[0] === "light" && themeEntry?.themeSeq?.[1] === "dark" && themeEntry?.themeModeStored === "auto",
    `themeSeq: ${JSON.stringify(themeEntry?.themeSeq)} stored: ${themeEntry?.themeModeStored}`);

  const toastSame = byLabel(log, "realtime-toast-current-league");
  check("league_shows realtime event for the CURRENT league fires a toast",
    toastSame && toastSame.toasts.length > 0,
    `toasts: ${toastSame?.toasts}`);

  const toastOther = byLabel(log, "realtime-toast-other-league");
  check("league_shows realtime event for a DIFFERENT league does NOT fire a toast",
    toastOther && toastOther.toasts.length === 0,
    `toasts: ${toastOther?.toasts}`);

  check("no crash reached the last-resort error trap",
    !(byLabel(log, "boot")?.html || "").includes("Script failed to load"));

  // runScenario always presets a valid session, so it never boots into
  // renderAuth() at all — a separate boot, with no session, is the only way
  // to exercise the login screen itself. This is exactly the coverage gap
  // that let a whole layout (login form landing in a hidden desktop column)
  // ship unnoticed: not "desktop vs mobile" so much as "the auth path was
  // never run in either mode."
  const loggedOut = await runLoggedOutBoot({ html, scripts, mode });
  check("logged-out boot renders the login form somewhere visible",
    loggedOut.authFormPresent && loggedOut.authFormInVisibleContainer,
    `colsDisplay: "${loggedOut.colsDisplay}" authFormPresent: ${loggedOut.authFormPresent} inVisibleContainer: ${loggedOut.authFormInVisibleContainer}`);

  return failures.length;
}

for (const mode of ["mobile", "desktop"]) await runMode(mode);

if (!failures.length){
  console.log(`\nPASS — all scenario checks passed.`);
} else {
  console.log(`\nFAIL — ${failures.length} failure(s):`);
  for (const f of failures) console.log("  " + f.replace(/\n/g, "\n  "));
}
process.exit(failures.length ? 1 : 0);
