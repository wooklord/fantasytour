# Auth and security: rate-limiting, stored session, PIN storage and reset

> Extracted verbatim from `CLAUDE.md` at commit 54a5ab8 (2026-10-18), original lines 1066–1208, 1265–1308, 3900–4012. Nested entries were de-indented to top level; wording is unchanged.
> Decision record — currently binding. `CLAUDE.md` holds only a pointer stub under the same entry name; this file is the full text and rationale.

- **Login rate-limiting: the top real security exposure in this app, deferred
  with a dated trigger — not an open-ended "someday."** `login` is a public,
  unrated RPC that takes a nickname + a 4–8 digit PIN, and nothing throttles
  guesses. The reason this outranks every other gap on the list is that all
  four preconditions for cheap online guessing are already satisfied *and
  public*: nicknames are enumerable (they're printed on the leaderboard),
  PINs can be as short as 4 digits — nominally a 10k keyspace, but the
  *effective* one is far smaller, since a meaningful share of human-chosen
  4-digit PINs are `1234`, `0000`, or a birth year, which is exactly why
  part (3) of the fix below is not optional — the anon key needed to call
  the endpoint ships in the deployed frontend by design, and `login`'s exact
  signature is in committed SQL. None of that is a leak — every piece is
  public on purpose or unavoidably — but together they mean the only thing
  standing between an attacker and an account is the absence of any
  throttling or PIN-strength floor.
  - **Trigger: before Session 5's Facebook League, and before any non-dev
    league admin exists** — whichever comes first. Same dated-trigger pattern
    as the ladder-mutability decision below. Today's Ambassadors are a
    closed, trusted pool where the risk is theoretical — counted directly
    2026-08-12: 14 league members, all 14 in the Official opt-in set, 13
    currently rostered. A ~50-person semi-public league is where it stops
    being theoretical.
  - **Minimal viable fix — three parts. Any one alone is insufficient, and
    they cover different attacks; don't ship a subset.**
    1. **Per-nickname progressive delay, NOT lockout.** Escalating
       server-side delay (or reject-with-retry-after) on consecutive
       failures for the same `lower(name)`, reset on success. Throttles
       vertical guessing (many PINs against one account) without ever
       handing anyone a button that disables an account.
    2. **Aggregate failed-attempt throttle across ALL accounts in a rolling
       window.** This is the only part that sees PIN *spraying* at all, and
       it is not redundant with (1) — do not drop it as belt-and-braces.
       The efficient attack here is horizontal, not vertical: try one likely
       PIN (`1234`, `0000`, a birth year) exactly once against every
       enumerable nickname. Each account records a single failure, so no
       per-account counter ever trips, while across ~50 accounts a handful
       of common PINs has good odds of landing one. Per-account state is
       structurally blind to this; only a global failure rate sees it.
    3. **Weak-PIN rejection at set/reset time.** Minimum length above 4 for
       newly-set PINs, plus a denylist of trivial values (repeated digits,
       ascending/descending sequences, plausible birth years). This is the
       only one of the three that shrinks the *useful* keyspace rather than
       slowing access to it — throttling alone leaves `1234` just as likely
       to be someone's PIN, it just takes longer to try. Note that existing
       short/weak PINs stay weak until rotated; **whether to force rotation
       on existing accounts is an open sub-question, deliberately not
       decided here** (it trades a real security gain against pushing every
       player through a forced-change interstitial — the machinery for which
       already exists, see `must_change_pin`).
    All three must be enforced **server-side inside `login`** (and, for (3),
    inside `change_own_pin`/`admin_reset_player_pin`). A client-side check is
    worth nothing against an attacker calling the RPC directly, which is the
    entire threat model.
  - **Rejected design, recorded so it isn't re-proposed as the simpler
    option: a per-nickname failed-attempt counter with a hard lockout
    window.** It was proposed more than once and it's the wrong shape, for
    two independent reasons — either alone disqualifies it. (a) It doesn't
    see spraying, per (2) above: the attack's volume is distributed across
    accounts while the counter measures per-account attempts. (b) A hard
    lockout is a griefing vector, not an acceptable tradeoff — nicknames are
    public and picks have hard submission deadlines, so anyone could lock
    every account in a bracket an hour before cutoff and prevent the entire
    league from submitting. That's a worse and more likely outage than the
    compromise it prevents. Progressive delay gets the throttling benefit
    without creating the button.
  - **Why the integrity notes elsewhere in this file are publishable and this
    one is still worth fixing** — the distinction matters and is easy to get
    backwards. Notes like "`admin_update_config` has no schema validation" or
    "`admin_set_season_roster` has no `roster_locked_at` check" are safe to
    write down publicly **because they're dominated by this exposure, not
    because admin auth contains them.** "It's admin-gated" is not a
    containment argument in a system whose auth is the weakest link — if PIN
    guessing works, admin-gating is exactly as strong as a PIN. They're
    publishable because they disclose nothing an attacker who already reads
    the committed SQL doesn't have, and because compromising auth is strictly
    easier than exploiting any of them. Fix this bullet and the admin-gating
    argument becomes real; until then, don't lean on it.
- **The stored session IS the credential: `ft_session` persists the
  plaintext PIN.** Same auth story as the bullet above, recorded separately
  because the fix is different. `auth.js:26` writes
  `state.session = { ...d, pin: $("#a-pin").value }` straight into
  `localStorage`, and every RPC in the app reads `state.session.pin` to
  authenticate (`switcher.js:49`, `realtime.js:31`, and ~everywhere else).
  Consequences worth stating plainly:
  - **There is no revocation path short of changing the PIN.** A leaked
    session isn't a token that can be invalidated server-side — it's the
    password itself, so "log this device out" and "rotate the credential"
    are the same operation.
  - **It now sits on its OWN storage origin — resolved 2026-08-15 by the
    domain move (see below).** Until then everything served from
    `wooklord.github.io` was one origin, so this app shared `localStorage`
    with the Ambassadors app and anything else published there; key
    prefixing (`ft_*`) is naming, not isolation, so any script on any page
    of that origin could read `ft_session` and recover a player's PIN in
    plaintext. On `fantasyeggy.wooklord.net` that specific exposure is
    gone: a sibling app on a different subdomain is a different storage
    origin and cannot reach these keys.
    - **This narrowed the blast radius; it did NOT fix the underlying
      problem.** The stored credential is still a plaintext PIN with no
      revocation path — the token exchange below is unchanged and still
      the actual fix. What the move removed was one *route in*, not the
      thing being protected.
    - **The cookie caveat is now live rather than hypothetical.**
      Subdomains are separate storage origins, but `wooklord.net` is a
      registrable domain, so a cookie set with `domain=.wooklord.net`
      would be readable by every subdomain including this one. Storage
      separates automatically; cookies don't. This app sets no cookies at
      all today — keep it that way, or scope any future cookie to the
      exact host with no `domain` attribute.
  - **Eventual fix, recorded so it isn't redesigned from scratch: exchange
    the PIN for an opaque server-issued session token at login, store the
    token, never store the PIN.** That gives a real revocation path and
    makes a stolen session bounded rather than permanent. This is genuine
    work — a new table, token issue/verify/expiry, and re-pointing every
    RPC's auth argument off `p_pin` — **not a quick patch. Don't start it
    without scoping it as its own session.**
  - Scale note, same as elsewhere: today every app on that origin is the
    dev's own, so the practical exposure is a bug in the dev's own code,
    not a third party. That's why this is recorded rather than treated as
    an incident.
- **At rest, PINs ARE hashed — bcrypt, verified correctly. Don't
  re-investigate this.** Different question from the bullet above (which is
  about the *client*), with a different answer, so both are recorded.
  `register_player` stores `crypt(p_pin, gen_salt('bf'))` into
  `players.pin_hash` (`sql/stage_c1_rpcs.sql:72-73`) — `gen_salt('bf')` is
  Blowfish/bcrypt with a per-row salt — and `_auth_player` verifies with
  `pl.pin_hash <> crypt(p_pin, pl.pin_hash)`, the standard
  recompute-using-the-stored-hash-as-salt comparison. There is no plaintext
  PIN column anywhere; the column is `pin_hash`.
  - **Blast radius, stated honestly rather than reassuringly:** read access
    to `players` yields bcrypt hashes, not a plaintext credential dump — so
    a table read is meaningfully better than the client-side story above.
    But **against a 4-digit PIN the hashing buys far less than it would for
    real passwords**: the entire keyspace is 10k candidates, so an attacker
    holding the hashes brute-forces them offline regardless of bcrypt's
    cost factor. This is the same root cause as the weak-PIN half of the
    rate-limiting bullet — hashing protects the *storage*, only PIN length
    protects the *credential*.
  - Implication for the eventual token exchange: since storage is already
    hashed and correct, that work is confined to the client/session layer —
    issue and store a token instead of the PIN. It does **not** require
    re-doing password storage, which is one of the few things here that's
    already right.

---

- **Resolved (Session 4): both halves of decision 3 now exist.** A
  league/global admin can run `admin_reset_player_pin`
  (`sql/stage_l_admin_pin_reset.sql`) to server-generate a new PIN and force
  the target to set a real one on next login (`must_change_pin`,
  `sql/stage_k_pin_management.sql`, `renderForceChangePin()` in `auth.js`).
  Separately, a player can voluntarily change their own PIN any time via a
  "Change PIN" form in `settingsPanelHtml()` (`settings.js`'s
  `changeOwnPin()`), calling the same `change_own_pin` RPC the forced flow
  uses — current PIN required and verified server-side (`_auth_player`
  raises before any write if it's wrong), so a live session on a shared
  device can't be used to lock the owner out. This was initially shipped
  admin-reset-only, with self-service deferred as a "follow-up" — corrected
  same session, before the SQL was run: the admin reset was always meant as
  the *fallback*, not the only path, so a player without admin access had no
  real recovery until this landed. The "only recovery is raw SQL against
  `pin_hash`" framing of this bullet is fully retired now, not just half of it.
- **Reveal-once secrets (the PIN reset's `new_pin`) transit through whatever
  request/response logging Supabase's platform does, if any — outside this
  app's control, but a real property worth having written down rather than
  assumed away.** `admin_reset_player_pin` never writes the plaintext PIN to
  any table or application log — it exists only as a `plpgsql` local
  variable and the single RPC response that returns it once, matching the
  "admin never sees/chooses it, relayed once" requirement. But if
  project-level API/request logging is ever enabled on the Supabase project
  (not something this codebase controls or has audited), that response body
  — like any RPC response containing a secret — would transit through it the
  same way. This isn't specific to a coding mistake here; it's an inherent
  property of any "reveal a secret once via an RPC response" pattern, and
  applies equally to a future self-service forgot-PIN flow if one is ever
  built the same way. Worth a one-time check of the project's logging
  settings before this matters at real scale, not something to re-derive
  from a chat transcript later.
- **Fixed: auth rejections from `reopen`/`cutoff_changed`/`finalize` used to all
  return HTTP 500**, indistinguishable from a genuine server bug (the
  handler's single `catch` turned "wrong PIN," "not authorized," and a real
  error into the same generic 500). `requireLeagueAdmin` now throws tagged
  `AuthError`/`ForbiddenError` (401/403 respectively), and the router's catch
  reads `.status` off the thrown error instead of hardcoding 500 — a real
  server error still falls through to 500 unchanged. Verified live against
  the deployed function, not just the source: a bad-credentials call now
  returns 401. This was already flagged here as a known gap before it was
  fixed; leaving this note rather than deleting it, since "was this ever
  actually broken" is exactly the kind of thing this file exists to answer
  without re-deriving it.

---

**NOT a bug, checked 2026-08-17 so nobody re-investigates: `must_change_pin`
is set correctly by BOTH admin reset buttons.** It looks like Session 4
might have wired the interstitial to `globalResetPin` only, but there is
just one implementation — `resetMemberPin` (`admin.js:463`) and
`globalResetPin` (`admin.js:167`) call the same `admin_reset_player_pin`
RPC, differing only in `p_league_id`. That RPC sets
`must_change_pin = true` unconditionally (`stage_l:77`), and the only other
statement in non-archive SQL that writes `pin_hash` is `change_own_pin`,
which clears the flag. There is no second path to miss.

**ADMIN PIN RESET — READ FROM THE LIVE CATALOG 2026-10-11, because three
Green Eggs league admins now exist and this is the path they will use.
Read-only; nothing changed. Playbook for admins:
`docs/admin_playbook_forgot_pin.md`.**
- **⚠️ CORRECTION, RECORDED AT FULL WEIGHT: a claim circulated in Claude
  Chat — relayed from an August chat transcript, never from the repo — that
  `resetMemberPin` called an `admin_set_player_pin` which did NOT set
  `must_change_pin`, so a league admin kept permanent knowledge of a reset
  player's PIN. THAT CLAIM WAS WRONG; THE CODE WAS RIGHT.** The live
  catalog has no `admin_set_player_pin`; `git log --all -S` finds the name
  in no commit, ever; no file in the repo and no commit carries the date
  the claim was attributed to (2026-08-22). The only reset RPC is
  `admin_reset_player_pin`, and its live body sets `must_change_pin =
  true` in the same UPDATE that writes the hash — as the "NOT a bug"
  entry immediately above already recorded on 2026-08-17. Same family as
  the false-memory entries elsewhere in this file: a transcript read back
  as the repo. **A claim about what a function does is settled by
  `pg_get_functiondef`, not by any chat.**
- **What the reset actually is (live body):** caller authenticates and
  passes `_reject_if_must_change_pin`; `_is_league_admin_or_global(caller,
  p_league_id)` gates it; target must exist; a global-admin target needs a
  global-admin caller; a non-global caller's target must have a
  `league_members` row in `p_league_id`. Then a six-digit temporary PIN
  (`lpad(floor(random()*1000000), 6, '0')`), bcrypt-hashed, flag set,
  `new_pin` returned once. Frontend: one `confirm()`, then a blocking
  `alert()` with the PIN (`resetMemberPin`, `admin.js`). The admin never
  chooses the PIN and knows the temporary one only until the player's
  next login; `change_own_pin` (`^\d{4,8}$`, no denylist) replaces it and
  clears the flag.
- **Scope, by target:** another league's member — blocked ("That player
  is not in this league"); **another league admin in the same league —
  ALLOWED, nothing checks the target's admin flag**, so the three Green
  Eggs admins can reset each other; a global admin — blocked for a league
  admin. One global admin exists.
- **Accountability: NONE.** No audit table, no trigger in `public`, no
  `updated_at` on `players`, no reset timestamp, no actor. The dashboard
  API log sees a `POST .../rpc/admin_reset_player_pin` with the shared
  anon key and cannot say which admin pressed it.
- **The button:** one confirm, plain `.btn.ghost.small` — indistinguishable
  from any small button, while Boot beside it is coral with two confirms.
  Already flagged in the "Members panel signalling" entry above.
- **A RESET BREAKS THE PLAYER'S EXISTING SESSIONS ON EVERY DEVICE, BUT
  DOES NOT LOG THEM OUT — traced 2026-10-11.** `ft_session` stores the
  plaintext PIN and every RPC sends `state.session.pin`; 31 of the 35
  public RPCs call `_auth_player`, which recomputes `crypt(p_pin,
  pin_hash)` against the NEW hash and raises "Wrong name or PIN". The four
  that don't (`get_league_shows`, `get_bracket_seasons`,
  `register_player`, `rls_auto_enable`) take no PIN. Nothing server-side
  pushes a logout and the stored session's `must_change_pin` is the OLD
  login's `false`, so the forced-change screen never appears on the old
  device. **What the player sees there, by surface:** the shows list still
  renders (public read); opening a show → "Couldn't load this show /
  Wrong name or PIN" (`can_submit_picks`); saving picks → "Wrong name or
  PIN" in `#p-err`; Standings → stops updating silently (`renderBoard`
  has no catch); a full reload → "Something broke loading the app / Wrong
  name or PIN" with Reload and Log out (`my_leagues` in `boot()`).
  Realtime toasts keep arriving (anon key, no PIN). Recovery is Log out →
  log in with the temporary PIN → forced change. No message says "your
  PIN was reset". The playbook's step 1 ("only reset someone who
  genuinely cannot log in") exists because of this.
- **PROPOSED — a separate PIN batch, AFTER the post-first-show batch, NOT
  added to it. Recorded 2026-10-11; none of it approved, none of it
  scheduled:**
  - **(a) Audit log for admin resets and boots.** A table with target
    player, actor, league, timestamp, written INSIDE `admin_reset_player_pin`
    and `admin_league_boot` so it cannot be skipped. Proposed, not
    approved.
  - **(b) Policy on league admins resetting other league admins —
    DECIDED 2026-10-11 (dev): ALLOW-PLUS-LOG.** League admins keep the
    ability to reset each other; (a)'s audit log is what makes it
    accountable after the fact. The recovery path stays symmetric when
    one admin is the one locked out. **Rejected: restrict-to-global** —
    one line in the RPC and it closes the peer-takeover route, but it
    makes the dev the only recovery for a locked-out league admin, which
    is exactly the admin-reset fallback the "Resolved (Session 4)" entry
    says must exist. So (b) depends on (a): the RPC does not change, the
    log is the control. Until (a) ships, the current behaviour (allowed,
    unlogged) stands as the accepted state.
  - **(c) Weak-PIN denylist on `change_own_pin`** (repeated digits,
    straight sequences, 1234 and friends, plausible birth years). Proposed;
    it is part (3) of the login rate-limiting item (Pre-Session-5 gate
    #1) and belongs with it, not alone.
  - **(d) `random()` is Postgres's non-cryptographic PRNG. ACCEPTED** for a
    six-digit temporary PIN that must be changed on first login and is
    relayed by a human — not worth `gen_random_bytes` until (c) exists.
  - **(e) "Your PIN may have been reset" hint — client-only, from the
    session trace above.** When an RPC fails with "Wrong name or PIN" for
    a session that previously worked (i.e. `state.session` exists, so the
    PIN once authenticated), show a one-line hint next to the error: an
    admin may have reset your PIN — log out and log in with the temporary
    one. Today the old device gets the bare error on four different
    surfaces and nothing says why. Proposed, not approved.
  - **(f) `renderBoard` (Standings) has NO catch — client-only, not
    PIN-specific, filed here because it surfaced here.** A failed
    `get_bracket_scores` leaves the board silently stale with only a
    console error, where every other tab renders a visible failure
    (`boot()`'s panel, `renderShowDetailError`, `#p-err`). Add error
    handling to match. Proposed, not approved.
  - Side note from the same read: `admin_reset_player_pin` carries the
    default PUBLIC execute grant alongside its anon grant. Harmless here
    (the body authenticates; anon has it anyway), same gap the
    `_auth_player` entry documents, worth revoking in the same batch.
