# Known pending work queued in chat before 2.0 (verified against code)

> Extracted verbatim from `CLAUDE.md` at commit 54a5ab8 (2026-10-18), original lines 2432–2476. Nested entries were de-indented to top level; wording is unchanged.
> Historical record — resolved, closed or superseded. Kept for its method and evidence. Not a current instruction.

- **v6 edge function batch** ("carton-sync-v6"): Cover Pick slot type + Any Debut
  wildcard scoring; "slot not played" wording; tie-fix. Was HELD from deploy while a
  show's picks were locked. Deploy edge fn first, then frontend.
- **Reopen button** (un-finalize a show so corrected Carton data re-scores): **built**
  as the edge function's `reopen` action (Stage C1) — name/PIN-authenticated, wipes
  that league's scores for the show, resets `league_shows.status = 'live'` and
  `winner_sent = null` so the corrected winner re-announces, and fires a "scores
  reopened" Discord notice. Pairs with "correct The Carton before finalizing"
  workflow (a friend of the dev can edit setlists on The Carton). Frontend wiring is
  **also done** — a "Reopen" button in admin.js's Shows & cutoffs panel, next to
  Finalize on any show with `status === 'final'`; smoke-tested against the real
  Boston 7/31 show (see the closer-family scoring fix note above). **`cutoff_changed`
  is wired too now (Session 1, commit `2816d66`)** — `admin.js`'s `saveCutoff()`
  fires the edge action (fire-and-forget, `.catch(() => {})` so a failed Discord
  notice can't read as a failed cutoff save) right after `admin_set_cutoff`
  succeeds. All three authenticated edge actions (`reopen`/`cutoff_changed`/
  `finalize`) now have a real frontend caller — none is orphaned anymore.
- **Slot labels in setlists & notifications — a fourth false-memory instance (see
  the note at the top of this section), corrected against the source.** This
  bullet used to describe two things as current behavior that were never actually
  built:
  1. "Setlist view shows all slot labels ('Laurel — Opener')" — not true.
     `picks.js`'s `renderShowDetail` renders position, song name, a segue arrow,
     and (since Session 2) a debut tag per song. There is no per-song slot label
     anywhere in that view, and no trace in git history that there ever was.
  2. "Live toasts tag opener, set2_opener, encore + debut" — only half true.
     `realtime.js`'s live song toast tags `(encore)` and `— DEBUT 🥚` (the debut
     half shipped Session 2, exactly as planned). There is no opener or
     set2_opener tag anywhere in that toast string, confirmed directly against
     the current code.
  **What's actually true**: debut tagging is real, in both spots this bullet
  always described, mirroring the existing `is_encore` pattern. Plain footnote
  trivia is descoped, not planned, and stays that way.
  **Not started, if still wanted**: per-song slot labels in the setlist view;
  opener/set2_opener tags in the live toast. Neither exists today — don't assume
  either from an older reading of this bullet.
- **Discord notification logic rework**: broadcast (not personal) + per-league in
  2.0. Still needs a design pass for the bigger pieces (public non-voter shaming
  vs. neutral counts; dedupe with in-app toasts; Discord roles) — but **per-league
  webhooks are further along than this bullet used to imply**: `notifyLeague()`
  (`index.ts`) already resolves a `DISCORD_WEBHOOK_<LEAGUENAME>` env var per
  league, falling back to the single global `DISCORD_WEBHOOK` only if that named
  one isn't set. No DB column, no admin UI — but the routing mechanism already
  exists. A second league's notifications landing in the first league's channel
  is a missing *secret*, not missing code.
