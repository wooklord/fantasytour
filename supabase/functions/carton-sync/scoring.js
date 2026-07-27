// Pure scoring logic for Fantasy Eggy — no Deno, no Supabase, no network I/O.
// Takes plain data (a show's setlist, a bracket's config, a player's picks,
// that player's previous breakdown) and returns a scored breakdown. The Deno
// edge function (index.ts) imports this file for the actual scoring and
// handles only I/O; test/scoring.test.mjs imports the same file under plain
// Node to unit-test the logic in isolation.

export const norm = (s) =>
  (s || "").toLowerCase().normalize("NFKD").replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]+/g, " ").trim();

// Derive the show-level structural facts every bracket's scoring shares:
// which song is the opener/closer/etc, which songs were played at all, and
// which slots don't even exist in this show's shape (e.g. no set 2 at a
// one-setter). `songs` must already be sorted by position. Computed once per
// show and reused for every player/bracket that scores it.
export function deriveSlotFacts(songs) {
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
  const anyDebut = songs.some((s) => /debut/i.test(s.footnote ?? ""));
  return { set1, set2, encore, opener, closer, encoreSet, played, slotSong, slotImpossible, anyDebut };
}

// Which config section applies — the standard slots, or `cfg.oneset` for a
// one-set/festival show (falls back to the standard section if the bracket
// never configured a oneset section).
export function resolveConfigSection(cfg, format) {
  return (format === "one_set" && cfg.oneset) ? cfg.oneset : cfg;
}

// Score one player's picks against one show, given the bracket's config and
// (optionally) that player's previously-recorded breakdown for the same show.
//
// Best-result-across-replays: a live show gets scored multiple times as the
// setlist grows, and the derived slot targets above can shift between
// passes. This never lets a pick's recorded result get worse: for each slot
// it keeps whichever of {previous, fresh} has the higher points. That's what
// upgrades a wrong-slot partial to a full slot-match on a later replay
// (fresh > old) and what stops a later, still-incomplete pass from undoing
// an earlier correct match (old > fresh). Finalize just stops calling this,
// freezing whatever's best at that point.
export function scorePicks({ picks, songs, slotFacts, cfg, format, prevBreakdown }) {
  const sect = resolveConfigSection(cfg, format);
  const flatPts = Number(sect.flat_points ?? cfg.flat_points ?? 1);
  const slotPoints = {};
  const slotType = {};
  for (const s of sect.slots ?? []) {
    slotPoints[s.key] = Number(s.points ?? 2);
    slotType[s.key] = s.type ?? s.key;
  }
  const { played, slotSong, slotImpossible, anyDebut } = slotFacts;

  const fresh = [];
  for (const p of picks) {
    let pts = 0, hit = false, reason = "not played";
    const isSlot = p.slot in slotPoints;
    if (norm(p.songname) === "any debut") {
      if (anyDebut) { pts = isSlot ? slotPoints[p.slot] : flatPts; hit = true; reason = "a debut was played"; }
      else reason = "no debut this show";
      fresh.push({ slot: p.slot, songname: p.songname, hit, points: pts, reason });
      continue;
    }
    const stype = slotType[p.slot] ?? p.slot;
    const exactHit = stype === "cover_pick"
      ? songs.some((x) => x.is_cover === true && norm(x.songname) === norm(p.songname))
      : slotSong[stype]?.(p.songname);
    if (isSlot && exactHit) {
      pts = slotPoints[p.slot]; hit = true;
      reason = stype === "cover_pick" ? "cover played" : `${stype} — exact`;
    } else if (played.has(norm(p.songname))) {
      hit = true;
      if (isSlot) {
        const why = slotImpossible[stype] ? "slot not played"
          : stype === "cover_pick" ? "played, but it's an original" : "played, wrong slot";
        if (cfg.partial_credit) { pts = Number(cfg.partial_points ?? 1); reason = why; }
        else reason = why + " (no partial credit)";
      } else { pts = flatPts; reason = "played"; }
    }
    if (hit && pts > 0) {
      const row = songs.find((s) => norm(s.songname) === norm(p.songname));
      const b = cfg.bonuses ?? {};
      if (row?.is_cover && Number(b.cover)) { pts += Number(b.cover); reason += " +cover"; }
      if (/debut/i.test(row?.footnote ?? "") && Number(b.debut)) { pts += Number(b.debut); reason += " +debut"; }
    }
    fresh.push({ slot: p.slot, songname: p.songname, hit, points: pts, reason });
  }

  const prevBySlot = new Map((prevBreakdown ?? []).map((b) => [b.slot, b]));
  const breakdown = fresh.map((b) => {
    const old = prevBySlot.get(b.slot);
    if (!old) return b;
    if (old.points > b.points) return old;
    if (old.points === b.points && old.hit && !b.hit) return old;
    return b;
  });

  const expected = (sect.slots?.length ?? 0) + Number(sect.flat_picks ?? 0);
  const perf = Number((cfg.bonuses ?? {}).perfect ?? 0);
  if (perf > 0 && expected > 0 && picks.length === expected && breakdown.every((x) => x.hit)) {
    breakdown.push({ slot: "bonus", songname: "Perfect sheet", hit: true, points: perf, reason: "every pick hit" });
  }
  const total = breakdown.reduce((sum, b) => sum + b.points, 0);
  return { breakdown, total };
}
