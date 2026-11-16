# Conventions: the grandfathered files under the nickname rule

> Moved verbatim from `CLAUDE.md` at commit c9b2f89 (2026-11-15), original lines 499–512, for headroom. Wording is unchanged.
> Decision record — currently binding. `CLAUDE.md` holds the STANDING RULE itself and a pointer stub; this file is the full text of the exception.

- **`test2-scoring-comparison.html` is GRANDFATHERED, explicitly.** It
  carries the full roster (ten nicknames, 16–26 occurrences each, with
  per-player scoring data) and predates this rule by a long way — added in
  `ff7a3f0`, *"Add two standalone analysis docs for sharing outside the
  org"*, i.e. it was created deliberately for external sharing, not leaked
  into the repo by accident. **Removing it is a separate decision, not a
  cleanup task**, and it needs the dev's call because the sharing intent
  was the point of the file. Recorded here so a future reader finds an
  explanation rather than an unexplained contradiction and "fixes" it —
  or, worse, concludes the rule is dead because the repo visibly ignores
  it. (`test/tiebreak.test.mjs`, `src/features/standings.js` and the
  analysis HTML also carry a few real nicknames as fixture/example data;
  same grandfathering, lower stakes, worth swapping for invented names
  whenever those files are next touched for another reason.)
