// Pure scoring logic for Fantasy Eggy — no Deno, no Supabase, no network I/O.
// Takes plain data (a show's setlist, a bracket's config, a player's picks)
// and returns a scored breakdown. The Deno edge function (index.ts) imports
// this file for the actual scoring and handles only I/O; test/scoring.test.mjs
// imports the same file under plain Node to unit-test the logic in isolation.

export const norm = (s) =>
  (s || "").toLowerCase().normalize("NFKD").replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]+/g, " ").trim();

// Derive the show-level structural facts every bracket's scoring shares:
// which song is the opener/closer/etc, which songs were played at all, which
// slots don't structurally exist in this show's shape (e.g. no set 2 at a
// one-setter) — and, the part that matters for a show still in progress,
// which of the positional closer-family facts can actually be trusted yet.
// `songs` must already be sorted by position. `isFinal` should be true only
// for the scoring pass that runs as part of a show finalizing (manual or
// auto) — it's the fallback signal for the one slot with no earlier
// structural tell. Computed once per show and reused for every player/
// bracket that scores it.
export function deriveSlotFacts(songs, isFinal = false) {
  const nonEncore = songs.filter((s) => !s.is_encore);
  const encore = songs.filter((s) => s.is_encore);
  // group non-encore songs into sets by first-seen setnumber (naming-agnostic)
  const setOrder = [];
  const setGroups = {};
  for (const s of nonEncore) {
    if (!(s.setnumber in setGroups)) { setGroups[s.setnumber] = []; setOrder.push(s.setnumber); }
    setGroups[s.setnumber].push(s);
  }
  const set1 = setGroups[setOrder[0]] ?? [];
  const set2 = setGroups[setOrder[1]] ?? [];
  const opener = nonEncore[0]?.songname ?? songs[0]?.songname ?? null;
  const closer = nonEncore.length ? nonEncore[nonEncore.length - 1].songname : null;
  const encoreSet = new Set(encore.map((s) => norm(s.songname)));
  const played = new Set(songs.map((s) => norm(s.songname)));
  const eq = (a, b) => b != null && norm(a) === norm(b);
  const slotSong = {
    opener:      (p) => eq(p, opener),
    set1_closer: (p) => eq(p, set1.length ? set1[set1.length - 1].songname : null),
    set2_opener: (p) => eq(p, set2.length ? set2[0].songname : null),
    closer:      (p) => eq(p, closer), // "Set 2 Closer" is the display label; the slot key stays `closer`
    encore:      (p) => encoreSet.has(norm(p)),
    show_closer: (p) => songs.length > 0 && eq(p, songs[songs.length - 1].songname),
    second_song: (p) => songs.length > 1 && eq(p, songs[1].songname),
    cover_call:  (p) => songs.some((s) => s.is_cover === true && norm(s.songname) === norm(p)),
    debut_call:  (p) => songs.some((s) => /debut/i.test(s.footnote ?? "") && norm(s.songname) === norm(p)),
  };
  // slots whose target doesn't exist in this show's structure (e.g. set 2 at a one-setter)
  const slotImpossible = {
    set2_opener: set2.length === 0,
    set1_closer: set1.length === 0,
    encore: encore.length === 0,
    second_song: songs.length < 2,
    cover_call: !songs.some((s) => s.is_cover === true),
    debut_call: !songs.some((s) => /debut/i.test(s.footnote ?? "")),
  };
  // Positional slots (Set 1 Closer / Set 2 Closer / Show Closer) can't be
  // trusted from an in-progress setlist alone — "the last song so far" keeps
  // changing as the show goes on, and a scoring pass that trusted it anyway
  // is what let a mid-show snapshot's guess freeze in permanently (the
  // Boston 7/31/2026 incident — Shatter scored "closer — exact" from a
  // 5-song snapshot, then never got corrected once Voice of Them All turned
  // out to actually close the set). Each slot becomes determined the moment
  // there's real structural evidence the relevant set/show is over, which is
  // well before finalize in the common case:
  //   - Set 1 Closer: the instant anything plays after set 1 — a set 2 song,
  //     or (if the show turns out to skip set 2 entirely) the encore
  //     starting.
  //   - Set 2 Closer ("closer"): the instant the encore starts — a second
  //     encore break doesn't change who closed out the last set.
  //   - Show Closer: no reliable in-show signal exists (another encore break
  //     is always possible until the show is actually over) — this one only
  //     ever resolves at finalize.
  // `isFinal` is the fallback for the rarer case where no early signal ever
  // fires (e.g. a show that plays no encore at all) — the finalize pass is
  // always taken as ground truth once it runs.
  const slotDetermined = {
    set1_closer: set2.length > 0 || encore.length > 0 || isFinal,
    closer: encore.length > 0 || isFinal,
    show_closer: isFinal,
  };
  const anyDebut = songs.some((s) => /debut/i.test(s.footnote ?? ""));
  return { set1, set2, encore, opener, closer, encoreSet, played, slotSong, slotImpossible, slotDetermined, anyDebut };
}

// Which config section applies — the standard slots, or `cfg.oneset` for a
// one-set/festival show (falls back to the standard section if the bracket
// never configured a oneset section).
export function resolveConfigSection(cfg, format) {
  return (format === "one_set" && cfg.oneset) ? cfg.oneset : cfg;
}

// Ranked-choice scoring: N picks against a fixed descending point ladder
// (`cfg.ranked.ladder`, e.g. [5,4,3,2,1]). A pick either got played or it
// didn't — there is no positional matching, so none of deriveSlotFacts'
// output is consulted here beyond "was this song played at all," and this
// function deliberately takes no `slotFacts`/`format` parameter to make
// that structural rather than a convention.
//
// Written as a separate function rather than a branch inside scorePicks
// for one specific reason: cover bonuses, debut bonuses, and the Any Debut
// wildcard must not apply in this mode. Those reward obscurity, which is a
// second risk axis competing with the only question ranked choice asks —
// how confident is the player in this song. Keeping them out by *having no
// code path that applies them* is enforceable; keeping them out with an
// `if` inside the slot loop is a convention that a later edit can quietly
// undo. Perfect-sheet is the single bonus that carries over, because it
// scores the whole sheet being right rather than any one song's rarity.
//
// Row count never varies by show format here. Slot mode splits on format
// because its slots name set structure ("Set 2 Closer") that a one-set
// show doesn't have; a ladder position names nothing structural, so
// `cfg.ranked` is read from the top level and never through
// resolveConfigSection's oneset branch.
export function scoreRankedPicks({ picks, songs, cfg }) {
  // A non-finite rung is coerced to 0 rather than trusted. `.map(Number)`
  // alone turns "abc" (or undefined) into NaN, and a single NaN rung makes
  // the pick that lands on it score NaN, which propagates into `total`,
  // gets written to scores.points, and then poisons every standings sum
  // for that player for the rest of the season — a far worse failure than
  // a rung that pays nothing. Blank and null already coerce to 0 on their
  // own; this only adds the NaN cases.
  //
  // This lives in the scorer even though save-time validation is the right
  // PRIMARY defense, because today it's the only layer that can exist:
  // brackets.config is schemaless jsonb, admin_update_config writes
  // whatever JSON it's handed, and readLadder() (which will scrape DOM
  // input values — strings) isn't built yet. Nothing between an admin's
  // keystroke and this function currently checks anything.
  //
  // Residual this deliberately cannot fix: a coerced-to-0 rung is
  // indistinguishable from an admin who typed 0 on purpose, and either way
  // it stays a real ladder position that counts toward perfect-sheet
  // coverage while paying nothing. Only save-time validation can tell those
  // apart — see the readLadder() requirements in
  // docs/module_b_ranked_choice_plan.md. Coercing to 0 rather than dropping
  // the rung is also deliberate: dropping would shorten the ladder and
  // silently renumber every position beneath it.
  //
  // NOT DEAD CODE, despite the admin UI no longer being able to produce a
  // non-finite rung: the ladder editor's inputs are type="number", which
  // coerces unparseable content to "" before it is ever read, and
  // readLadder() now rejects empty rows outright. This coercion defends the
  // other way in — a hand-crafted RPC call, since admin_update_config takes
  // arbitrary JSON with no schema validation, or a config written before
  // that validation existed. Reaching a NaN here would put a NaN in
  // scores.points and poison every standings sum for that player, so the
  // floor stays regardless of what the UI can or can't emit.
  const ladder = (cfg.ranked?.ladder ?? []).map((v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  });
  const played = new Set(songs.map((s) => norm(s.songname)));

  // ONE definition of "which ladder position is this slot," used for
  // scoring, for coverage, and for the hit test alike. An earlier draft
  // derived the index by string surgery (`Number(slot.replace("rank",""))`)
  // while testing membership by exact match, which are two different
  // notions that disagree on real input: `picks.slot` is plain text with no
  // enum behind it, so `"rank02"` parsed to index 1 and scored 4 points
  // while failing an exact-match test — earning points without
  // participating in either the coverage or hit check. (`" rank2"` slipped
  // through the same way, since Number() tolerates leading whitespace.)
  // Deriving the index from the canonical list removes the third state: a
  // slot either IS a ladder position — scoring its value and counting
  // toward both tests — or it isn't, and scores 0 in every sense.
  const expectedSlots = ladder.map((_, i) => "rank" + (i + 1));
  const rankIndex = (slot) => expectedSlots.indexOf(String(slot));

  const breakdown = picks.map((p) => {
    const value = ladder[rankIndex(p.slot)] ?? 0; // -1 indexes to undefined -> 0
    const hit = played.has(norm(p.songname));
    return {
      slot: p.slot, songname: p.songname, hit,
      points: hit ? value : 0,
      reason: hit ? "played" : "not played",
    };
  });

  // Perfect-sheet gates on which distinct ladder POSITIONS are covered, not
  // on how many picks were submitted. `picks.length === ladder.length` looks
  // equivalent and isn't: several rows that don't actually cover every
  // position (a duplicated slot key, a stale row from a longer ladder) can
  // satisfy a count while a real rank sits unfilled. Coverage is the
  // condition; count is only correlated with it.
  //
  // The hit check is scoped to the ladder's own positions for the mirror
  // reason: a pick outside the current ladder (a "rank7" row left over from
  // before the ladder was shortened) must not block an otherwise-complete,
  // all-hit sheet just by existing unplayed. Such rows still appear in the
  // breakdown, scoring 0; they simply don't participate in either test.
  const inLadder = breakdown.filter((b) => rankIndex(b.slot) >= 0);
  const filledSlots = new Set(inLadder.map((b) => b.slot));
  const complete = expectedSlots.length > 0 && expectedSlots.every((k) => filledSlots.has(k));
  const perf = Number((cfg.bonuses ?? {}).perfect ?? 0);
  if (perf > 0 && complete && inLadder.every((x) => x.hit)) {
    breakdown.push({ slot: "bonus", songname: "Perfect sheet", hit: true, points: perf, reason: "every pick hit" });
  }
  const total = breakdown.reduce((sum, b) => sum + b.points, 0);
  return { breakdown, total };
}

// Score one player's picks against one show, given the bracket's config.
// Always scores fresh off the current setlist snapshot — a live show only
// ever grows its setlist_songs rows (a genuine undo goes through reopen,
// which wipes scores and starts clean), so a fresh pass is monotonically at
// least as informed as the last one and never needs to be reconciled against
// a previously-stored result. The one thing a fresh pass can't safely claim
// on its own is a Set 1/Set 2/Show Closer match while that slot is still not
// `slotDetermined` (see deriveSlotFacts) — those get consolation credit (if
// the bracket has partial credit on) and an honest "undetermined" label
// instead of a premature exact/wrong-slot verdict, then get scored for real
// the moment (or pass) the slot becomes determined.
export function scorePicks({ picks, songs, slotFacts, cfg, format }) {
  // Mode dispatch happens before anything slot-related is computed, so a
  // ranked bracket never reaches the slot/flat logic, the Any Debut branch,
  // or the cover/debut bonus block below. A config with no `mode` key is
  // slot mode, which is what every existing bracket has — no migration.
  if (cfg.mode === "ranked_choice") return scoreRankedPicks({ picks, songs, cfg });
  const sect = resolveConfigSection(cfg, format);
  const flatPts = Number(sect.flat_points ?? cfg.flat_points ?? 1);
  const slotPoints = {};
  const slotType = {};
  for (const s of sect.slots ?? []) {
    slotPoints[s.key] = Number(s.points ?? 2);
    slotType[s.key] = s.type ?? s.key;
  }
  const { played, slotSong, slotImpossible, slotDetermined, anyDebut } = slotFacts;

  const breakdown = [];
  for (const p of picks) {
    let pts = 0, hit = false, reason = "not played";
    const isSlot = p.slot in slotPoints;
    if (norm(p.songname) === "any debut") {
      if (anyDebut) { pts = isSlot ? slotPoints[p.slot] : flatPts; hit = true; reason = "a debut was played"; }
      else reason = "no debut this show";
      breakdown.push({ slot: p.slot, songname: p.songname, hit, points: pts, reason });
      continue;
    }
    const stype = slotType[p.slot] ?? p.slot;
    const determined = slotDetermined[stype] ?? true;
    const playedIt = played.has(norm(p.songname));

    if (isSlot && !determined && playedIt) {
      // Played, but this positional slot can't be confirmed yet — consolation
      // credit (if enabled), not a verdict either way.
      hit = true;
      if (cfg.partial_credit) { pts = Number(cfg.partial_points ?? 1); reason = "played — slot undetermined"; }
      else reason = "played — slot undetermined (no partial credit yet)";
    } else {
      const exactHit = stype === "cover_pick"
        ? songs.some((x) => x.is_cover === true && norm(x.songname) === norm(p.songname))
        : slotSong[stype]?.(p.songname);
      if (isSlot && exactHit) {
        pts = slotPoints[p.slot]; hit = true;
        reason = stype === "cover_pick" ? "cover played" : `${stype} — exact`;
      } else if (playedIt) {
        hit = true;
        if (isSlot) {
          const why = slotImpossible[stype] ? "slot not played"
            : stype === "cover_pick" ? "played, but it's an original" : "played, wrong slot";
          if (cfg.partial_credit) { pts = Number(cfg.partial_points ?? 1); reason = why; }
          else reason = why + " (no partial credit)";
        } else { pts = flatPts; reason = "played"; }
      }
    }
    if (hit && pts > 0) {
      const row = songs.find((s) => norm(s.songname) === norm(p.songname));
      const b = cfg.bonuses ?? {};
      if (row?.is_cover && Number(b.cover)) { pts += Number(b.cover); reason += " +cover"; }
      if (/debut/i.test(row?.footnote ?? "") && Number(b.debut)) { pts += Number(b.debut); reason += " +debut"; }
    }
    breakdown.push({ slot: p.slot, songname: p.songname, hit, points: pts, reason });
  }

  const expected = (sect.slots?.length ?? 0) + Number(sect.flat_picks ?? 0);
  const perf = Number((cfg.bonuses ?? {}).perfect ?? 0);
  if (perf > 0 && expected > 0 && picks.length === expected && breakdown.every((x) => x.hit)) {
    breakdown.push({ slot: "bonus", songname: "Perfect sheet", hit: true, points: perf, reason: "every pick hit" });
  }
  const total = breakdown.reduce((sum, b) => sum + b.points, 0);
  return { breakdown, total };
}
