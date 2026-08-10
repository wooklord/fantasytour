-- ============================================================
-- STAGE J — realtime ping table for scores/league_shows toasts
-- ============================================================
-- Design locked in CLAUDE.md ("2.0 REBUILD roadmap", decision 4). Build to
-- that design rather than re-deriving it here; this comment is a pointer,
-- not a restatement.
--
-- Why not just add a public SELECT policy to scores/league_shows directly:
-- this app has no per-request identity (name+PIN auth via RPCs, not
-- Supabase Auth — every client shares one anon key regardless of which
-- player is "logged in"). A public policy on those tables would expose
-- every league's scores to anyone holding that key, undoing
-- get_bracket_scores's membership gate. Ruled out on that evidence, not
-- preference.
--
-- Instead: a minimal ping table carrying nothing inferable — no
-- bracket_id, no counts, no deltas, just "this league+show changed, go
-- refetch." Upserted by the edge function once per scoring/notify pass,
-- not by a trigger (a trigger would fire per-row on every
-- identical-value re-upsert during a live show). Client subscribes on
-- its OWN dedicated realtime channel — not the existing shared
-- `live-${bracketId}` channel (setlist_songs/league_shows/seasons/scores)
-- — so a future misconfiguration here can't repeat the channel-poisoning
-- bug: a table subscribed to postgres_changes without being BOTH
-- publication-registered AND RLS-permitted silently kills delivery for
-- every OTHER binding sharing that channel, confirmed directly (see
-- CLAUDE.md's realtime gotcha for the isolated repro). Real score/show
-- data never crosses this public channel — the client still has to
-- refetch through the existing authenticated RPC (get_bracket_scores /
-- get_league_shows) to see anything real; a ping alone tells it nothing.

create table if not exists realtime_pings (
  league_id  bigint not null references leagues(id) on delete cascade,
  show_id    bigint not null references shows(id) on delete cascade,
  updated_at timestamptz not null default now(),
  primary key (league_id, show_id)
);

alter table realtime_pings enable row level security;

-- Safe to be public: this row is "this league+show changed," nothing
-- more. Gate 1 of 2 — see the publication statement below for gate 2 and
-- why both are required.
create policy "pub realtime_pings" on realtime_pings for select using (true);

-- Gate 2 of 2 — publication membership. Both this and the RLS policy
-- above are required, and each fails differently and silently if
-- missing:
--   * absent from the publication -> the client's subscribe() on this
--     table's channel still reports SUBSCRIBED, but postgres_changes
--     registration fails for EVERY binding on that channel, not just
--     this one (the confirmed channel-poisoning bug this table's own
--     dedicated channel is designed to be immune to).
--   * present without a permitting SELECT policy -> registers fine,
--     delivers nothing at all for this table, no error either.
alter publication supabase_realtime add table realtime_pings;

-- ============================================================
-- VERIFICATION — run both checks separately; they fail differently, so a
-- single "it looks subscribed" check in the browser proves neither one.
-- ============================================================

-- 1. Publication membership. Expect exactly one row back.
select schemaname, tablename
from pg_publication_tables
where pubname = 'supabase_realtime' and tablename = 'realtime_pings';

-- 2. RLS policy. Expect exactly one row back: polcmd 'r' (select),
--    polroles empty/{0} (meaning PUBLIC — every role, including anon).
select polname, polcmd, polroles
from pg_policy
where polrelid = 'realtime_pings'::regclass;

-- 3. End-to-end, from a real anon-key client (not this SQL editor):
--    subscribe to postgres_changes on realtime_pings, then run
--       insert into realtime_pings (league_id, show_id) values (<a real league_id>, <a real show_id>)
--       on conflict (league_id, show_id) do update set updated_at = now();
--    from this editor (service_role bypasses RLS, same as the edge
--    function's own writes) and confirm the anon client actually
--    receives an event. This is the only check that proves both gates
--    passed AT ONCE, end to end, rather than each in isolation.
