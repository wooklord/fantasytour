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

  const header = byLabel(log, "header-chrome");
  check("header shows the player name, league name, and current bracket label",
    header && /Wooklord/.test(header.whoami) && /Ambassadors/.test(header.whoami) && /Casual/.test(header.bracketLabel),
    `header: ${JSON.stringify(header)}`);

  const casualSheet = byLabel(log, "pick-sheet-open-casual");
  check("Casual pick sheet renders fillable inputs (never gated)",
    casualSheet && /slotline/.test(casualSheet.html));

  // Shows-list pick-status marker: show 1 has 2 of 5 (standard format's
  // target) saved and no draft yet at boot; show 2 has all 5 saved.
  const boot = byLabel(log, "boot")?.html || "";
  check("shows list marks show 1 (saved but incomplete, no draft) with the amber checkmark",
    boot.includes('pickmark progress" title="Picks saved but incomplete"'),
    `boot html: ${boot}`);
  check("shows list marks show 2 (saved, complete) with the green checkmark",
    boot.includes('pickmark done" title="Picks saved — complete"'),
    `boot html: ${boot}`);

  check("draft persists under the bracket-scoped key",
    res.draftKeyVal && JSON.parse(res.draftKeyVal).opener === "Distraction",
    `draftKeyVal: ${res.draftKeyVal}`);

  const withDraft = byLabel(log, "shows-list-with-draft")?.html || "";
  check("an unsaved draft flips show 1's marker to the amber warning glyph, outranking its still-incomplete saved count",
    withDraft.includes('pickmark warn" title="Draft in progress — not yet saved"'),
    `shows-list-with-draft html: ${withDraft}`);

  check("submit_picks called with p_bracket_id",
    rpcCalls.some(c => c.fn === "submit_picks" && c.args?.p_bracket_id != null),
    `rpc calls: ${JSON.stringify(rpcFns)}`);

  const afterSave = byLabel(log, "shows-list-after-save")?.html || "";
  check("saving picks clears the draft and refetches the count with no reload — show 1 drops back to the plain amber checkmark",
    afterSave.includes('pickmark progress" title="Picks saved but incomplete"') && !afterSave.includes("pickmark warn"),
    `shows-list-after-save html: ${afterSave}`);

  const officialGate = byLabel(log, "pick-sheet-official-ineligible");
  check("Official (no covering season) shows the ineligible reason, not a form",
    res.officialHasInputs === false && /No Official season covers this show yet/.test(officialGate?.html || ""),
    `official gate html: ${officialGate?.html}`);

  check("standings reads via get_bracket_scores rather than a raw scores table query",
    rpcFns.includes("get_bracket_scores"),
    `rpc calls: ${JSON.stringify(rpcFns)}`);

  // Regression for the standings default-season bug: the fixture's only
  // season ("Past Season") ended 2026-01-31, long before the 7-day grace
  // window relative to the real wall clock this harness runs against — so
  // the default must fall through to All time, NOT stay pinned on that
  // long-finished season forever (the old `.slice(-1)[0]` fallback this
  // replaced would have picked it unconditionally, with no grace check at all).
  const standings = byLabel(log, "standings");
  check("standings defaults to All time once the only season's grace period has long since passed",
    standings && /<option value="all" selected/.test(standings.html) && /· All time/.test(standings.html),
    `standings html: ${standings?.html}`);

  const admin = byLabel(log, "admin");
  check("admin tab renders admin content for a league admin",
    admin && /Seasons|Master switch/.test(admin.html),
    `admin html present: ${!!admin?.html}`);

  check("admin tab's embedded Settings section shows the Casual/Official bracket toggle",
    admin && /Casual/.test(admin.html) && /Official/.test(admin.html),
    `admin html: ${admin?.html}`);

  check("Members panel (league-scoped, not app-wide) lists both members, with the ★ badge on the league admin",
    admin && /★/.test(admin.html) && /Wooklord/.test(admin.html) && /EggHead/.test(admin.html),
    `admin html: ${admin?.html}`);

  check("Members panel has the add-member search control",
    admin && /member-search/.test(admin.html),
    `admin html: ${admin?.html}`);

  check("Seasons panel has a manage-roster control per saved season",
    admin && /manage roster/.test(admin.html),
    `admin html: ${admin?.html}`);

  check("Shows & cutoffs offers Reopen for the finalized fixture show (show 2), not Finalize",
    admin && /reopenShow\(2,/.test(admin.html) && !/finalizeShow\(2,/.test(admin.html),
    `admin html: ${admin?.html}`);

  const memberSearch = byLabel(log, "member-search-results");
  check("searching \"wa\" surfaces the non-member fixture player (Wanderer), not existing members",
    memberSearch && /Wanderer/.test(memberSearch.html) && !/Wooklord/.test(memberSearch.html) && !/EggHead/.test(memberSearch.html),
    `member-search-results: ${memberSearch?.html}`);

  const rosterPanel = byLabel(log, "season-roster-panel");
  check("season roster panel renders real join logic: p1 (on roster) gets Remove, p2 (not) gets Add",
    rosterPanel && /Wooklord/.test(rosterPanel.html) && /Remove/.test(rosterPanel.html)
      && /EggHead/.test(rosterPanel.html) && />Add</.test(rosterPanel.html),
    `season-roster-panel: ${rosterPanel?.html}`);

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
