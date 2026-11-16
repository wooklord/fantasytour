# Pre-Session-5 gate (overtaken 2026-10-11)

> Moved verbatim from `CLAUDE.md` at commit c9b2f89 (2026-11-15), original lines 399–428. Wording is unchanged.
> **OVERTAKEN, not completed.** This gate was written to be walked before the second league launched and before any league admin who is not the dev existed. That league, Green Eggs, launched, and its first non-dev league admins joined on 2026-10-11, without the gate being completed. Some items were crossed by recorded decision, and the ordering note that followed this block in `CLAUDE.md` (settle #4 before #5, and #1–#3 before either) was not met. Not every item that was crossed has a recorded decision. Which items, and where each decision is recorded, is kept in local notes. The text below is kept as written, for its numbering and its reasoning. It is not a current checklist. A row without a ✅ says nothing about that item today: per-item status is not kept in tracked files.

### PRE-SESSION-5 GATE (walk this list before launching the Facebook League)

Items elsewhere in this file are gated on "before Session 5 / before the
Facebook League / before a non-dev league admin exists." Each was recorded
beside the code it concerns, which is right for understanding it and wrong
for remembering it — a trigger buried next to its own implementation is a
trigger nobody re-reads at the moment it fires. **This table is the index;
its Status column is the count.** Completed items keep their row and their
number rather than being deleted, so the ordering note at the bottom
("settle #4 before #5, and #1–#3 before either") keeps referring to the same
things it was written about. **The full reasoning stays in the
bullets referenced, deliberately not duplicated here**, since a duplicated
rationale is one that drifts. (#7 is the exception to that last rule: it has
no home bullet elsewhere, so its reasoning lives directly below the table.)

| # | Item | Where the full bullet lives | Why it's gated here |
|---|---|---|---|
| 1 | **Login rate-limiting** (3-part fix: progressive delay + aggregate spray throttle + weak-PIN rejection) | Postgres/Supabase gotchas — "Login rate-limiting: the top real security exposure" | ~50 semi-strangers is where enumerable nicknames + short PINs stop being theoretical |
| 2 | **`ft_session` plaintext PIN → server-issued token** | Same section, the bullet immediately after #1 | The stored session IS the credential, with no revocation path; scope as its own session, it's real work |
| 3 | ✅ **DONE 2026-08-15** — **Domain move to a `wooklord.net` subdomain**, live at `fantasyeggy.wooklord.net` | Same section, the roadmap bullet after #2 | Origin isolation for #2, and PWA installs become expensive to move *after* recruitment. Row kept rather than deleted so the numbering and the ordering note below stay valid |
| 4 | **Ladder-mutability revisit** (Module B) | "Alternate scoring modes" → Module B locked decisions → "Decided: mid-season ladder edits stay unguarded" | Unguarded config edits silently rewrite already-published scores; acceptable only while one trusted person can edit |
| 5 | **Appointing any non-dev league admin** | Cross-cuts #4 and the `admin_update_config`/`admin_set_season_roster` integrity notes | This is the event that invalidates "only the dev can do damage," which several decisions currently rest on |
| 6 | ✅ **DECIDED 2026-10-12** — **Official opt-in default revisit**: the dev reaffirmed default `true`; Stage F (never actually applied — found 2026-10-11) stands as the fix and is item (e) of the post-first-show batch | 2.0 rebuild key decisions — the `official_opt_in` bullet | Opt-in-by-default was a closed-group convenience; the dev chose it deliberately for the semi-public pool too. Row kept so the numbering holds |
| 7 | ✅ **DONE 2026-08-16** — **`get_show_picks` is now membership-gated**, matching `get_bracket_scores`; `player_id` dropped from the payload in favour of a server-computed `is_mine`. Reveal-after-cutoff unchanged | The bullet immediately below this table, and `sql/stage_p_get_show_picks_membership.sql` | Anyone with the publishable key could scrape every player's nickname, UUID and full pick history; at ~50 semi-strangers that stopped being a closed-group detail |

**#7 in full** — ✅ resolved 2026-08-16 by Stage P; the membership gate
cannot be exercised by the dev's own account (register a throwaway
non-global-admin account to test it) and `is_mine` must be checked both
ways, not inferred from the page rendering: `docs/history/2026-08-16-stage-p.md`.

