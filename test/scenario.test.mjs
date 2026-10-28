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
import { runScenario, runLoggedOutBoot, runNonAdminScenario, runGlobalAdminScenario, runBootScenario, runRosterScenario, runNoLeagueScenario, runNoLeagueLinksScenario, runNoLeaguePollScenario, runNoLeaguePollTimersScenario, runUnaffiliatedScenario, runFormatToggleScenario, runSaveSplitScenario, runForcedPinChangeScenario, runRankedChoiceScenario, runNoOverlayScenario, runSettingsLinksScenario, runStandingsTiebreakScenario, runScoresViewScenario, runLongNameScenario, runWhosPickedScenario, runRegisterLengthScenario, runSyncFlagScenario, runMembersPanelScenario, runStatsScenario, runEmptyLadderScenario, runOnboardingScenario, runVetFirstScenario } from "./harness.mjs";

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

  // Shows-list pick-status marker: show 1 (open, upcoming) has 2 of 5
  // (standard format's target) saved and no draft yet at boot; show 2
  // (final) has all 5 saved.
  const boot = byLabel(log, "boot")?.html || "";
  check("shows list marks show 1 (open, saved but incomplete, no draft) with the amber checkmark",
    boot.includes('pickmark progress" title="Picks saved but incomplete"'),
    `boot html: ${boot}`);
  check("show 2 (final, was fully picked) shows bare 'Score' — no marker at all once a show is final, regardless of completeness",
    boot.includes(">Score<") && !boot.includes("pickmark done"),
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

  // The real fix, verified end-to-end rather than assumed: a draft key
  // left over from before lock must stop being consulted the instant the
  // show locks, even though nothing clears the key itself at that moment.
  // Same show, same still-incomplete saved count (1 of 5), same
  // still-present draft — only the cutoff moved into the past.
  const afterLock = byLabel(log, "shows-list-after-lock-with-stale-draft")?.html || "";
  check("a show locking with a stale draft still present falls back to the amber check, not the exclamation and not nothing",
    afterLock.includes('pickmark progress" title="Picks saved but incomplete"') && !afterLock.includes("pickmark warn"),
    `shows-list-after-lock-with-stale-draft html: ${afterLock}`);

  // Slot mode's rules card. The ranked work turned the bottom-of-card note
  // from a ternary between two strings into a conditional render, so the
  // regression to catch is the element vanishing in BOTH modes rather than
  // just ranked. Every other rules-card assertion lives in the ranked
  // scenario, where absence is the expected result — so without this,
  // deleting the note outright would be entirely green.
  check("slot mode still renders the bottom-of-card rulenote",
    typeof res.slotsRules.note === "string" && /points per slot/.test(res.slotsRules.note),
    `note: ${JSON.stringify(res.slotsRules.note)}`);
  // Perfect sheet in slot mode: the fixture sets perfect:3, so the row must
  // render with that value read from config.
  check("slot mode renders the perfect-sheet row with the configured value",
    res.slotsRules.terms.includes("Perfect")
      && /\+3\./.test(res.slotsRules.descs.find(d => /Fill every row/.test(d)) ?? ""),
    `terms: ${JSON.stringify(res.slotsRules.terms)} descs: ${JSON.stringify(res.slotsRules.descs)}`);
  // The explicit half of that copy. Slot mode's perfect bonus fires on
  // `breakdown.every(x => x.hit)`, and a played-but-wrong-slot pick sets
  // hit=true — so the bonus really does pay on a sheet where every song
  // played and every slot was wrong. The caveat is the whole reason this
  // string is longer than the ranked one; asserting it stops a future
  // "tidy" from shortening the copy back into being misleading.
  check("slot mode's perfect-sheet copy keeps the slots-don't-have-to-match caveat",
    /slots don't have to match/.test(res.slotsRules.descs.find(d => /Fill every row/.test(d)) ?? ""),
    `descs: ${JSON.stringify(res.slotsRules.descs)}`);

  const officialGate = byLabel(log, "pick-sheet-official-ineligible");
  check("Official (no covering season) shows the ineligible reason, not a form",
    res.officialHasInputs === false && /No Official season covers this show yet/.test(officialGate?.html || ""),
    `official gate html: ${officialGate?.html}`);

  const resumed = byLabel(log, "shows-tab-resumed-after-standings");
  check("returning to Shows via the nav tab resumes the open show, not the list",
    resumed && /slotline/.test(resumed.html),
    `resumed html: ${resumed?.html}`);

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
  // The Data section is global-admin only (2026-08-17). Its three buttons
  // trigger CROSS-LEAGUE writes -- syncShows loops every league creating
  // league_shows overlays, and scoreShows scores every bracket of every
  // league and posts to every league's Discord. A league admin has no
  // business reaching that from their own league's panel.
  // NOTE this is presentation only, NOT a security boundary: the three edge
  // actions take no auth at all, runEdge is on window, and the endpoint is
  // callable with the publishable key. See CLAUDE.md.
  // This session (p1) is a league admin with is_global_admin:false, which is
  // exactly the case that must NOT see it.
  check("the Data section is hidden from a league admin who is not a global admin",
    admin && !/>Data</.test(admin.html) && !/Sync song catalog/.test(admin.html),
    `admin html: ${admin?.html?.slice(0, 400)}`);

  check("admin tab's embedded Settings section shows the Casual/Official bracket toggle",
    admin && /Casual/.test(admin.html) && /Official/.test(admin.html),
    `admin html: ${admin?.html}`);

  check("Members panel (league-scoped, not app-wide) lists both members, with the ★ badge on the league admin",
    admin && /★/.test(admin.html) && /Wooklord/.test(admin.html) && /EggHead/.test(admin.html),
    `admin html: ${admin?.html}`);

  check("Members panel has the add-member search control",
    admin && /member-search/.test(admin.html),
    `admin html: ${admin?.html}`);

  check("Members panel offers Reset PIN per member (Session 4 step 4)",
    admin && /resetMemberPin/.test(admin.html),
    `admin html: ${admin?.html}`);

  // Members panel cleanup (admin-panel.md → "Members panel cleanup",
  // LOCKED 2026-10-26, ROWS A). Structural read of #playerlist, own boot.
  const mp = await runMembersPanelScenario({ html, scripts, mode });
  const mrow = name => mp.rows.find(r => r.name === name);
  const S = v => JSON.stringify(v);
  check("members list renders every member as a two-line .member-row (no legacy single-line rows) and the word 'Official' appears on NONE of them",
    mp.rowCount === 3 && mp.legacyRows === 0 && mp.rows.every(r => r.official === false),
    `rows: ${S(mp.rows)} legacy: ${mp.legacyRows}`);
  check("'casual only' renders as a .pill ONLY on the official_opt_in:false member (the fixture's second member), and on no other row",
    mrow("EggHead")?.pill === "casual only" && /\bpill\b/.test(mrow("EggHead")?.pillClass || "")
      && mrow("Wooklord")?.pill === null && mrow(mp.LONG)?.pill === null,
    `pills: ${S(mp.rows.map(r => [r.name, r.pill]))}`);
  check("the league admin's row keeps its ★ and the 'admin' marker on line one; non-admin rows get the dot and no 'admin' marker",
    mrow("Wooklord")?.mark === "★" && mrow("Wooklord")?.markers.includes("admin")
      && mrow("EggHead")?.mark === "·" && !mrow("EggHead")?.markers.includes("admin")
      && mrow(mp.LONG)?.mark === "·" && !mrow(mp.LONG)?.markers.includes("admin"),
    `marks: ${S(mp.rows.map(r => [r.name, r.mark, r.markers]))}`);
  // Stylesheet read here rather than via the `css` declared further down
  // this function (a const — referencing it earlier is a TDZ error).
  const cssText = readFileSync(join(root, "styles.css"), "utf8");
  check("names are not truncated: a 27-character name renders in full with the full name in title through .mname, no row uses the ellipsis class .nm, and the stylesheet gives .mname no ellipsis/nowrap while .member-row stacks its two lines",
    mrow(mp.LONG)?.name === mp.LONG && mrow(mp.LONG)?.title === mp.LONG && mp.rows.every(r => r.usesNm === false)
      && /\.mname\{[^}]*\}/.test(cssText) && !/\.mname\{[^}]*(ellipsis|nowrap)/.test(cssText)
      && /\.pickres\.member-row\{flex-direction:column/.test(cssText),
    `long: ${S(mrow(mp.LONG))} usesNm: ${S(mp.rows.map(r => r.usesNm))}`);
  check("line two holds Reset PIN and Boot wired to resetMemberPin/bootPlayer with the player id for every other member; the viewer's own row shows 'you' on line one and renders no line two",
    S(mrow("EggHead")?.buttons) === S(["Reset PIN", "Boot"])
      && /^resetMemberPin\('p2', /.test(mrow("EggHead")?.onclicks[0] || "") && /^bootPlayer\('p2', /.test(mrow("EggHead")?.onclicks[1] || "")
      && S(mrow(mp.LONG)?.buttons) === S(["Reset PIN", "Boot"])
      && mrow("Wooklord")?.lineTwo === false && mrow("Wooklord")?.buttons.length === 0 && mrow("Wooklord")?.markers.includes("you"),
    `buttons: ${S(mp.rows.map(r => [r.name, r.lineTwo, r.buttons, r.onclicks, r.markers]))}`);

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
  check("a realtime_pings event for the CURRENT league fires a toast",
    toastSame && toastSame.toasts.length > 0,
    `toasts: ${toastSame?.toasts}`);

  const toastOther = byLabel(log, "realtime-toast-other-league");
  check("a realtime_pings event for a DIFFERENT league does NOT fire a toast",
    toastOther && toastOther.toasts.length === 0,
    `toasts: ${toastOther?.toasts}`);

  // Adding the ping channel is exactly the kind of change that's silently
  // poisoned a shared channel's OTHER bindings before (see CLAUDE.md's
  // realtime gotcha) — these three prove setlist_songs/seasons still
  // deliver after that addition, not just that the new binding works.
  const toastSong = byLabel(log, "realtime-toast-setlist-song");
  check("setlist_songs still delivers after adding the ping channel",
    toastSong && toastSong.toasts.length > 0,
    `toasts: ${toastSong?.toasts}`);

  const toastSeasonSame = byLabel(log, "realtime-toast-season-current-bracket");
  check("seasons still delivers for the CURRENT bracket after adding the ping channel",
    toastSeasonSame && toastSeasonSame.toasts.length > 0,
    `toasts: ${toastSeasonSame?.toasts}`);

  const toastSeasonOther = byLabel(log, "realtime-toast-season-other-bracket");
  check("seasons for a DIFFERENT bracket still does NOT fire a toast",
    toastSeasonOther && toastSeasonOther.toasts.length === 0,
    `toasts: ${toastSeasonOther?.toasts}`);

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

  // Stage S — the login screen is the first onboarding surface (onboarding
  // Batch 1, pre-auth). Three shapes: links present, none anywhere (the
  // default fixture, already loaded above), and a leagues read that throws.
  check("login screen with no links anywhere renders no community block (empty-set case)",
    !loggedOut.linksPresent && !/Looking for your league/.test(loggedOut.mainText),
    `mainText: ${loggedOut.mainText.slice(0, 300)}`);
  const loggedOutLinks = await runLoggedOutBoot({ html, scripts, mode, mutate: t => {
    t.leagues[0].config = { fb_url: "https://example.invalid/fb-group", discord_url: "https://example.invalid/discord-invite" };
    t.leagues.push({ id: 99, name: "Linkless League" });
  }});
  check("login screen shows both community links beneath a present form, one row per league that has any",
    loggedOutLinks.authFormPresent && loggedOutLinks.authFormInVisibleContainer
      && loggedOutLinks.linksPresent
      && loggedOutLinks.anchors.length === 2
      && loggedOutLinks.anchors.some(a => a.href === "https://example.invalid/fb-group" && /Facebook/.test(a.text))
      && loggedOutLinks.anchors.some(a => a.href === "https://example.invalid/discord-invite" && /Discord/.test(a.text))
      && loggedOutLinks.anchors.every(a => a.target === "_blank" && /noopener/.test(a.rel || "") && /noreferrer/.test(a.rel || ""))
      && /Ambassadors/.test(loggedOutLinks.blockText) && !/Linkless League/.test(loggedOutLinks.blockText),
    `anchors: ${JSON.stringify(loggedOutLinks.anchors)} blockText: ${JSON.stringify(loggedOutLinks.blockText)}`);
  const loggedOutErr = await runLoggedOutBoot({ html, scripts, mode, mutate: t => {
    Object.defineProperty(t, "leagues", { get(){ throw new Error("leagues read failed"); } });
  }});
  check("a failing leagues read leaves the login form intact and renders no community block",
    loggedOutErr.authFormPresent && loggedOutErr.authFormInVisibleContainer && !loggedOutErr.linksPresent,
    `authFormPresent: ${loggedOutErr.authFormPresent} linksPresent: ${loggedOutErr.linksPresent}`);

  // Every session above is p1, a league admin in the fixture — this whole
  // suite never logged in as a genuine non-admin until now. Regression
  // coverage for the real bug: a non-admin's shared admin/settings tab
  // rendered the admin-only panel after backgrounding+foregrounding,
  // because refreshCurrent() called renderAdmin() directly instead of the
  // role-aware dispatcher every other call site already used.
  const nonAdmin = await runNonAdminScenario({ html, scripts, mode });
  check("non-admin's shared tab shows Settings, not Admin, content",
    /Bracket/.test(nonAdmin.settingsHtml) && /Log out/.test(nonAdmin.settingsHtml)
      && !/Master switch/.test(nonAdmin.settingsHtml) && !/id="whospicked"/.test(nonAdmin.settingsHtml),
    `settingsHtml: ${nonAdmin.settingsHtml}`);
  check("non-admin's shared tab is labeled Settings, not Admin",
    nonAdmin.sharedTabLabel === "Settings",
    `sharedTabLabel: "${nonAdmin.sharedTabLabel}"`);

  check("Settings offers self-service PIN change fields",
    /pin-current/.test(nonAdmin.settingsHtml) && /pin-new/.test(nonAdmin.settingsHtml) && /pin-confirm/.test(nonAdmin.settingsHtml),
    `settingsHtml: ${nonAdmin.settingsHtml}`);
  check("a new/confirm PIN mismatch is rejected client-side, no session change",
    /don't match/.test(nonAdmin.mismatchErr) && nonAdmin.sessionAfterMismatch?.pin === "1234",
    `mismatchErr: "${nonAdmin.mismatchErr}" sessionAfterMismatch: ${JSON.stringify(nonAdmin.sessionAfterMismatch)}`);
  check("a successful self-service PIN change updates the stored session and leaves must_change_pin false",
    nonAdmin.sessionAfterPinChange?.pin === "5555" && nonAdmin.sessionAfterPinChange?.must_change_pin === false,
    `sessionAfterPinChange: ${JSON.stringify(nonAdmin.sessionAfterPinChange)}`);
  check("backgrounding+foregrounding on that tab still shows Settings, not the admin panel (the actual bug)",
    /Bracket/.test(nonAdmin.afterForegroundHtml) && /Log out/.test(nonAdmin.afterForegroundHtml)
      && !/Master switch/.test(nonAdmin.afterForegroundHtml) && !/id="whospicked"/.test(nonAdmin.afterForegroundHtml),
    `afterForegroundHtml: ${nonAdmin.afterForegroundHtml}`);

  // p4 is a genuine global admin (is_global_admin:true) with no
  // league_members.is_league_admin flag at all — closes the blind spot
  // CLAUDE.md flags: every other scenario's admin coverage runs through the
  // league-admin branch, never the is_global_admin one.
  const globalAdmin = await runGlobalAdminScenario({ html, scripts, mode });
  // settingsPanelHtml() (with its own "Log out" button) is embedded inside
  // renderAdmin() too (see admin.js), so "Log out" appears on both — the
  // admin-only signal is Master switch/Who's picked, not the absence of Log out.
  // Keyed on the section ID, not its title: this broke once when "Master
  // switch" was renamed to "Voting & scoring mode" (2026-08-17). The id is
  // the stable identity — it is what toggleSection and the localStorage
  // collapse state address — while titles are copy and will change again.
  check("a genuine global admin (no league-admin flag) sees Admin content",
    /id="sec-master"/.test(globalAdmin.adminHtml) && /id="whospicked"/.test(globalAdmin.adminHtml),
    `adminHtml present: ${!!globalAdmin.adminHtml}`);
  check("a genuine global admin's shared tab is labeled Admin, not Settings",
    globalAdmin.sharedTabLabel === "Admin",
    `sharedTabLabel: "${globalAdmin.sharedTabLabel}"`);
  check("the Global console section renders for a global admin",
    /Global console/.test(globalAdmin.adminHtml),
    `adminHtml: ${globalAdmin.adminHtml}`);
  check("creating a league via the Global console adds a real row",
    globalAdmin.leagueCountAfterCreate === 2,
    `leagueCountAfterCreate: ${globalAdmin.leagueCountAfterCreate}`);
  check("Global console player search surfaces the non-member fixture player (Wanderer)",
    /Wanderer/.test(globalAdmin.appointResultsHtml),
    `appointResultsHtml: ${globalAdmin.appointResultsHtml}`);
  check("appointing via the Global console makes Wanderer an admin of the new league",
    globalAdmin.wandererIsAdminOfNewLeague === true,
    `wandererIsAdminOfNewLeague: ${globalAdmin.wandererIsAdminOfNewLeague}`);
  // Stage R — a new league is on the schedule from creation. Coverage, not a
  // count: the overlay's show ids must equal the fixture's show ids exactly
  // (so an extra or missing row both fail), and no cutoff may be null (the
  // state that made Green Eggs unplayable). The fake global_create_league
  // seeds these; the real RPC does once sql/stage_r_* is APPLIED — until
  // then this pins the fake to the intended behaviour, not the live one.
  check("a created league gets one league_shows row per existing show (ids match exactly)",
    JSON.stringify(globalAdmin.newLeagueOverlayShowIds) === JSON.stringify(globalAdmin.fixtureShowIds)
      && globalAdmin.fixtureShowIds.length > 0,
    `overlay show ids: ${JSON.stringify(globalAdmin.newLeagueOverlayShowIds)} vs shows: ${JSON.stringify(globalAdmin.fixtureShowIds)}`);
  check("a created league's seeded rows all have a cutoff (zero null cutoff_at)",
    globalAdmin.newLeagueOverlayRows > 0 && globalAdmin.newLeagueOverlayNullCutoffs === 0,
    `rows: ${globalAdmin.newLeagueOverlayRows}, null cutoffs: ${globalAdmin.newLeagueOverlayNullCutoffs}`);

  // Module B — ranked-choice scoring on Casual, slots still on Official.
  const ranked = await runRankedChoiceScenario({ html, scripts, mode });
  check("ranked bracket renders the ladder editor with the stored ladder",
    JSON.stringify(ranked.ladderValues) === JSON.stringify(["5","4","3","2","1"]),
    `ladderValues: ${JSON.stringify(ranked.ladderValues)}`);
  check("ladder rows are labelled by position",
    JSON.stringify(ranked.rankLabels) === JSON.stringify(["Rank 1","Rank 2","Rank 3","Rank 4","Rank 5"]),
    `rankLabels: ${JSON.stringify(ranked.rankLabels)}`);
  // Absence, not invisibility: decision 1 is that cover/debut/wildcard cannot
  // be turned on for a ranked bracket, and a hidden-but-present input is not that.
  check("slots-mode fields are absent from the DOM in ranked mode",
    ranked.leakedSlotsFields.length === 0,
    `leaked: ${JSON.stringify(ranked.leakedSlotsFields)}`);
  check("perfect-sheet field is still present in ranked mode (it moved to Master switch)",
    ranked.perfectPresent === true,
    `perfectPresent: ${ranked.perfectPresent}`);
  check("switching the mode select to slots swaps the rules region in place",
    ranked.afterSwitchToSlots.hasSlots && !ranked.afterSwitchToSlots.hasLadder && ranked.afterSwitchToSlots.hasCover,
    `afterSwitchToSlots: ${JSON.stringify(ranked.afterSwitchToSlots)}`);
  check("switching back to ranked restores the ladder editor",
    ranked.backToRanked.hasLadder && !ranked.backToRanked.hasSlots,
    `backToRanked: ${JSON.stringify(ranked.backToRanked)}`);
  // Blank rank rejection. Every rendered row must carry a value — clearing a
  // field is not how a rank is removed (that's the ✕), and dropping it
  // silently would shift every rank beneath it up one with nothing telling
  // the admin. Same path covers browser-mangled input, since type="number"
  // coerces unparseable content to "" before readLadder ever sees it.
  check("a blank rank row is rejected with a message naming the rank",
    /Rank 3 has no value/.test(ranked.blankRowReject.err),
    `cfg-err: "${ranked.blankRowReject.err}"`);
  check("a blank rank row aborts before any admin_update_config call",
    ranked.blankRowReject.rpcCalls === 0,
    `rpcCalls: ${ranked.blankRowReject.rpcCalls}`);
  check("a blank rank row leaves the stored config untouched",
    ranked.blankRowReject.configUnchanged === true,
    `configUnchanged: ${ranked.blankRowReject.configUnchanged}`);
  // Removing every rank via ✕ is reachable, and hits saveConfig's own guard
  // rather than readLadder's per-row one. containerPresent proves which
  // branch ran — see the comment in the harness.
  check("emptying the ladder still leaves #rankladder in the DOM (so the empty guard runs)",
    ranked.emptyLadderReject.containerPresent === true,
    `containerPresent: ${ranked.emptyLadderReject.containerPresent}`);
  check("a ranked bracket with zero ranks is rejected with a message",
    /at least one rank/.test(ranked.emptyLadderReject.err),
    `cfg-err: "${ranked.emptyLadderReject.err}"`);
  check("a zero-rank ladder aborts before any admin_update_config call",
    ranked.emptyLadderReject.rpcCalls === 0,
    `rpcCalls: ${ranked.emptyLadderReject.rpcCalls}`);
  check("a zero-rank ladder leaves the stored config untouched",
    ranked.emptyLadderReject.configUnchanged === true,
    `configUnchanged: ${ranked.emptyLadderReject.configUnchanged}`);
  check("saving from ranked mode writes mode and ladder",
    ranked.savedMode === "ranked_choice" && JSON.stringify(ranked.savedLadder) === JSON.stringify([5,4,3,2,1]),
    `savedMode: ${ranked.savedMode}, savedLadder: ${JSON.stringify(ranked.savedLadder)}`);
  // The data-loss guard. None of these fields has an input on screen in
  // ranked mode, so they survive a save only through saveConfig()'s
  // read-through-to-state.cfg fallbacks. Expectations are HARDCODED to what
  // makeRankedFixtures sets — deriving them from the fixture would let a
  // corrupted fixture corrupt the expectation to match, passing while
  // proving nothing. Each value is one a regressed guard's literal fallback
  // would visibly differ from; see makeRankedFixtures for why these specific
  // numbers (five of the plain defaults coincide with their own fallback).
  check("saving from ranked mode preserves slots array contents",
    ranked.slotsAfter === ranked.slotsBefore,
    `before: ${ranked.slotsBefore}\n    after:  ${ranked.slotsAfter}`);
  check("saving from ranked mode preserves oneset.slots array contents",
    ranked.onesetSlotsAfter === ranked.onesetSlotsBefore,
    `before: ${ranked.onesetSlotsBefore}\n    after:  ${ranked.onesetSlotsAfter}`);
  check("saving from ranked mode preserves every scalar slots-mode field",
    JSON.stringify(ranked.preserved) === JSON.stringify({
      flat_picks: 2, flat_points: 3,
      partial_credit: true, partial_points: 2,
      allow_duplicates: true,
      cover: 1, debut: 2, perfect: 7,
      wildcardDebut: false,
      onesetFlatPicks: 1, onesetFlatPoints: 2,
    }),
    `actual: ${JSON.stringify(ranked.preserved)}`);
  // ---- the ranked pick sheet (player-facing) ----
  check("ranked pick sheet renders one input per ladder rung, keyed rank1..rankN",
    JSON.stringify(ranked.sheet.slotKeys) === JSON.stringify(["rank1","rank2","rank3","rank4","rank5"]),
    `slotKeys: ${JSON.stringify(ranked.sheet.slotKeys)}`);
  // Rows carry no label in ranked mode — the points bubble replaces it,
  // since the rank and the points are the same fact. Omitted from the DOM
  // rather than CSS-hidden, so this count is a real check rather than an
  // assertion about invisible text. The bubble's left position is
  // `.slotline.ranked .pts{order:-1}`, which JSDOM cannot see; the manual
  // browser pass covers that half.
  check("ranked pick sheet rows carry no label element",
    ranked.sheet.labelCount === 0,
    `labelCount: ${ranked.sheet.labelCount}`);
  check("ranked pick sheet rows carry the .ranked modifier class",
    ranked.sheet.rowsCarryRankedClass === true,
    `rowsCarryRankedClass: ${ranked.sheet.rowsCarryRankedClass}`);
  check("each row shows its ladder value",
    JSON.stringify(ranked.sheet.points) === JSON.stringify(["5","4","3","2","1"]),
    `points: ${JSON.stringify(ranked.sheet.points)}`);
  // One LADDER row, not one per rank — asserted on the terms rather than on
  // a total row count, which is no longer a fixed 1 now that the
  // perfect-sheet row is conditional. A 5-rung ladder rendering one row per
  // rank is the regression this guards.
  check("the rules card explains the ladder once, not once per rank",
    ranked.sheet.ruleTerms.filter(t => t === "Ladder").length === 1,
    `ruleTerms: ${JSON.stringify(ranked.sheet.ruleTerms)}`);
  // Copy is worded against what's on screen: rows are unlabelled now, so the
  // rules row explains the number beside each row rather than naming ranks
  // the player can no longer see.
  //
  // Matched on the FULL sentence, not on /number beside it/. That fragment
  // survived the last two rewordings of this string unchanged, so a green
  // result proved only that some ladder copy existed — not that the intended
  // copy landed. The negative half matters just as much: the dropped second
  // sentence ("Top row is worth most (5), down to 1 …") also contained
  // "number beside it"'s neighbourhood and would have passed the old check
  // while still wrapping to seven lines on a phone.
  check("the ladder row uses the current wording, not a previous revision",
    ranked.sheet.ruleText === "Each row scores the number beside it if that song is played, anywhere in the show.",
    `ruleText: "${ranked.sheet.ruleText}"`);
  check("the dropped second sentence is gone from the ladder row",
    !/Top row is worth most/.test(ranked.sheet.ruleText) && !/setlist/.test(ranked.sheet.ruleText),
    `ruleText: "${ranked.sheet.ruleText}"`);
  check("'pays' is gone from player-facing ranked copy",
    !ranked.sheet.ruleDescs.some(d => /\bpays\b/.test(d)) && !/\bpays\b/.test(ranked.sheet.ruleNote ?? ""),
    `descs: ${JSON.stringify(ranked.sheet.ruleDescs)} note: ${JSON.stringify(ranked.sheet.ruleNote)}`);
  // Ranked mode renders NO note element, rather than alternate copy — the
  // ladder row already says what the numbers mean, and the old note was a
  // second copy of the same sentence six lines below it.
  check("ranked mode renders no bottom-of-card rulenote at all",
    ranked.sheet.ruleNote === null,
    `ruleNote: ${JSON.stringify(ranked.sheet.ruleNote)}`);
  // Perfect sheet, present direction. The ranked fixture sets perfect:5, so
  // the row must render AND must carry that value from config rather than a
  // hardcoded number.
  check("perfect-sheet row renders when the bonus is non-zero",
    ranked.sheet.ruleTerms.includes("Perfect"),
    `ruleTerms: ${JSON.stringify(ranked.sheet.ruleTerms)}`);
  check("perfect-sheet row reads its value from config, not a literal",
    /\+7\./.test(ranked.sheet.ruleDescs.find(d => /Fill all/.test(d)) ?? ""),
    `descs: ${JSON.stringify(ranked.sheet.ruleDescs)}`);
  check("perfect-sheet row names the real ladder length",
    /Fill all 5 rows/.test(ranked.sheet.ruleDescs.find(d => /Fill all/.test(d)) ?? ""),
    `descs: ${JSON.stringify(ranked.sheet.ruleDescs)}`);
  check("no 'Anywhere in the show' divider in ranked mode (no flat picks)",
    ranked.sheet.hasFlatDivider === false,
    `hasFlatDivider: ${ranked.sheet.hasFlatDivider}`);
  // NOTE: the "Any Debut" assertions deliberately do NOT run here. This
  // fixture sets wildcards.debut:false, so the wildcard would be absent
  // even with the mode check removed — the assertion would pass for the
  // wrong reason. They run against the wildcard-ON fixture below instead.
  // (Found by mutation: reverting the mode gate left this run green.)
  // Breakdown ordering. The fixture stores these rows shuffled, so this is
  // the check that proves breakdownSlotInfo supplied a real order rather
  // than falling through to sortBySlotOrder's compares-equal path — which
  // would leave DB order, and would look right whenever DB order happened
  // to match. Length asserted first: a wrong selector yields [] silently.
  check("frozen breakdown renders one row per rank (positive control)",
    ranked.breakdownLabels.length === 5,
    `breakdownLabels: ${JSON.stringify(ranked.breakdownLabels)}`);
  check("frozen breakdown displays ranks in rank order, not stored order",
    JSON.stringify(ranked.breakdownLabels) === JSON.stringify(["Rank 1","Rank 2","Rank 3","Rank 4","Rank 5"]),
    `breakdownLabels: ${JSON.stringify(ranked.breakdownLabels)}`);
  // The pre-scoring pick board still names ranks. This is the surface that
  // keeps slotDefs' labels alive now the sheet omits them — blanking the
  // label there would break this and nothing else.
  check("pre-scoring pick board still labels picks by rank",
    JSON.stringify(ranked.pickBoardLabels) === JSON.stringify(["Rank 1","Rank 2","Rank 3"]),
    `pickBoardLabels: ${JSON.stringify(ranked.pickBoardLabels)}`);

  // Mode-change orphan warning, BOTH directions. Only testing "doesn't
  // fire" would let a broken picks lookup pass — a query returning [] for
  // the wrong reason looks identical to a bracket with nothing at risk.
  check("changing scoring mode warns that existing picks will be orphaned",
    ranked.modeWarning.fired === true,
    `confirms seen: ${JSON.stringify(ranked.modeWarning.message)}`);
  // Matched on structure, not the full string — the copy embeds live counts
  // and venue names, so asserting the whole message would break on every
  // wording change and on any fixture edit.
  // Pins the actual NUMBER, not just that digits appear. The fixture has
  // p1 holding 2 Casual picks for the open show while p2 and p4 are members
  // with zero — so summing picks_count gives 2 and counting rows gives 3
  // (league size). The old regex /\d+ pick(s)?/ matched either, so a
  // row-count regression rendered "3 picks" and passed. This is the
  // count-vs-coverage substitution in assertion form.
  // Pins the actual NUMBER, not just that digits appear. At this point in
  // the scenario the open show holds exactly 1 pick (the sheet save earlier
  // in this run replaced its fixture picks), while the league has 3 members
  // — so summing picks_count gives 1 and counting rows gives 3. The old
  // regex /\d+ pick(s)?/ matched either, so a row-count regression rendered
  // "3 picks" and passed. Count-vs-coverage substitution, in assertion form.
  check("the warning names the real at-risk pick count, not the member count",
    /1 pick across 1 open show/.test(ranked.modeWarning.message),
    `message: ${JSON.stringify(ranked.modeWarning.message)}`);
  check("cancelling the warning leaves the stored mode unchanged",
    ranked.modeWarning.modeAfterCancel === "ranked_choice",
    `modeAfterCancel: ${ranked.modeWarning.modeAfterCancel}`);
  check("a routine save that does NOT change mode raises no orphan warning",
    ranked.confirmsOnUnchangedSave.every(m => !/orphan/i.test(m)),
    `confirms: ${JSON.stringify(ranked.confirmsOnUnchangedSave)}`);

  // Failed-lookup branch. A save that can't determine the risk must still
  // present a decision — silently proceeding would make "nothing at risk"
  // and "couldn't find out" indistinguishable to the admin.
  check("a failed picks lookup still warns before switching mode",
    ranked.lookupFailWarning.fired === true,
    `confirms: ${JSON.stringify(ranked.lookupFailWarning)}`);
  check("the failed-lookup warning does not invent a pick count",
    ranked.lookupFailWarning.claimedACount === false,
    `claimedACount: ${ranked.lookupFailWarning.claimedACount}`);
  check("cancelling the failed-lookup warning leaves the stored mode unchanged",
    ranked.lookupFailWarning.modeAfterCancel === "ranked_choice",
    `modeAfterCancel: ${ranked.lookupFailWarning.modeAfterCancel}`);

  // Second run, wildcard flipped. wildcards.debut is the one config boolean
  // no single fixture value can cover: dropping its guard yields false when
  // the input is absent, keeping it with a literal fallback yields true, so
  // false catches one shape and true catches the other. The run above (false)
  // covers the literal-fallback regression; this one covers guard-dropped.
  // Only the wildcard is re-asserted — everything else is already proven above.
  const rankedWildcardOn = await runRankedChoiceScenario({ html, scripts, mode, wildcardDebut: true });
  check("saving from ranked mode preserves wildcards.debut when it is ON",
    rankedWildcardOn.preserved.wildcardDebut === true,
    `wildcardDebut: ${rankedWildcardOn.preserved.wildcardDebut}`);
  // "Any Debut" suppression is asserted HERE, on the wildcard-ON fixture,
  // not on the run above. With wildcards.debut:false the wildcard is absent
  // regardless of the mode check, so that run cannot distinguish suppression
  // from the flag simply being off — verified by mutation, which passed
  // green against the other fixture. Only with the flag ON does the mode
  // check become the sole thing keeping "Any Debut" off a ranked sheet.
  check("autocomplete dropdown actually renders (positive control)",
    rankedWildcardOn.sheet.autocompleteRendered === true,
    `autocompleteRendered: ${rankedWildcardOn.sheet.autocompleteRendered}`);
  check("'Any Debut' is NOT offered in ranked mode even when wildcards.debut is ON",
    rankedWildcardOn.sheet.offersAnyDebut === false,
    `offersAnyDebut: ${rankedWildcardOn.sheet.offersAnyDebut}`);
  // The other half of the same bug: savePicks exempts wildcards from the
  // not-in-catalog confirm, so without a mode check a typed-from-memory
  // "Any Debut" would save silently in ranked mode — where it scores 0.
  check("typing 'Any Debut' in ranked mode still triggers the not-in-catalog confirm",
    rankedWildcardOn.sheet.confirmedUnknown === true,
    `confirmedUnknown: ${rankedWildcardOn.sheet.confirmedUnknown}`);

  // Perfect-sheet row, ABSENT direction — a third ranked run purely to flip
  // bonuses.perfect to 0. A single fixture value can only ever exercise one
  // direction, and "+0" advertises a bonus that cannot be earned, so the
  // absence is a real requirement rather than a cosmetic one.
  const rankedNoPerfect = await runRankedChoiceScenario({ html, scripts, mode, perfect: 0 });
  check("perfect-sheet row does NOT render when the bonus is zero",
    !rankedNoPerfect.sheet.ruleTerms.includes("Perfect"),
    `ruleTerms: ${JSON.stringify(rankedNoPerfect.sheet.ruleTerms)}`);
  // Positive control for the check immediately above. Without it, a bug that
  // dropped EVERY rules row (an exception in ruleDefs, a broken selector, a
  // sheet that never rendered) would satisfy the absence assertion for
  // entirely the wrong reason and look green.
  check("...and the Ladder row still renders on that run (positive control)",
    rankedNoPerfect.sheet.ruleTerms.includes("Ladder"),
    `ruleTerms: ${JSON.stringify(rankedNoPerfect.sheet.ruleTerms)}`);

  // Session 4 step 2: must_change_pin:true must block the normal tabs
  // behind a forced interstitial, and submitting a matching new PIN must
  // clear the flag in the stored session.
  // bootPlayer's three confirm branches. Boot is irreversible for a player's
  // standings position (they keep taking zeros in a running season and
  // nothing in the app undoes it), so the dialog wording IS the safety
  // mechanism, and the lookup that selects the wording gates the boot.
  const bootScen = await runBootScenario({ html, scripts, mode });
  check("boot with no season running says so explicitly",
    /No Official season is running/.test(bootScen.case1.firstConfirm),
    `case1 confirm: ${JSON.stringify(bootScen.case1.firstConfirm)}`);
  // NOT a plain !/zero/ test: the no-season wording legitimately says "no
  // zeros will accrue", so the word itself is present and proves nothing.
  // The discriminating property is the absence of the live-season WARNING —
  // the tiebreaker name and the no-workaround sentence. This is also what
  // makes the check fail when the two branch strings are swapped.
  check("boot with no season running carries none of the live-season warning",
    !/fewest zeros/i.test(bootScen.case1.firstConfirm)
      && !/NO way to prevent/i.test(bootScen.case1.firstConfirm),
    `case1 confirm: ${JSON.stringify(bootScen.case1.firstConfirm)}`);
  check("boot with no season running proceeds to admin_league_boot when accepted",
    bootScen.case1.booted === true,
    `case1 booted: ${bootScen.case1.booted}`);
  check("boot during a live season names that season in the confirm",
    /Live Season/.test(bootScen.case2.firstConfirm),
    `case2 confirm: ${JSON.stringify(bootScen.case2.firstConfirm)}`);
  check("boot during a live season states the zero-accrual consequence",
    /zero/i.test(bootScen.case2.firstConfirm) && /fewest zeros/i.test(bootScen.case2.firstConfirm),
    `case2 confirm: ${JSON.stringify(bootScen.case2.firstConfirm)}`);
  // The third clause is the newest claim and the one most likely to be
  // softened back into sounding harmless — remove-then-re-add silently drops
  // a player's accumulated zeros, which is a standings change in their
  // favour, not a repair. Pinned explicitly for that reason.
  check("boot during a live season says roster removal is not a workaround, and that re-adding is a standings edit rather than a repair",
    /NO way to prevent/i.test(bootScen.case2.firstConfirm)
      && /not a workaround/i.test(bootScen.case2.firstConfirm)
      && /standings edit, not a repair/i.test(bootScen.case2.firstConfirm),
    `case2 confirm: ${JSON.stringify(bootScen.case2.firstConfirm)}`);
  check("boot during a live season still proceeds when accepted",
    bootScen.case2.booted === true,
    `case2 booted: ${bootScen.case2.booted}`);
  // The three case-3 assertions are deliberately separate: a dropped early
  // return trips "no confirm" and "no rpc" together, while a lost toast trips
  // only the third. Collapsing them would hide which half regressed.
  check("a failed season lookup shows NO confirm at all",
    bootScen.case3.confirmCount === 0,
    `case3 confirmCount: ${bootScen.case3.confirmCount}`);
  check("a failed season lookup does NOT call admin_league_boot",
    bootScen.case3.booted === false,
    `case3 booted: ${bootScen.case3.booted}`);
  check("a failed season lookup surfaces a toast explaining the boot was cancelled",
    /cancel/i.test(bootScen.case3.toastHtml),
    `case3 toastHtml: ${bootScen.case3.toastHtml}`);

  // Season-roster removal. The wording claims are pinned individually
  // because each states a fact that was got WRONG at least once while this
  // dialog was being written: that the player stays on the board, that
  // removal doesn't stop zeros, and that a re-add drops accumulated zeros.
  const roster = await runRosterScenario({ html, scripts, mode });
  check("roster removal confirms, and says the player does NOT disappear from the standings",
    /do not disappear from the standings/i.test(roster.unlocked.confirm),
    `unlocked confirm: ${JSON.stringify(roster.unlocked.confirm)}`);
  check("roster removal says it does NOT stop their zeros and can increase them",
    /does NOT stop their zeros/i.test(roster.unlocked.confirm)
      && /widens the zero window/i.test(roster.unlocked.confirm),
    `unlocked confirm: ${JSON.stringify(roster.unlocked.confirm)}`);
  check("roster removal warns that re-adding resets the join date and permanently drops earlier zeros",
    /join date resets/i.test(roster.unlocked.confirm)
      && /permanently dropped/i.test(roster.unlocked.confirm),
    `unlocked confirm: ${JSON.stringify(roster.unlocked.confirm)}`);
  check("roster removal proceeds to admin_set_season_roster when accepted",
    roster.unlocked.called === true,
    `unlocked called: ${roster.unlocked.called}`);
  check("an UNLOCKED season's removal confirm omits the activation sentence",
    !/already activated/i.test(roster.unlocked.confirm),
    `unlocked confirm: ${JSON.stringify(roster.unlocked.confirm)}`);
  check("a LOCKED season's removal confirm adds the activation sentence",
    /already activated/i.test(roster.locked.confirm)
      && /only a manual re-add/i.test(roster.locked.confirm),
    `locked confirm: ${JSON.stringify(roster.locked.confirm)}`);
  check("cancelling the roster-removal confirm makes NO admin_set_season_roster call",
    roster.cancelled.called === false,
    `cancelled called: ${roster.cancelled.called}`);
  check("ADDING to a roster is confirm-free and still calls the RPC",
    roster.added.confirmCount === 0 && roster.added.called === true,
    `add confirmCount: ${roster.added.confirmCount}, called: ${roster.added.called}`);
  check("a failed season lookup blocks roster removal with no confirm",
    roster.lookupFailed.confirmCount === 0,
    `lookupFailed confirmCount: ${roster.lookupFailed.confirmCount}`);
  check("a failed season lookup makes NO admin_set_season_roster call",
    roster.lookupFailed.called === false,
    `lookupFailed called: ${roster.lookupFailed.called}`);
  check("a failed season lookup surfaces a cancellation toast",
    /cancel/i.test(roster.lookupFailed.toastHtml),
    `lookupFailed toastHtml: ${roster.lookupFailed.toastHtml}`);

  // The recruitment loop. Priority here is the LOOP, not the wording: copy
  // can be re-read by a human at any time, whereas a regression in
  // "added -> reload -> in the app" is invisible and strands every new
  // player on a screen telling them to wait.
  const noLeague = await runNoLeagueScenario({ html, scripts, mode });
  check("a registered player in no league gets the no-league screen, not the app",
    /not in a league yet/i.test(noLeague.before.html),
    `before.html: ${noLeague.before.html.slice(0, 300)}`);
  check("the no-league screen hides the nav tabs entirely",
    noLeague.before.tabsDisplay === "none",
    `before.tabsDisplay: "${noLeague.before.tabsDisplay}"`);
  check("the no-league screen offers a Check again control that reloads",
    /location\.reload/.test(noLeague.before.checkAgainHtml),
    `checkAgainHtml: ${noLeague.before.checkAgainHtml}`);
  // The claim the old copy got wrong. Asserted as absence of the false
  // promise, so restoring it fails rather than silently shipping again.
  check("the no-league screen does NOT claim no further action is needed",
    !/don't need to do anything else/i.test(noLeague.before.html),
    `before.html: ${noLeague.before.html.slice(0, 300)}`);
  // THE LOOP: after an admin adds them, a reload lands them in the app.
  check("after being added, a reload leaves the no-league screen behind",
    !/not in a league yet/i.test(noLeague.after.html),
    `after.html: ${noLeague.after.html.slice(0, 300)}`);
  check("after being added, a reload shows the nav tabs",
    noLeague.after.tabsDisplay === "flex",
    `after.tabsDisplay: "${noLeague.after.tabsDisplay}"`);

  // Stage S — community links on the no-league screen (onboarding Batch 1).
  const links = await runNoLeagueLinksScenario({ html, scripts, mode });
  check("no-league screen renders both community links for a league that has them",
    links.withLinks.blockPresent
      && links.withLinks.anchors.length === 2
      && links.withLinks.anchors.some(a => a.href === "https://example.invalid/fb-group" && /Facebook/.test(a.text))
      && links.withLinks.anchors.some(a => a.href === "https://example.invalid/discord-invite" && /Discord/.test(a.text)),
    `anchors: ${JSON.stringify(links.withLinks.anchors)}`);
  check("every community link opens in a new tab with noopener noreferrer",
    links.withLinks.anchors.every(a => a.target === "_blank" && /noopener/.test(a.rel || "") && /noreferrer/.test(a.rel || "")),
    `anchors: ${JSON.stringify(links.withLinks.anchors)}`);
  check("a league with no links contributes no row to the community block",
    /Ambassadors/.test(links.withLinks.blockText) && !/Linkless League/.test(links.withLinks.blockText),
    `blockText: ${JSON.stringify(links.withLinks.blockText)}`);
  check("with no links anywhere, the community block is absent entirely (empty-set case)",
    !links.noLinks.blockPresent && !/Find the community/.test(links.noLinks.html) && /not in a league yet/i.test(links.noLinks.html),
    `html: ${links.noLinks.html.slice(0, 300)}`);
  check("a javascript: URL in leagues.config never becomes an href; an upper-case HTTPS one does",
    links.badScheme.anchors.length === 1
      && links.badScheme.anchors[0].href === "HTTPS://example.invalid/upper-ok"
      && !/javascript:/.test(links.badScheme.html),
    `anchors: ${JSON.stringify(links.badScheme.anchors)}`);

  // The save split's whole reason for existing: neither save may revert the
  // other's fields. Asserted on the actual admin_update_config payloads, not
  // on rendered values — a reverted field looks identical on screen until the
  // next reload, which is why this was invisible.
  // The no-league poll: the transition must happen in ONE window, with no
  // reload. Driven by visibilitychange rather than the 15s timer, because
  // foregrounding is both the real-world case and the deterministic one.
  const poll = await runNoLeaguePollScenario({ html, scripts, mode });
  check("the no-league screen says it checks automatically, not that it won't update",
    /updates itself/.test(poll.before.status) && !/won't update on its own/.test(poll.before.html),
    `status: ${JSON.stringify(poll.before.status)}`);
  check("foregrounding while still not in a league does NOT transition",
    /not in a league yet/i.test(poll.stillWaiting.html),
    `html: ${poll.stillWaiting.html.slice(0, 200)}`);
  // Proves it actually asks rather than booting on any visibility event.
  check("foregrounding polls my_leagues",
    poll.stillWaiting.myLeaguesCalls >= 2,
    `my_leagues calls: ${poll.stillWaiting.myLeaguesCalls}`);
  check("once added, foregrounding transitions into the app with no reload",
    !/not in a league yet/i.test(poll.afterAdd.html) && poll.afterAdd.tabsDisplay === "flex",
    `afterAdd: ${poll.afterAdd.html.slice(0, 200)} tabs: ${poll.afterAdd.tabsDisplay}`);

  // Timer-driven properties the visibilitychange scenario cannot reach.
  const pollT = await runNoLeaguePollTimersScenario({ html, scripts, mode });
  // "The poll stops" means the INTERVAL is cleared — a transition only proves
  // boot() ran. A surviving interval would keep firing against a replaced DOM.
  check("a successful poll clears the interval, not just transitions",
    pollT.onSuccess.cleared === true && pollT.onSuccess.tabsDisplay === "flex"
      && !/not in a league yet/i.test(pollT.onSuccess.html),
    `onSuccess: ${JSON.stringify({ cleared: pollT.onSuccess.cleared, tabs: pollT.onSuccess.tabsDisplay })}`);
  check("the attempt cap stops polling and says so",
    /Stopped checking/i.test(pollT.cap.status) && pollT.cap.cleared === true,
    `cap: ${JSON.stringify({ status: pollT.cap.status, cleared: pollT.cap.cleared })}`);
  // Cap assertion is deliberately not encoding NO_LEAGUE_MAX_POLLS: 200 ticks
  // must produce far fewer calls, whatever the constant is.
  check("the attempt cap actually bounds the requests",
    pollT.cap.myLeaguesCalls > 0 && pollT.cap.myLeaguesCalls < 400,
    `my_leagues calls over 400 ticks: ${pollT.cap.myLeaguesCalls}`);
  check("Check again still works after the cap stops automatic polling",
    /location\.reload/.test(pollT.cap.buttonHtml),
    `buttonHtml: ${pollT.cap.buttonHtml}`);
  // The abandoned-overnight case: a backgrounded tab must not hit the server.
  check("a hidden tab makes no my_leagues request at all",
    pollT.hidden.callsAdded === 0,
    `callsAdded: ${pollT.hidden.callsAdded}`);

  // toggleFormat's orphan confirm — the control behind the 2026-08-14
  // incident, and the last destructive admin action to gain a dialog.
  const fmt = await runFormatToggleScenario({ html, scripts, mode });
  check("a format toggle that orphans slots warns, naming the bracket",
    /Casual/.test(fmt.cancelled.confirm),
    `confirm: ${JSON.stringify(fmt.cancelled.confirm)}`);
  check("the format warning names the slots that disappear, not just a count",
    /Set 2 Closer/.test(fmt.cancelled.confirm) && /Encore/.test(fmt.cancelled.confirm)
      && /Flat pick 2/.test(fmt.cancelled.confirm),
    `confirm: ${JSON.stringify(fmt.cancelled.confirm)}`);
  // Official loses the same keys but holds no picks for this show, so the
  // n > 0 guard must keep it out of the dialog entirely.
  check("the format warning excludes a bracket with no picks for that show",
    !/Official/.test(fmt.cancelled.confirm),
    `confirm: ${JSON.stringify(fmt.cancelled.confirm)}`);
  check("cancelling the format warning makes NO admin_set_show_format call",
    fmt.cancelled.wrote === false,
    `wrote: ${fmt.cancelled.wrote}`);
  check("accepting the format warning proceeds to admin_set_show_format",
    fmt.accepted.wrote === true,
    `wrote: ${fmt.accepted.wrote}`);
  // Harmless branch: one_set -> standard loses nothing (oneset keys are a
  // subset of standard's), so no dialog even though Casual holds picks.
  // This is what pins the orphan set to the DIFFERENCE rather than to every
  // current key — a mutation returning all keys passes every other check here.
  check("a format toggle that orphans nothing shows no dialog and still writes",
    fmt.harmless.confirmCount === 0 && fmt.harmless.wrote === true,
    `harmless: ${JSON.stringify(fmt.harmless)}`);
  // Ranked brackets are format-independent — counting them would be false.
  check("a ranked bracket is excluded, so a toggle with nothing else at risk shows no dialog",
    fmt.rankedExcluded.confirmCount === 0 && fmt.rankedExcluded.wrote === true,
    `rankedExcluded: ${JSON.stringify(fmt.rankedExcluded)}`);
  check("a failed pick-count lookup blocks the format toggle with no confirm",
    fmt.lookupFailed.confirmCount === 0,
    `confirmCount: ${fmt.lookupFailed.confirmCount}`);
  check("a failed pick-count lookup makes NO admin_set_show_format call",
    fmt.lookupFailed.wrote === false,
    `wrote: ${fmt.lookupFailed.wrote}`);
  check("a failed pick-count lookup surfaces a toast",
    /format unchanged|Couldn't check/i.test(fmt.lookupFailed.toastHtml),
    `toastHtml: ${fmt.lookupFailed.toastHtml}`);

  const unaff = await runUnaffiliatedScenario({ html, scripts, mode });
  check("the unaffiliated panel lists the registered non-member",
    /Wanderer/.test(unaff.listed.html),
    `listed: ${unaff.listed.html.slice(0, 300)}`);
  // The predicate check: p2 (EggHead) is a league member, so listing them
  // would mean the frontend is using admin_find_players' "not in THIS league"
  // rule instead of "in NO league" — the two diverge at two leagues.
  check("the unaffiliated panel excludes players who are already in a league",
    !/EggHead/.test(unaff.listed.html) && !/Wooklord/.test(unaff.listed.html),
    `listed: ${unaff.listed.html.slice(0, 300)}`);
  check("the unaffiliated panel states the count",
    /not in any league \(1\)/.test(unaff.listed.html),
    `listed: ${unaff.listed.html.slice(0, 300)}`);
  // The on-screen mitigation for two admins working the same list.
  check("the unaffiliated panel warns they may not have asked to join this league",
    /may not have asked to join/.test(unaff.listed.html) && /only if they/.test(unaff.listed.html),
    `listed: ${unaff.listed.html.slice(0, 400)}`);
  check("adding from the unaffiliated panel re-fetches, dropping the row without a reload",
    !/Wanderer/.test(unaff.afterAdd.html),
    `afterAdd: ${unaff.afterAdd.html.slice(0, 300)}`);

  const split = await runSaveSplitScenario({ html, scripts, mode });
  check("Master switch save writes its own two fields",
    split.masterWrote.voting_override === "locked" && split.masterWrote.perfect === 9,
    `masterWrote: ${JSON.stringify(split.masterWrote)}`);
  check("a later rules save does NOT revert voting override or the perfect bonus",
    split.rulesPreserved.voting_override === "locked" && split.rulesPreserved.perfect === 9,
    `rulesPreserved: ${JSON.stringify(split.rulesPreserved)}`);
  check("the rules save still writes its own fields",
    typeof split.rulesWrote.flat_picks === "number",
    `rulesWrote: ${JSON.stringify(split.rulesWrote)}`);
  check("a later Master switch save does NOT revert rules fields",
    split.masterPreserved.flat_picks === split.rulesWrote.flat_picks,
    `masterPreserved: ${JSON.stringify(split.masterPreserved)} vs rulesWrote: ${JSON.stringify(split.rulesWrote)}`);

  const forcedPin = await runForcedPinChangeScenario({ html, scripts, mode });
  check("must_change_pin:true renders the forced interstitial, not the normal tabs",
    /Set a new PIN/.test(forcedPin.interstitialHtml) && forcedPin.tabsDisplay !== "flex",
    `interstitialHtml present: ${/Set a new PIN/.test(forcedPin.interstitialHtml)} tabsDisplay: "${forcedPin.tabsDisplay}"`);
  check("submitting a matching new PIN clears must_change_pin in the stored session",
    forcedPin.storedSession && forcedPin.storedSession.must_change_pin === false && forcedPin.storedSession.pin === "4321",
    `storedSession: ${JSON.stringify(forcedPin.storedSession)}`);

  // Zero-overlay league — see runNoOverlayScenario's header for what this
  // pins and what it cannot (the scorer). The fixture's two shows are
  // today's and five days ago; neither has a league_shows row here.
  const noOv = await runNoOverlayScenario({ html, scripts, mode });
  check("zero-overlay: shows are still LISTED (they come from the global shows table)",
    noOv.list.rowCount > 0 && noOv.list.venues.includes("The Barn"),
    `rows: ${noOv.list.rowCount}, venues: ${JSON.stringify(noOv.list.venues)}`);
  check("zero-overlay: every listed show's pill reads 'no cutoff'",
    noOv.list.pills.length > 0 && noOv.list.pills.every(p => p === "no cutoff"),
    `pills: ${JSON.stringify(noOv.list.pills)}`);
  check("zero-overlay: every show button says 'Score', none says 'Pick'",
    noOv.list.buttonLabels.length > 0 && noOv.list.buttonLabels.every(b => b === "Score"),
    `buttons: ${JSON.stringify(noOv.list.buttonLabels)}`);
  check("zero-overlay: opening a show renders the detail view, not a pick sheet",
    noOv.detail.sheetInputCount === 0 && /no cutoff/.test(noOv.detail.html) && /← shows/.test(noOv.detail.html),
    `sheet inputs: ${noOv.detail.sheetInputCount}, html: ${noOv.detail.html.slice(0, 300)}`);
  check("zero-overlay: submit_picks (fake mirroring the real RPC) rejects a show with no overlay row",
    noOv.submitErrorNoRow === "This show is not on this league's schedule",
    `error: ${noOv.submitErrorNoRow}`);
  check("zero-overlay positive control: the identical submit succeeds once the row exists",
    noOv.submitWithRow && noOv.submitWithRow.ok === true && noOv.submitWithRow.saved === 1,
    `submitWithRow: ${JSON.stringify(noOv.submitWithRow)}`);

  // ================================================================
  // 2026-10-25 batch — docs/decisions/standings-ux.md (1–4) and
  // admin-panel.md → "Who's Picked".
  // ================================================================
  const css = readFileSync(join(root, "styles.css"), "utf8");

  // (3) own-row outline — both ways, off the DOM
  const meLog = byLabel(log, "standings-me");
  check("own standings row carries .me exactly once, on the session player, and on no other row (checked both ways)",
    meLog && meLog.me.length === 1 && meLog.me[0] === "Wooklord" && meLog.others.length > 0 && !meLog.others.includes("Wooklord"),
    `me: ${JSON.stringify(meLog?.me)} others: ${JSON.stringify(meLog?.others)}`);
  check("own-row rule is an inset box-shadow outline in --yolk on the cells, and the hardcoded fill is gone",
    /\.lb tr\.me td\{box-shadow:inset[^}]*var\(--yolk\)/.test(css) && !/\.lb tr\.me td\{background/.test(css) && !/rgba\(255,197,61,\.07\)/.test(css.replace(/\/\*[\s\S]*?\*\//g, "")),
    "styles.css .lb tr.me td rule");

  // (4) name overflow — the rule exists, and the markup carries it
  check("name cells get the ellipsis rule and the table-width trick (stylesheet, checked statically — the suite is blind to CSS)",
    /\.nm\{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap\}/.test(css) && /\.lb td\.pname\{width:100%;max-width:0\}/.test(css),
    "styles.css .nm / .lb td.pname rules");
  const longName = await runLongNameScenario({ html, scripts, mode });
  check("a 27-character nickname renders in full, with the full name in title, in the standings table, the podium, Who's Picked and Members",
    longName.cellText === longName.LONG && longName.podText === longName.LONG
      && longName.rosterText === longName.LONG && longName.memberText === longName.LONG,
    `cell: ${longName.cellText} pod: ${longName.podText} roster: ${longName.rosterText} member: ${longName.memberText}`);

  // (1) Settings links
  check("Settings inside the admin tab renders no community block when the league has no links (empty-set case)",
    byLabel(log, "settings-links")?.present === false,
    `settings-links present: ${byLabel(log, "settings-links")?.present}`);
  const sl = await runSettingsLinksScenario({ html, scripts, mode });
  for (const [who, r] of Object.entries(sl)){
    check(`Settings (${who}) shows the current league's two links beneath the league selector, from state.leagues, with no leagues table read`,
      r.present && r.slotAfterSelector && r.leagueReads === 0 && r.anchors.length === 2
        && r.anchors.some(a => a.href === "https://example.invalid/fb-group" && /Facebook/.test(a.text))
        && r.anchors.some(a => a.href === "https://example.invalid/discord-invite" && /Discord/.test(a.text))
        && r.anchors.every(a => a.target === "_blank" && /noopener/.test(a.rel || "") && /noreferrer/.test(a.rel || ""))
        && /Ambassadors/.test(r.blockText),
      `present: ${r.present} slotAfterSelector: ${r.slotAfterSelector} leagueReads: ${r.leagueReads} anchors: ${JSON.stringify(r.anchors)}`);
  }

  // (5) tie groups on the standings board (standings-ux.md item 5); the
  // 3a facts — no chip, no setBoardView, leftover key inert — ride along.
  const tb = await runStandingsTiebreakScenario({ html, scripts, mode });
  const c = tb.collapsed;
  check("resolved tie, collapsed by default: both rows carry tg (first/last) under one key, ONE tag 'Tie for 1st decided: Fewest Zeros' (amendment C wording) with '+' (aria-expanded=false) wired to toggleTieGroup, the sub-row present but hidden, NO lines in any name cell; the Tiebreakers footer is Title Case; no chip, no setBoardView",
    c.tgRows.length === 2 && c.tgRows[0].first && !c.tgRows[0].last && c.tgRows[1].last && !c.tgRows[1].first && c.tgRows.every(r => r.key === "5-1")
      && c.tags.length === 1 && c.tags[0].text === "Tie for 1st decided: Fewest Zeros" && c.tags[0].plus === "+" && c.tags[0].expanded === "false"
      && /^Tiebreakers1st: Fewest Zeros$/.test(c.footer)
      && c.tags[0].onclick === "toggleTieGroup('5-1')" && c.tags[0].none === null
      && c.subs.length === 1 && c.subs[0].hidden === true && c.nameCellDivs === 0 && c.names.length === 2
      && !c.chipPresent && c.setterOnWindow === "undefined" && c.toggleOnWindow === "function",
    `collapsed: ${JSON.stringify(c)}`);
  const J = v => JSON.stringify(v);
  const esub = tb.expanded.subs[0];
  check("expand: sub-row visible, glyph '−', aria-expanded true; the grid has ONE header column 'Fewest Zeros' (deciding tint + decided mark) and one row per member — '1 Wooklord 0' then '2 EggHead 1' with titles — every deciding-column cell tinted, no stray cells, no refetch; collapse hides it and restores '+'",
    esub?.hidden === false && tb.expanded.tags[0]?.plus === "−" && tb.expanded.tags[0]?.expanded === "true"
      && J(esub?.headers) === J([{ layer: "fewest_zeros", label: "Fewest Zeros", deciding: true, decidedMark: true }])
      && /repeat\(1,/.test(esub?.cols ?? "") && esub?.stray === 0
      && J(esub?.rows.map(r => [r.rank, r.name, r.title, r.vals.map(v => `${v.layer}=${v.value}:${v.deciding}`)]))
         === J([["1", "Wooklord", "Wooklord", ["fewest_zeros=0:true"]], ["2", "EggHead", "EggHead", ["fewest_zeros=1:true"]]])
      && tb.expanded.rpcCount === c.rpcCount
      && tb.collapsedAgain.subs[0]?.hidden === true && tb.collapsedAgain.tags[0]?.plus === "+" && tb.collapsedAgain.tags[0]?.expanded === "false",
    `expanded: ${J(tb.expanded.subs)} tags: ${J(tb.expanded.tags)} rpc: ${c.rpcCount}/${tb.expanded.rpcCount} again: ${J(tb.collapsedAgain.tags)}`);
  check("expand state is in memory only: a re-render redraws the open group OPEN, and localStorage gains no key",
    tb.afterRerender.subs[0]?.hidden === false && tb.afterRerender.tags[0]?.plus === "−" && tb.afterRerender.tags[0]?.expanded === "true"
      && JSON.stringify(tb.afterRerender.storageKeys) === JSON.stringify(c.storageKeys),
    `after: ${JSON.stringify(tb.afterRerender.subs)} keys before/after: ${JSON.stringify(c.storageKeys)} / ${JSON.stringify(tb.afterRerender.storageKeys)}`);
  const ssub = tb.shared.subs[0];
  check("shared tie (most_wins 1–1): 'Tie for 1st · shared', both rows rank 1, '+' present; the grid lists Most Laurels with equal values, equal ranks down the rank column, and NO deciding tint or mark anywhere",
    tb.shared.tags.length === 1 && tb.shared.tags[0].text === "Tie for 1st · shared" && tb.shared.tags[0].plus === "+"
      && tb.shared.tgRows.length === 2 && tb.shared.tgRows.every(r => r.rank === "1")
      && tb.shared.subs.length === 1 && J(ssub?.headers) === J([{ layer: "most_wins", label: "Most Laurels", deciding: false, decidedMark: false }])
      && J(ssub?.rows.map(r => [r.rank, r.name, r.vals.map(v => v.value)])) === J([["1", "EggHead", ["1"]], ["1", "Wooklord", ["1"]]])
      && ssub?.stray === 0 && ssub?.rows.every(r => r.vals.every(v => v.deciding === false)),
    `shared: ${J(tb.shared.tags)} rows: ${J(tb.shared.tgRows)} subs: ${J(tb.shared.subs)}`);
  check("no tie: two plain rows, no tg class, no tag, no '+', no sub-row (groupTies' empty-set case on the board)",
    tb.none.names.length === 2 && tb.none.tgRows.length === 0 && tb.none.tags.length === 0 && tb.none.subs.length === 0,
    `none: rows ${JSON.stringify(tb.none.tgRows)} tags ${JSON.stringify(tb.none.tags)}`);
  check("own row inside a group keeps .me, and only the viewer's row has it; the tag row and sub-row carry neither .me nor .tg",
    c.tgRows.find(r => r.name === "Wooklord")?.me === true && c.tgRows.find(r => r.name === "EggHead")?.me === false
      && JSON.stringify(c.meRows) === JSON.stringify(["Wooklord"]) && c.tags[0].me === false && c.tags[0].tg === false && c.subs[0].tg === false,
    `rows: ${JSON.stringify(c.tgRows)} meRows: ${JSON.stringify(c.meRows)} tag: ${JSON.stringify(c.tags[0])}`);
  check("bracket/outline coexistence, checked statically: the bracket is a border-left in --mint on tr.tg td:first-child, .me's inset box-shadow on td:first-child is intact, and no rule puts a box-shadow on tr.tg",
    /\.lb tr\.tg td:first-child\{border-left:3px solid var\(--mint\)\}/.test(css)
      && /\.lb tr\.me td:first-child\{box-shadow:inset 2px 0 0 var\(--yolk\)/.test(css)
      && !/tr\.tg[^-\w][^{]*\{[^}]*box-shadow/.test(css),
    "styles.css: .lb tr.tg td:first-child / .lb tr.me td:first-child rules");
  // The cell-tint amendment's recorded example, all four facts: (1) High
  // Score cells tinted for all three, (2) Fewest Zeros tinted for the
  // pair only, (3) the first player's Fewest Zeros cell PLAIN, (4) Most
  // Wins (1–1) plain — and, per amendment A + its addendum, the tag names
  // BOTH layers that worked; the "decided" mark sits on both headers
  // (this column did work) while the TINT sits on High Score only (where
  // the group first broke); Most Laurels (split nobody) gets neither.
  // Footer Title Case (amendment B); "laurels" per its addendum.
  const tsub = tb.three.subs[0];
  check("three-way, three-layer stack: ONE tag 'Tie for 1st decided: High Score & Fewest Zeros' (amendment C wording); High Score header tinted AND marked, Fewest Zeros header marked but NOT tinted, Most Laurels neither; cells — High Score tinted for all three, Fewest Zeros tinted for the pair only, the split-off player's Fewest Zeros cell plain, Most Laurels plain; ranks 1/2/3; footer '1st: High Score · 2nd: Fewest Zeros · 3rd: Most Laurels'",
    tb.three.tags.length === 1 && tb.three.tags[0].text === "Tie for 1st decided: High Score & Fewest Zeros" && tb.three.tgRows.length === 3
      && J(tb.three.tgRows.map(r => r.rank)) === J(["1", "2", "3"])
      && /^Tiebreakers1st: High Score · 2nd: Fewest Zeros · 3rd: Most Laurels$/.test(tb.three.footer)
      && J(tsub?.headers) === J([{ layer: "highest_single_show", label: "High Score", deciding: true, decidedMark: true },
                                 { layer: "fewest_zeros", label: "Fewest Zeros", deciding: false, decidedMark: true },
                                 { layer: "most_wins", label: "Most Laurels", deciding: false, decidedMark: false }])
      && /repeat\(3,/.test(tsub?.cols ?? "") && tsub?.stray === 0
      && J(tsub?.rows.map(r => [r.rank, r.name, r.vals.map(v => `${v.value}:${v.deciding}`)]))
         === J([["1", "Wooklord", ["6:true", "2:false", "1:false"]], ["2", "GlobalAdmin", ["3:true", "0:true", "1:false"]], ["3", "EggHead", ["3:true", "1:true", "1:false"]]]),
    `three: ${J(tb.three.tags)} rows ${J(tb.three.tgRows)} subs ${J(tb.three.subs)}`);
  check("admin Season tiebreakers (Official, league admin): the help prose says 'Most laurels — per-show ties still share the crown', matching the select's own 'Most laurels' option, and no 'wins' wording remains in it (laurels addendum follow-up)",
    tb.adminTiebreak.present
      && tb.adminTiebreak.help.includes("Most laurels — per-show ties still share the crown.")
      && !/\bwins?\b/i.test(tb.adminTiebreak.help)
      && tb.adminTiebreak.options.includes("Most laurels") && !tb.adminTiebreak.options.some(o => /\bwins?\b/i.test(o)),
    `admin tiebreakers: ${J(tb.adminTiebreak)}`);
  check("all-zero board (fresh season): no groups, no tags, no sub-rows — the hasAnyScore gate — while the placeholder podium renders (empty-set case)",
    tb.zero.names.length === 2 && tb.zero.tgRows.length === 0 && tb.zero.tags.length === 0 && tb.zero.subs.length === 0 && tb.zero.placeholderPodium,
    `zero: rows ${JSON.stringify(tb.zero.tgRows)} tags ${JSON.stringify(tb.zero.tags)} placeholder: ${tb.zero.placeholderPodium}`);
  check("empty stack (Casual, All time): 'Tie for 1st · shared' with muted 'no tiebreakers set' in the expander's place, no '+', no sub-row",
    tb.casual.tags.length === 1 && tb.casual.tags[0].text === "Tie for 1st · shared" && tb.casual.tags[0].plus === null
      && tb.casual.tags[0].none === "no tiebreakers set" && tb.casual.subs.length === 0 && tb.casual.tgRows.length === 2,
    `casual: ${JSON.stringify(tb.casual.tags)} subs ${tb.casual.subs.length} rows ${tb.casual.tgRows.length}`);
  check("a leftover ft_board_view=compact key from 1a74cee changes nothing: the group still renders, no chip",
    tb.leftoverKey.tags.length === 1 && tb.leftoverKey.tgRows.length === 2 && !tb.leftoverKey.chipPresent,
    `leftover: tags ${tb.leftoverKey.tags.length} rows ${tb.leftoverKey.tgRows.length} chip ${tb.leftoverKey.chipPresent}`);

  // (6) Stats panel (standings-ux.md item 6). Column indexes: headers
  // 0 Player, 1 Shows, 2 Avg, 3 High, 4 0s, 5 wins (laurel, no text);
  // cells 0 Shows, 1 Avg, 2 High, 3 0s, 4 wins.
  const st = await runStatsScenario({ html, scripts, mode });
  const names = r => r.rows.map(x => x.name);
  const activeHeaders = r => r.headers.map((h, i) => h.active ? i : -1).filter(i => i >= 0);
  const arrowHeaders = r => r.headers.map((h, i) => h.arrow ? i : -1).filter(i => i >= 0);
  const activeCells = r => [...new Set(r.rows.flatMap(x => x.cells.map((c, i) => c.active ? i : -1).filter(i => i >= 0)))];
  check("Stats: heading reads 'Stats · Live Season'; headers are Player, Shows, Avg, High, 0s, laurel; ALL six are sortable (Player alphabetically); the legend says 'laurels = shows won'; setStatsSort is on window",
    st.dflt.heading === "Stats · Live Season" && st.dflt.setterOnWindow === "function"
      && J(st.dflt.headers.map(h => h.text)) === J(["Player", "Shows", "Avg", "High", "0s", ""])
      && J(st.dflt.headers.map(h => h.sortable)) === J([true, true, true, true, true, true])
      && st.dflt.headers[0].onclick === "setStatsSort('player')" && st.dflt.headers[4].onclick === "setStatsSort('zeros')"
      && /laurels = shows won/.test(st.dflt.legend) && !/wreath/.test(st.dflt.legend),
    `headers: ${J(st.dflt.headers)} heading: ${st.dflt.heading} legend: ${st.dflt.legend}`);
  check("Stats default: today's order (Avg best-first) — Wooklord 7.0, EggHead 3.0, GlobalAdmin 2.3 — Avg header active with ▼ and aria-sort=descending, every other header aria-sort=none and arrow-less, bold cells in the Avg column only, nothing written to localStorage before a tap, own row carries .me",
    J(names(st.dflt)) === J(["Wooklord", "EggHead", "GlobalAdmin"])
      && J(st.dflt.rows.map(x => x.cells.map(c => c.v))) === J([["1", "7.0", "7", "2", "1"], ["2", "3.0", "3", "1", "1"], ["3", "2.3", "4", "0", "1"]])
      && J(activeHeaders(st.dflt)) === J([2]) && J(arrowHeaders(st.dflt)) === J([2]) && st.dflt.headers[2].arrow === "▼" && st.dflt.headers[2].ariaSort === "descending"
      && st.dflt.headers.filter((h, i) => i !== 2 && h.sortable).every(h => h.ariaSort === "none")
      && J(activeCells(st.dflt)) === J([1]) && st.dflt.stored === null
      && st.dflt.rows.find(x => x.name === "Wooklord")?.me === true && st.dflt.rows.filter(x => x.me).length === 1,
    `rows: ${J(st.dflt.rows)} headers: ${J(st.dflt.headers)} stored: ${st.dflt.stored}`);
  check("Stats: tapping 0s sorts ASCENDING (GlobalAdmin 0, EggHead 1, Wooklord 2) with ▲ and aria-sort=ascending on the 0s header only, bold cells in the 0s column only, ft_stats_sort=zeros:asc written, and NO refetch (rpc count unchanged)",
    J(names(st.zerosAsc)) === J(["GlobalAdmin", "EggHead", "Wooklord"])
      && J(activeHeaders(st.zerosAsc)) === J([4]) && J(arrowHeaders(st.zerosAsc)) === J([4]) && st.zerosAsc.headers[4].arrow === "▲" && st.zerosAsc.headers[4].ariaSort === "ascending"
      && J(activeCells(st.zerosAsc)) === J([3]) && st.zerosAsc.stored === "zeros:asc" && st.zerosAsc.rpcCount === st.dflt.rpcCount,
    `rows: ${J(names(st.zerosAsc))} headers: ${J(st.zerosAsc.headers)} stored: ${st.zerosAsc.stored} rpc ${st.dflt.rpcCount}/${st.zerosAsc.rpcCount}`);
  check("Stats: a second tap on 0s flips to descending (Wooklord, EggHead, GlobalAdmin) with ▼ and zeros:desc stored",
    J(names(st.zerosDesc)) === J(["Wooklord", "EggHead", "GlobalAdmin"]) && st.zerosDesc.headers[4].arrow === "▼"
      && st.zerosDesc.headers[4].ariaSort === "descending" && st.zerosDesc.stored === "zeros:desc",
    `rows: ${J(names(st.zerosDesc))} stored: ${st.zerosDesc.stored}`);
  check("Stats: a stored wins:desc is honoured on a fresh boot — wins header active, and the three-way tie at 1 win falls to name A–Z (EggHead, GlobalAdmin, Wooklord) although the panel received them as GlobalAdmin, Wooklord, EggHead",
    J(activeHeaders(st.presetWins)) === J([5]) && st.presetWins.headers[5].ariaSort === "descending"
      && J(names(st.presetWins)) === J(["EggHead", "GlobalAdmin", "Wooklord"]) && J(activeCells(st.presetWins)) === J([4]),
    `rows: ${J(names(st.presetWins))} headers: ${J(st.presetWins.headers)}`);
  check("Stats: a bogus stored value falls back to the default (Avg active) and is left untouched until a tap",
    J(activeHeaders(st.presetBogus)) === J([2]) && J(names(st.presetBogus)) === J(["Wooklord", "EggHead", "GlobalAdmin"]) && st.presetBogus.stored === "bogus",
    `headers: ${J(st.presetBogus.headers)} stored: ${st.presetBogus.stored}`);
  check("Stats leaders (season view): FIVE stacked rows in order — Best avg Wooklord 7.0, High score Wooklord 7, Most laurels EggHead, GlobalAdmin, Wooklord (three-way tie, every name, name order, no '+') 1, Most shows GlobalAdmin 3, Fewest zeros GlobalAdmin 0 — and no row carries a '+N'",
    J(st.dflt.leaders.map(l => [l.key, l.label, l.names, l.more, l.value])) === J([
      ["avg", "Best avg", ["Wooklord"], null, "7.0"], ["high", "High score", ["Wooklord"], null, "7"],
      ["wins", "Most laurels", ["EggHead", "GlobalAdmin", "Wooklord"], null, "1"],
      ["shows", "Most shows", ["GlobalAdmin"], null, "3"], ["zeros", "Fewest zeros", ["GlobalAdmin"], null, "0"]])
      && st.dflt.leaders.every(l => l.plus === false),
    `leaders: ${J(st.dflt.leaders)}`);
  check("Stats leaders two-way ties: Best avg lists EggHead, Wooklord (both, name order, no '+') at 3.0 and Most laurels lists the same pair at 2; High score, Most shows and Fewest zeros are GlobalAdmin alone",
    J(st.twoWay.leaders.map(l => [l.key, l.names, l.more, l.value])) === J([
      ["avg", ["EggHead", "Wooklord"], null, "3.0"], ["high", ["GlobalAdmin"], null, "4"],
      ["wins", ["EggHead", "Wooklord"], null, "2"], ["shows", ["GlobalAdmin"], null, "3"], ["zeros", ["GlobalAdmin"], null, "0"]])
      && st.twoWay.leaders.every(l => l.plus === false),
    `twoWay: ${J(st.twoWay.leaders)}`);
  check("Stats leaders six-way tie (the cap): every row lists the first FIVE names in name order (EggHead, GlobalAdmin, Marigold, Quartz, Tumbleweed) then muted 'and 1 more', five rows",
    st.sixWay.leaders.length === 5
      && st.sixWay.leaders.every(l => J(l.names) === J(["EggHead", "GlobalAdmin", "Marigold", "Quartz", "Tumbleweed"]) && l.more === "and 1 more" && l.plus === false),
    `sixWay: ${J(st.sixWay.leaders)}`);
  check("Stats Player sort: first tap A–Z (EggHead, GlobalAdmin, Wooklord) with ▲ and aria-sort=ascending on the Player header only, name cells active, player:asc stored; second tap Z–A with ▼ and player:desc",
    J(names(st.playerAsc)) === J(["EggHead", "GlobalAdmin", "Wooklord"]) && J(activeHeaders(st.playerAsc)) === J([0]) && J(arrowHeaders(st.playerAsc)) === J([0])
      && st.playerAsc.headers[0].arrow === "▲" && st.playerAsc.headers[0].ariaSort === "ascending" && st.playerAsc.stored === "player:asc"
      && st.playerAsc.rows.every(r => r.nameActive === true) && J(activeCells(st.playerAsc)) === J([])
      && J(names(st.playerDesc)) === J(["Wooklord", "GlobalAdmin", "EggHead"]) && st.playerDesc.headers[0].arrow === "▼"
      && st.playerDesc.headers[0].ariaSort === "descending" && st.playerDesc.stored === "player:desc",
    `asc: ${J(names(st.playerAsc))} ${J(st.playerAsc.headers[0])} stored ${st.playerAsc.stored}; desc: ${J(names(st.playerDesc))} ${J(st.playerDesc.headers[0])} stored ${st.playerDesc.stored}`);
  check("Stats no-scores board: the empty row renders, no leaders strip, no player rows (empty-set case)",
    st.empty.emptyRow === "Stats appear once shows score." && st.empty.leadersPresent === false && st.empty.rows.length === 0,
    `empty: ${J(st.empty)}`);
  check("Stats on All time (no season): 0s cells read '—', the 0s header is NOT sortable (no onclick, no aria-sort), the Fewest zeros leader is omitted, the legend says season views only; a stored zeros:asc falls back to Avg for the render without being rewritten, and a tap on 0s there is ignored",
    st.allTime.heading === "Stats · All time" && st.allTime.rows.every(x => x.cells[3].v === "—")
      && st.allTime.headers[4].sortable === false && st.allTime.headers[4].onclick === "" && st.allTime.headers[4].ariaSort === null
      && J(st.allTime.leaders.map(l => l.key)) === J(["avg", "high", "wins", "shows"]) && /season views only/.test(st.allTime.legend)
      && J(activeHeaders(st.allTimeZerosPreset)) === J([2]) && st.allTimeZerosPreset.stored === "zeros:asc"
      && J(activeHeaders(st.allTimeZerosTap)) === J([2]) && st.allTimeZerosTap.stored === "zeros:asc" && st.allTimeZerosTap.rpcCount === st.allTimeZerosPreset.rpcCount,
    `allTime: ${J(st.allTime.headers)} leaders ${J(st.allTime.leaders.map(l => l.key))} preset: ${J(activeHeaders(st.allTimeZerosPreset))}/${st.allTimeZerosPreset.stored} tap: ${J(activeHeaders(st.allTimeZerosTap))}/${st.allTimeZerosTap.stored}`);
  check("Stats stylesheet, statically: the arrow lives only in .lb th .arrow with no reserved width, .lb td.active is bold, .leaders is a stacked column and each .leader is a three-column grid — a fixed 5.2rem label track (rem, never em: an em track resolves against the ROW font, which made 7.2em 115px; 5.2rem is the original ~83px, which fits the longest .72rem small-caps label on one line, measured), left-aligned names, a right-aligned value column at least 3ch wide — with 14px column gaps; the strip itself is not a grid",
    /\.lb th \.arrow\{font-size:\.6rem;margin-left:2px;vertical-align:middle\}/.test(css)
      && /\.lb td\.active\{font-weight:700;color:var\(--cream\)\}/.test(css)
      && /\.leaders\{display:flex;flex-direction:column/.test(css)
      && /\.leader\{display:grid;grid-template-columns:5\.2rem minmax\(0,1fr\) minmax\(3ch,max-content\);column-gap:14px/.test(css)
      && /\.leader \.lbl\{font-size:\.72rem;font-variant:small-caps/.test(css)
      && /\.leader b\{[^}]*text-align:right/.test(css)
      && !/\.leaders\{display:grid/.test(css),
    "styles.css: .lb th .arrow / .lb td.active / .leaders / .leader rules");
  // Truncation fix (item 6, same day). The cause was a CLASS COLLISION: the
  // names cell was .who, which also matches the header's global .who rule
  // and its margin-left:auto. So the check pins the class (DOM) as well as
  // the rules (stylesheet): the overflow clip on the names cell, the
  // per-name cap that resolves (max-width:100% on a flex item of a
  // stretched cell, min-width:0 so it can shrink), and the .nm that
  // shrinks inside it. Geometry itself is unmeasurable in jsdom; it was
  // measured in headless Chrome at 320/360/412px (record in the decision).
  check("Stats leaders names cell is .ldr-names on every row, never the header's global .who; every listed name is its own .ldr-name entry; 'and N more' sits inside the LAST entry beside the last name",
    st.sixWay.leaderCells.length === 5 && st.sixWay.leaderCells.every(c => c.cls === "ldr-names" && c.entries === 5 && c.moreInLastEntry === true)
      && st.dflt.leaderCells.every(c => c.cls === "ldr-names" && c.moreInLastEntry === null),
    `sixWay cells: ${J(st.sixWay.leaderCells)} dflt cells: ${J(st.dflt.leaderCells)}`);
  check("Stats leaders stylesheet, statically: the names cell clips (overflow:hidden, min-width:0) and wraps; each entry is capped at the cell (max-width:100%) and may shrink (min-width:0); the .nm inside shrinks; and NO .leader .who rule remains",
    /\.leader \.ldr-names\{display:flex;flex-wrap:wrap;[^}]*min-width:0;overflow:hidden/.test(css)
      && /\.leader \.ldr-names\{[^}]*text-align:left/.test(css)
      && /\.leader \.ldr-name\{display:flex;[^}]*flex:0 1 auto;min-width:0;max-width:100%\}/.test(css)
      && /\.leader \.ldr-name \.nm\{flex:0 1 auto;min-width:0\}/.test(css)
      && /\.leader \.ldr-name small\{flex:0 0 auto;/.test(css)
      && !/\.leader \.who\b/.test(css),
    "styles.css: .leader .ldr-names / .ldr-name / .ldr-name .nm / .ldr-name small rules");

  // Empty ranked ladder (admin-panel.md → "EMPTY RANKED LADDER", LOCKED
  // 2026-10-26). The empty-set case the ranked scenario skipped.
  const el = await runEmptyLadderScenario({ html, scripts, mode });
  for (const [label, f] of [["no ranked key", el.noKey], ["ranked: { ladder: [] }", el.emptyKey]]){
    check(`empty-ladder flip (${label}): onModeChange previews the default ladder and flags it unsaved; saveMasterSwitch makes ONE admin_update_config call whose payload carries mode ranked_choice WITH that ladder, no error, the stored config holds it, the flag clears; opening a show then renders five ranked rows, Lock 'em in, no notice, and a Ladder rule`,
      J(f.previewed) === J([5, 4, 3, 2, 1]) && f.flagShown === true
        && f.payloads.length === 1 && f.payloads[0].mode === "ranked_choice" && J(f.payloads[0].ranked?.ladder) === J([5, 4, 3, 2, 1])
        && f.msErr === "" && f.storedMode === "ranked_choice" && J(f.storedLadder) === J([5, 4, 3, 2, 1]) && f.flagAfterSave === false
        && f.show.rows === 5 && f.show.saveBtn === true && f.show.sheetNotice === null && f.show.ruleTerms.includes("Ladder"),
      `${label}: ${J(f)}`);
  }
  check("empty-ladder notice (the incident state: ranked mode, ladder []): zero rows, NO Lock 'em in, no revert link, the sheet and the Rules card both carry the notice naming the ROLE ('ask your league admin'), no rule terms, and no app-wide class on the paper sheet",
    el.notice.rows === 0 && el.notice.saveBtn === false && el.notice.revert === false
      && /ask your league admin/i.test(el.notice.sheetNotice || "") && /ask your league admin/i.test(el.notice.rulesNotice || "")
      && !/Wooklord|EggHead|GlobalAdmin/.test(el.notice.sheetNotice || "")
      && el.notice.ruleTerms.length === 0 && el.notice.sheetHasAppClass === false,
    `notice: ${J(el.notice)}`);
  check("admin ranked region in the incident state flags the unsaved default ladder above a five-row editor",
    el.adminFlag.present === true && /not saved yet/.test(el.adminFlag.text) && el.adminFlag.editorRows === 5,
    `adminFlag: ${J(el.adminFlag)}`);
  check("the fake admin_update_config mirrors Stage V: ranked mode with an empty ladder throws 'A ranked-choice bracket needs at least one rank'; with a ladder it succeeds",
    el.gateError === "A ranked-choice bracket needs at least one rank" && el.gateOk?.ok === true,
    `gateError: ${el.gateError} gateOk: ${J(el.gateOk)}`);
  check("stylesheet, statically: the sheet notice uses paper tokens only (.sheet .sheetnote on --paper-ink-soft)",
    /\.sheet \.sheetnote\{color:var\(--paper-ink-soft\)/.test(css),
    "styles.css: .sheet .sheetnote rule");

  // (2a/3a) Scores page: View chip, own-entry outline, ellipsis names
  const sv = await runScoresViewScenario({ html, scripts, mode });
  check("Scores page defaults to Compact: chip present, Compact on, two entries, zero pick rows, nothing stored",
    sv.compact.chipPresent && sv.compact.on.length === 1 && sv.compact.on[0] === "Compact"
      && sv.compact.entries === 2 && sv.compact.pickRows === 0 && sv.compact.stored === null,
    `on: ${JSON.stringify(sv.compact.on)} entries: ${sv.compact.entries} pickRows: ${sv.compact.pickRows} stored: ${sv.compact.stored}`);
  check("Detail opens every entry (pick rows present), stores ft_scores_view=detail, and re-renders from the cache without refetching",
    sv.detail.on[0] === "Detail" && sv.detail.pickRows === 2 && sv.detail.stored === "detail" && sv.detail.rpcCalls === sv.compact.rpcCalls,
    `on: ${JSON.stringify(sv.detail.on)} pickRows: ${sv.detail.pickRows} stored: ${sv.detail.stored} rpc before/after: ${sv.compact.rpcCalls}/${sv.detail.rpcCalls}`);
  check("back to Compact removes the pick rows and stores compact; an unknown value is ignored",
    sv.backToCompact.pickRows === 0 && sv.backToCompact.stored === "compact" && sv.afterBogus.stored === "compact" && sv.afterBogus.on[0] === "Compact",
    `pickRows: ${sv.backToCompact.pickRows} stored: ${sv.backToCompact.stored} bogus: ${sv.afterBogus.stored}`);
  check("a stored ft_scores_view=detail is honoured on a fresh boot",
    sv.presetDetail.on[0] === "Detail" && sv.presetDetail.pickRows === 2,
    `on: ${JSON.stringify(sv.presetDetail.on)} pickRows: ${sv.presetDetail.pickRows}`);
  check("exactly one entry carries the own-entry outline, and it follows the viewer (p1 session → Wooklord, p2 session → EggHead), never the other entry",
    sv.compact.mine.length === 1 && sv.compact.mine[0] === "Wooklord" && sv.compact.notMine.length === 1 && sv.compact.notMine[0] === "EggHead"
      && sv.asP2.mine.length === 1 && sv.asP2.mine[0] === "EggHead" && sv.asP2.notMine.length === 1 && sv.asP2.notMine[0] === "Wooklord",
    `p1 mine: ${JSON.stringify(sv.compact.mine)} notMine: ${JSON.stringify(sv.compact.notMine)} p2 mine: ${JSON.stringify(sv.asP2.mine)} notMine: ${JSON.stringify(sv.asP2.notMine)}`);
  check("Scores-page names are .nm cells with a title attribute",
    sv.compact.titled === 2,
    `titled: ${sv.compact.titled}`);
  check("a show with zero score entries still renders the View chip beside the empty-state line (empty-set case)",
    sv.empty.chipPresent && sv.empty.entries === 0 && /No scores yet/.test(sv.empty.html),
    `chip: ${sv.empty.chipPresent} entries: ${sv.empty.entries}`);
  check("own-entry outline rule is an inset box-shadow ring in --yolk on the card (stylesheet, checked statically)",
    /\.panel\.scoreentry\.mine\{box-shadow:inset 0 0 0 2px var\(--yolk\)\}/.test(css),
    "styles.css .panel.scoreentry.mine rule");

  // Who's Picked
  const wp = await runWhosPickedScenario({ html, scripts, mode });
  const rowOf = (r, name) => r.rows.find(x => x.name === name);
  check("Who's Picked opens on Needs picks and lists Partial (2 of 5), the 1-pick Partial, and the no-picks row with its 'Waiting on' pill (class .pill.waiting, not .none), line two still 'no picks yet'",
    wp.show1Needs.on.length === 1 && wp.show1Needs.on[0] === "Needs picks" && wp.show1Needs.rows.length === 3
      && rowOf(wp.show1Needs, "Wooklord")?.status === "partial" && rowOf(wp.show1Needs, "Wooklord")?.pill === "Partial"
      && /\bpartial\b/.test(rowOf(wp.show1Needs, "Wooklord")?.pillClass || "")
      && rowOf(wp.show1Needs, "EggHead")?.status === "partial"
      && rowOf(wp.show1Needs, "GlobalAdmin")?.status === "none" && rowOf(wp.show1Needs, "GlobalAdmin")?.pill === "Waiting on"
      && /\bwaiting\b/.test(rowOf(wp.show1Needs, "GlobalAdmin")?.pillClass || "") && !/\bnone\b/.test(rowOf(wp.show1Needs, "GlobalAdmin")?.pillClass || "")
      && rowOf(wp.show1Needs, "GlobalAdmin")?.l2 === "no picks yet",
    `on: ${JSON.stringify(wp.show1Needs.on)} rows: ${JSON.stringify(wp.show1Needs.rows)}`);
  check("line two keeps the verbatim 'n picks · saved <when>' text, singular for exactly one pick",
    /^2 picks · saved /.test(rowOf(wp.show1Needs, "Wooklord")?.l2 || "") && /^1 pick · saved /.test(rowOf(wp.show1Needs, "EggHead")?.l2 || ""),
    `p1: "${rowOf(wp.show1Needs, "Wooklord")?.l2}" p2: "${rowOf(wp.show1Needs, "EggHead")?.l2}"`);
  check("a Done player (5 of 5) drops off Needs picks and appears under All with the Done pill, summary unchanged",
    !rowOf(wp.show2Needs, "Wooklord") && wp.show2Needs.rows.length === 2
      && rowOf(wp.show2All, "Wooklord")?.status === "done" && rowOf(wp.show2All, "Wooklord")?.pill === "Done"
      && wp.show2All.rows.length === 3 && /^1 of 3 players have picks in/.test(wp.show2All.summary) && wp.show2All.on[0] === "All",
    `needs: ${JSON.stringify(wp.show2Needs.rows)} all: ${JSON.stringify(wp.show2All.rows)} summary: ${wp.show2All.summary}`);
  check("the Show chip is not persisted: a re-render reopens on Needs picks",
    wp.afterRerender.on.length === 1 && wp.afterRerender.on[0] === "Needs picks",
    `on after re-render: ${JSON.stringify(wp.afterRerender.on)}`);
  check("when everyone has picked, Needs picks says so instead of rendering nothing (empty-set case); All still lists them",
    wp.everyoneDone.rows.length === 0 && /Everyone has picks in/.test(wp.everyoneDone.empty)
      && wp.everyoneDoneAll.rows.length === 1 && wp.everyoneDoneAll.empty === "",
    `empty: "${wp.everyoneDone.empty}" rows: ${wp.everyoneDone.rows.length} all: ${wp.everyoneDoneAll.rows.length}`);
  // Refinement 2026-10-26 (admin-panel.md → Who's Picked): names at full
  // color on every row; dim only the status parts. CSS is checked
  // statically (jsdom cannot compute opacity); the DOM facts prove the
  // name sits outside every dimmed element on a row that still has .miss.
  check("Who's Picked: a no-picks row still carries .miss, and its name is neither inside a dimmed element (pill, line two) nor the row's first span (the mark); picked rows carry no .miss",
    rowOf(wp.show1Needs, "GlobalAdmin")?.miss === true && rowOf(wp.show1Needs, "GlobalAdmin")?.nameInDimmed === false
      && rowOf(wp.show1Needs, "GlobalAdmin")?.nameIsFirstSpan === false
      && rowOf(wp.show1Needs, "Wooklord")?.miss === false && rowOf(wp.show2All, "Wooklord")?.miss === false,
    `rows: ${JSON.stringify(wp.show1Needs.rows.map(r => [r.name, r.status, r.miss, r.nameInDimmed, r.nameIsFirstSpan]))}`);
  check("stylesheet, statically: no bare .pickres.miss opacity rule on the row; the row dim survives only as .pickres.miss:not(.roster-row) for the other lists; .roster-row.miss dims EXACTLY its first span and .roster-l2 (the pill is exempt); .roster-row.miss .nm is pinned to opacity:1 at full color; no roster-row rule dims .nm or .pill; .pill.waiting is coral border+text and .pill.none is gone",
    !/\.pickres\.miss\{[^}]*opacity/.test(css)
      && /\.pickres\.miss:not\(\.roster-row\)\{opacity:\.55\}/.test(css)
      && /\.pickres\.roster-row\.miss > span:first-child,\.pickres\.roster-row\.miss \.roster-l2\{opacity:\.55\}/.test(css)
      && /\.pickres\.roster-row\.miss \.nm\{opacity:1;color:var\(--cream\)\}/.test(css)
      && !/roster-row[^{]*\.nm[^{]*\{[^}]*opacity:(0?\.\d+|0)\b/.test(css)
      && !/roster-row[^{]*\.pill[^{]*\{[^}]*opacity:(0?\.\d+|0)\b/.test(css)
      && /\.pill\.waiting\{border-color:var\(--coral\);color:var\(--coral\)\}/.test(css)
      && !/\.pill\.none\{/.test(css),
    "styles.css: .pickres.miss / .pickres.roster-row.miss / .pill.waiting rules");

  // (4) registration cap
  const reg = await runRegisterLengthScenario({ html, scripts, mode });
  check("a 21-character name is rejected on the client with the cap message, no register_player call, no session",
    reg.over.err === "Name must be 20 characters or fewer" && reg.over.registerCalls.length === 0 && reg.over.session === null,
    `err: "${reg.over.err}" calls: ${JSON.stringify(reg.over.registerCalls)} session: ${JSON.stringify(reg.over.session)}`);
  check("a 20-character name is accepted: register_player called once, session stored with that name, no error",
    reg.max.err === "" && reg.max.registerCalls.length === 1 && reg.max.session?.name === "Z".repeat(20),
    `err: "${reg.max.err}" calls: ${JSON.stringify(reg.max.registerCalls)} session: ${JSON.stringify(reg.max.session)}`);
  check("a padded 22-character input is accepted because both sides trim first, and the stored name is the trimmed one",
    reg.padded.err === "" && reg.padded.registerCalls.length === 1 && reg.padded.session?.name === "Z".repeat(20),
    `err: "${reg.padded.err}" session: ${JSON.stringify(reg.padded.session)}`);

  // Show-sync flag notice (docs/show_sync_plan.md, Stage U)
  const sf = await runSyncFlagScenario({ html, scripts, mode });
  check("a show with sync_flag renders exactly one .noticebox.sync-flag, under its own row head, carrying the flag text and a Clear button wired to clearSyncFlag(<id>)",
    sf.flagged.sectionPresent && sf.flagged.rowCount === 2 && sf.flagged.notices.length === 1
      && sf.flagged.notices[0].show === "1" && sf.flagged.notices[0].underRowHead
      && sf.flagged.notices[0].text.includes(sf.flagText) && /^clearSyncFlag\(1,/.test(sf.flagged.notices[0].onclick),
    `flagged: ${JSON.stringify(sf.flagged)}`);
  check("clearSyncFlag is on window and calls admin_clear_sync_flag once with the session's name/PIN and p_show_id",
    sf.handlerOnWindow && sf.rpcCalls.length === 1 && sf.rpcCalls[0].p_show_id === 1
      && sf.rpcCalls[0].p_name === "Wooklord" && sf.rpcCalls[0].p_pin === "1234",
    `onWindow: ${sf.handlerOnWindow} calls: ${JSON.stringify(sf.rpcCalls)}`);
  check("the fake logs the cleared text and nulls the flag, and the re-render drops the notice while keeping both show rows",
    sf.tableFlagAfter === null && sf.clearLog.length === 1 && sf.clearLog[0].note === sf.flagText && sf.clearLog[0].show_id === 1
      && sf.cleared.notices.length === 0 && sf.cleared.rowCount === 2,
    `flagAfter: ${JSON.stringify(sf.tableFlagAfter)} log: ${JSON.stringify(sf.clearLog)} cleared: ${JSON.stringify(sf.cleared)}`);
  check("the default fixture (sync_flag null on every show) renders no notice at all (empty-set case)",
    sf.none.sectionPresent && sf.none.rowCount === 2 && sf.none.notices.length === 0,
    `none: ${JSON.stringify(sf.none)}`);

  // ---------- Onboarding Batch 3 (docs/decisions/onboarding.md, decision 6) ----------
  const ob = await runOnboardingScenario({ html, scripts, mode });
  const OB_C = ob.ids.CASUAL_ID, OB_O = ob.ids.OFFICIAL_ID;
  const HOWTO = [
    "Before each show, pick the songs you think Eggy will play.",
    "Picks partly score in realtime and finalize once the setlist is in.",
    "Standings update after every show.",
    "Change your picks any time until the cutoff.",
    "Scoring details are in The Rules under every pick sheet.",
  ];
  const MENU_B = "Tap ⋮ (top right), then Install and create shortcut (older Chrome: Add to home screen), then Install.";
  const IOS_STEPS = ["Tap Share, then Add to Home Screen.", "If you see Open as Web App, leave it on.", "You'll sign in once more inside the app, so keep your PIN handy."];
  const IN_APP = (app, menu) => `You're in ${app}'s browser, which can't install apps. Tap ${menu} → Open in browser, then install from there.`;
  const FIRST_TOAST = "Picks locked in ✔ Change them any time before cutoff. Scores show up on the show's Scores page after it ends.";
  const DONT = "Don't show again";
  const noHelp = r => !r.section && !r.bar;
  // Desktop renders Settings beside the list, so a dismissal must leave any
  // on-screen switch unchecked; on mobile the switch is simply not there.
  const tipsOff = r => r.tips === null || r.tips.checked === false;
  const nw = ob.newPlayer;
  check("welcome card, no-picks player: 'Welcome to <league>', the five how-to lines verbatim (band from config), the next open show's cutoff with 'Make your picks' wired to openShow(1), community links through the https-only guard (the javascript: one dropped), and a ✕ labelled as hiding only the card",
    nw.card && nw.heading === "Welcome to Ambassadors" && J(nw.howto) === J(HOWTO)
      && /^Next cutoff: The Barn · .+ Make your picks$/.test(nw.next ?? "") && nw.nextOnclick === "openShow(1)"
      && J(nw.links) === J([["Facebook group", "https://example.com/group"]])
      && nw.cardX?.onclick === "dismissWelcome()" && nw.cardX?.label === "Hide this card",
    `newPlayer: ${J(nw)}`);
  check("'Make your picks' is wired to something real: firing its onclick renders the pick sheet for that show",
    ob.buttonFired === true && ob.buttonOpenedSheet === true,
    `fired: ${ob.buttonFired} opened: ${ob.buttonOpenedSheet}`);
  check("Android phone, no captured prompt: the card's section shows branch (b) with a visible 'Don't show again', and NO bar while the section is on screen",
    nw.section && J(nw.sectionSteps) === J([MENU_B]) && nw.sectionDismiss?.text === DONT && nw.sectionDismiss?.onclick === "dismissInstall()" && !nw.bar,
    `section: ${J(nw.sectionSteps)} dismiss: ${J(nw.sectionDismiss)} bar: ${nw.bar}`);
  check("derivation is league-wide (decision 1) and free for a returning player: picks here → ONE pick-count call (this bracket), no card; Official-only picks seen from Casual → two calls, no card; no picks anywhere → two calls, card",
    J(ob.hasPicksCalls) === J([OB_C]) && !ob.hasPicks.card
      && J(ob.officialOnlyCalls) === J([OB_C, OB_O]) && !ob.officialOnly.card
      && J(ob.newPlayerCalls) === J([OB_C, OB_O]) && nw.card,
    `calls picks ${J(ob.hasPicksCalls)} officialOnly ${J(ob.officialOnlyCalls)} new ${J(ob.newPlayerCalls)}`);
  check("a draft counts as picks in either bracket: a draft in the other bracket suppresses the card WITHOUT querying that bracket; a draft in this one suppresses it too",
    !ob.draftOther.card && J(ob.draftOtherCalls) === J([OB_C]) && !ob.draftHere.card,
    `draftOther: card ${ob.draftOther.card} calls ${J(ob.draftOtherCalls)} draftHere: card ${ob.draftHere.card}`);
  check("decision 3: the shows list silently sets ft_first_save_<id> whenever it sees SAVED picks in either bracket, and never for a no-picks player or a draft alone",
    ob.hasPicksFirstSave === "1" && ob.officialOnlyFirstSave === "1" && ob.newPlayerFirstSave === null && ob.draftOtherFirstSave === null,
    `p1 ${ob.hasPicksFirstSave} p6 ${ob.officialOnlyFirstSave} new ${ob.newPlayerFirstSave} draft ${ob.draftOtherFirstSave}`);
  check("empty case, no show open: the card renders without the deadline line or its button, everything else intact",
    ob.noOpenShow.card && ob.noOpenShow.next === null && ob.noOpenShow.nextOnclick === null && J(ob.noOpenShow.howto) === J(HOWTO) && ob.noOpenShow.section,
    `noOpenShow: ${J(ob.noOpenShow)}`);
  check("a player with picks on a phone gets the slim bar: 'Add Fantasy Eggy to your home screen', a collapsed 'How?', and a ✕ whose aria-label AND title read 'Don't show again'",
    ob.hasPicks.bar && ob.hasPicks.barText === "Add Fantasy Eggy to your home screen" && ob.hasPicks.barHow?.onclick === "toggleInstallHow()"
      && ob.hasPicks.howHidden === true && ob.hasPicks.barX?.label === DONT && ob.hasPicks.barX?.title === DONT && ob.hasPicks.barX?.onclick === "dismissInstall()",
    `bar: ${J({ text: ob.hasPicks.barText, how: ob.hasPicks.barHow, x: ob.hasPicks.barX, hidden: ob.hasPicks.howHidden })}`);
  check("'How?' expands the same platform instructions (iPhone: the iOS text)",
    ob.barHowIos.howHidden === false && J(ob.barHowIos.howSteps) === J(IOS_STEPS),
    `how: hidden ${ob.barHowIos.howHidden} ${J(ob.barHowIos.howSteps)}`);
  check("amended bar rule (decision 6): the card's ✕ hides ONLY the card (ft_welcome_<id>, no install flag) and the bar appears at once and after a reload; another player on the same device still gets the card and its section",
    ob.cardXFired === true && !ob.afterCardX.card && ob.afterCardX.bar && ob.afterCardXStorage["ft_welcome_p2"] === "1" && !("ft_install_dismissed" in ob.afterCardXStorage)
      && !ob.afterCardXReload.card && ob.afterCardXReload.bar && ob.otherPlayerSameDevice.card && ob.otherPlayerSameDevice.section,
    `after ✕: ${J({ card: ob.afterCardX.card, bar: ob.afterCardX.bar })} storage ${J(Object.keys(ob.afterCardXStorage))} reload ${J({ card: ob.afterCardXReload.card, bar: ob.afterCardXReload.bar })} p5 ${J({ card: ob.otherPlayerSameDevice.card, section: ob.otherPlayerSameDevice.section })}`);
  check("standalone hides ALL install help: the card keeps its welcome but loses its section, no bar for a player with picks, iOS navigator.standalone counts too, and no Settings switch",
    ob.standaloneNew.card && noHelp(ob.standaloneNew) && noHelp(ob.standalonePicks) && noHelp(ob.iosNavStandalone) && ob.standaloneSettings.tips === null,
    `new ${J({ card: ob.standaloneNew.card, section: ob.standaloneNew.section, bar: ob.standaloneNew.bar })} picks bar ${ob.standalonePicks.bar} iosNav bar ${ob.iosNavStandalone.bar} tips ${J(ob.standaloneSettings.tips)}`);
  check("not a phone (desktop agent): no install help and no switch; a phone not running standalone gets the switch, checked, wired to setInstallTips(this.checked)",
    ob.desktopNew.card && noHelp(ob.desktopNew) && noHelp(ob.desktopPicks) && ob.desktopSettings.tips === null
      && ob.phoneSettings.tips?.checked === true && ob.phoneSettings.tips?.onchange === "setInstallTips(this.checked)",
    `desktop ${J({ section: ob.desktopNew.section, bar: ob.desktopPicks.bar, tips: ob.desktopSettings.tips })} phone tips ${J(ob.phoneSettings.tips)}`);
  check("each platform branch through the DOM: iPhone (c) with the sign-in line; Facebook on iOS (d) with ⋯; Messenger on Android (d) with ⋮; Instagram on iOS (d); Samsung Internet (b) with ≡",
    J(ob.branchIos.sectionSteps) === J(IOS_STEPS)
      && J(ob.branchFbIos.sectionSteps) === J([IN_APP("Facebook", "⋯")])
      && J(ob.branchMsgrAndroid.sectionSteps) === J([IN_APP("Messenger", "⋮")])
      && J(ob.branchIgIos.sectionSteps) === J([IN_APP("Instagram", "⋯")])
      && J(ob.branchSamsung.sectionSteps) === J(["Tap ≡ (bottom), then Add page to, then Home screen."]),
    `ios ${J(ob.branchIos.sectionSteps)} fb ${J(ob.branchFbIos.sectionSteps)} msgr ${J(ob.branchMsgrAndroid.sectionSteps)} ig ${J(ob.branchIgIos.sectionSteps)} samsung ${J(ob.branchSamsung.sectionSteps)}`);
  check("a captured beforeinstallprompt, branch (a): preventDefault'd, ONE Install button replaces the menu text; firing it calls prompt() exactly once, then the menu text returns; appinstalled sets ft_install_dismissed and clears the help (decision 4)",
    ob.prompt.prevented === true && ob.prompt.before.sectionInstall === "promptInstall()" && J(ob.prompt.before.sectionSteps) === J([])
      && ob.prompt.prompted === 1 && ob.prompt.after.sectionInstall === null && J(ob.prompt.after.sectionSteps) === J([MENU_B])
      && ob.prompt.installedFlag === "1" && noHelp(ob.prompt.installed),
    `prompt: ${J({ prevented: ob.prompt.prevented, before: ob.prompt.before.sectionInstall, prompted: ob.prompt.prompted, after: ob.prompt.after.sectionSteps, flag: ob.prompt.installedFlag })}`);
  check("the captured prompt reaches the bar's 'How?' too; on a dismissed device or a desktop the event is left alone (no preventDefault), keeping the browser's own install offer",
    ob.promptInBar.bar && ob.promptInBar.howInstall === "promptInstall()"
      && ob.promptWhenDismissed.prevented === false && !ob.promptWhenDismissed.read.section && ob.promptOnDesktop.prevented === false,
    `bar how ${ob.promptInBar.howInstall} dismissed ${ob.promptWhenDismissed.prevented} desktop ${ob.promptOnDesktop.prevented}`);
  check("ONE permanent flag, from the bar: 'Don't show again' sets ft_install_dismissed; after a reload neither the bar nor the card's section shows, for this player or a no-picks one",
    ob.barDismiss.flag === "1" && noHelp(ob.barDismiss.read) && tipsOff(ob.barDismiss.read)
      && noHelp(ob.barDismissReload) && ob.barDismissNewPlayer.card && noHelp(ob.barDismissNewPlayer),
    `flag ${ob.barDismiss.flag} after ${J({ bar: ob.barDismiss.read.bar, tips: ob.barDismiss.read.tips })} reload bar ${ob.barDismissReload.bar} new ${J({ card: ob.barDismissNewPlayer.card, section: ob.barDismissNewPlayer.section })}`);
  check("ONE permanent flag, from the card's section: the bar never appears, not beside the card, not after the card's ✕, not for a player with picks",
    ob.sectionDismiss.flag === "1" && ob.sectionDismiss.read.card && noHelp(ob.sectionDismiss.read) && tipsOff(ob.sectionDismiss.read)
      && !ob.sectionDismissThenCardX.card && noHelp(ob.sectionDismissThenCardX) && noHelp(ob.sectionDismissPicksPlayer),
    `flag ${ob.sectionDismiss.flag} then ✕ ${J({ card: ob.sectionDismissThenCardX.card, bar: ob.sectionDismissThenCardX.bar })} p1 bar ${ob.sectionDismissPicksPlayer.bar}`);
  check("logout keeps the device flag, and a different player logging in on the same device still sees no install help (nor the same player)",
    ob.logout.sessionGone && ob.logout.flag === "1" && ob.logoutOtherPlayer.card && noHelp(ob.logoutOtherPlayer) && noHelp(ob.logoutSamePlayer),
    `logout ${J(ob.logout)} other ${J({ card: ob.logoutOtherPlayer.card, section: ob.logoutOtherPlayer.section, bar: ob.logoutOtherPlayer.bar })} same bar ${ob.logoutSamePlayer.bar}`);
  check("the Settings switch is the undo: unchecked while dismissed; checking it clears the flag and BOTH the card's section and the bar come back; unchecking sets the flag again",
    ob.switchBefore.tips?.checked === false && ob.switchOnFlag === null && ob.switchOnShows.section && ob.switchOnPicksPlayer.bar && ob.switchOffFlag === "1",
    `before ${J(ob.switchBefore.tips)} on-flag ${ob.switchOnFlag} section ${ob.switchOnShows.section} bar ${ob.switchOnPicksPlayer.bar} off-flag ${ob.switchOffFlag}`);
  check("first-save toast: the long text on a new player's first save and the flag set; 'Picks saved ✔' on the next save and after a reload; a second player on the device gets it once; a player the shows list saw with picks never gets it",
    ob.firstSave.saved && J(ob.firstSave.toasts1) === J([FIRST_TOAST]) && ob.firstSave.flag === "1"
      && J(ob.firstSave.toasts2) === J([FIRST_TOAST, "Picks saved ✔"]) && J(ob.firstSave.reloadToasts) === J(["Picks saved ✔"])
      && J(ob.firstSave.otherPlayerToasts) === J([FIRST_TOAST]) && J(ob.firstSave.veteranToasts) === J(["Picks saved ✔"]),
    `firstSave: ${J(ob.firstSave)}`);
  // 2026-10-26 device-check amendment, item 4: the same-browser installed check.
  const ins = ob.installed, late = ob.late;
  const help3 = r => J({ card: r.card, section: r.section, bar: r.bar, tips: r.tips });
  check("installed from THIS browser (getInstalledRelatedApps returns a webapp entry): the welcome stays but its install section goes, no bar for a player with picks, no Settings switch, and ft_install_dismissed stays UNSET; the next load with nothing installed (an uninstall) brings the section back",
    ins.shows.card && noHelp(ins.shows) && ins.settings.tips === null && ins.flag === null && noHelp(ins.picks)
      && ins.uninstalled.card && ins.uninstalled.section && J(ins.uninstalled.sectionSteps) === J([MENU_B]),
    `shows ${help3(ins.shows)} settings tips ${J(ins.settings.tips)} flag ${ins.flag} picks bar ${ins.picks.bar} uninstalled ${help3(ins.uninstalled)}`);
  check("the installed answer landing AFTER render clears what is on screen: the card's section, a picks player's bar, an open Settings switch; the flag stays unset",
    late.newBefore.section && late.newAfter.card && noHelp(late.newAfter) && late.newAfter.tips === null
      && late.picksBefore.bar && noHelp(late.picksAfter)
      && late.settingsBefore.tips?.checked === true && late.settingsAfter.tips === null && late.flag === null,
    `new ${help3(late.newBefore)} → ${help3(late.newAfter)} picks bar ${late.picksBefore.bar} → ${late.picksAfter.bar} settings ${J(late.settingsBefore.tips)} → ${J(late.settingsAfter.tips)} flag ${late.flag}`);
  check("the API present but reporting nothing, or throwing, changes nothing (absent is every other onboarding check here): section, bar and switch as before",
    ob.relatedEmpty.shows.section && J(ob.relatedEmpty.shows.sectionSteps) === J([MENU_B]) && ob.relatedEmpty.settings.tips?.checked === true && ob.relatedEmpty.picks.bar
      && ob.relatedThrow.shows.section && ob.relatedThrow.picks.bar,
    `empty ${help3(ob.relatedEmpty.shows)} tips ${J(ob.relatedEmpty.settings.tips)} bar ${ob.relatedEmpty.picks.bar} throw ${help3(ob.relatedThrow.shows)} bar ${ob.relatedThrow.picks.bar}`);
  {
    const showsSrc = readFileSync(join(root, "src/features/shows.js"), "utf8");
    const configSrc = readFileSync(join(root, "src/core/config.js"), "utf8");
    const cssSrc = readFileSync(join(root, "styles.css"), "utf8");
    const block = cssSrc.slice(cssSrc.indexOf("/* Onboarding Batch 3"), cssSrc.indexOf(".tips-switch input"));
    check("statically: the band comes from config.BAND_NAME (no literal in the how-to copy), and no onboarding rule uses var(--cream-dim) (under AA on the light panel) and hide the empty bar slot",
      /export const BAND_NAME = "Eggy";/.test(configSrc) && /think \$\{BAND_NAME\} will play/.test(showsSrc) && !/think Eggy/.test(showsSrc)
        && block.length > 200 && !/var\(--cream-dim\)/.test(block) && /#install-bar:empty\{display:none\}/.test(cssSrc),
      `block length ${block.length}`);
  }

  // ---------- Vet-first fast path (docs/decisions/onboarding.md, decision 7) ----------
  const vf = await runVetFirstScenario({ html, scripts, mode });
  const vfNames = r => J(r.rows.map(x => x.name)), vfMarks = r => J(r.rows.map(x => x.isNew));
  const hasToast = (list, text) => list.some(t => t.text === text);
  check("load: an admin on the shows tab sees the pill on the Admin tab AND the desktop column title, counting only the two registrations inside 14 days, from exactly ONE list call",
    vf.boot.tabBadge?.text === "2" && vf.boot.colBadge?.text === "2"
      && vf.boot.tabBadge?.label === "2 new registrations in the last 14 days, not in any league" && vf.boot.calls === 1,
    `boot: ${J({ tab: vf.boot.tabBadge, col: vf.boot.colBadge, calls: vf.boot.calls })}`);
  check("admin-panel render (decision 2): the unaffiliated list newest first, every row dated, 'new' only inside the window; the panel's own call is the only one",
    vfNames(vf.panel) === J(["Fresh Fern", "Early Elm", "Old Oak", "Wanderer"]) && vfMarks(vf.panel) === J([true, true, false, false])
      && vf.panel.rows.every(r => r.reg) && vf.panel.calls === 1 && vf.panel.tabBadge?.text === "2",
    `panel: ${J({ rows: vf.panel.rows, calls: vf.panel.calls, badge: vf.panel.tabBadge })}`);
  check("Add from the list drops the count at once (the list reload sets the badge); no season running, so no roster row and a plain toast",
    vf.addedOk && vf.afterAdd.tabBadge?.text === "1" && vf.afterAddRoster.length === 0 && hasToast(vf.afterAdd.toasts, "Fresh Fern added"),
    `afterAdd: ${J({ ok: vf.addedOk, badge: vf.afterAdd.tabBadge, roster: vf.afterAddRoster, toasts: vf.afterAdd.toasts })}`);
  check("foreground (decision 3): exactly ONE list call on the shows tab, on the admin tab, and over an open pick sheet (left on screen), each picking up a registration made meanwhile",
    vf.fgShows.calls === 1 && vf.fgShows.badge?.text === "3" && vf.fgAdmin.calls === 1 && vf.fgAdmin.badge?.text === "3"
      && vf.fgSheet.calls === 1 && vf.fgSheet.badge?.text === "3" && vf.fgSheet.sheet,
    `fg: ${J({ shows: vf.fgShows, admin: vf.fgAdmin, sheet: vf.fgSheet })}`);
  check("empty case: nobody inside the window → no pill anywhere and the label reads exactly 'Admin' (the list is still fetched once)",
    vf.empty.anyBadge === 0 && vf.empty.tab === "Admin" && vf.empty.calls === 1,
    `empty: ${J({ any: vf.empty.anyBadge, tab: vf.empty.tab, calls: vf.empty.calls })}`);
  check("a non-admin never sees the pill and the client never calls the admin list: on load, on the Settings tab, after a foreground there, and after a foreground over an open pick sheet (the one path that reaches the gate on desktop)",
    vf.nonAdmin.boot.tab === "Settings" && vf.nonAdmin.boot.anyBadge === 0 && vf.nonAdmin.settings.anyBadge === 0
      && vf.nonAdmin.after.anyBadge === 0 && vf.nonAdmin.overSheet.sheet && vf.nonAdmin.overSheet.anyBadge === 0 && vf.nonAdmin.calls === 0,
    `nonAdmin: ${J({ tab: vf.nonAdmin.boot.tab, any: [vf.nonAdmin.boot.anyBadge, vf.nonAdmin.settings.anyBadge, vf.nonAdmin.after.anyBadge, vf.nonAdmin.overSheet.anyBadge], sheet: vf.nonAdmin.overSheet.sheet, calls: vf.nonAdmin.calls })}`);
  check("the cap: 55 registrations inside the window come back as 50, and the pill says '50+'",
    vf.cap.tabBadge?.text === "50+",
    `cap: ${J(vf.cap.tabBadge)}`);
  check("deploy order: against the pre-Stage-W function (no created_at) there is no pill, and the list still renders, undated and unmarked",
    vf.oldSql.boot.anyBadge === 0 && vf.oldSql.panel.rows.length === 4 && vf.oldSql.panel.rows.every(r => r.reg === null && !r.isNew),
    `oldSql: ${J({ any: vf.oldSql.boot.anyBadge, rows: vf.oldSql.panel.rows })}`);
  check("mid-season add (Part B): exactly one roster row, in the running season (not the ended or the not-yet-snapshotted one), stamped at add time; the toast names it; the open roster panel redraws with the new member on it",
    J(vf.mid.roster) === J([{ season_id: 601, stamped: true }]) && hasToast(vf.mid.toasts, "Fresh Fern added, and to the Fall Run roster") && vf.mid.panelHit,
    `mid: ${J(vf.mid)}`);
  check("no running season (only ended or not-yet-snapshotted ones): the add writes no roster row and the toast is plain",
    vf.noActive.roster.length === 0 && hasToast(vf.noActive.toasts, "Fresh Fern added") && !vf.noActive.toasts.some(t => /roster/.test(t.text)),
    `noActive: ${J(vf.noActive)}`);
  check("the Add toast escapes the registrant's name (toast() renders HTML; a registrant picks their own name)",
    vf.escaped.some(t => t.text === "<b>Bold</b> added" && t.bold === false),
    `escaped: ${J(vf.escaped)}`);

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
