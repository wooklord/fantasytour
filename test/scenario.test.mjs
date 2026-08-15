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
import { runScenario, runLoggedOutBoot, runNonAdminScenario, runGlobalAdminScenario, runForcedPinChangeScenario, runRankedChoiceScenario } from "./harness.mjs";

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
    res.slotsRules.terms.includes("Perfect sheet")
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

  // Every session above is p1, a league admin in the fixture — this whole
  // suite never logged in as a genuine non-admin until now. Regression
  // coverage for the real bug: a non-admin's shared admin/settings tab
  // rendered the admin-only panel after backgrounding+foregrounding,
  // because refreshCurrent() called renderAdmin() directly instead of the
  // role-aware dispatcher every other call site already used.
  const nonAdmin = await runNonAdminScenario({ html, scripts, mode });
  check("non-admin's shared tab shows Settings, not Admin, content",
    /Bracket/.test(nonAdmin.settingsHtml) && /Log out/.test(nonAdmin.settingsHtml)
      && !/Master switch/.test(nonAdmin.settingsHtml) && !/Who's picked/.test(nonAdmin.settingsHtml),
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
      && !/Master switch/.test(nonAdmin.afterForegroundHtml) && !/Who's picked/.test(nonAdmin.afterForegroundHtml),
    `afterForegroundHtml: ${nonAdmin.afterForegroundHtml}`);

  // p4 is a genuine global admin (is_global_admin:true) with no
  // league_members.is_league_admin flag at all — closes the blind spot
  // CLAUDE.md flags: every other scenario's admin coverage runs through the
  // league-admin branch, never the is_global_admin one.
  const globalAdmin = await runGlobalAdminScenario({ html, scripts, mode });
  // settingsPanelHtml() (with its own "Log out" button) is embedded inside
  // renderAdmin() too (see admin.js), so "Log out" appears on both — the
  // admin-only signal is Master switch/Who's picked, not the absence of Log out.
  check("a genuine global admin (no league-admin flag) sees Admin content",
    /Master switch/.test(globalAdmin.adminHtml) && /Who's picked/.test(globalAdmin.adminHtml),
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
    ranked.sheet.ruleTerms.includes("Perfect sheet"),
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
  check("the warning names how many picks across how many open shows",
    /\d+ pick(s)? across \d+ open show(s)?/.test(ranked.modeWarning.message),
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
    !rankedNoPerfect.sheet.ruleTerms.includes("Perfect sheet"),
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
  const forcedPin = await runForcedPinChangeScenario({ html, scripts, mode });
  check("must_change_pin:true renders the forced interstitial, not the normal tabs",
    /Set a new PIN/.test(forcedPin.interstitialHtml) && forcedPin.tabsDisplay !== "flex",
    `interstitialHtml present: ${/Set a new PIN/.test(forcedPin.interstitialHtml)} tabsDisplay: "${forcedPin.tabsDisplay}"`);
  check("submitting a matching new PIN clears must_change_pin in the stored session",
    forcedPin.storedSession && forcedPin.storedSession.must_change_pin === false && forcedPin.storedSession.pin === "4321",
    `storedSession: ${JSON.stringify(forcedPin.storedSession)}`);

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
