# Realtime: publication gate, channel poisoning, the ping table

> Extracted verbatim from `CLAUDE.md` at commit 54a5ab8 (2026-10-18), original lines 959–999, 2929–2983. Nested entries were de-indented to top level; wording is unchanged.
> Decision record — currently binding. `CLAUDE.md` holds only a pointer stub under the same entry name; this file is the full text and rationale.

- **Realtime only pushes tables in the `supabase_realtime` publication**
  (currently `shows`, `seasons`, `setlist_songs`, `scores`, `league_shows` —
  adding another table requires `alter publication supabase_realtime add
  table <t>`) — **and subscribing to a table that ISN'T in it silently kills
  postgres_changes delivery for every OTHER binding on the same channel,
  not just that one.** `realtime.js` puts all four of its postgres_changes
  subscriptions (`setlist_songs`, `league_shows`, `seasons`, `scores`) on
  one shared channel (`live-${bracketId}`). `scores` and `league_shows`
  were silently missing from the publication (dropped or never re-added
  during Stage A's schema rebuild) — the actual, confirmed bug wasn't just
  "those two toasts don't fire," it was that the whole shared channel's
  postgres_changes registration failed, so `setlist_songs`'s song-by-song
  toasts and `seasons`'s winner toasts died too, despite both of those
  tables being correctly configured the entire time.
  **The channel still reports `SUBSCRIBED` when this happens** — that
  status only reflects the channel/socket join succeeding, not whether the
  postgres_changes registration behind it actually worked, so nothing in
  the client-visible state indicates a problem. Confirmed by direct
  isolation, not inference: an identical 4-binding channel reproduced the
  dead behavior, a channel with only the 2 valid bindings (of the same 4)
  delivered cleanly, and a single-binding channel worked alone too — the
  invalid bindings, not anything about `setlist_songs`/`seasons`
  themselves, were the cause. `subscribeRealtime()` now warns
  (`console.warn`) whenever the channel reaches any status other than
  `SUBSCRIBED`, since that's the only client-visible signal available —
  the status itself can't reveal a poisoned-channel case like this one.
  **Publication membership and RLS are two independent gates, in series —
  both must pass, and each fails differently.** A table absent from the
  publication isn't realtime-eligible at all (this is what poisons the
  shared channel above). A table that IS in the publication but has no
  permitting RLS policy registers fine — the channel doesn't break — but
  delivers **nothing at all** for that table, not an empty or redacted
  payload, verified directly (added `scores` to the publication alone,
  subscribed an anon-key client with no SELECT policy on the table, forced
  a real value change, zero events arrived). This is why fixing the
  publication gap didn't require touching RLS: `scores`/`league_shows`
  still have zero public SELECT policies by Stage A's original design
  (scoped reads go through RPCs, not RLS — see below), so their own
  realtime toasts remain genuinely non-functional even after this fix —
  intentionally; only the collateral damage to the other two tables'
  delivery was the bug.

---

4. **scores/league_shows realtime toasts: build a ping table (not a public RLS
   policy, not polling) — built (Session 3).** This app has no per-request
   identity — players authenticate via a name+PIN RPC, not Supabase Auth, so
   every request shares one anon key regardless of which player is "logged in"
   client-side. A public RLS policy on `scores`/`league_shows` would expose
   every score in every league to anyone holding that key, undoing
   `get_bracket_scores`'s membership gate — ruled out on that evidence, not
   preference.

   **What shipped**, matching the design above exactly: a `realtime_pings`
   table (`sql/stage_j_realtime_ping.sql`) carrying only `{league_id, show_id,
   updated_at}` — no `bracket_id`, no counts, no deltas, nothing inferable.
   Written by the edge function's new `pingRealtime()` helper
   (`supabase/functions/carton-sync/index.ts`), called once per real change —
   inside `announcements()` right after each `remind_sent`/`lock_sent`/
   `winner_sent` stamp, inside `scoreShow()`'s per-league-show loop only when
   a bracket actually had a score write (`scoreBracket`'s existing
   `score_writes` diff count) or a status flip to `live`, and inside
   `reopenShow()`. Not a trigger — deliberately called from application code
   at each of those points, so a quiet cron tick with nothing new doesn't
   write (and doesn't fire a client refetch) at all. Both gates are on: added
   to the `supabase_realtime` publication AND given a public SELECT policy
   (`create policy "pub realtime_pings" ... for select using (true)`) — the
   SQL file's own verification section checks each independently, since they
   fail differently and silently (see the publication/RLS gotcha above).

   On its own dedicated channel (`ping-${leagueId}` in `realtime.js`),
   separate from the existing `live-${bracketId}` channel — so a future
   misconfiguration on this table can't repeat the channel-poisoning bug.
   `handlePing()` is the client-side consumer: on any ping, it refetches
   `get_league_shows` (for the remind/lock/winner freshness check) and
   `get_bracket_scores` (for the winner toast and the player's own "you're at
   N pts" toast) — one `get_bracket_scores` call covers both toasts, where the
   two dead bindings it replaced used to fetch separately. Real score/show
   data never crosses the public ping channel; the ping only ever says
   "something changed here, go refetch."

   **The two now-dead bindings this replaces (`league_shows` UPDATE and
   `scores` `*` on the shared channel) are gone, not just superseded** —
   they never delivered anything (no public RLS policy on either table, by
   design) and would have been confusing dead weight sitting next to the
   working ping-driven logic. The shared channel now carries only the two
   bindings that were ever real: `setlist_songs` INSERT and `seasons`
   UPDATE.

   **Verified two ways**, per the exact failure mode that already cost a
   debugging session once (the original channel-poisoning bug): (1) the SQL
   file's publication-membership check and RLS-policy check are two separate
   queries, not one "looks subscribed" check — each gate fails differently
   and silently, so only checking one proves nothing about the other. (2)
   `test/harness.mjs`'s realtime block now emits `setlist_songs` and
   `seasons` events (previously never exercised by anything in this harness
   at all — a gap, not a regression) alongside the new `realtime_pings`
   emits, so adding a fifth thing to subscribe to is checked against ALL
   five bindings together, not the new one in isolation.
