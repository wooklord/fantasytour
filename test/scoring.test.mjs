// Fixture-based unit tests for the pure scoring module (supabase/functions/
// carton-sync/scoring.js). Runs under plain Node — no Deno, no Supabase, no
// network. Fixtures are real setlists pulled from The Carton's API so the
// sandwich/closer-determinacy scenarios are grounded in shows that actually
// happened, not invented data.
//
//   node test/scoring.test.mjs

import { readFileSync } from "node:fs";
import { deriveSlotFacts, resolveConfigSection, scorePicks, scoreRankedPicks } from "../supabase/functions/carton-sync/scoring.js";
import {
  decodeEntities, diffProjections, finalUpdatePatch, hashSetlist, mapSetlistRows, parseProjection, projectSetlist,
  rederiveVerdicts, setlistCheckDue, withFinalBaseline,
} from "../supabase/functions/carton-sync/setlistCheck.js";

const failures = [];
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) failures.push(`${label}\n  expected: ${e}\n  actual:   ${a}`);
}

// ---------------------------------------------------------------
// Fixture: Rocking The Docks Music Series, Lewes DE — 2026-07-26
// https://thecarton.net/setlists/eggy-july-26-2026-rocking-the-docks-music-series-lewes-de-usa.html
// Set 1 has the real sandwich: Reflections(6) > Shatter(7) > Reflections(8) —
// the second Reflections is also the true Set 1 Closer.
// ---------------------------------------------------------------
const rockingDocks = [
  { position: 1, setnumber: "1", is_encore: false, songname: "Silver Steed (My Blue)", is_cover: false, footnote: null },
  { position: 2, setnumber: "1", is_encore: false, songname: "Laurel", is_cover: false, footnote: null },
  { position: 3, setnumber: "1", is_encore: false, songname: "Trixieville", is_cover: false, footnote: null },
  { position: 4, setnumber: "1", is_encore: false, songname: "Parceled Serotonin", is_cover: false, footnote: "with Shallow Rivers tease, Jake switched to acoustic" },
  { position: 5, setnumber: "1", is_encore: false, songname: "Carry On", is_cover: true, footnote: "Crosby, Stills, Nash & Young cover, Jake on acoustic" },
  { position: 6, setnumber: "1", is_encore: false, songname: "Reflections", is_cover: false, footnote: null },
  { position: 7, setnumber: "1", is_encore: false, songname: "Shatter", is_cover: false, footnote: null },
  { position: 8, setnumber: "1", is_encore: false, songname: "Reflections", is_cover: false, footnote: null },
  { position: 9, setnumber: "2", is_encore: false, songname: "Soak Up The Sun", is_cover: true, footnote: "Sheryl Crow cover" },
  { position: 10, setnumber: "2", is_encore: false, songname: "Beaming", is_cover: false, footnote: null },
  { position: 11, setnumber: "2", is_encore: false, songname: "High Noon", is_cover: false, footnote: null },
  { position: 12, setnumber: "2", is_encore: false, songname: "Smile", is_cover: false, footnote: "with Shatter tease" },
  { position: 13, setnumber: "2", is_encore: false, songname: "Bloomlight", is_cover: false, footnote: null },
  { position: 14, setnumber: "2", is_encore: false, songname: "Shatter", is_cover: false, footnote: null },
  { position: 15, setnumber: "e", is_encore: true, songname: "Voice of Them All", is_cover: false, footnote: null },
  { position: 16, setnumber: "e", is_encore: true, songname: "Parceled Serotonin", is_cover: false, footnote: null },
];

// ---------------------------------------------------------------
// Fixture: Citizens House of Blues, Boston MA — 2026-07-31 (real production
// incident). Shatter(5) looked like the closer from a 5-song snapshot; the
// real Set 2 Closer is Voice of Them All(7), confirmed once the encore
// (Smile, 8) starts. The old merge-against-history logic latched Shatter's
// mid-show "closer — exact" permanently; this is the regression test.
// ---------------------------------------------------------------
const bostonHOB = [
  { position: 1, setnumber: "1", is_encore: false, songname: "Woah There", is_cover: false, footnote: null },
  { position: 2, setnumber: "1", is_encore: false, songname: "Peace Upon Us", is_cover: false, footnote: null },
  { position: 3, setnumber: "1", is_encore: false, songname: "Interior People", is_cover: true, footnote: "King Gizzard & the Lizard Wizard cover" },
  { position: 4, setnumber: "1", is_encore: false, songname: "City Lights", is_cover: false, footnote: null },
  { position: 5, setnumber: "1", is_encore: false, songname: "Shatter", is_cover: false, footnote: null },
  { position: 6, setnumber: "1", is_encore: false, songname: "Hungry Like The Wolf", is_cover: true, footnote: "Duran Duran cover, LTP 12/28/24 (160 show gap)" },
  { position: 7, setnumber: "1", is_encore: false, songname: "Voice of Them All", is_cover: false, footnote: null },
  { position: 8, setnumber: "e", is_encore: true, songname: "Smile", is_cover: false, footnote: null },
];

// ---------------------------------------------------------------
// Fixture: GratefulFest, Garrettsville OH — 2026-07-24 (one-set festival)
// https://thecarton.net/setlists/eggy-july-24-2026-gratefulfest-garrettsville-oh-usa.html
// Real one-set show with no encore at all; also has its own sandwich
// (Shatter wraps Smile) and ends on the second Shatter, so "closer" resolves
// to it once we're treating this as the finished show (no encore ever came,
// so there's no earlier structural signal — only finalize confirms it).
// ---------------------------------------------------------------
const gratefulFest = [
  { position: 1, setnumber: "1", is_encore: false, songname: "Woah There", is_cover: false, footnote: null },
  { position: 2, setnumber: "1", is_encore: false, songname: "A Moment's Notice", is_cover: false, footnote: null },
  { position: 3, setnumber: "1", is_encore: false, songname: "Time Loves A Hero", is_cover: true, footnote: "Little Feat cover" },
  { position: 4, setnumber: "1", is_encore: false, songname: "Sweat Equity", is_cover: false, footnote: null },
  { position: 5, setnumber: "1", is_encore: false, songname: "Breaking the Horse", is_cover: false, footnote: null },
  { position: 6, setnumber: "1", is_encore: false, songname: "Parceled Serotonin", is_cover: false, footnote: null },
  { position: 7, setnumber: "1", is_encore: false, songname: "Shatter", is_cover: false, footnote: null },
  { position: 8, setnumber: "1", is_encore: false, songname: "Smile", is_cover: false, footnote: null },
  { position: 9, setnumber: "1", is_encore: false, songname: "Shatter", is_cover: false, footnote: null },
];

// ---------------------------------------------------------------
// Fixture: Levitt Pavilion, Westport CT — 2026-07-11
// https://thecarton.net/setlists/eggy-july-11-2026-levitt-pavilion-for-the-performing-arts-westport-ct-usa.html
// Shadow opens set 2 (position 10) AND closes the show in the encore
// (position 21) — real encore-vs-show-closer distinction, and a real
// wrong-slot-then-right-slot resolution that isn't the same song/slot as the
// Rocking The Docks sandwich above.
// ---------------------------------------------------------------
const levittPavilion = [
  { position: 1, setnumber: "1", is_encore: false, songname: "Breaking the Horse", is_cover: false, footnote: null },
  { position: 2, setnumber: "1", is_encore: false, songname: "Laurel", is_cover: false, footnote: null },
  { position: 3, setnumber: "1", is_encore: false, songname: "Reflections", is_cover: false, footnote: null },
  { position: 4, setnumber: "1", is_encore: false, songname: "I Pray", is_cover: false, footnote: null },
  { position: 5, setnumber: "1", is_encore: false, songname: "Subterranean Homesick Alien", is_cover: true, footnote: "Radiohead cover, with Ross Bogan" },
  { position: 6, setnumber: "1", is_encore: false, songname: "Trixieville", is_cover: false, footnote: null },
  { position: 7, setnumber: "1", is_encore: false, songname: "Waiting Game", is_cover: false, footnote: null },
  { position: 8, setnumber: "1", is_encore: false, songname: "Come Up Slow", is_cover: false, footnote: "Jake on acoustic" },
  { position: 9, setnumber: "1", is_encore: false, songname: "Shallow Rivers", is_cover: false, footnote: null },
  { position: 10, setnumber: "2", is_encore: false, songname: "Shadow", is_cover: false, footnote: null },
  { position: 11, setnumber: "2", is_encore: false, songname: "Must Come Down", is_cover: false, footnote: "with Slide (Calvin Harris) tease from Jake" },
  { position: 12, setnumber: "2", is_encore: false, songname: "Razi", is_cover: false, footnote: null },
  { position: 13, setnumber: "2", is_encore: false, songname: "Coming Up", is_cover: true, footnote: "Paul McCartney cover" },
  { position: 14, setnumber: "2", is_encore: false, songname: "Razi", is_cover: false, footnote: null },
  { position: 15, setnumber: "2", is_encore: false, songname: "A Moment's Notice", is_cover: false, footnote: null },
  { position: 16, setnumber: "2", is_encore: false, songname: "Evergreen", is_cover: false, footnote: null },
  { position: 17, setnumber: "2", is_encore: false, songname: "Beaming", is_cover: false, footnote: null },
  { position: 18, setnumber: "2", is_encore: false, songname: "So Long", is_cover: false, footnote: "LTP 11/30/2024 (153 show gap)" },
  { position: 19, setnumber: "2", is_encore: false, songname: "Through the Mist", is_cover: false, footnote: null },
  { position: 20, setnumber: "e", is_encore: true, songname: "Smile", is_cover: false, footnote: null },
  { position: 21, setnumber: "e", is_encore: true, songname: "Shadow", is_cover: false, footnote: null },
];

// Config resembling the seeded default, extended with the full closer
// vocabulary (Set 1 Closer / Set 2 Closer / Show Closer) for the standard
// (2-set + encore) section.
const standardCfg = {
  slots: [
    { key: "opener", type: "opener", label: "Opener", points: 2 },
    { key: "set1_closer", type: "set1_closer", label: "Set 1 Closer", points: 2 },
    { key: "closer", type: "closer", label: "Set 2 Closer", points: 2 },
    { key: "encore", type: "encore", label: "Encore", points: 2 },
    { key: "show_closer", type: "show_closer", label: "Show Closer", points: 3 },
  ],
  flat_picks: 2, flat_points: 1,
  partial_credit: true, partial_points: 1,
  allow_duplicates: false,
  wildcards: { debut: true },
  bonuses: { cover: 0, debut: 0, perfect: 0 },
};

// A bracket config with distinct standard vs. one-set sections, mirroring
// the seeded default's oneset shape (opener/closer/cover1).
const oneSetCapableCfg = {
  slots: [
    { key: "opener", type: "opener", label: "Opener", points: 2 },
    { key: "set1_closer", type: "set1_closer", label: "Set 1 Closer", points: 2 },
  ],
  flat_picks: 0,
  partial_credit: true, partial_points: 1,
  bonuses: {},
  oneset: {
    slots: [
      { key: "opener", type: "opener", label: "Opener", points: 2 },
      { key: "closer", type: "closer", label: "Closer", points: 2 },
      { key: "cover1", type: "cover_pick", label: "Cover Pick", points: 2 },
    ],
    flat_picks: 1, flat_points: 1,
  },
};

// =================================================================
// 1. Set 1 Closer determinacy — Reflections sandwich, Rocking The Docks.
//    Determined only once something plays after set 1 (set 2 or the
//    encore starting) — NOT just because "the last song we've seen so far
//    in set 1 hasn't changed in a while."
// =================================================================
{
  const picks = [{ slot: "set1_closer", songname: "Reflections" }];

  // Pass 1: only positions 1–7 known (Shatter is the most recent song).
  // Reflections has been played (position 6) but set 1 clearly isn't over
  // yet — undetermined, consolation credit only.
  const p1 = rockingDocks.slice(0, 7);
  const pass1 = scorePicks({ picks, songs: p1, slotFacts: deriveSlotFacts(p1), cfg: standardCfg, format: "standard" });
  check("set1 closer pass 1: hit (played)", pass1.breakdown[0].hit, true);
  check("set1 closer pass 1: consolation points only", pass1.breakdown[0].points, 1);
  check("set1 closer pass 1: reason", pass1.breakdown[0].reason, "played — slot undetermined");

  // Pass 2: through position 8 (the second Reflections) — this LOOKS like
  // "all of set 1" and is exactly the snapshot the old code would have
  // scored as an exact closer match. Nothing has played after it yet
  // though, so it must still read as undetermined, not exact — this is the
  // regression case for the class of bug the Boston incident exposed.
  const p2 = rockingDocks.slice(0, 8);
  const pass2 = scorePicks({ picks, songs: p2, slotFacts: deriveSlotFacts(p2), cfg: standardCfg, format: "standard" });
  check("set1 closer pass 2 (naive 'full set 1'): still undetermined, no premature exact", pass2.breakdown[0].points, 1);
  check("set1 closer pass 2: reason still undetermined", pass2.breakdown[0].reason, "played — slot undetermined");

  // Pass 3: through position 9 (Soak Up The Sun opens set 2) — now there's
  // real evidence set 1 is over, so the second Reflections is confirmed as
  // the true Set 1 Closer.
  const p3 = rockingDocks.slice(0, 9);
  const pass3 = scorePicks({ picks, songs: p3, slotFacts: deriveSlotFacts(p3), cfg: standardCfg, format: "standard" });
  check("set1 closer pass 3: now determined, exact", pass3.breakdown[0].points, 2);
  check("set1 closer pass 3: reason", pass3.breakdown[0].reason, "set1_closer — exact");
}

// =================================================================
// 2. Regression test for the actual Boston 7/31/2026 incident: a mid-show
//    snapshot must never freeze a "closer — exact" claim that a later,
//    more complete pass would contradict.
// =================================================================
{
  const picks = [{ slot: "closer", songname: "Shatter" }];

  // Mid-show: only positions 1–5 known. Shatter is the most recent song,
  // but the encore hasn't started, so Set 2 Closer can't be confirmed —
  // consolation only, clearly labeled as provisional.
  const mid = bostonHOB.slice(0, 5);
  const midPass = scorePicks({ picks, songs: mid, slotFacts: deriveSlotFacts(mid), cfg: standardCfg, format: "standard" });
  check("Boston incident, mid-show: consolation only", midPass.breakdown[0].points, 1);
  check("Boston incident, mid-show: reason", midPass.breakdown[0].reason, "played — slot undetermined");

  // Full show, encore included: Voice of Them All (position 7) is the real
  // Set 2 Closer. Every pass scores fresh off the current snapshot — there
  // is no persisted "best result" to latch the wrong mid-show guess in.
  const fullPass = scorePicks({ picks, songs: bostonHOB, slotFacts: deriveSlotFacts(bostonHOB), cfg: standardCfg, format: "standard" });
  check("Boston incident, full show: correctly demoted, no stale exact", fullPass.breakdown[0].points, 1);
  check("Boston incident, full show: reason", fullPass.breakdown[0].reason, "played, wrong slot");
}

// =================================================================
// 3. One-set/festival show, no encore ever played — config section
//    resolution, and Closer only resolves once we know it's the finished
//    show (no earlier structural signal exists when there's no encore).
// =================================================================
{
  const facts = deriveSlotFacts(gratefulFest, true); // isFinal: no encore ever came
  const picks = [
    { slot: "opener", songname: "Woah There" },
    { slot: "closer", songname: "Shatter" }, // resolves via cfg.oneset, not cfg.slots
    { slot: "cover1", songname: "Time Loves A Hero" },
  ];
  const result = scorePicks({ picks, songs: gratefulFest, slotFacts: facts, cfg: oneSetCapableCfg, format: "one_set" });
  check("one-set: opener exact", [result.breakdown[0].hit, result.breakdown[0].points], [true, 2]);
  check("one-set: closer exact (Shatter's 2nd, final occurrence)", [result.breakdown[1].hit, result.breakdown[1].points], [true, 2]);
  check("one-set: cover pick exact", [result.breakdown[2].hit, result.breakdown[2].points], [true, 2]);

  // Confirm the section resolver itself: one_set picks cfg.oneset; anything
  // else (including a bracket with no oneset section) falls back to cfg.
  check("resolveConfigSection: one_set", resolveConfigSection(oneSetCapableCfg, "one_set"), oneSetCapableCfg.oneset);
  check("resolveConfigSection: standard", resolveConfigSection(oneSetCapableCfg, "standard"), oneSetCapableCfg);
  check("resolveConfigSection: one_set with no oneset section falls back", resolveConfigSection(standardCfg, "one_set"), standardCfg);
}

// =================================================================
// 4. Repeated song, wrong-slot then correct-slot (not the same
//    song/slot as the sandwiches above) — Shadow/Encore, Levitt Pavilion.
//    "encore" isn't a closer-family slot, so it's always determined — a
//    fresh pass naturally reflects a later reprise with no gating needed.
// =================================================================
{
  const picks = [{ slot: "encore", songname: "Shadow" }];

  // Pass 1: Shadow has just opened set 2 (position 10) — played, but no
  // encore has happened yet.
  const partial = levittPavilion.slice(0, 10);
  const pass1 = scorePicks({ picks, songs: partial, slotFacts: deriveSlotFacts(partial), cfg: standardCfg, format: "standard" });
  check("wrong-then-right pass 1: hit (played, not yet encore)", pass1.breakdown[0].hit, true);
  check("wrong-then-right pass 1: partial only", pass1.breakdown[0].points, 1);

  // Pass 2: full show — Shadow reprises in the actual encore.
  const pass2 = scorePicks({ picks, songs: levittPavilion, slotFacts: deriveSlotFacts(levittPavilion), cfg: standardCfg, format: "standard" });
  check("wrong-then-right pass 2: upgraded to full encore value", pass2.breakdown[0].points, 2);
  check("wrong-then-right pass 2: reason", pass2.breakdown[0].reason, "encore — exact");
}

// =================================================================
// 5. Encore vs. show-closer distinction — Smile vs. Shadow, Levitt Pavilion.
//    Smile is in the encore but isn't last; Shadow is both. Show Closer has
//    no early signal, so this only resolves once isFinal is true.
// =================================================================
{
  const facts = deriveSlotFacts(levittPavilion, true);

  const smilePicks = [
    { slot: "encore", songname: "Smile" },
    { slot: "show_closer", songname: "Smile" },
  ];
  const smile = scorePicks({ picks: smilePicks, songs: levittPavilion, slotFacts: facts, cfg: standardCfg, format: "standard" });
  check("Smile → Encore: exact hit", [smile.breakdown[0].hit, smile.breakdown[0].points], [true, 2]);
  check("Smile → Show Closer: played but wrong slot (Shadow closes, not Smile)", [smile.breakdown[1].hit, smile.breakdown[1].points, smile.breakdown[1].reason], [true, 1, "played, wrong slot"]);

  const shadowPicks = [
    { slot: "encore", songname: "Shadow" },
    { slot: "show_closer", songname: "Shadow" },
  ];
  const shadow = scorePicks({ picks: shadowPicks, songs: levittPavilion, slotFacts: facts, cfg: standardCfg, format: "standard" });
  check("Shadow → Encore: exact hit", [shadow.breakdown[0].hit, shadow.breakdown[0].points], [true, 2]);
  check("Shadow → Show Closer: also an exact hit (it's the literal last song)", [shadow.breakdown[1].hit, shadow.breakdown[1].points], [true, 3]);
}

// =================================================================
// 5b. Show Closer mid-show: no early signal exists at all (unlike Set 1/
//     Set 2 Closer) — even with the encore well underway, it stays
//     undetermined until isFinal.
// =================================================================
{
  const picks = [{ slot: "show_closer", songname: "Smile" }];
  const facts = deriveSlotFacts(levittPavilion, false); // encore has started, but not final
  const result = scorePicks({ picks, songs: levittPavilion, slotFacts: facts, cfg: standardCfg, format: "standard" });
  check("show closer mid-encore: still undetermined", result.breakdown[0].points, 1);
  check("show closer mid-encore: reason", result.breakdown[0].reason, "played — slot undetermined");
}

// =================================================================
// 6. A pick that never plays
// =================================================================
{
  const facts = deriveSlotFacts(levittPavilion, true);
  const picks = [{ slot: "opener", songname: "Distraction" }]; // not in this setlist at all
  const result = scorePicks({ picks, songs: levittPavilion, slotFacts: facts, cfg: standardCfg, format: "standard" });
  check("never played: miss", [result.breakdown[0].hit, result.breakdown[0].points, result.breakdown[0].reason], [false, 0, "not played"]);
}

// =================================================================
// 7. Ranked-choice mode (cfg.mode === "ranked_choice").
//    Slot-independent: a pick is played or it isn't, and its value comes
//    from its ladder position. Uses the Rocking The Docks setlist purely as
//    a source of real played/not-played song names — none of the positional
//    facts matter in this mode.
// =================================================================
const rankedCfg = {
  mode: "ranked_choice",
  ranked: { ladder: [5, 4, 3, 2, 1] },
  // cover/debut deliberately non-zero and the wildcard deliberately ON, to
  // prove suppression is structural rather than "the admin left them at 0".
  bonuses: { cover: 3, debut: 3, perfect: 5 },
  wildcards: { debut: true },
  // slot-mode fields present and populated but never read in this mode
  slots: [{ key: "opener", type: "opener", label: "Opener", points: 2 }],
  flat_picks: 2, flat_points: 1,
  partial_credit: true, partial_points: 1,
};
const R = rockingDocks; // played: Laurel, Shatter, Beaming, High Noon, Smile, Trixieville, Bloomlight, Carry On (cover)

// 7a. Hit and miss score at their ladder positions.
{
  const picks = [
    { slot: "rank1", songname: "Laurel" },       // played
    { slot: "rank2", songname: "Distraction" },  // not in this setlist
  ];
  const r = scorePicks({ picks, songs: R, slotFacts: null, cfg: rankedCfg, format: "standard" });
  check("ranked 7a: hit at rank1", [r.breakdown[0].hit, r.breakdown[0].points, r.breakdown[0].reason], [true, 5, "played"]);
  check("ranked 7a: miss at rank2", [r.breakdown[1].hit, r.breakdown[1].points, r.breakdown[1].reason], [false, 0, "not played"]);
  check("ranked 7a: total", r.total, 5);
  check("ranked 7a: slotFacts unused (no throw, no bonus row)", r.breakdown.length, 2);
}

// 7b. Partial sheet scores normally, no penalty, and cannot earn perfect.
{
  const picks = [
    { slot: "rank1", songname: "Laurel" },
    { slot: "rank2", songname: "Shatter" },
  ];
  const r = scorePicks({ picks, songs: R, slotFacts: null, cfg: rankedCfg, format: "standard" });
  check("ranked 7b: partial sheet total", r.total, 9);
  check("ranked 7b: no perfect bonus row", r.breakdown.length, 2);
}

// 7c. The exploit case: one pick, it hits, perfect must NOT fire.
{
  const picks = [{ slot: "rank1", songname: "Laurel" }];
  const r = scorePicks({ picks, songs: R, slotFacts: null, cfg: rankedCfg, format: "standard" });
  check("ranked 7c: 1-pick sheet earns no perfect", r.breakdown.length, 1);
  check("ranked 7c: total is just the rank value", r.total, 5);
}

// 7d. Count vs. coverage: 5 picks, all hit, but rank2 is never submitted
//     (rank1 appears twice). A picks.length check would fire perfect here.
{
  const picks = [
    { slot: "rank1", songname: "Laurel" },
    { slot: "rank1", songname: "Shatter" },
    { slot: "rank3", songname: "Beaming" },
    { slot: "rank4", songname: "High Noon" },
    { slot: "rank5", songname: "Smile" },
  ];
  const r = scorePicks({ picks, songs: R, slotFacts: null, cfg: rankedCfg, format: "standard" });
  check("ranked 7d: 5 picks but rank2 uncovered -> no perfect", r.breakdown.some(b => b.slot === "bonus"), false);
  check("ranked 7d: total (5+5+3+2+1, no bonus)", r.total, 16);
}

// 7e. Full sheet, every row hits -> perfect fires exactly once.
{
  const picks = [
    { slot: "rank1", songname: "Laurel" },
    { slot: "rank2", songname: "Shatter" },
    { slot: "rank3", songname: "Beaming" },
    { slot: "rank4", songname: "High Noon" },
    { slot: "rank5", songname: "Smile" },
  ];
  const r = scorePicks({ picks, songs: R, slotFacts: null, cfg: rankedCfg, format: "standard" });
  check("ranked 7e: perfect fires once", r.breakdown.filter(b => b.slot === "bonus").length, 1);
  check("ranked 7e: total 15 + 5 bonus", r.total, 20);
}

// 7f. Orphaned row outside the ladder must not block a complete, all-hit
//     sheet — the mirror of 7d. "rank7" is left over from a longer ladder.
{
  const picks = [
    { slot: "rank1", songname: "Laurel" },
    { slot: "rank2", songname: "Shatter" },
    { slot: "rank3", songname: "Beaming" },
    { slot: "rank4", songname: "High Noon" },
    { slot: "rank5", songname: "Smile" },
    { slot: "rank7", songname: "Distraction" }, // outside ladder AND not played
  ];
  const r = scorePicks({ picks, songs: R, slotFacts: null, cfg: rankedCfg, format: "standard" });
  check("ranked 7f: orphan does not block perfect", r.breakdown.filter(b => b.slot === "bonus").length, 1);
  check("ranked 7f: orphan scores 0", r.breakdown.find(b => b.slot === "rank7").points, 0);
  check("ranked 7f: total unchanged by orphan", r.total, 20);
}

// 7g. Suppression is structural: a played COVER earns its ladder value and
//     nothing more, and "Any Debut" is just an unmatched song name here.
{
  const picks = [
    { slot: "rank1", songname: "Carry On" },  // is_cover: true in this fixture
    { slot: "rank2", songname: "Any Debut" }, // the wildcard token, inert in this mode
  ];
  const r = scorePicks({ picks, songs: R, slotFacts: null, cfg: rankedCfg, format: "standard" });
  check("ranked 7g: cover scores ladder value only, no +cover", [r.breakdown[0].points, r.breakdown[0].reason], [5, "played"]);
  check("ranked 7g: Any Debut is not a wildcard here", [r.breakdown[1].hit, r.breakdown[1].points, r.breakdown[1].reason], [false, 0, "not played"]);
  check("ranked 7g: no bonus suffixes anywhere", r.breakdown.every(b => !/\+cover|\+debut/.test(b.reason)), true);
  check("ranked 7g: total is 5, not 5 + cover bonus", r.total, 5);
}

// 7h. Slot keys that are NOT canonical ladder positions score 0 even when
//     the song played — one definition of "which rank is this", not two.
//     Regression: deriving the index by string surgery let "rank02" score
//     the rank-2 value while failing an exact-match membership test, so it
//     earned points without participating in coverage or the hit check.
{
  const picks = [
    { slot: "rank1", songname: "Laurel" },
    { slot: "rank2", songname: "Shatter" },
    { slot: "rank3", songname: "Beaming" },
    { slot: "rank4", songname: "High Noon" },
    { slot: "rank5", songname: "Smile" },
    { slot: "rank02", songname: "Trixieville" }, // played; zero-padded
    { slot: " rank2", songname: "Bloomlight" },  // played; leading space
    { slot: "rank", songname: "Carry On" },      // played; no digits
    { slot: "bonus", songname: "Laurel" },       // played; reserved key inbound as a pick
  ];
  const r = scorePicks({ picks, songs: R, slotFacts: null, cfg: rankedCfg, format: "standard" });
  for (const key of ["rank02", " rank2", "rank", "bonus"]) {
    const row = r.breakdown.find(b => b.slot === key);
    check(`ranked 7h: "${key}" is hit but scores 0`, [row.hit, row.points], [true, 0]);
  }
  check("ranked 7h: non-canonical keys do not block perfect", r.breakdown.filter(b => b.slot === "bonus" && b.songname === "Perfect").length, 1);
  check("ranked 7h: total 15 + 5 bonus, no leaked points", r.total, 20);
}

// 7i. Duplicate ladder keys — pinning CURRENT behavior, not endorsing it.
//     The pick sheet renders fixed rows and there is no duplicate
//     prevention at the DB level (same as slot mode), so this is what a
//     duplicate actually does today: coverage passes on Set semantics, so
//     perfect still fires, and the duplicated position pays twice.
{
  const picks = [
    { slot: "rank1", songname: "Laurel" },
    { slot: "rank1", songname: "Shatter" }, // same ladder position, second row
    { slot: "rank2", songname: "Beaming" },
    { slot: "rank3", songname: "High Noon" },
    { slot: "rank4", songname: "Smile" },
    { slot: "rank5", songname: "Trixieville" },
  ];
  const r = scorePicks({ picks, songs: R, slotFacts: null, cfg: rankedCfg, format: "standard" });
  check("ranked 7i: duplicate rank1 still satisfies coverage -> perfect fires", r.breakdown.filter(b => b.slot === "bonus").length, 1);
  check("ranked 7i: both rank1 rows pay the ladder's first value", r.breakdown.filter(b => b.slot === "rank1").map(b => b.points), [5, 5]);
  check("ranked 7i: total (5+5+4+3+2+1) + 5 bonus", r.total, 25);
}

// 7j. Complete sheet with one miss — the most likely real outcome of any
//     given show, and distinct from both 7b (partial, all hit) and 7d
//     (count satisfied, coverage not). Here coverage DOES pass and the hit
//     test is what fails, so perfect must not fire.
{
  const picks = [
    { slot: "rank1", songname: "Laurel" },      // hit  5
    { slot: "rank2", songname: "Shatter" },     // hit  4
    { slot: "rank3", songname: "Beaming" },     // hit  3
    { slot: "rank4", songname: "High Noon" },   // hit  2
    { slot: "rank5", songname: "Distraction" }, // miss 0
  ];
  const r = scorePicks({ picks, songs: R, slotFacts: null, cfg: rankedCfg, format: "standard" });
  check("ranked 7j: complete but imperfect -> no bonus row", r.breakdown.some(b => b.slot === "bonus"), false);
  check("ranked 7j: total is the four hits only", r.total, 14);
  check("ranked 7j: the miss is recorded, not dropped", [r.breakdown[4].hit, r.breakdown[4].points], [false, 0]);
}

// 7k. Empty or absent ladder — exercises the `expectedSlots.length > 0`
//     guard, which nothing else tests. Without it an empty ladder would
//     make `every()` vacuously true and hand out perfect for free.
for (const [label, cfg] of [
  ["ranked omitted", { mode: "ranked_choice", bonuses: { perfect: 5 } }],
  ["ladder empty", { mode: "ranked_choice", ranked: { ladder: [] }, bonuses: { perfect: 5 } }],
]) {
  const picks = [{ slot: "rank1", songname: "Laurel" }]; // a played song
  const r = scorePicks({ picks, songs: R, slotFacts: null, cfg, format: "standard" });
  check(`ranked 7k (${label}): pick scores 0`, r.breakdown[0].points, 0);
  check(`ranked 7k (${label}): no vacuous perfect`, r.breakdown.some(b => b.slot === "bonus"), false);
  check(`ranked 7k (${label}): total 0`, r.total, 0);
}

// 7l. Perfect bonus disabled — exercises the `perf > 0` guard, also
//     otherwise untested. Same all-hit sheet as 7e.
for (const [label, bonuses] of [["perfect: 0", { perfect: 0 }], ["bonuses omitted", undefined]]) {
  const cfg = { mode: "ranked_choice", ranked: { ladder: [5, 4, 3, 2, 1] }, ...(bonuses ? { bonuses } : {}) };
  const picks = [
    { slot: "rank1", songname: "Laurel" },
    { slot: "rank2", songname: "Shatter" },
    { slot: "rank3", songname: "Beaming" },
    { slot: "rank4", songname: "High Noon" },
    { slot: "rank5", songname: "Smile" },
  ];
  const r = scorePicks({ picks, songs: R, slotFacts: null, cfg, format: "standard" });
  check(`ranked 7l (${label}): no bonus row`, r.breakdown.some(b => b.slot === "bonus"), false);
  check(`ranked 7l (${label}): total 15`, r.total, 15);
}

// 7m. A ladder of a different length, with string values — the realistic
//     production shape, since readLadder() scrapes DOM inputs and those are
//     strings unless saveConfig coerces them. Also confirms expectedSlots
//     is derived from the ladder's actual length, not an implicit 5.
{
  const cfg = { mode: "ranked_choice", ranked: { ladder: ["10", "5"] }, bonuses: { perfect: 7 } };
  const picks = [
    { slot: "rank1", songname: "Laurel" },
    { slot: "rank2", songname: "Shatter" },
  ];
  const r = scorePicks({ picks, songs: R, slotFacts: null, cfg, format: "standard" });
  check("ranked 7m: string ladder values coerce to numbers", [r.breakdown[0].points, r.breakdown[1].points], [10, 5]);
  check("ranked 7m: 2-row ladder is complete at 2 -> perfect fires", r.breakdown.filter(b => b.slot === "bonus").length, 1);
  check("ranked 7m: total 10 + 5 + 7 bonus", r.total, 22);
  // A third position doesn't exist on this ladder, so it scores 0 and is
  // outside coverage — same as any other non-canonical key (7h).
  const r3 = scorePicks({
    picks: [...picks, { slot: "rank3", songname: "Beaming" }],
    songs: R, slotFacts: null, cfg, format: "standard",
  });
  check("ranked 7m: rank3 off a 2-row ladder scores 0", r3.breakdown.find(b => b.slot === "rank3").points, 0);
  check("ranked 7m: and does not disturb the bonus", r3.total, 22);
}

// 7n. The complement of 7f, pinning ladder-scoping from the other side.
//     Two sub-cases, and they do different jobs — worth stating, because
//     they look interchangeable:
//     (a) an orphan that HIT. Both a correctly-scoped hit test and a
//         naive breakdown-wide one agree here (every row is a hit either
//         way), so this case cannot detect a scoping regression. It's a
//         behavioral pin: a hitting out-of-ladder row must score 0 and
//         must not inflate the total or disturb the bonus.
//     (b) a NON-CANONICAL key that MISSED. This one does discriminate: a
//         breakdown-wide hit test sees the miss and suppresses the bonus,
//         while a ladder-scoped one ignores it. Without this, 7f is the
//         only test standing between the ladder-scoped hit check and a
//         silent regression.
{
  const full = [
    { slot: "rank1", songname: "Laurel" },
    { slot: "rank2", songname: "Shatter" },
    { slot: "rank3", songname: "Beaming" },
    { slot: "rank4", songname: "High Noon" },
    { slot: "rank5", songname: "Smile" },
  ];
  // (a) orphan outside the ladder that DID play
  const rHit = scorePicks({
    picks: [...full, { slot: "rank7", songname: "Trixieville" }],
    songs: R, slotFacts: null, cfg: rankedCfg, format: "standard",
  });
  check("ranked 7n(a): hitting orphan still scores 0", rHit.breakdown.find(b => b.slot === "rank7").points, 0);
  check("ranked 7n(a): hitting orphan is recorded as a hit", rHit.breakdown.find(b => b.slot === "rank7").hit, true);
  check("ranked 7n(a): bonus fires", rHit.breakdown.filter(b => b.slot === "bonus").length, 1);
  check("ranked 7n(a): total not inflated by the orphan", rHit.total, 20);
  // Second guardian for the canonical-index fix, which 7h otherwise
  // protects alone. A zero-padded key that HITS is the only shape that
  // discriminates: string surgery reads "rank01" as position 1 and pays 5,
  // while an exact-match index reads it as no position at all and pays 0.
  // 7n(b)'s "rank02" can't cover this — it misses, and `hit ? value : 0`
  // zeroes a miss under either implementation.
  const rPad = scorePicks({
    picks: [...full, { slot: "rank01", songname: "Trixieville" }],
    songs: R, slotFacts: null, cfg: rankedCfg, format: "standard",
  });
  check("ranked 7n(a): hitting zero-padded key scores 0, not rank1's value", rPad.breakdown.find(b => b.slot === "rank01").points, 0);
  check("ranked 7n(a): and does not inflate the total", rPad.total, 20);
  // (b) non-canonical key that did NOT play — the discriminating case
  const rMiss = scorePicks({
    picks: [...full, { slot: "rank02", songname: "Distraction" }],
    songs: R, slotFacts: null, cfg: rankedCfg, format: "standard",
  });
  check("ranked 7n(b): missed non-canonical row does not block perfect", rMiss.breakdown.filter(b => b.slot === "bonus").length, 1);
  check("ranked 7n(b): it scores 0 and is marked a miss", [rMiss.breakdown.find(b => b.slot === "rank02").hit, rMiss.breakdown.find(b => b.slot === "rank02").points], [false, 0]);
  check("ranked 7n(b): total 15 + 5 bonus", rMiss.total, 20);
}

// 7o. Malformed ladder rungs must never produce a non-finite total. The
//     condition under test is "`total` is a real number," so that's what's
//     asserted — a specific expected value would only be a proxy for it,
//     and would pass for the wrong reason if the arithmetic changed.
//     Without the coercion in scoreRankedPicks, "abc" and undefined map to
//     NaN, a pick landing on that rung scores NaN, and `total` becomes NaN
//     — which would reach scores.points and poison every standings sum for
//     that player for the season.
for (const [label, ladder, expected] of [
  ["blank string", [5, "", 3], 15],
  ["non-numeric", [5, "abc", 3], 15],
  ["null", [5, null, 3], 15],
  ["undefined", [5, undefined, 3], 15],
  ["all strings", ["5", "4", "3"], 19],
]) {
  const cfg = { mode: "ranked_choice", ranked: { ladder }, bonuses: { perfect: 7 } };
  const picks = [
    { slot: "rank1", songname: "Laurel" },
    { slot: "rank2", songname: "Shatter" },
    { slot: "rank3", songname: "Beaming" },
  ];
  const r = scorePicks({ picks, songs: R, slotFacts: null, cfg, format: "standard" });
  check(`ranked 7o (${label}): total is finite`, Number.isFinite(r.total), true);
  check(`ranked 7o (${label}): every row's points are finite`, r.breakdown.every(b => Number.isFinite(b.points)), true);
  check(`ranked 7o (${label}): total`, r.total, expected);
}
// The residual the scorer cannot fix, pinned so it's a known property
// rather than a surprise: a coerced rung is a real ladder position worth 0
// that still counts toward coverage, so a full sheet of hits still earns
// perfect-sheet even though one rung paid nothing. Only save-time
// validation can distinguish that from an admin typing 0 deliberately.
{
  const cfg = { mode: "ranked_choice", ranked: { ladder: [5, "", 3] }, bonuses: { perfect: 7 } };
  const picks = [
    { slot: "rank1", songname: "Laurel" },
    { slot: "rank2", songname: "Shatter" },  // lands on the 0-value rung
    { slot: "rank3", songname: "Beaming" },
  ];
  const r = scorePicks({ picks, songs: R, slotFacts: null, cfg, format: "standard" });
  check("ranked 7o: 0-value rung still counts toward coverage", r.breakdown.filter(b => b.slot === "bonus").length, 1);
  check("ranked 7o: the pick on it hits but pays nothing", [r.breakdown[1].hit, r.breakdown[1].points], [true, 0]);
}

// 7p. Dispatch: a config with no `mode` key keeps today's slot behavior
//     exactly — the "config doesn't opt into the variant" case, same shape
//     resolveConfigSection is tested for above.
{
  const facts = deriveSlotFacts(R, true);
  const picks = [{ slot: "opener", songname: "Silver Steed (My Blue)" }];
  const r = scorePicks({ picks, songs: R, slotFacts: facts, cfg: standardCfg, format: "standard" });
  check("ranked 7p: no mode key -> slot scoring still runs", r.breakdown[0].reason, "opener — exact");
  const viaRanked = scoreRankedPicks({ picks: [{ slot: "rank1", songname: "Laurel" }], songs: R, cfg: rankedCfg });
  check("ranked 7p: scoreRankedPicks callable directly", viaRanked.total, 5);
}

// ===============================================================
// The daily setlist check: setlistCheck.js. Plan:
// docs/setlist_check_plan.md, sections 2 and 5. Every fixture from here on is
// synthetic except P1, P2 and D8, which reuse the Rocking The Docks setlist
// above. None holds a real pick.
// ===============================================================
const cartonRow = (over) => ({ show_id: 900, position: 1, setnumber: "1", settype: "Set", songname: "Alpha Song", isoriginal: 1, footnote: "", transition: ",", ...over });

// M1: the show-id filter keeps only the rows carrying the stored id.
{
  const rows = [
    cartonRow({ position: 2, songname: "Bravo Song" }),
    cartonRow({ position: 1, songname: "Alpha Song" }),
    cartonRow({ show_id: 901, position: 1, songname: "Other Show Song" }),
  ];
  const { songs, matched } = mapSetlistRows({ id: 900 }, rows);
  check("M1 show-id filter: only the matching rows, in position order, matched true",
    [songs.map((s) => [s.position, s.songname]), matched], [[[1, "Alpha Song"], [2, "Bravo Song"]], true]);
  check("M1 the show id is compared as a number", mapSetlistRows({ id: "900" }, rows).matched, true);
  check("M1 the fetched array keeps its own order (the sort is on a copy)", rows.map((r) => r.position), [2, 1, 1]);
}

// M2: the fallback uses every row at the date and reports matched: false.
{
  const rows = [cartonRow({ show_id: 901, position: 1 }), cartonRow({ show_id: 902, position: 2, songname: "Bravo Song" })];
  const { songs, matched } = mapSetlistRows({ id: 999 }, rows);
  check("M2 fallback: every row at the date, matched false, mapped onto the stored show id",
    [songs.map((s) => [s.show_id, s.position]), matched], [[[999, 1], [999, 2]], false]);
  check("M2 zero rows: no songs, matched false", mapSetlistRows({ id: 999 }, []), { songs: [], matched: false });
}

// M3: empty-name rows are dropped; `song` stands in for a missing songname.
{
  const rows = [
    cartonRow({ position: 1, songname: "" }),
    cartonRow({ position: 2, songname: null, song: "Named By Song Field" }),
    cartonRow({ position: 3, songname: null }),
    cartonRow({ position: 4, songname: "Delta Song" }),
  ];
  check("M3 empty-name rows dropped", mapSetlistRows({ id: 900 }, rows).songs.map((s) => s.songname), ["Named By Song Field", "Delta Song"]);
}

// M4: the output field set and order equal what scoreShow stores in
// setlist_songs (the mapping in index.ts as of efb088b).
{
  const rows = [
    cartonRow({ position: "7", setnumber: "e", songname: "Rock &amp; Roll &#039;Tune&#39;", isoriginal: 0,
      footnote: "Tom &amp; Jerry cover", footnotes: ["with &quot;tease&quot;"], transition: " > " }),
    cartonRow({ position: 8, setnumber: 3, settype: "Encore", songname: "Plain Song", isoriginal: null, footnote: null, transition: "" }),
  ];
  const { songs } = mapSetlistRows({ id: 900 }, rows);
  check("M4 field set and order", Object.keys(songs[0]), ["show_id", "position", "setnumber", "is_encore", "songname", "is_cover", "footnote", "segue"]);
  check("M4 values, entities decoded", songs[0], {
    show_id: 900, position: 7, setnumber: "e", is_encore: true, songname: "Rock & Roll 'Tune'", is_cover: true,
    footnote: 'Tom & Jerry cover; with "tease"', segue: true,
  });
  check("M4 encore from settype, setnumber as a string, null isoriginal and no footnote stay null, no arrow is no segue", songs[1], {
    show_id: 900, position: 8, setnumber: "3", is_encore: true, songname: "Plain Song", is_cover: null, footnote: null, segue: false,
  });
  check("M4 &amp; decodes last: no double decode", decodeEntities("&amp;lt;"), "&lt;");
  check("M4 a null passes through decodeEntities", decodeEntities(null), null);
}

// ---------- projection and hash ----------
const setRow = (position, songname, over = {}) => ({ show_id: 1, position, setnumber: "1", is_encore: false, songname, is_cover: false, footnote: null, segue: false, ...over });
const five = [
  setRow(1, "Alpha Song"), setRow(2, "Bravo Song"), setRow(3, "Charlie Song"),
  setRow(4, "Delta Song", { setnumber: "2" }), setRow(5, "Echo Song", { setnumber: "e", is_encore: true }),
];
const edit = (rows, position, over) => rows.map((r) => (r.position === position ? { ...r, ...over } : r));
const insertAt = (rows, position, row) => [
  ...rows.filter((r) => r.position < position), { ...row, position },
  ...rows.filter((r) => r.position >= position).map((r) => ({ ...r, position: r.position + 1 })),
];
const removeAt = (rows, position) => rows.filter((r) => r.position !== position)
  .map((r) => (r.position > position ? { ...r, position: r.position - 1 } : r));
const H5 = await hashSetlist(five);

// P1
{
  const a = await hashSetlist(rockingDocks);
  const b = await hashSetlist(rockingDocks);
  const hex = /^[0-9a-f]{64}$/;
  check("P1 both hashes are 64 lowercase hex, differ from each other, and repeat on a second call",
    [hex.test(a.setlist_hash_scoring), hex.test(a.setlist_hash_full), a.setlist_hash_scoring !== a.setlist_hash_full,
     a.setlist_hash_scoring === b.setlist_hash_scoring, a.setlist_hash_full === b.setlist_hash_full],
    [true, true, true, true, true]);
}

// P2
{
  const a = await hashSetlist(rockingDocks);
  const b = await hashSetlist([...rockingDocks].reverse());
  check("P2 rows in another input order give identical strings and hashes", b, a);
}

// P3: the field order is a tested contract.
const twoRows = [
  setRow(1, "Alpha Song", { segue: true }),
  setRow(2, "Béta's Tune", { setnumber: "e", is_encore: true, is_cover: true, footnote: "First-time cover, debut" }),
];
const P3_SCORING = 'setlist-v1:[[1,"1",false,"alpha song",false,false],[2,"e",true,"beta s tune",true,true]]';
const P3_FULL = 'setlist-v1:[[1,"1",false,"alpha song",false,false,"Alpha Song",true,null],[2,"e",true,"beta s tune",true,true,"Béta\'s Tune",false,"First-time cover, debut"]]';
check("P3 the exact canonical strings, prefix included", projectSetlist(twoRows), { scoring: P3_SCORING, full: P3_FULL });
check("P3 hashSetlist stores those same two strings",
  await hashSetlist(twoRows).then((h) => [h.setlist_projection_scoring, h.setlist_projection_full]), [P3_SCORING, P3_FULL]);
check("P3 hashSetlist returns exactly the four column names",
  Object.keys(await hashSetlist(twoRows)), ["setlist_hash_scoring", "setlist_hash_full", "setlist_projection_scoring", "setlist_projection_full"]);

// P4: each scoring field moves the scoring hash, and with it the full hash.
{
  const variants = {
    setnumber: edit(five, 3, { setnumber: "2" }),
    is_encore: edit(five, 3, { is_encore: true }),
    is_cover: edit(five, 3, { is_cover: true }),
    "footnote gaining Debut": edit(five, 3, { footnote: "Debut" }),
    "a different songname": edit(five, 3, { songname: "Zulu Song" }),
    "a row inserted at 3, later rows shifted": insertAt(five, 3, setRow(0, "New Song")),
  };
  const unmoved = [];
  for (const [name, rows] of Object.entries(variants)) {
    const h = await hashSetlist(rows);
    if (h.setlist_hash_scoring === H5.setlist_hash_scoring) unmoved.push(`${name}: scoring`);
    if (h.setlist_hash_full === H5.setlist_hash_full) unmoved.push(`${name}: full`);
  }
  check("P4 every scoring field moves both hashes (the ones that did not)", unmoved, []);
}

// P5, P6, P7: display facts move the full hash only.
{
  const fullOnly = {
    "P5 a trailing space on a songname": edit(five, 3, { songname: "Charlie Song " }),
    "P6 a segue flip": edit(five, 3, { segue: true }),
    "P7 a footnote change without the word debut": edit(five, 3, { footnote: "with Bravo Song tease" }),
    "P7 a case change": edit(five, 3, { songname: "CHARLIE song" }),
    "P7 a diacritic": edit(five, 3, { songname: "Chárlie Song" }),
    'P7 "FTP" in a footnote does not set has_debut': edit(five, 3, { footnote: "FTP" }),
  };
  for (const [name, rows] of Object.entries(fullOnly)) {
    const h = await hashSetlist(rows);
    check(`${name}: scoring hash unchanged, full hash changed`,
      [h.setlist_hash_scoring === H5.setlist_hash_scoring, h.setlist_hash_full === H5.setlist_hash_full], [true, false]);
  }
}

// P8: the empty setlist. The constant was computed independently of the code
// under test, over the UTF-8 bytes of the empty projection, in PowerShell:
//   ([System.BitConverter]::ToString([System.Security.Cryptography.SHA256]::HashData([System.Text.Encoding]::UTF8.GetBytes('setlist-v1:[]'))) -replace '-','').ToLower()
const EMPTY_SETLIST_SHA256 = "cbb50793a89bdda2c5264ae31fc7e560d5047d45fe0b363a5d76b29b370b5214";
{
  const h = await hashSetlist([]);
  check("P8 both empty strings", [h.setlist_projection_scoring, h.setlist_projection_full], ["setlist-v1:[]", "setlist-v1:[]"]);
  check("P8 both empty hashes equal the pinned constant", [h.setlist_hash_scoring, h.setlist_hash_full], [EMPTY_SETLIST_SHA256, EMPTY_SETLIST_SHA256]);
  const one = await hashSetlist([setRow(1, "Alpha Song")]);
  check("P8 a one-row list differs from the empty one",
    [one.setlist_hash_scoring !== EMPTY_SETLIST_SHA256, one.setlist_hash_full !== EMPTY_SETLIST_SHA256], [true, true]);
}

// P9
{
  const row = { position: 1, setnumber: "1", is_encore: false, songname: "Alpha Song", is_cover: null, footnote: null };
  check("P9 null is_cover and null footnote stay null, an undefined segue becomes false", projectSetlist([row]), {
    scoring: 'setlist-v1:[[1,"1",false,"alpha song",null,false]]',
    full: 'setlist-v1:[[1,"1",false,"alpha song",null,false,"Alpha Song",false,null]]',
  });
}

// P10
check("P10 parseProjection round-trips P3's strings",
  [parseProjection(P3_SCORING), parseProjection(P3_FULL)],
  [JSON.parse(P3_SCORING.slice("setlist-v1:".length)), JSON.parse(P3_FULL.slice("setlist-v1:".length))]);
check("P10 another prefix, an unparsable body, a non-array body and a non-string all give null",
  [parseProjection("setlist-v2:[]"), parseProjection("setlist-v1:[["), parseProjection('setlist-v1:{"a":1}'), parseProjection(null)],
  [null, null, null, null]);

// ---------- diff ----------
const NO_DIFF = { added: [], removed: [], moved: [], changed: [] };
const P5 = projectSetlist(five);
const diffBoth = (rows) => {
  const p = projectSetlist(rows);
  return { scoring: diffProjections(P5.scoring, p.scoring), full: diffProjections(P5.full, p.full) };
};

check("D1 identical: all four lists empty, on both projections",
  [diffProjections(P5.scoring, P5.scoring), diffProjections(P5.full, P5.full)], [NO_DIFF, NO_DIFF]);

{
  const d = diffBoth(insertAt(five, 3, setRow(0, "New Song")));
  check("D2 a row inserted at 3: that one row is added, the shifted rows are not moves",
    d.scoring, { ...NO_DIFF, added: [{ position: 3, song: "new song" }] });
  check("D2 on the full projection the song is the raw name", d.full, { ...NO_DIFF, added: [{ position: 3, song: "New Song" }] });
}

check("D3 one row removed: removed has it, the rest empty",
  diffBoth(removeAt(five, 3)).scoring, { ...NO_DIFF, removed: [{ position: 3, song: "charlie song" }] });

{
  const swapped = five.map((r) => (r.position === 2 ? { ...r, position: 3 } : r.position === 3 ? { ...r, position: 2 } : r));
  const d = diffBoth(swapped).scoring;
  check("D4 two adjacent rows swapped: moved non-empty, added, removed and changed empty",
    [d?.moved.length > 0, d?.added, d?.removed, d?.changed], [true, [], [], []]);
  check("D4 moved says from and to", d?.moved, [{ song: "bravo song", from: 2, to: 3 }]);
}

check("D5 one row's is_cover flipped: changed is exactly that",
  diffBoth(edit(five, 3, { is_cover: true })).scoring,
  { ...NO_DIFF, changed: [{ position: 3, song: "charlie song", field: "is_cover", from: false, to: true }] });

{
  const d = diffBoth(edit(five, 3, { footnote: "Debut" }));
  check("D6 a footnote gaining Debut: has_debut only on the scoring projection",
    d.scoring?.changed.map((c) => [c.position, c.field]), [[3, "has_debut"]]);
  check("D6 has_debut and footnote for the same row on the full projection",
    d.full?.changed.map((c) => [c.position, c.field]), [[3, "has_debut"], [3, "footnote"]]);
}

{
  const d = diffBoth(edit(five, 3, { songname: "Charlie Song " }));
  check("D7 a trailing space: songname only on the full projection",
    d.full, { ...NO_DIFF, changed: [{ position: 3, song: "Charlie Song ", field: "songname", from: "Charlie Song", to: "Charlie Song " }] });
  check("D7 a trailing space: nothing on the scoring projection", d.scoring, NO_DIFF);
}

{
  const baseline = projectSetlist(rockingDocks).scoring;
  // The Rocking The Docks sandwich: Reflections at 6 and at 8.
  const secondGone = diffProjections(baseline, projectSetlist(removeAt(rockingDocks, 8)).scoring);
  check("D8 the sandwich without its second occurrence: exactly that one removed, the other matched",
    secondGone, { ...NO_DIFF, removed: [{ position: 8, song: "reflections" }] });
  const firstGone = diffProjections(baseline, projectSetlist(removeAt(rockingDocks, 6)).scoring);
  check("D8 the sandwich without its first occurrence: exactly one removed, nothing moved",
    [firstGone?.removed.length, firstGone?.removed[0]?.song, firstGone?.moved, firstGone?.added, firstGone?.changed],
    [1, "reflections", [], [], []]);
}

{
  const p = projectSetlist(twoRows);
  check("D9 an empty baseline: everything added",
    diffProjections("setlist-v1:[]", p.scoring),
    { ...NO_DIFF, added: [{ position: 1, song: "alpha song" }, { position: 2, song: "beta s tune" }] });
  check("D9 an unparsable side, either way: null",
    [diffProjections("setlist-v2:[]", p.scoring), diffProjections(p.scoring, "not a projection"), diffProjections(null, p.scoring)],
    [null, null, null]);
}

// ---------- gate ----------
// 2026-11-02 is Eastern Standard Time: 14:00Z is 09:00 ET.
const G_NOW = new Date("2026-11-02T15:00:00Z");
const G_SYNC_TODAY = "2026-11-02T14:00:30Z";
const minutesBefore = (now, m) => new Date(now.getTime() - m * 60_000).toISOString();
check("G1 own gate due, the show sync has not run today: false",
  setlistCheckDue({ ranAt: null, attemptedAt: null, showSyncRanAt: null, now: G_NOW }), false);
check("G2 the show sync ran today, own row never run: true",
  setlistCheckDue({ ranAt: null, attemptedAt: null, showSyncRanAt: G_SYNC_TODAY, now: G_NOW }), true);
check("G3 own row ran today: false",
  setlistCheckDue({ ranAt: "2026-11-02T14:01:00Z", attemptedAt: "2026-11-02T14:00:40Z", showSyncRanAt: G_SYNC_TODAY, now: G_NOW }), false);
check("G4 own attempt 10 minutes ago: false; 31 minutes ago: true",
  [setlistCheckDue({ ranAt: null, attemptedAt: minutesBefore(G_NOW, 10), showSyncRanAt: G_SYNC_TODAY, now: G_NOW }),
   setlistCheckDue({ ranAt: null, attemptedAt: minutesBefore(G_NOW, 31), showSyncRanAt: G_SYNC_TODAY, now: G_NOW })],
  [false, true]);
// 22:30 ET on 11-01 and 09:00 ET on 11-02 share the UTC date 11-02, so a UTC
// comparison would wrongly call the show sync today's.
check("G5 the show sync ran at 22:30 ET yesterday, now 09:00 ET today: false (Eastern date on both sides)",
  setlistCheckDue({ ranAt: null, attemptedAt: null, showSyncRanAt: "2026-11-02T03:30:00Z", now: new Date("2026-11-02T14:00:00Z") }), false);

// ---------- verdict re-derivation ----------
const eSongs = [
  setRow(1, "Alpha Song"), setRow(2, "Bravo Song"), setRow(3, "Charlie Song"),
  setRow(4, "Cover Tune", { is_cover: true, footnote: "Some Artist cover" }),
  setRow(5, "Debut Tune", { footnote: "Debut" }),
  setRow(6, "Echo Song", { setnumber: "e", is_encore: true }),
];
const NO_FLIP = (total_rows) => ({ hit_flips: 0, reason_flips: 0, pairs: [], total_rows });

check("E1 a frozen 'not played' on a flat slot whose song is now at position 3: one hit flip, n carried, bonus rows skipped",
  rederiveVerdicts({
    rows: [
      { bracket_id: 2, slot: "flat2", songname: "Charlie Song", hit: false, reason: "not played", n: 2 },
      { bracket_id: 2, slot: "bonus", songname: "Perfect", hit: true, reason: "every pick hit", n: 1 },
    ],
    songs: eSongs, format: "standard",
  }),
  { 2: { hit_flips: 1, reason_flips: 0,
    pairs: [{ slot: "flat2", song: "Charlie Song", from: { hit: false, reason: "not played" }, to: { hit: true, reason: "played" }, n: 2 }],
    total_rows: 2 } });

check("E2 cover1 against a cover: unchanged",
  rederiveVerdicts({ rows: [{ bracket_id: 1, slot: "cover1", songname: "Cover Tune", hit: true, reason: "cover played", n: 1 }], songs: eSongs, format: "standard" }),
  { 1: NO_FLIP(1) });

check("E3 rank rows use ranked mode: hit from the played set, no slot reasoning",
  rederiveVerdicts({
    rows: [
      { bracket_id: 2, slot: "rank3", songname: "Bravo Song", hit: true, reason: "played", n: 1 },
      { bracket_id: 2, slot: "rank4", songname: "Not In This Show", hit: false, reason: "not played", n: 3 },
    ],
    songs: eSongs, format: "standard",
  }),
  { 2: NO_FLIP(4) });

check("E4 a suffix only: +debut, +cover and no partial credit are stripped, and the rows they split merge",
  rederiveVerdicts({
    rows: [
      { bracket_id: 1, slot: "flat1", songname: "Debut Tune", hit: true, reason: "played +debut", n: 1 },
      { bracket_id: 1, slot: "flat1", songname: "Debut Tune", hit: true, reason: "played", n: 2 },
      { bracket_id: 1, slot: "flat3", songname: "Cover Tune", hit: true, reason: "played +cover +debut", n: 1 },
      { bracket_id: 1, slot: "opener", songname: "Bravo Song", hit: true, reason: "played, wrong slot (no partial credit)", n: 1 },
    ],
    songs: eSongs, format: "standard",
  }),
  { 1: NO_FLIP(5) });

{
  const shared = { slot: "flat1", songname: "Charlie Song", n: 1 };
  const out = rederiveVerdicts({
    rows: [{ ...shared, bracket_id: 1, hit: true, reason: "played" }, { ...shared, bracket_id: 2, hit: false, reason: "not played" }],
    songs: eSongs, format: "standard",
  });
  check("E5 two brackets' rows are kept apart", [out[1].hit_flips, out[2].hit_flips, Object.keys(out)], [0, 1, ["1", "2"]]);
}

{
  const out = rederiveVerdicts({
    rows: [{ bracket_id: 1, slot: "flat1", songname: "Charlie Song", hit: false, reason: "not played", n: 1,
      player_id: "00000000-0000-0000-0000-000000000000", player_name: "someone" }],
    songs: eSongs, format: "standard",
  });
  const text = JSON.stringify(out);
  check("E6 an extra player field on a row is not echoed", [/player/i.test(text), text.includes("00000000"), text.includes("someone"), out[1].hit_flips], [false, false, false, 1]);
}

{
  // The frozen verdicts of a real pass against eSongs, in two brackets.
  const frozen = [
    { bracket_id: 1, slot: "opener", songname: "Alpha Song", hit: true, reason: "opener — exact", n: 1 },
    { bracket_id: 1, slot: "flat1", songname: "Charlie Song", hit: true, reason: "played", n: 2 },
    { bracket_id: 2, slot: "rank1", songname: "Bravo Song", hit: true, reason: "played", n: 2 },
  ];
  const sameShow = eSongs.map((s) => ({ ...s, show_id: 777 }));
  const sameOut = rederiveVerdicts({ rows: frozen, songs: sameShow, format: "standard" });
  check("E7 fallback rows that are the same show under a new id: zero flips in every bracket",
    [sameOut[1].hit_flips + sameOut[1].reason_flips, sameOut[2].hit_flips + sameOut[2].reason_flips], [0, 0]);
  const otherShow = [setRow(1, "Zulu Song"), setRow(2, "Yankee Song")];
  const otherOut = rederiveVerdicts({ rows: frozen, songs: otherShow, format: "standard" });
  check("E7 another show's setlist on the stored date: flips in every bracket", [otherOut[1].hit_flips > 0, otherOut[2].hit_flips > 0], [true, true]);
}

// ---------------------------------------------------------------
// Deploy A, the final pass (docs/setlist_check_plan.md section 3). F is the one
// update a final pass makes, B is what scoreShow returns, W is the wiring. The
// helpers prove nothing unless index.ts calls them, and index.ts cannot run here,
// so W reads its text; deno check and the rehearsal cover what text cannot.
{
  const FOUR = ["setlist_hash_scoring", "setlist_hash_full", "setlist_projection_scoring", "setlist_projection_full"];
  const finalSongs = [
    { position: 1, setnumber: "1", is_encore: false, songname: "Alpha Song", is_cover: false, footnote: null, segue: false },
    { position: 2, setnumber: "1", is_encore: false, songname: "Bravo Song", is_cover: null, footnote: null, segue: true },
  ];
  const hashed = await hashSetlist(finalSongs);

  // Explicit nulls, not absent keys: an absent key is what leaves an old baseline
  // in the row, so each key has to exist and hold null.
  const nullShape = (patch) => [
    patch.status,
    FOUR.map((k) => Object.hasOwn(patch, k)),
    FOUR.map((k) => patch[k]),
    Object.keys(patch).length,
  ];
  const NULLS = ["final", [true, true, true, true], [null, null, null, null], 5];

  check("F1 baseline present: status plus the four values", finalUpdatePatch({ show: 1, baseline: hashed }), { status: "final", ...hashed });
  check("F1 the four values are text, not nulls", FOUR.map((k) => typeof finalUpdatePatch({ baseline: hashed })[k]), ["string", "string", "string", "string"]);
  check("F2 baseline null, the fallback: four explicit nulls", nullShape(finalUpdatePatch({ show: 1, songs: 2, baseline: null })), NULLS);
  check("F3 res null, scoreShow threw: four explicit nulls", nullShape(finalUpdatePatch(null)), NULLS);
  check("F4 early return, no setlist yet: four explicit nulls", nullShape(finalUpdatePatch({ show: 1, note: "no setlist yet" })), NULLS);
  check("F4 early return, empty setlist: four explicit nulls", nullShape(finalUpdatePatch({ show: 1, note: "empty setlist" })), NULLS);
  check("F5 both branches name the columns hashSetlist fills", [Object.keys(finalUpdatePatch(null)), Object.keys(finalUpdatePatch({ baseline: hashed }))],
    [["status", ...Object.keys(hashed)], ["status", ...Object.keys(hashed)]]);

  // settle turns a rejection into a value, so a mutation fails a named check here
  // and does not crash the file.
  const settle = (p) => p.then((v) => v, () => "rejected");
  const result = { show: 1, songs: 2, new: 0, brackets: [] };
  for (const matched of [true, false]) {
    const out = await settle(withFinalBaseline(result, { isFinal: false, matched, songs: finalSongs }));
    check(`B1 not final, matched ${matched}: the same result, no baseline key`, [out === result, Object.hasOwn(out, "baseline")], [true, false]);
    // songs: null throws if anything hashes it, so a cron tick is proven not to hash.
    const noHash = await settle(withFinalBaseline(result, { isFinal: false, matched, songs: null }));
    check(`B1 not final, matched ${matched}: nothing is hashed`, noHash === result, true);
  }
  const good = await settle(withFinalBaseline(result, { isFinal: true, matched: true, songs: finalSongs }));
  check("B2 final and matched: the result plus the four values", good, { ...result, baseline: hashed });
  const fallback = await settle(withFinalBaseline(result, { isFinal: true, matched: false, songs: finalSongs }));
  check("B3 final, not matched: the result plus baseline null, key present", [Object.hasOwn(fallback, "baseline"), fallback.baseline, fallback.show], [true, null, 1]);
  const fallbackNoHash = await settle(withFinalBaseline(result, { isFinal: true, matched: false, songs: null }));
  check("B3 final, not matched: nothing is hashed", fallbackNoHash === "rejected", false);
  check("B4 a hash failure rejects, for the caller's catch", await settle(withFinalBaseline(result, { isFinal: true, matched: true, songs: null })), "rejected");
  check("B5 matched, through to the update: the four values", finalUpdatePatch(good), { status: "final", ...hashed });
  check("B5 fallback, through to the update: four nulls", nullShape(finalUpdatePatch(fallback)), NULLS);
  const caught = await withFinalBaseline(result, { isFinal: true, matched: true, songs: null }).catch(() => null);
  check("B5 hash failure, through the catch to the update: four nulls", nullShape(finalUpdatePatch(caught)), NULLS);

  const ix = readFileSync(new URL("../supabase/functions/carton-sync/index.ts", import.meta.url), "utf8");
  const occurs = (needle) => ix.split(needle).length - 1;
  check("W1 no status literal bypasses the patch", occurs('status: "final"'), 0);
  check("W1 both final updates go through the patch", occurs(".update(finalUpdatePatch(res))"), 2);
  check("W2 both final passes catch to null", [occurs(", true).catch(() => null)"), occurs(", true).catch(() => {})")], [2, 0]);
  check("W3 scoreShow returns through the helper", [occurs("return withFinalBaseline("), occurs("{ isFinal, matched, songs }"), occurs("return { show: show.id, songs: songs.length")], [1, 1, 0]);
  check("W4 the cron path passes no final flag", occurs("scoreShow(showRows[0].show, showRows)"), 1);
  check("W5 scoreShow has its definition and exactly three callers", occurs("scoreShow("), 4);
  check("W6 one definition of the mapping and of decodeEntities", [occurs("mapSetlistRows(show, rows)"), occurs("function decodeEntities"), occurs("const mine ="), occurs(".filter((s: any) => s.songname)")], [1, 0, 0, 0]);
  check("W7 the import names all five (mapSongRows joined 2026-11-07, the songs_cache dedupe)", occurs('import { decodeEntities, mapSetlistRows, mapSongRows, finalUpdatePatch, withFinalBaseline } from "./setlistCheck.js";'), 1);
  check("W8 the fallback warning fires on a final pass only", occurs("if (isFinal && !matched) console.warn("), 1);
  check("W9 both final updates log their error", occurs("if (error) console.error(`final update failed:"), 2);
}

// ---------------------------------------------------------------
if (failures.length) {
  console.log(`FAIL — ${failures.length} check(s):`);
  for (const f of failures) console.log("  " + f.replace(/\n/g, "\n  "));
  process.exit(1);
} else {
  console.log("PASS — all scoring.js and setlistCheck.js checks passed.");
  process.exit(0);
}
