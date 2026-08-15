// Fixture-based unit tests for the pure scoring module (supabase/functions/
// carton-sync/scoring.js). Runs under plain Node — no Deno, no Supabase, no
// network. Fixtures are real setlists pulled from The Carton's API so the
// sandwich/closer-determinacy scenarios are grounded in shows that actually
// happened, not invented data.
//
//   node test/scoring.test.mjs

import { deriveSlotFacts, resolveConfigSection, scorePicks, scoreRankedPicks } from "../supabase/functions/carton-sync/scoring.js";

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

// ---------------------------------------------------------------
if (failures.length) {
  console.log(`FAIL — ${failures.length} check(s):`);
  for (const f of failures) console.log("  " + f.replace(/\n/g, "\n  "));
  process.exit(1);
} else {
  console.log("PASS — all scoring.js fixture checks passed.");
  process.exit(0);
}
