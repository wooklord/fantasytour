-- Adds the resolved venue IANA timezone to `shows`, computed server-side by
-- the edge function's sync (STATE_TZ) so the admin panel can display/edit
-- cutoffs in venue-local time by reading data instead of duplicating that
-- map client-side. Null means "state didn't map" — explicit, not a silent
-- fallback to some default zone.
alter table shows add column if not exists timezone text;
