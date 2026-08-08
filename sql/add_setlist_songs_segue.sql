-- Adds the segue flag to `setlist_songs`, computed server-side by the edge
-- function's sync from Carton's own `transition` text (does this song's
-- connector contain an arrow: " > " or "->"). Display-only — never read by
-- scoring. Defaults existing rows to false; carton-sync backfills it for any
-- show that syncs again (its diff check compares `segue` too), same
-- "doesn't reach shows already outside the sync window" caveat as
-- add_shows_timezone.sql.
alter table setlist_songs add column if not exists segue boolean not null default false;
