-- ============================================================
-- FANTASY EGGY — STAGE F: default Official participation to opted-IN
-- ============================================================
-- Reverses a locked 2.0 design decision (spec: Official participation is
-- opt-IN, a conscious choice). CLAUDE.md's 2.0 rebuild section flags this
-- reversal explicitly, alongside the PIN-guessing and no-self-service-PIN
-- gaps, as something to revisit before the ~50-person Facebook League
-- joins — that reasoning (participation should be a conscious choice for a
-- pool of semi-strangers) still holds there. This is a beta convenience
-- for the current closed Ambassadors group, where the dev adds every
-- member by hand and flipping the flag per person is pure friction.
--
-- Two parts:
--   1. Flip the column default so admin_add_league_member (which inserts
--      league_members without specifying official_opt_in, relying entirely
--      on the table default) lands new members opted in without any RPC
--      change.
--   2. Backfill existing rows still sitting false, so there are no
--      stragglers from before this default existed.
--
-- Does NOT touch set_official_opt_in or admin_set_season_roster — the
-- opt-in lock-while-a-season-is-running rule, and the self-service
-- opt-OUT path, are both unaffected by which way the default points.
-- ============================================================

begin;

alter table league_members alter column official_opt_in set default true;

update league_members set official_opt_in = true where official_opt_in = false;

commit;

-- ============================================================
-- VERIFICATION
-- ============================================================
-- select column_default from information_schema.columns
--   where table_name = 'league_members' and column_name = 'official_opt_in';
--   Expect: 'true'.
-- select count(*) from league_members where official_opt_in = false;
--   Expect: 0.
