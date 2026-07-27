// Fixture-based unit tests for the pure scoring module (supabase/functions/
// carton-sync/scoring.js). Runs under plain Node — no Deno, no Supabase, no
// network. Fixtures are real setlists pulled from The Carton's API so the
// sandwich/replay scenarios are grounded in shows that actually happened,
// not invented data.
//
//   node test/scoring.test.mjs

import { deriveSlotFacts, resolveConfigSection, scorePicks } from "../supabase/functions/carton-sync/scoring.js";

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
// Fixture: GratefulFest, Garrettsville OH — 2026-07-24 (one-set festival)
// https://thecarton.net/setlists/eggy-july-24-2026-gratefulfest-garrettsville-oh-usa.html
// Real one-set show; also has its own sandwich (Shatter wraps Smile) and
// ends on the second Shatter, so "closer" resolves to it.
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
// wrong-slot-then-right-slot replay that isn't the same song/slot as the
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
// 1. Sandwich / best-result-across-replays upgrade path
//    Reflections > Shatter > Reflections (Rocking The Docks, Set 1 Closer)
// =================================================================
{
  const picks = [{ slot: "set1_closer", songname: "Reflections" }];

  // Pass 1: only positions 1–7 known (set 1 not over yet — Shatter is the
  // most recent song). A "Set 1 Closer" pick of Reflections has been played
  // (position 6) but isn't the current end of set 1, so it's a wrong-slot
  // partial, not a miss.
  const partial = rockingDocks.slice(0, 7);
  const factsPass1 = deriveSlotFacts(partial);
  const pass1 = scorePicks({ picks, songs: partial, slotFacts: factsPass1, cfg: standardCfg, format: "standard", prevBreakdown: null });
  check("sandwich pass 1: hit", pass1.breakdown[0].hit, true);
  check("sandwich pass 1: partial points", pass1.breakdown[0].points, 1);
  // set1_closer's "impossible" flag is keyed on set1 being empty (correct —
  // it mirrors set2_opener's own set2-empty check for the OTHER set), not on
  // whether set 2 has started. Set 1 is non-empty here, so this is the
  // ordinary "played, wrong slot" wording, not "slot not played".
  check("sandwich pass 1: reason", pass1.breakdown[0].reason, "played, wrong slot");

  // Pass 2: full set 1 (through position 8) — Reflections reprises and IS
  // now the true Set 1 Closer. Merging against pass 1's breakdown must
  // upgrade the partial to the full slot value, not add to it.
  const full = rockingDocks.slice(0, 8);
  const factsPass2 = deriveSlotFacts(full);
  const pass2 = scorePicks({ picks, songs: full, slotFacts: factsPass2, cfg: standardCfg, format: "standard", prevBreakdown: pass1.breakdown });
  check("sandwich pass 2: hit", pass2.breakdown[0].hit, true);
  check("sandwich pass 2: upgraded to full slot value (not additive)", pass2.breakdown[0].points, 2);
  check("sandwich pass 2: reason", pass2.breakdown[0].reason, "set1_closer — exact");
}

// =================================================================
// 2. Best-result never downgrades, even if a later pass's fresh
//    computation alone would be worse (adversarial, not narrative).
// =================================================================
{
  const picks = [{ slot: "closer", songname: "Shatter" }];
  const full = rockingDocks.slice(0, 8); // Shatter is mid-set-1 here, not the closer — a fresh miss/partial
  const facts = deriveSlotFacts(full);
  const fakeBetterPrev = [{ slot: "closer", songname: "Shatter", hit: true, points: 2, reason: "closer — exact" }];
  const merged = scorePicks({ picks, songs: full, slotFacts: facts, cfg: standardCfg, format: "standard", prevBreakdown: fakeBetterPrev });
  check("never-downgrade: keeps the higher previous result", merged.breakdown[0].points, 2);
  check("never-downgrade: keeps hit=true", merged.breakdown[0].hit, true);
}

// =================================================================
// 3. One-set/festival show — config section resolution
// =================================================================
{
  const facts = deriveSlotFacts(gratefulFest);
  const picks = [
    { slot: "opener", songname: "Woah There" },
    { slot: "closer", songname: "Shatter" }, // resolves via cfg.oneset, not cfg.slots
    { slot: "cover1", songname: "Time Loves A Hero" },
  ];
  const result = scorePicks({ picks, songs: gratefulFest, slotFacts: facts, cfg: oneSetCapableCfg, format: "one_set", prevBreakdown: null });
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
//    song/slot as the sandwich above) — Shadow/Encore, Levitt Pavilion
// =================================================================
{
  const picks = [{ slot: "encore", songname: "Shadow" }];

  // Pass 1: Shadow has just opened set 2 (position 10) — played, but no
  // encore has happened yet.
  const partial = levittPavilion.slice(0, 10);
  const factsPass1 = deriveSlotFacts(partial);
  const pass1 = scorePicks({ picks, songs: partial, slotFacts: factsPass1, cfg: standardCfg, format: "standard", prevBreakdown: null });
  check("wrong-then-right pass 1: hit (played, not yet encore)", pass1.breakdown[0].hit, true);
  check("wrong-then-right pass 1: partial only", pass1.breakdown[0].points, 1);

  // Pass 2: full show — Shadow reprises in the actual encore.
  const factsPass2 = deriveSlotFacts(levittPavilion);
  const pass2 = scorePicks({ picks, songs: levittPavilion, slotFacts: factsPass2, cfg: standardCfg, format: "standard", prevBreakdown: pass1.breakdown });
  check("wrong-then-right pass 2: upgraded to full encore value", pass2.breakdown[0].points, 2);
  check("wrong-then-right pass 2: reason", pass2.breakdown[0].reason, "encore — exact");
}

// =================================================================
// 5. Encore vs. show-closer distinction — Smile vs. Shadow, Levitt Pavilion
//    Smile is in the encore but isn't last; Shadow is both.
// =================================================================
{
  const facts = deriveSlotFacts(levittPavilion);

  const smilePicks = [
    { slot: "encore", songname: "Smile" },
    { slot: "show_closer", songname: "Smile" },
  ];
  const smile = scorePicks({ picks: smilePicks, songs: levittPavilion, slotFacts: facts, cfg: standardCfg, format: "standard", prevBreakdown: null });
  check("Smile → Encore: exact hit", [smile.breakdown[0].hit, smile.breakdown[0].points], [true, 2]);
  check("Smile → Show Closer: played but wrong slot (Shadow closes, not Smile)", [smile.breakdown[1].hit, smile.breakdown[1].points, smile.breakdown[1].reason], [true, 1, "played, wrong slot"]);

  const shadowPicks = [
    { slot: "encore", songname: "Shadow" },
    { slot: "show_closer", songname: "Shadow" },
  ];
  const shadow = scorePicks({ picks: shadowPicks, songs: levittPavilion, slotFacts: facts, cfg: standardCfg, format: "standard", prevBreakdown: null });
  check("Shadow → Encore: exact hit", [shadow.breakdown[0].hit, shadow.breakdown[0].points], [true, 2]);
  check("Shadow → Show Closer: also an exact hit (it's the literal last song)", [shadow.breakdown[1].hit, shadow.breakdown[1].points], [true, 3]);
}

// =================================================================
// 6. A pick that never plays
// =================================================================
{
  const facts = deriveSlotFacts(levittPavilion);
  const picks = [{ slot: "opener", songname: "Distraction" }]; // not in this setlist at all
  const result = scorePicks({ picks, songs: levittPavilion, slotFacts: facts, cfg: standardCfg, format: "standard", prevBreakdown: null });
  check("never played: miss", [result.breakdown[0].hit, result.breakdown[0].points, result.breakdown[0].reason], [false, 0, "not played"]);
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
