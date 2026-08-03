-- One-time backfill for `shows.timezone` rows that stayed null after
-- add_shows_timezone.sql + the carton-sync redeploy: syncShows only
-- upserts shows inside its rolling 200-show/14-day fetch window (the same
-- bound that already limits permalink corrections — see CLAUDE.md's
-- Postgres/Supabase gotchas). Any show that had already aged out of that
-- window before this column existed never got touched by the sync at all,
-- and never will be by a normal sync going forward.
--
-- Computes the zone directly from `state` for whatever's still null, using
-- the same STATE_TZ mapping as the edge function's resolveVenueTz
-- (supabase/functions/carton-sync/index.ts) — transcribed once, here,
-- rather than duplicated as a permanently-maintained second copy. A state
-- genuinely outside this mapping correctly stays null (no fallback, same
-- as resolveVenueTz). Safe to run more than once — only touches rows still
-- null, and only via an exact 2-letter state match, same as what every
-- currently-null row actually has.
update shows s set timezone = tz.zone
from (values
  ('CT','America/New_York'), ('DE','America/New_York'), ('DC','America/New_York'), ('FL','America/New_York'),
  ('GA','America/New_York'), ('IN','America/Indiana/Indianapolis'), ('KY','America/New_York'), ('ME','America/New_York'),
  ('MD','America/New_York'), ('MA','America/New_York'), ('MI','America/Detroit'), ('NH','America/New_York'),
  ('NJ','America/New_York'), ('NY','America/New_York'), ('NC','America/New_York'), ('OH','America/New_York'),
  ('PA','America/New_York'), ('RI','America/New_York'), ('SC','America/New_York'), ('VT','America/New_York'),
  ('VA','America/New_York'), ('WV','America/New_York'),
  ('AL','America/Chicago'), ('AR','America/Chicago'), ('IL','America/Chicago'), ('IA','America/Chicago'),
  ('KS','America/Chicago'), ('LA','America/Chicago'), ('MN','America/Chicago'), ('MS','America/Chicago'),
  ('MO','America/Chicago'), ('NE','America/Chicago'), ('ND','America/Chicago'), ('OK','America/Chicago'),
  ('SD','America/Chicago'), ('TN','America/Chicago'), ('TX','America/Chicago'), ('WI','America/Chicago'),
  ('AZ','America/Phoenix'), ('CO','America/Denver'), ('ID','America/Boise'), ('MT','America/Denver'),
  ('NM','America/Denver'), ('UT','America/Denver'), ('WY','America/Denver'),
  ('CA','America/Los_Angeles'), ('NV','America/Los_Angeles'), ('OR','America/Los_Angeles'), ('WA','America/Los_Angeles'),
  ('AK','America/Anchorage'), ('HI','Pacific/Honolulu'),
  ('ON','America/Toronto'), ('QC','America/Toronto'), ('BC','America/Vancouver'), ('AB','America/Edmonton')
) as tz(state, zone)
where s.timezone is null
  and upper(trim(s.state)) = tz.state;
