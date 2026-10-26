-- ============================================================
-- FANTASY EGGY — STAGE R: seed league_shows at league creation
-- ============================================================
-- ⚠️⚠️⚠️ STATUS: WRITTEN 2026-10-11, NOT APPLIED — apply after the first
-- Green Eggs show scores, alongside the cron change. ⚠️⚠️⚠️
--
-- ⚠️ REQUIRES STAGE U FIRST (sql/stage_u_show_sync.sql, 2026-10-26): the
-- INSERT in SECTION 2 seeds league_shows.cutoff_set_by_admin = false, a
-- column Stage U creates (a seeded cutoff is derived, so the daily show
-- sync may recompute it on a date move). Applied before Stage U, this file
-- fails loudly on that column inside its transaction — it cannot
-- half-apply. Stage U precedes it in every build order.
--
-- Until SECTION 3's catalog check passes, the live global_create_league is
-- still the stage N body and a NEW LEAGUE STILL STARTS WITH ZERO
-- league_shows ROWS. Do not read this file's presence in sql/ as evidence
-- it ran: sql/stage_f_official_default_optin.sql sat here for two months
-- looking applied while the live column default stayed `false`. A stage
-- file proves the SQL was WRITTEN. The catalog proves it was APPLIED.
-- When this IS applied, change the status line above and the matching
-- CLAUDE.md entry in the same commit.
--
-- WHY: Green Eggs (league 2) was created 2026-08-17 by global_create_league
-- and had NO league_shows rows until 2026-10-11 — no cutoffs, every button
-- "Score", submit_picks raising, the scorer skipping it. The function
-- creates the league and two brackets and nothing else; the only creator of
-- overlay rows is syncShows() in the edge function, and nothing but the
-- manual "Sync shows" button invokes it. Fixed for Green Eggs by pressing
-- that button. This file fixes it for every league created from now on.
--
-- WHAT CHANGES: global_create_league's body gains one INSERT (one
-- league_shows row per existing show) and one extra key in its return
-- JSON (`shows_seeded`). A new internal helper, default_show_cutoff,
-- computes the cutoff. Signature, grants and every existing row in every
-- table are untouched — the INSERT is scoped to the league id returned by
-- the INSERT immediately above it, which did not exist a statement ago.
--
-- WHAT DOES NOT CHANGE: how the edge function creates overlay rows for
-- shows that appear AFTER a league exists. That is still syncShows(), and
-- scheduling it is the separate, HELD cron change.
--
-- BASED ON THE LIVE BODY, not on a stage file: pg_get_functiondef was read
-- 2026-10-11 and diffed (whitespace/CRLF-normalised) against the
-- definition in sql/stage_n_reject_pending_pin_change_writes.sql:
-- identical. The body below is that body plus the INSERT, the `seeded`
-- variable, and the extra return key.
--
-- ------------------------------------------------------------
-- THE CUTOFF MUST EQUAL venueCutoffISO() IN THE EDGE FUNCTION
-- (supabase/functions/carton-sync/index.ts) — AND IT CAN DRIFT.
-- ------------------------------------------------------------
-- Three facts are duplicated between that TypeScript and this SQL:
--   1. The hour: DEFAULT_CUTOFF_HOUR_ET = 18 there, `time '18:00'` here.
--   2. The fallback zone when the venue's state is unmapped:
--      "America/New_York" in both.
--   3. The state→zone mapping (STATE_TZ). NOT duplicated here — this file
--      reads shows.timezone, which syncShows() persists from that same map
--      (resolveVenueTz). Null means "unmapped", so the fallback applies,
--      exactly as venueTz() falls back there.
-- Method differs too: TS probes the zone's offset at 12:00 UTC on the show
-- date; `at time zone` applies the zone at 18:00 local. They agree unless a
-- DST transition falls between those two instants on a show date. US and
-- Canadian transitions are at 02:00 local, so for this band's venues they
-- never disagree — but that is a property of the zones, not of the code.
--
-- PIN, mechanical, at apply time: SECTION 3 step 3 joins every UPCOMING
-- league_shows row to its show and counts rows where the stored cutoff —
-- every one of which venueCutoffISO() wrote — differs from this helper's
-- output. Expected 0. The set covers both DST offsets (October rows at
-- 22:00Z, November rows at 23:00Z) and the null-timezone fallback branch
-- (the two Washington, D.C. shows). That is SQL tested against TS output,
-- not a comment hoping they agree.
-- PIN, by convention, ongoing: the four literal asserts in SECTION 3 step 4.
-- A planned post-first-show change moves venueCutoffISO() into a shared
-- .js module (the scoring.js precedent) with the same four expectations in
-- a node test, so a change to the hour fails both files.
-- ============================================================

begin;

-- ------------------------------------------------------------
-- SECTION 1 — helper: the default cutoff for a show
-- ------------------------------------------------------------
-- "6 PM at the venue, on the show date", as an absolute instant. p_tz is
-- shows.timezone; null falls back to Eastern, mirroring venueTz().
-- Internal — not granted to anon/authenticated, and the default PUBLIC
-- execute grant is revoked (see the _auth_player gotcha in CLAUDE.md).
create or replace function default_show_cutoff(p_showdate date, p_tz text)
returns timestamptz language sql stable as $$
  select (p_showdate + time '18:00') at time zone coalesce(p_tz, 'America/New_York');
$$;
revoke execute on function default_show_cutoff(date, text) from public;

-- ------------------------------------------------------------
-- SECTION 2 — global_create_league, now seeding league_shows
-- ------------------------------------------------------------
create or replace function global_create_league(p_name text, p_pin text, p_league_name text)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare
  pl players; new_league_id bigint; seeded int;
  -- Instance constant: default slot config seeded for new brackets (mirrors
  -- stage_a_schema.sql's def_cfg — keep the two in sync).
  def_cfg jsonb := '{
    "slots": [
      {"key":"opener","type":"opener","label":"Opener","points":2},
      {"key":"closer","type":"closer","label":"Set 2 Closer","points":2},
      {"key":"encore","type":"encore","label":"Encore","points":2}
    ],
    "flat_picks": 3, "flat_points": 1,
    "partial_credit": true, "partial_points": 1,
    "allow_duplicates": false,
    "wildcards": {"debut": true},
    "bonuses": {"cover":0,"debut":0,"perfect":0,"jamchart":0},
    "voting_override": "auto"
  }';
begin
  pl := _auth_player(p_name, p_pin);
  perform _reject_if_must_change_pin(pl);
  if not pl.is_global_admin then raise exception 'Global admins only'; end if;
  if coalesce(trim(p_league_name), '') = '' then raise exception 'League needs a name'; end if;
  insert into leagues (name) values (trim(p_league_name)) returning id into new_league_id;
  insert into brackets (league_id, name, kind, config) values (new_league_id, 'Official', 'official', def_cfg);
  insert into brackets (league_id, name, kind, config) values (new_league_id, 'Casual', 'casual', def_cfg);

  -- One overlay row per existing show, so the league is on the schedule
  -- from its first second rather than from the next manual "Sync shows".
  --
  -- Future shows: cutoff defaulted, status 'upcoming', flags null — the
  -- same row syncShows() would have inserted.
  --
  -- Past shows: status 'final' with all three announcement flags stamped.
  -- Two deliberate choices, flagged because Stage A did it differently:
  --   * Stage A COPIED old statuses when it seeded Ambassadors. There is
  --     nothing to copy for a brand-new league. 'final' rather than
  --     'upcoming' because the season-champion announcement requires every
  --     overlay row in a season's date range to be final — a league created
  --     mid-season with past shows stuck at 'upcoming' (never scored: the
  --     scorer's eligibility floor is one day) would never have its
  --     champion announced. 'final' plus stamped flags: nothing announces,
  --     nothing loops.
  --   * format is always 'standard'. The sync's festival-tag promotion only
  --     targets 'standard' rows, so a later sync still promotes a festival
  --     show. (The tag is unused on The Carton anyway.)
  -- `current_date` is the SERVER's (UTC) date; the edge function uses the
  -- Eastern date. A league created between 00:00 and 04:00 UTC on a show
  -- day would stamp that day's show 'final' where the sync would not. Not
  -- worth a timezone dance here: a show-day creation is an edge case and an
  -- admin can Reopen.
  insert into league_shows (league_id, show_id, cutoff_at, format, status, remind_sent, lock_sent, winner_sent, cutoff_set_by_admin)
  select new_league_id, s.id, default_show_cutoff(s.showdate, s.timezone), 'standard',
         case when s.showdate < current_date then 'final' else 'upcoming' end,
         case when s.showdate < current_date then now() end,
         case when s.showdate < current_date then now() end,
         case when s.showdate < current_date then now() end,
         false  -- Stage U: a seeded cutoff is derived, never admin-set (header note)
  from shows s;
  get diagnostics seeded = row_count;

  return json_build_object('ok', true, 'league_id', new_league_id, 'shows_seeded', seeded);
end $$;
-- Same signature as before, so the existing grants (anon, authenticated)
-- survive `create or replace`. Nothing to re-grant.

commit;

-- ============================================================
-- SECTION 3 — VERIFICATION (run separately, after the commit above)
-- ============================================================
-- Deployment check FIRST, from the catalog. The signature did not change,
-- so "the function exists" proves nothing — only the body does.
--
-- 1. Body contains the new INSERT. Expect: t
--   select pg_get_functiondef('global_create_league(text,text,text)'::regprocedure)
--          ilike '%insert into league_shows%';
--
-- 2. Helper exists, with no PUBLIC execute. Expect: one row, and the
--    grants query returns NO row whose grantee is PUBLIC.
--   select proname, pg_get_function_identity_arguments(oid)
--     from pg_proc where proname = 'default_show_cutoff';
--   select grantee from information_schema.routine_privileges
--     where routine_name = 'default_show_cutoff';
--
-- 3. THE DRIFT PIN — SQL against the cutoffs TS actually wrote. Expect: 0.
--    Every upcoming league_shows row (32 as of 2026-10-11: 16 shows × 2
--    leagues) was written by venueCutoffISO() and none has been
--    admin-edited (verified 2026-10-11: zero cutoff differences between the
--    two leagues on those 16 shows). Includes both DST offsets and the two
--    null-timezone D.C. shows. A non-zero count means the hour, the
--    fallback zone or the method has drifted — STOP and reconcile before
--    trusting any seeded cutoff.
--   select count(*) as drifted
--     from league_shows ls join shows s on s.id = ls.show_id
--    where s.showdate >= current_date
--      and ls.cutoff_at <> default_show_cutoff(s.showdate, s.timezone);
--    (For diagnosis, list them:)
--   select ls.league_id, ls.show_id, s.timezone, ls.cutoff_at,
--          default_show_cutoff(s.showdate, s.timezone) as sql_value
--     from league_shows ls join shows s on s.id = ls.show_id
--    where s.showdate >= current_date
--      and ls.cutoff_at <> default_show_cutoff(s.showdate, s.timezone);
--
-- 4. Literal asserts — the ongoing by-convention pin. Expect: t, t, t, t.
--    Same four expectations belong in a node test against venueCutoffISO()
--    once it is in a shared module.
--   select default_show_cutoff('2026-10-15', 'America/New_York') = '2026-10-15 22:00:00+00', -- EDT
--          default_show_cutoff('2026-11-20', null)               = '2026-11-20 23:00:00+00', -- EST, fallback branch
--          default_show_cutoff('2026-10-18', 'America/Chicago')  = '2026-10-18 23:00:00+00', -- CDT
--          default_show_cutoff('2026-12-04', 'America/Toronto')  = '2026-12-04 23:00:00+00'; -- EST
--
-- 5. Auth probe — proves the grant and that the body reaches _auth_player,
--    WITHOUT creating a league. Expect: P0001 "Wrong name or PIN".
--   select global_create_league('nobody', '0000', 'probe');
--
-- 6. Nothing already there moved. Expect the same per-league counts as
--    before running this file (37 and 16 as of 2026-10-11).
--   select league_id, count(*) from league_shows group by 1 order by 1;
--
-- A PGRST202 from the frontend's Global console after this is applied is
-- NOT "the function is missing" — the signature is unchanged. It would be
-- a cached schema; reload PostgREST's schema cache or wait.
