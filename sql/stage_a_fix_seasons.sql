-- ============================================================
-- FIX: stage_a_schema.sql's Section 3 used `create table if not exists
-- seasons`, but seasons already existed (from add_seasons.sql), so it was
-- a no-op — bracket_id/roster_locked_at never got added and the old beta
-- season row survived (verification showed seasons = 1, not 0).
-- Run this once, after stage_a_schema.sql, to correct an affected database.
-- ============================================================

alter table seasons add column if not exists bracket_id bigint references brackets(id) on delete cascade;
alter table seasons add column if not exists roster_locked_at timestamptz;
alter table seasons add column if not exists winner_sent timestamptz;

-- Launch reset wipes seasons along with picks/scores.
delete from season_rosters;
delete from seasons;

-- Safe now that the table is empty.
alter table seasons alter column bracket_id set not null;
