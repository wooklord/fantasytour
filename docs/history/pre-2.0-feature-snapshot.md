# Feature set frozen at the start of 2.0 (historical snapshot)

> Extracted verbatim from `CLAUDE.md` at commit 54a5ab8 (2026-10-18), original lines 2358–2429. Nested entries were de-indented to top level; wording is unchanged.
> Historical record — resolved, closed or superseded. Kept for its method and evidence. Not a current instruction.

**This section is not maintained and does not describe the app's current
behavior.** It's a frozen snapshot of the pre-2.0 feature set, written once
before the rebuild began, and every rebuild stage since has moved the actual
UI further away from it without this section being updated to match. It has
already sent work down the wrong path four times now: it described a
collapsible sidebar that was **never built** (precisely: no code for one was
ever committed — that is all the git evidence below can show, and it is not
the same as "the dev never wanted one." **Git history can disprove an
artifact; it can never disprove an intention.** The dev did mention a desktop
sidebar redesign once, in passing — see the deferred-items entry near the end
of this file, and discipline item 6); an admin show-row layout that (in
an earlier draft) only ever existed in a chat message, never in the repo;
and, separately from this section's own text, a personal task list compiled
from conversation memory once again claimed a desktop sidebar mockup
("mock2") had been chosen but never committed, with "the rejected 3-column
layout" implied to be a mistake still shipping. Re-verified directly
(`git log --all -S"sidebar"`, `-S"mock2"`, `-S"collapse"` across every
commit's diffs): zero matches, ever — `-S"mock2"` in particular matches
nothing at all. The 3-column grid (`e7fa3ef`, still live in
`src/core/layout.js`) is the only desktop layout that was ever built; it
isn't a rejected fallback, it's the only thing that exists. A fourth instance
turned up in the "Known pending work" section, not here — the slot-labels
bullet describing per-song setlist labels and opener/set2_opener live-toast
tags that were never actually built, only ever planned (see that bullet,
corrected). **The mechanism is the same whether the false claim is about a
past decision or a feature's current status**: a plan or possibility gets
written down — in a chat message, a personal task list, a "known pending
work" bullet — and later gets read back as if it already existed, because
nothing forced a check against the actual repo in between.
**The mechanism runs in BOTH directions, and this note used to arm you
against only one of them.** The four instances above are all *inflation* — a
possibility read back as fact. The mirror case happened later, on the sidebar
entry itself: a correction concluded "never existed" from evidence that only
ever showed "never committed," and in doing so deleted a real (if very
low-weight) stated preference along with the invented specifics around it.
Inflating a mention into a deliverable and erasing a mention as fictional are
the same error wearing opposite signs — a claim not calibrated to the
evidence actually behind it. **And note the remedy below does not cover the
erasure direction**: "check it against the actual repo" adjudicates claims
about code, but the sidebar mention was never a claim about code — it was a
claim about what the dev wanted, which no repo check can settle in either
direction. The only defense there is recording a mention at the weight it was
given in the first place; see discipline item 6. Treat any
specific claim below — exact wording, layout details, which widget does
what, or whether a described feature is actually live — as unverified until
you've actually read the relevant source (`src/features/*.js`,
`src/core/*.js`) or checked `git log`/`git blame` on it. For what's actually
shipped in 2.0, the "THE 2.0 REBUILD" section below tracks each stage
explicitly as done or not-started — that's the current source of truth,
this isn't.

Slot types (opener, set1_closer, set2_opener, closer, encore, show_closer,
second_song, **cover_pick** [repeatable, catalog-restricted to covers]) + an
**"Any Debut" wildcard** (any slot, hits if any debut is played). Flat picks,
partial credit, perfect-sheet bonus, cover/debut bonuses. Per-show venue-local
cutoffs (state→IANA tz map, DST-aware). Admin: master voting override
(auto/locked/open), "who's picked" roster, players panel with boot + per-league
ban + collapsible ban list, seasons (named date ranges), per-show 1set/2set format
toggle, finalize + (planned) reopen. Show lifecycle open→locked→live→complete.
Standings with podium (top-3 trophies, gold/silver/bronze **eggs** inside the
wreaths), single Score column (season pts, or career when "All time"), season
selector, nerd stats (shows/avg/high/wins). Draft persistence (pick sheets save to
localStorage every keystroke, restore on return, never wiped by foreground refresh).
3-state theme (auto-follow-phone / light / dark). Desktop is a static, non-collapsible
3-column grid (Standings / Shows / Admin, each showing full content — confirmed by
reading the actual source and git history during Stage C2a; there's no collapse
affordance or top-3-trimmed variant anywhere in the codebase's history, despite an
earlier version of this doc describing one); bottom-tab single-view on mobile. Tie handling shows
co-winners everywhere ("X & Y tie"). App icon = green laurel wreath (halo on
favicon/small badges only, not the header). Winner "trophy" = wreath over a laurel
pile; podium version has the medal egg inside.
