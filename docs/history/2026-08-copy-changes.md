# 2026-08-14: countdown phrasing

> Extracted verbatim from `CLAUDE.md` at commit 54a5ab8 (2026-10-18), original lines 4103–4117. Nested entries were de-indented to top level; wording is unchanged.
> Historical record — resolved, closed or superseded. Kept for its method and evidence. Not a current instruction.

**Small, unresolved: the countdown is now phrased two ways.** `picks.js`'s
pick sheet renders `Cutoff Aug 14, 11:00 PM · 2h 14m` — the trailing "left"
was dropped 2026-08-14 at the dev's request, since it wrapped awkwardly beside
the cutoff time. But `shows.js:183` and `:256` render the same
`countdown()` value as `"cutoff in 2h 14m"`, so the app now states the same
fact two ways and the pick sheet has the version with no word saying what the
duration *is*. Not a bug and not obviously wrong — a bare `2h 14m` directly
after a timestamp reads fine in context — but it was a deliberate change made
without the `shows.js` phrasing in view, so it's recorded rather than left as
an accident someone later "fixes" in the wrong direction. **Nothing in the
suite covers `.countbig`**, so either phrasing can drift without a test
noticing. Options if it's ever worth touching: align `shows.js` to the bare
form, restore a short word to the sheet ("in 2h 14m"), or decide the two
contexts genuinely want different wording and note that here instead.
