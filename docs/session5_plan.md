# Session 5 — Facebook League launch: state, deferrals, accepted risks

Working plan file for the Facebook League launch. Started 2026-08-16.
Read alongside `CLAUDE.md`'s "Session 5" roadmap bullet and the
PRE-SESSION-5 GATE table — this file carries the current state and the
decisions; CLAUDE.md carries the durable reasoning.

**Standing rule observed throughout: no player nicknames in this file.**
Nicknames are the login identifier — half of the name+PIN credential pair —
and this repo is public. The two prospective league admins are referred to
by role only. Resolve identities with a query at the time you need them.

---

## Status as of 2026-08-16

**Done tonight:**

1. **First-ever database backup.** No backup of this project had existed at
   any point. Tooling now lives at `C:\Users\kylem\backups\fantasyeggy\`
   (outside the repo — the dumps carry `players.pin_hash` and every
   player's picks, and this repo is public). First dump:
   `fantasyeggy-data-20260816-201558.sql`, 316K, 12 tables —
   picks 560, songs_cache 363, setlist_songs 101, scores 100,
   season_rosters 47, shows 37, league_shows 37, players 15,
   league_members 14, seasons 5, brackets 2, leagues 1.
   (Those counts are the pre-creation state — `leagues 1` / `brackets 2`
   is Ambassadors alone.)
2. **Second league created** via the real Global console
   (`global_create_league`), which seeds Official + Casual with the
   hardcoded `def_cfg` and **no members**.
3. **Dev added himself** to the new league — see "Why appointing yourself
   was the only route" below for the mechanism and why it necessarily set
   the admin flag.

**Explicitly NOT done, by decision:** no season, no other admin
appointments, no Discord webhook secret.

---

## DEFERRED: no Official season for the new league

**Do not create one "helpfully." Creating a season before the player pool
exists is destructive and effectively irreversible.**

The failure is in `activateSeasons()`
(`supabase/functions/carton-sync/index.ts:338-364`). It fires on the next
cron tick — within a minute — for any season whose `start_date <= today`
and whose `roster_locked_at` is null. It snapshots every `league_members`
row with `official_opt_in = true` **at that instant** into
`season_rosters`, then stamps `roster_locked_at`.

**The zero-row case is the specific hazard.** The insert is guarded, but
only against an *error*:

```js
let insertError = null;
if (rows.length) {            // <-- skipped entirely when the league is empty
  const { error } = await supa.from("season_rosters").upsert(rows, ...);
  insertError = error;
}
if (insertError) { ...retry next run... }
await supa.from("seasons").update({ roster_locked_at: ... })
```

With an empty or near-empty league, `rows.length` is 0, the write is
skipped, `insertError` stays `null` — and `roster_locked_at` is stamped
anyway. **The season is then permanently "activated" with an empty
roster.** The `.is("roster_locked_at", null)` filter never revisits it, so
nothing retries and nothing reports it.

Consequence: every player who joins afterwards fails `_official_gate`'s
`roster_locked_at is not null` branch, is not in `season_rosters`, and gets
**"You are not on this season's roster"** on every Official pick sheet.
Recovery is `admin_set_season_roster` one player at a time through the
admin UI — there is no bulk add. At ~50 players that is 50 manual clicks
to undo one premature season.

**This is the same family as the bug fixed in `activateSeasons` earlier**
(an unguarded multi-row insert followed by an unconditional "mark this
done" write) — the error path was fixed, the *empty* path was not.

**The correct sequence, and it is free:** leave the new league with **no
season** until recruitment is done. While no season exists, Official simply
blocks picks with "No Official season covers this show yet" and the admin
panel shows the ⚠️ no-season warning — **both are the intended state, not
faults to fix.** Casual is unaffected and takes picks immediately.

When the pool is real, create the season with a `start_date` in the future.
Until `roster_locked_at` is stamped, `_official_gate` falls back to the
live `official_opt_in` flag, so everyone added in the meantime can vote in
Official right away and the snapshot happens once against a full roster.

---

## ACCEPTED RISKS — decided, not drifted

Recorded so these read as choices rather than oversights. Both were weighed
and accepted on 2026-08-16; neither is an open task.

### 1. Login rate-limiting deferred at ~50 players

**Accepted.** `login` remains a public, unthrottled RPC taking a nickname
(enumerable — they are printed on the leaderboard) and a 4–8 digit PIN, and
the anon key needed to call it ships in the deployed frontend by design.
The full three-part fix (per-nickname progressive delay, aggregate spray
throttle, weak-PIN rejection) is described in CLAUDE.md and is a session of
work on its own.

**Why accepted rather than fixed first:** the realistic worst case at this
scale is someone guessing into a fantasy-setlist account — there is no
money, no PII beyond a nickname, and no cross-service credential reuse
value beyond whatever a player chose to reuse. The cost of blocking launch
on it is real; the cost of the exposure is bounded and reversible (an admin
PIN reset).

**What would change the calculus:** any real-world consequence attaching to
an account (prizes, money, a public-facing role), or the league growing
materially past ~50. Revisit then, not on a date.

**Item #1 on the Pre-Session-5 gate is therefore knowingly crossed, not
satisfied.**

### 2. `official_opt_in` defaulting to `true` during recruitment

**Accepted.** Stage F flipped the column default to `true` for beta
convenience, so `admin_add_league_member` — which inserts without naming
the column — lands every new member opted into Official automatically.
Gate item #6 exists to revisit exactly this before a semi-public pool.

**Why accepted for now:** during recruitment it is the behaviour you want.
Opt-in-by-default plus a deferred season start means every player added is
immediately eligible for Official the moment a season is created, with no
per-player flag-flipping and no one silently excluded from the first
snapshot. The original opt-in-by-default reasoning — participation should
be a conscious choice among semi-strangers — is about the *steady state*,
not the onboarding window.

**Known gap that comes with it:** `set_official_opt_in` exists as an RPC but
**is not wired to any frontend control**, so a player who wants out cannot
do it themselves — only a league admin can remove them from a running
season's roster. Accepted for now; revisit together with #6 before season
two.

### 3. Discord webhook secret skipped

**Accepted.** With no `DISCORD_WEBHOOK_<LEAGUENAME>` env var set,
`notifyLeague()` falls back to the single global `DISCORD_WEBHOOK` — so the
new league's announcements post into the Ambassadors channel. Judged
harmless because nobody is in the new league's channel yet, so the
misrouted messages are noise nobody hears.

**Becomes load-bearing the moment real players join**, since Ambassadors
members would then see another league's announcements. Provision the secret
before recruitment starts. Name derivation:
`"DISCORD_WEBHOOK_" + name.toUpperCase().replace(/[^A-Z0-9]+/g, "_")`.

---

## Why appointing yourself was the only route

Worth recording because it looks like an inconsistency and isn't.

`global_create_league` seeds a league with **zero members**, including its
creator. The Members panel's add is hardcoded to `state.currentLeagueId`
(`admin.js:461`), and you cannot switch to the new league because
`my_leagues` only returns leagues you already belong to. Chicken-and-egg.

The only in-app mechanism that writes a `league_members` row for a league
you are not in is **Global console → Appoint a league admin**
(`global_appoint_league_admin`), which upserts with
`is_league_admin = true`. So joining a league you just created necessarily
makes you its admin. A plain-member row would require raw SQL.

This is distinct from the deferred appointment of the two outside admins —
that decision is unchanged.

---

## BLOCKER on the remaining Session 5 work: admin tab reorg

The two prospective league admins are **not being appointed until the admin
tab is reorganised.** The dev's reasoning, recorded because it corrects an
earlier framing in this repo:

The `toggleFormat` orphan hazard and unguarded config edits are frequently
cited as reasons to fear handing out admin. **On a brand-new league they are
not risks at all** — both are destructive to *data* (orphaned picks,
rewritten published scores), and a league with no picks and no scores has
nothing to destroy. The real problem is simply that the panel is laid out
poorly and hard to hand to someone who did not build it.

Those hazards do become real once the new league has picks and scores. They
are tracked in CLAUDE.md's deferred list; they are not what is gating the
appointments.

---

## Next steps, in order

1. **Admin tab reorg** — inventory first (done, see below), then arrangement.
   This is the next work item, ahead of everything else on the later-work
   list.
2. Appoint the two league admins via the Global console.
3. **Brief them on the reload requirement before they add anyone** — every
   player added must fully close and reopen the app before the league
   appears; foregrounding is not enough. See CLAUDE.md, "Multi-league
   switcher behavior." This will be the most common support question during
   recruitment and is invisible from the admin side.
4. Provision the Discord webhook secret.
5. Recruitment; add players as they register.
6. Create the Official season with a **future** `start_date`, once the pool
   is stable.

## Open questions, deliberately unresolved

- **Whether the two admins should be Global admins or league admins.**
  League admin is assumed throughout; nothing has actually decided it. The
  only Global-exclusive power is the nuclear boot, so league admin is
  almost certainly right — but it has not been stated.
- **Whether the new league's brackets should keep `def_cfg` as seeded.**
  All four bonuses are `0`, including perfect sheet, and there is no
  `oneset` section at all (a one-set show silently falls back to the
  standard section). Fine as a starting point; nobody has decided it is the
  intended ruleset.
- **Whether Casual should run ranked choice** the way Ambassadors' Casual
  does, or start in slots mode as seeded.
