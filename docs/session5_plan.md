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

## 🚨 Status as of 2026-10-11 — Green Eggs has NO schedule rows; season starts 2026-10-14

**Read this first; everything below it is older.** Green Eggs (league 2,
Official = bracket 3, Casual = bracket 4) is live, has 18 members (3 admins)
and a locked 18-row roster for season 11 ("The Final Tour", 2026-10-14 →
2026-12-06). It also has **zero rows in `league_shows`**, so every show reads
"no cutoff", every button says "Score", `submit_picks` raises, and the scorer
skips it. Full root cause and evidence in CLAUDE.md, Postgres/Supabase
gotchas, the "🚨 FOUND 2026-10-11" entry. Short form: `global_create_league`
never creates overlay rows, only `syncShows()` does, and nothing but the
manual "Sync shows" button ever invokes it. Last `sync_shows` predates the
league's creation.

**Decisions locked 2026-10-11, in the dev's words where they matter:**
- **Nothing may change production behaviour this week except the data fix**
  — pressing "Sync shows" to create the 16 overlay rows, after a read-only
  pre-sync safety check (plan A below).
- **No second creator of overlay rows.** `admin_set_cutoff` is NOT to become
  an upsert. The Shows panel gets a "Not on this league's schedule" label
  instead of a blank input — plan only (E).
- **Cron scheduling of `sync_shows` is HELD** until the first Green Eggs show
  has scored cleanly. Scope folds into the `CRON_SECRET` dual-path change
  (CLAUDE.md "DECIDED 2026-08-17, NOT STARTED") — plan only (D).
- Review-before-edit for every code change: plan shown, approval, then edit.

**Work plan, A → E, each as plan-then-approve:**
- **A. Pre-sync safety check — ✅ DONE 2026-10-11, verdict SAFE, dev
  approved pressing "Sync shows".** 16 window shows, all future, same ids
  on The Carton and in `shows`; league 1 gets zero `league_shows` writes and
  a byte-identical `shows` upsert; null-state shows land on 23:00 UTC
  (Eastern fallback, correct for D.C.). Full list in CLAUDE.md's 🚨 entry.
  - **Decision folded in: provision `DISCORD_WEBHOOK_GREEN_EGGS` before
    2026-10-15 21:00 UTC** (the first reminder). No per-league secret
    exists today, so Green Eggs' messages would fall back to the Ambassadors
    channel and song-by-song posts would double up. This is the old step 4
    of "Next steps", now dated.
  - **✅ Post-sync verification PASSED 2026-10-11 ~17:00Z:** league 2 holds
    exactly 16 rows, 0 null cutoffs, all `upcoming`, all flags null, cutoffs
    identical to league 1's for the same 16 shows; D.C. shows at
    `23:00:00+00`; league 1 still 37 rows, window rows unchanged; cron still
    "no eligible shows". Not yet eyeballed: the button label flipping to
    "Pick" in the app (needs a reload — `max-age=600`).
  - **⏸️ PAUSED 2026-10-11 (dev's call) — was OPEN, dated 2026-10-15 21:00
    UTC:** `DISCORD_WEBHOOK_GREEN_EGGS` is on hold; nobody is using the
    Green Eggs Discord yet. Verified by name only the same day: the secret
    does not exist. Accepted consequence until it does: Green Eggs'
    reminder (naming non-voters), lock, winner and song-by-song posts fall
    back to the Ambassadors channel, song posts doubled. Kept here and in
    CLAUDE.md's DATED DEADLINES so it is not forgotten.
  - **🔇 SILENCED 2026-10-14 (dev's call) — supersedes the PAUSED bullet.
    ALL Discord posts for BOTH leagues are off: the global
    `DISCORD_WEBHOOK` secret was deleted. Config only, no code, no deploy.**
    Verified by name only the same day: platform defaults only, no
    `DISCORD_WEBHOOK`, no `DISCORD_WEBHOOK_*`. **Reason:** nobody reads
    either channel yet, and the message templates carry no league name
    (the name only selects the webhook, `index.ts:101`), so the shared
    fallback would have put every post in one channel twice with no way to
    tell the leagues apart — including non-voter nicknames from both
    leagues in the 1-hour reminder. **Stamps still advance** with no hook
    (`remind_sent` `:440`, `lock_sent` `:460`, `winner_sent` `:496`, season
    `:527`, `setlist_songs` upsert `:604`), so nothing replays on restore.
    **Residual:** Supabase documents that NEW secrets apply without
    redeploy, not deletions. **The 2026-10-15 21:00Z reminder for show
    1786387666 (league 1) is the test** — if it posts, the deletion did not
    propagate; record that and reassess. **Re-enabling is post-first-show
    batch item (f)** below. Full entry: CLAUDE.md, "🔇 SILENCED 2026-10-14"
    sub-bullet inside the 🚨 entry.
- **B. Seed overlays in `global_create_league`.** One row per existing show
  at creation, `cutoff_at` = 6 PM in `coalesce(shows.timezone,
  'America/New_York')`, past-show flags stamped as Stage A did. Must match
  `venueCutoffISO` exactly; state whether SQL and TS can drift and how to
  pin them. Name the migration file and the catalog check that proves it
  applied (Stage F turned out never to have been).
- **C. Zero-overlay fixture — ✅ DONE 2026-10-11, test files only.**
  `runNoOverlayScenario` + six checks; `submit_picks` fake now mirrors the
  real schedule/cutoff block (`can_submit_picks` left alone — the real one
  has no such check). Mutation: restoring the rows fails 4 checks × 2 modes,
  the two that hold either way survive. Scorer skip NOT exercised, stated in
  the scenario header. Details in CLAUDE.md's 🚨 entry, item 5.
- **D. Cron — HELD. ✅ Documented 2026-10-11.** The `CRON_SECRET` dual-path
  change is documented in CLAUDE.md under "DECIDED 2026-08-17, NOT STARTED:
  `sync_shows`, `sync_songs` and `score` ... are COMPLETELY UNAUTHENTICATED"
  (it has no section of its own in this file). Its scope now carries:
  **schedule `sync_shows` hourly, after the first Green Eggs show scores.**
  Nothing implemented, nothing scheduled. When it is done, the cron work
  and Stage R's apply happen in the same batch.
- **E. Shows panel label** for a missing overlay row — **APPROVED AS A
  PLAN 2026-10-11, HELD.** Detect a missing row by `sh.status === undefined`
  after `fetchShows`' spread (real rows always carry a status); render "Not
  on this league's schedule — run Sync shows" instead of the input and omit
  Change cutoff and the format switcher (both RPCs raise "Show not found"
  on a missing row). `admin_set_cutoff` stays update-only. Not written: it
  changes `admin.js`, and the state no longer exists in either league.

**THE POST-FIRST-SHOW BATCH (decided 2026-10-11): one batch, one deploy,
after the first Green Eggs show scores cleanly.** (a) apply Stage R;
(b) `CRON_SECRET` dual path + hourly `sync_shows`; (c) part E label;
(d) part F display fix; **(e) apply Stage F
(`sql/stage_f_official_default_optin.sql`) — added 2026-10-12, the dev
reaffirmed Official opt-in defaults to TRUE.** Catalog check after
applying: `column_default` on `league_members.official_opt_in` = `true`,
and `count(*) from league_members where not official_opt_in` = 0. No
effect on season 11 (roster locked; the gate reads `season_rosters`).
**(f) Re-enable Discord — added 2026-10-14, plan only.** Before any
webhook is set again: `DISCORD_WEBHOOK_GREEN_EGGS` AND a per-league
Ambassadors secret (no global fallback), plus a league-name prefix on
every `notifyLeague` message — the templates carry none today. Needs an
edge-function deploy for the prefix; the secrets are config.
Nothing in it ships before then. `src/` and the bundle untouched this
week.
- **F. (added 2026-10-11) Admin cutoff fallback shows the wrong hour** on
  null-timezone shows when device DST ≠ show-date DST — the two D.C. shows
  read 7:00 PM for a 6:00 PM Eastern cutoff. Display-only; the write path is
  correct, but a no-edit re-save shifts the cutoff +1h. Players unaffected.
  Full entry at the top of CLAUDE.md's Frontend/CSS gotchas. **Rule until
  fixed: Change cutoff is off-limits for Nov/Dec shows in both leagues.**
  Fix APPROVED AS A PLAN 2026-10-11, HELD for the post-first-show batch
  (item (d) above). (This line read "not approved" until later the same
  day — stale, corrected 2026-10-11 to match CLAUDE.md.)
- **G. (added 2026-10-11) Admin PIN reset, read from the live catalog —
  read-only, nothing changed.** Green Eggs has three league admins; this is
  their recovery path. Playbook written for them:
  `docs/admin_playbook_forgot_pin.md`. Full findings in CLAUDE.md's
  "ADMIN PIN RESET — READ FROM THE LIVE CATALOG 2026-10-11" entry. Three
  things to carry: **(1) CORRECTION** — the Chat-relayed claim that an
  `admin_set_player_pin` skipped `must_change_pin` was wrong; the function
  never existed, `admin_reset_player_pin` has always set the flag. **(2) A
  reset breaks the player's sessions on every device without logging them
  out** — they see "Wrong name or PIN" until they log out and back in;
  playbook step 1 exists for this. **(3) PROPOSED PIN BATCH, separate and
  AFTER the post-first-show batch, none of it approved:** (a) audit log
  for resets and boots; (b) admins-resetting-admins policy — **DECIDED
  2026-10-11: ALLOW-PLUS-LOG** (rejected restrict-to-global: closes the
  peer route but makes the dev the only recovery for a locked-out league
  admin; so (b) rides on (a), the RPC does not change); (c) weak-PIN
  denylist on `change_own_pin`, filed with the rate-limiting item; (d)
  `random()` for the temporary PIN ACCEPTED as is; (e) client-only hint on
  "Wrong name or PIN" for a session that previously worked — an admin may
  have reset your PIN, log out and use the temporary one; (f)
  `renderBoard` has no catch, so a failed RPC leaves Standings silently
  stale — add error handling to match the other tabs, client-only, not
  PIN-specific, filed here because it surfaced here. Design decisions
  happen in Chat; nothing ships this week.

**B status, 2026-10-11:** `sql/stage_r_seed_league_shows_on_create.sql`
WRITTEN, NOT APPLIED (first lines of the file say so). Live
`global_create_league` body diffed against stage N: identical. Harness fake
seeds overlay rows; two new assertions; mutation-tested (emptying the seed
loop → exactly those two fail, both modes). Apply after the first Green Eggs
show scores, with the cron change.

**Stage F: DECISION REAFFIRMED 2026-10-12 — default TRUE, Stage F stands,
now item (e) of the post-first-show batch (above).** Season 11 early lock:
**INVESTIGATED 2026-10-12 (read-only).** The only writer of
`roster_locked_at` is the cron's `activateSeasons`, gated on `start_date <=
today`; `admin_save_season` re-dates a season without clearing the lock. So
the season was saved on 2026-08-17 with a start date on or before that day,
activated by the next tick (stamp 15:34:01Z, one second past a minute
boundary), and re-dated afterwards. Its activation snapshot wrote nothing
that survives (all 23 roster rows are hand-adds with distinct timestamps;
all 23 members are opt-in `false`). It will not activate again on 10-14, so
the roster stays manual-only. **The next season saved with a start date on
or before today will lock the same way within a minute.** No fix proposed.

**Discord silenced 2026-10-14 (dev's call, config only):** the global
`DISCORD_WEBHOOK` secret was deleted; verified by name only that no
`DISCORD_WEBHOOK` or `DISCORD_WEBHOOK_*` name remains. Reason, residual and
the re-enable plan are in the 🔇 SILENCED bullet under item A above.
**Correction recorded the same day:** a `leagues.discord_webhook` column
was referred to in conversation as if an earlier plan note described one.
No tracked file mentions such a column (grepped CLAUDE.md and `docs/`), and
the live `leagues` table has `id`, `name`, `created_at` only. It never
existed. **Season 10 (Ambassadors) context, read 2026-10-14 ~03:11Z:** not
yet activated, 0 roster rows; league 1 has 14 members, all 14 opted in and
unbanned, so the first tick after 04:00Z on 2026-10-15 writes 14 roster
rows and locks. The cron is every minute (`cron.job` schedule `* * * * *`).

**CHECK FOR FRIDAY 2026-10-16's POST-SHOW PROMPT:** (1) no Discord post
appeared in the Ambassadors channel for show 1786387666; (2) `remind_sent`,
`lock_sent`, `winner_sent` advanced normally on that show's `league_shows`
row in BOTH league 1 and league 2; (3) `setlist_songs` holds the show's
rows; (4) season 10 has `roster_locked_at` ≈ 04:00Z on 10-15 and 14 roster
rows. Stamps present + no post = the silence worked and nothing is queued
to replay. Stamps absent = a different problem; the missing webhook cannot
throw (`index.ts:102-107`) and is not the cause.

**Secondary findings from the same read (details in the CLAUDE.md entry):**
Stage F's opt-in default was never applied (live default is `false`; all 18
Green Eggs members opted out; harmless today because the roster is locked);
season 11's roster locked 2026-08-17, two months before its start, so anyone
added since is not on it (18 = 18 today); bracket 3 now carries the
fabricated `oneset` section the admin fallback invents, bracket 4 is still
raw `def_cfg`.

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
   - **⚠️ IT IS CALLED "Green Eggs" — NOT "Facebook League".** Every plan
     document in this repo, including the roadmap in CLAUDE.md and the
     section headings in this file, refers to the second league as "the
     Facebook League" because that was the working name for years before
     it existed. The league that actually exists is named **Green Eggs**.
     Nothing is wrong; the name simply changed at creation time. Recorded
     explicitly so nobody greps for "Facebook" and concludes the league
     was never created.
   - Resolved ids, so they don't have to be looked up under pressure:
     **league_id 2**, **Official = bracket 3**, **Casual = bracket 4**.
     (Ambassadors remains league_id 1, Official 1, Casual 2.)
   - **(No longer true for bracket 3 as of 2026-10-11 — a save materialised
     the admin panel's invented section. Bracket 4 is still as described.)**
     **Neither Green Eggs bracket has a `oneset` config section**, because
     `def_cfg` does not define one. See the gap recorded below — it is
     display-only today but one save away from being a scoring change.
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

## GAP: `def_cfg` seeds no `oneset` section, and the admin panel invents one

Found 2026-08-17 while looking at the new league. **Display-only right now,
but it becomes a real scoring change the first time anyone saves rules on a
Green Eggs bracket** — so it is a trap, not a cosmetic wart.

**Verified against the live `brackets` table**, all four brackets:

| bracket | league | kind | has `oneset`? |
|---|---|---|---|
| 1 | Ambassadors | official | **yes** — opener 5, closer 5, cover1 3, flat 1 @ 2 |
| 2 | Ambassadors | casual | **yes** — opener 2, second_song 2, cover1 2, flat 0 @ 1 |
| 3 | Green Eggs | official | **no** |
| 4 | Green Eggs | casual | **no** |

So Ambassadors is unaffected — both its brackets got real `oneset` sections
from earlier saves. Only a freshly-created league has the gap.

**Three code paths disagree about what a one-set show means when `oneset` is
absent, and the odd one out is the admin panel:**
- `scoring.js`'s `resolveConfigSection` → `(format === "one_set" && cfg.oneset) ? cfg.oneset : cfg`, i.e. **falls back to the top-level standard section**.
- `picks.js`'s `slotDefs`/`breakdownSlotInfo` → the identical expression, so the **pick sheet agrees with the scorer**.
- `admin.js`'s `rulesRegionHtml` → `const os = cfg.oneset || { slots:[opener, closer, cover1], flat_picks:3, flat_points:1 }` — **its own hardcoded default that matches neither.**

Concretely for Green Eggs: a one-set show would score and render with
`opener / closer / **encore**` + 3 flats (the top-level section), while the
admin panel displays `opener / closer / **cover1**` + 3 flats. Different
third slot.

**THE FALLBACK ITSELF IS FINE — do not "fix" it.** The obvious reading is
that falling back to the standard section is broken because standard slots
reference set structure a one-setter doesn't have. Checked, and that is not
the case: `ONE_SET_EXCLUDED_TYPES` is only `["set1_closer", "set2_opener"]`.
`closer` is NOT excluded — `slotLabelFor()` relabels it to plain "Closer"
(last song before the encore), which is meaningful at a one-set show — and
`encore` is not excluded either, since one-set shows have encores. Green
Eggs' standard section is `opener / closer / encore` + 3 flats, **every one
of which is valid at a one-setter.** The fallback produces a sensible sheet.

**So the divergence is the admin panel's invented default, not the
fallback.** Only `rulesRegionHtml` disagrees with the other two, and it
disagrees by proposing `cover1` — a slot type that appears nowhere in this
bracket's config.

**Which makes the save direction the dangerous one, and the instinct to
avoid saving CORRECT for behaviour:**
- **Not saving** → the panel displays something the scorer won't use.
  Cosmetic. Actual scoring and the pick sheet are both sane.
- **Saving** → `saveConfig` reads `#slots1`, which always exists because the
  panel rendered its fabricated default into it, and writes
  `oneset: { slots: slots1, ... }`. **Any** rules save on these brackets —
  including one aimed at something completely unrelated — materialises the
  invented section and swaps `encore` for `cover1` on one-set shows. Nobody
  typed that; the panel supplied it.

**Stated plainly, because this is the whole reason it is confusing: the
panel is untruthful and the behaviour is correct, and those two facts pull
in opposite directions.** Every instinct that fixes one breaks the other.
Making the panel honest by pressing Save changes scoring. Keeping scoring
correct by not saving leaves the panel lying. There is no action available
to an admin that resolves both — which is precisely why this is a code fix
and not something to be careful about at the keyboard.

An earlier draft of this note framed it the other way round (avoid saving =
wrong instinct). That was written before `ONE_SET_EXCLUDED_TYPES` was
checked and is wrong: it would push an admin toward the single action that
actually changes scoring.

**Live exposure today: none.** The fallback only fires for brackets 3 and 4,
whose standard sections contain no excluded types. Ambassadors never reaches
it — both its brackets have real `oneset` sections.

**The narrow real bug, worth knowing separately:** `resolveConfigSection`
returns `cfg` wholesale without filtering `ONE_SET_EXCLUDED_TYPES`. So a
bracket whose standard section *did* contain `set1_closer` or `set2_opener`,
with no `oneset` section, would render and score set-2 slots at a one-set
show. No live bracket is in that state, and the admin editor already hides
those types when editing one-set — but nothing enforces it at scoring time.

**Options, undecided:** point `rulesRegionHtml`'s fallback at the same
expression the scorer uses, so the panel shows the top-level section when
`oneset` is absent and stops inventing (smallest, fixes the actual
divergence); and/or give `def_cfg` a real `oneset` section — which also
needs a one-shot update for brackets 3 and 4, since they already exist.

**Unrelated observation, recorded because it contradicts a written note:**
Ambassadors Official's live config no longer matches the values CLAUDE.md
recorded on 2026-08-14 (which had top-level opener/closer/encore/cover1 all
at 2 with flat 2 @ 1). It now reads opener 5, closer 5, encore 5, cover1 3,
flat 2 @ 2. Presumably a deliberate later edit; noted only so the CLAUDE.md
figures aren't treated as current.

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

#### Decision analysis (2026-08-17) — pending, deadline is season activation

**The framing that matters: this is not really a choice between three
defaults.** `set_official_opt_in` exists server-side, is correct, and is
wired to nothing. Until that control is built, **whichever default is
chosen is a one-way door for the player** — they cannot move themselves in
either direction.

**Where the flag is actually set, since this is easy to get wrong:**
registration sets nothing. `register_player` inserts into `players`, which
has no `official_opt_in` column at all — the flag lives on
`league_members`. Two live paths create membership and **neither names the
column**, so both take the Stage F default of `true`:
`admin_add_league_member` (`league_id, player_id`) and
`global_appoint_league_admin` (`league_id, player_id, is_league_admin`).
So it is the **Add button** that opts someone in, not their registration.

| option | cost | assessment |
|---|---|---|
| **A — keep `true`** | zero; already live | Nobody is silently excluded. But `computeStandings` seeds EVERY roster member into the table (`tiebreak.js:58`), so at 50 the Official board lists all 50 with most at zero |
| **B — `false`** | one `alter table` **plus a mandatory opt-in control** | Spec-correct, but shipped alone it means nobody can ever join Official except by admin action |
| **C — toggle at add-time** | RPC parameter + UI + a decision on every one of ~50 adds | Moves the consent problem rather than solving it |

**On A's real cost, which is scale-dependent and was invisible at 14:**
seeding every roster member into standings is *deliberate* — the comment at
`standings.js:113-120` records it as a fix, because an opted-in member who
never had a show finalize used to be invisible rather than shown at 0. That
fix stops scaling at 50: the board becomes mostly people who don't know the
bracket exists, for the benefit of the handful who engage.

**On B's hidden dependency:** without the control, default-`false` converts
"silently enrolled with no exit" into "silently excluded with no entry",
which is strictly worse for the player — being wrongly *out* costs them the
game, being wrongly *in* costs them nothing personally.

**RECOMMENDATION: keep A, and build the settings toggle
(`set_official_opt_in` → a control in `settingsPanelHtml()`) before Green
Eggs' first Official season activates.** The toggle is required for B
anyway, so it is the work item either way; building it first makes the
default a one-line decision taken afterwards, against a real control, while
nothing has been snapshotted yet.

**Deadline is activation, NOT recruitment.** Enrolment is harmless while no
Official season exists, and Green Eggs has none. It becomes hard to undo the
moment one activates, because `activateSeasons` snapshots every
`official_opt_in = true` member into `season_rosters` and stamps
`roster_locked_at` — after which removal is the messy, partly irreversible
path documented in CLAUDE.md's boot entry.

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

**UPDATE 2026-10-14: moot for now — the global `DISCORD_WEBHOOK` secret was
deleted, so neither league posts anything.** See the 🔇 SILENCED bullet
under work-plan item A. When Discord comes back (post-first-show batch
item (f)), BOTH leagues get their own secret and every message gets a
league-name prefix; the global fallback is not to be restored.
**Correction:** there is no `leagues.discord_webhook` column and never was
— the live table is `id`, `name`, `created_at` (read 2026-10-14); routing
is the env-var lookup above and nothing else.

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

0. ✅ **DONE — verified in a browser 2026-08-17. Nothing outstanding here.**
   The admin-tab reorg and the `.scopeline` CSS shipped having been checked
   only by the test suite, which is blind to CSS by design; this closes that
   gap. Verified by eye:
   - **Contrast in both light and dark themes.** The highest-risk item — the
     codebase has shipped three contrast failures from token choices and one
     (`--coral` on paper) is still open, so `.scopeline`'s use of
     `--line`/`--cream-dim`/`--cream` was worth confirming visually rather
     than by reading token values.
   - **Wraps cleanly at narrow widths** — the line is a long sentence and the
     desktop admin column is only ~224px at the 901px breakpoint.
   - **Both halves track the switcher**: switching Official ↔ Casual updates
     the bracket half, and doing it **in both leagues** updates the league
     half. That is the two-Casuals case the line exists for — with a second
     league, the bracket name alone identifies nothing, which is why the
     line names both.
1. **Admin tab reorg — arrangement DONE 2026-08-17 and shipped** (commit
   `170851c`). See CLAUDE.md's "The admin tab is GROUPED BY SCOPE" entry for
   the order and why it is load-bearing. **What remains is the Members
   section**, decided but not built — see the next item.
2. **Members section rework — DECIDED, NOT BUILT. Resume here.**
   - **Problem:** Reset PIN and Boot render as adjacent, identically-sized
     small buttons on every member row. At Ambassadors' 14 members that is
     13 of each on screen at once; at ~50 it is ~98 destructive buttons in
     a flat list. Finding a specific member means scrolling.
   - **Chosen shape ("Option 1"), confirmed by the dev:** hide the Boot
     buttons behind a visibility toggle **reusing the existing
     `toggleBans()` idiom already in this panel** — a `linkbtn` above the
     list, a class on each Boot button, one exported toggle that flips a
     `hidden` class. Same pattern as `#banToggle`/`#banlist`
     (`admin.js:534`+), so no new idiom is introduced.
   - **Plus a filter input above the list**, not a fixed-height scroll. At
     50 members the real problem is finding someone; typing three letters
     should be the answer. It pairs with the toggle: filter to one row,
     then reveal, and nothing else destructive is on screen.
   - **Fold in while there** (both recorded in CLAUDE.md): the signalling
     correction — Boot has two confirms + coral styling while Reset PIN has
     one confirm + default styling, yet Reset is the one that takes a live
     account offline until a human is reached; and Boot's confirm text,
     which wrongly implies removal stops Official accrual.
   - Not started. No code written for any of it.
   - **THIS IS THE GATE ON STEP 3.** The two prospective league admins are
     deliberately not being appointed until the Members section is
     reorganised — the dev's call, and the reasoning is recorded under
     "BLOCKER on the remaining Session 5 work" below: on a brand-new league
     the destructive controls have nothing to destroy, so what actually
     blocks handing the panel over is that it is hard to hand to someone who
     did not build it.
3. Appoint the two league admins via the Global console. **Blocked on step 2.**
3. **Brief them on the reload requirement before they add anyone** — every
   player added must fully close and reopen the app before the league
   appears; foregrounding is not enough. See CLAUDE.md, "Multi-league
   switcher behavior." This will be the most common support question during
   recruitment and is invisible from the admin side.
4. Provision the Discord webhook secret.
5. Recruitment; add players as they register.
6. Create the Official season with a **future** `start_date`, once the pool
   is stable.

## Admin-tab work, 2026-08-17 — DONE, with what's left

Shipped: the save split (`saveMasterSwitch`), frequency regrouping, five
renames, Who's picked moved to the top with a bracket qualifier, three
bounding dividers, the Settings bracket toggle +50%, the build id, Stage Q
(`admin_list_unaffiliated_players`) and its panel. All mutation-tested; see
CLAUDE.md for the mechanisms.

**Still unjudged — needs eyes, not code.** These were left deliberately for
the dev and never ruled on:
- **`--cream-dim` on `.scopeline-note` at `.9rem`** now carries a full
  sentence rather than a short label, directly under a `--cream` label.
  Check LIGHT theme especially — three contrast failures have shipped here
  from token choices and `--coral` on paper is still open. Fix if needed is
  one line: `.scopeline-note{color:var(--cream)}`.
- **Whether `: Casual` in the Who's picked heading needs dimming.** Tried
  plain first, deliberately; it inherits the heading entirely.
- **The scope line now WRAPS on phone**, accepted knowingly. "EDITING
  OFFICIAL · AMBASSADORS" is ~279px against ~258px on a 324px device; it
  already wrapped at the ~224px desktop-narrow column before the size bump.
  If it grates, **the fix is the copy, not the size** — moving the league
  name into the note line leaves "EDITING OFFICIAL" at ~154px, which fits
  everywhere.

**Deferred from this work, not started:**
- **`toggleFormat` still has no confirm** — unchanged, and now the only
  destructive admin control without one, since Boot and roster removal both
  gained theirs. Tracked in CLAUDE.md's deferred list with the orphan-check
  shape already spelled out.
- **The existence-vs-count weakness**: the mode-change assertions use
  `confirmCalls.some()`, so they verify a matching dialog EXISTS, not how
  many fired. They cannot distinguish one confirm from two. Same family as
  presence-vs-behaviour.
- **Stage Q's non-admin refusal is untested** (verification step 4) — needs
  the throwaway non-global-admin account, same one that closes the
  membership-gate and empty-state items below.

## Open items carried out of 2026-08-16/17, with enough to resume cold

Each of these has a full write-up in CLAUDE.md; this is the index so nothing
is only findable by remembering it exists.

- **`oneset` fallback divergence — decision not made.** `rulesRegionHtml`
  falls back to a hardcoded object proposing `cover1`; the scorer and pick
  sheet fall back to the top-level standard section. Green Eggs' brackets
  (3, 4) have no `oneset` section at all. Either point the panel's fallback
  at the same expression the other two use, or give `def_cfg` a real
  `oneset` section — the latter also needs a one-shot update for brackets 3
  and 4, which already exist. **Zero live exposure today**; the trap is that
  any unrelated rules save materialises the invention.
- **Boot leaves booted players accruing zeros** via `season_rosters`.
  Behavioural bug plus two wrong sentences (the SQL comment and the confirm
  text). Fix candidate recorded; not started.
- **Membership gate on `get_show_picks` is unexecuted.** Auth is verified
  (`P0001`), membership is not, and the dev structurally cannot test it —
  global admin short-circuits the check in every league. Closing it needs a
  throwaway non-global-admin account added to exactly one league, then one
  `curl` against the other league's bracket. ~10 minutes.
- **`app.js` cache-busting.** `max-age=600` on both `app.js` and
  `index.html`, bundle referenced with no content hash or query string.
  Forced the Stage P1/P2 split and will force the same dance on every future
  breaking change. Recommended fix: build-keyed query string.
- **The database restore path has never been tested.** Backups now exist
  (`C:\Users\kylem\backups\fantasyeggy\`); no restore has ever been
  performed, so it is a hypothesis. Test against a scratch project, never
  production.
- **The scenario suite has no two-league fixture.** A second league exists in
  production as of 2026-08-16, so `renderLeagueSelector`'s dropdown branch is
  now a real gap rather than a hypothetical one.
- **The no-league empty state has NO scenario coverage**, and the fixtures
  deliberately prevent it rendering (`p4` is given a membership row
  specifically so `renderNoLeague()` doesn't fire). Checking it needs a
  throwaway non-global-admin account — which **also** closes the
  membership-gate item above, since that needs exactly the same thing: a
  non-global-admin in one league. Register it, check the empty state at zero
  leagues, add it to one league, then use it for the `get_show_picks` check.
  Note the dev server runs against production Supabase, so registering
  creates a real `players` row (removable via `global_boot_player`).
- **`is_mine` not yet eyeballed in-app.** Stage P replaced `player_id` with a
  server-computed `is_mine`. A uniformly-false value renders plausibly —
  everything displays, nothing is highlighted, which reads as an ordinary
  no-hits show. Check on a show where you know you had hits.

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
