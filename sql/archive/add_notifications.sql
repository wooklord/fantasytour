-- Run once in the Supabase SQL Editor.
-- Adds: sent-flags for Discord announcements (reminder, lock, winners).

alter table shows   add column if not exists remind_sent timestamptz;
alter table shows   add column if not exists lock_sent   timestamptz;
alter table shows   add column if not exists winner_sent timestamptz;
alter table seasons add column if not exists winner_sent timestamptz;

-- backfill history so deploying doesn't announce old shows
update shows set remind_sent = now(), lock_sent = now(), winner_sent = now()
  where showdate < current_date;
update seasons set winner_sent = now() where end_date < current_date - 7;
