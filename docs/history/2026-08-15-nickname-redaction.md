# 2026-08-15: the nickname redaction and why history was not rewritten

> Extracted verbatim from `CLAUDE.md` at commit 54a5ab8 (2026-10-18), original lines 4388–4401. Nested entries were de-indented to top level; wording is unchanged.
> Historical record — resolved, closed or superseded. Kept for its method and evidence. Not a current instruction.

- **This rule was broken the day it was written, which is why it exists.**
  `caab1d6` recorded seven nicknames and four attributed picks into
  CLAUDE.md; redacted 2026-08-15 UTC. Forward redaction only — history was
  deliberately NOT rewritten, see the reasoning below.
- **Deciding factor for not rewriting history, and it cuts both ways:** the
  app already publishes a superset of this data to anonymous callers.
  `get_show_picks` is granted to `anon` and, for any show past cutoff,
  returns `player_id`, `player_name`, `slot`, `songname` — verified live,
  44 rows and 11 distinct names off a single past show using only the
  publishable key that ships in the frontend. So a history rewrite would
  have cost every commit SHA cited throughout this file to remove data that
  a public endpoint hands out anyway. **Do not read that as "the rule
  doesn't matter"** — read it as "the git leak was dominated by a bigger
  one," which is now tracked as an open question on the Pre-Session-5 gate.
