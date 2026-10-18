# Database backups and the untested restore path

> Extracted verbatim from `CLAUDE.md` at commit 54a5ab8 (2026-10-18), original lines 3538–3577. Nested entries were de-indented to top level; wording is unchanged.
> Decision record — currently binding. `CLAUDE.md` holds only a pointer stub under the same entry name; this file is the full text and rationale.

**Deferred, and it is the kind of thing that is only ever discovered at the
worst possible moment: THE DATABASE RESTORE PATH HAS NEVER BEEN TESTED.**
Backups themselves went from "none exist at all" to "a script exists" on
2026-08-16 (see below) — but no restore from one has ever been performed, so
what exists today is an untested hypothesis, not a recovery capability. The
distinction is the whole point of this entry: a dump that turns out to have
the wrong format, the wrong table set, or an unusable insert order fails
exactly when it is needed and not one moment earlier.
- **Where the backup tooling lives, deliberately NOT in this repo:**
  `C:\Users\kylem\backups\fantasyeggy\` — `dump.sh`, a `README.md`, and the
  dumps. It is outside the working tree (confirmed via `git check-ignore`,
  which reports it as outside the repository rather than merely ignored)
  because the dumps carry `players.pin_hash` plus every player's pick
  history, and this repo is public. **The directory also holds `conn.txt`,
  a full Postgres connection string in plaintext — read/write, not a scoped
  key — so the folder as a whole is as sensitive as the database.** Its
  README says so at the top; don't relocate it into the repo for
  convenience.
- **Requires `pg_dump`, which was not installed** — `supabase db dump`
  shells out to Docker and fails without it (`LegacyDockerRunError`), and
  the machine had no `pg_dump`/`psql`/`docker` on PATH at all. Installed
  via `scoop install postgresql` (18.6); the binaries are at
  `C:\Users\kylem\scoop\apps\postgresql\current\bin` and `dump.sh` adds
  that to PATH itself rather than depending on the shell's.
- **What to actually verify when the restore test happens**, against a
  scratch project or a local Postgres and never against production:
  `--column-inserts` output restores cleanly against a schema built from
  `sql/`; foreign-key insert ordering works or needs `--disable-triggers`
  (pg_dump's table order is not guaranteed to be a valid FK order);
  `players.pin_hash` survives round-trip and a restored account can really
  log in; and nothing depends on the Supabase-managed `auth`/`storage`
  schemas the dump excludes — it shouldn't, since this app uses name+PIN
  RPCs rather than Supabase Auth, but that is the assumption under test.
- **`shows`/`setlist_songs`/`songs_cache` are in the dump on purpose, and
  omitting them would quietly break it.** They look regenerable from The
  Carton, but `syncShows` only covers a rolling 200-show/14-day window and
  full setlist history has never been backfilled — so a re-sync would not
  restore them, and historical `scores` rows would reference shows and
  setlists that no longer exist.
