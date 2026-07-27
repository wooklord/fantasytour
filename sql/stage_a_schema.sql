-- ============================================================
-- FANTASY EGGY — STAGE A: multi-tenant schema (launch reset)
-- ============================================================
-- Run ONCE in the Supabase SQL Editor, in a quiet moment (no live show).
-- This supersedes schema.sql + every add_*.sql. It is written to be safe
-- to run on your current beta database:
--   * KEEPS player accounts (names + PIN hashes) — nobody re-registers.
--   * WIPES all gameplay (picks, scores, seasons, setlist data) — clean slate.
--   * Builds the Global -> League -> Bracket structure.
--   * Seeds the "Ambassadors" league with Casual + Official brackets and
--     moves every existing player into it.
--
-- Idempotency: uses IF NOT EXISTS / guards where practical. The WIPE section
-- is destructive by design; it only runs against gameplay tables.
-- ============================================================

create extension if not exists pgcrypto;

-- ============================================================
-- SECTION 1 — NEW TENANCY TABLES
-- ============================================================

create table if not exists leagues (
  id         bigint generated always as identity primary key,
  name       text not null,
  created_at timestamptz not null default now()
);

create table if not exists brackets (
  id         bigint generated always as identity primary key,
  league_id  bigint not null references leagues(id) on delete cascade,
  name       text not null,                 -- 'Casual' | 'Official'
  kind       text not null check (kind in ('casual','official')),
  config     jsonb not null,                -- per-bracket scoring/pick rules
  created_at timestamptz not null default now(),
  unique (league_id, kind)
);

-- players table already exists (global identity). Add global-admin flag,
-- preserving the old is_admin values into it, then drop is_admin.
alter table players add column if not exists is_global_admin boolean not null default false;

do $$
begin
  if exists (select 1 from information_schema.columns
             where table_name='players' and column_name='is_admin') then
    update players set is_global_admin = true where is_admin = true;
    alter table players drop column is_admin;
  end if;
end $$;

create table if not exists league_members (
  league_id       bigint not null references leagues(id) on delete cascade,
  player_id       uuid   not null references players(id) on delete cascade,
  is_league_admin boolean not null default false,
  official_opt_in boolean not null default false,   -- Official is opt-IN
  banned          boolean not null default false,    -- soft ban from THIS league
  joined_at       timestamptz not null default now(),
  primary key (league_id, player_id)
);

-- ============================================================
-- SECTION 2 — SHARED SHOW LIST (global) + PER-LEAGUE OVERLAY
-- ============================================================
-- shows already exists. Strip the per-league columns off it AFTER we copy
-- them into the overlay (done in the migration section). Here we just make
-- sure the overlay table exists.

create table if not exists league_shows (
  league_id   bigint not null references leagues(id) on delete cascade,
  show_id     bigint not null references shows(id) on delete cascade,
  cutoff_at   timestamptz,
  format      text not null default 'standard',     -- 'standard' | 'one_set'
  status      text not null default 'upcoming',     -- upcoming | live | final
  remind_sent timestamptz,
  lock_sent   timestamptz,
  winner_sent timestamptz,
  primary key (league_id, show_id)
);

-- ============================================================
-- SECTION 3 — SEASONS (per Official bracket) + FROZEN ROSTERS
-- ============================================================

create table if not exists seasons (
  id         bigint generated always as identity primary key,
  bracket_id bigint not null references brackets(id) on delete cascade,
  name       text not null,
  start_date date not null,
  end_date   date not null,
  winner_sent timestamptz,
  roster_locked_at timestamptz            -- set when the snapshot is written
);

create table if not exists season_rosters (
  season_id bigint not null references seasons(id) on delete cascade,
  player_id uuid   not null references players(id) on delete cascade,
  primary key (season_id, player_id)
);

-- ============================================================
-- SECTION 4 — GAMEPLAY (all scoped by bracket)
-- ============================================================
-- These already exist flat. We recreate them with bracket_id. Since gameplay
-- is being WIPED at launch, we drop and recreate rather than migrate rows.

drop table if exists picks cascade;
create table picks (
  id         uuid primary key default gen_random_uuid(),
  bracket_id bigint not null references brackets(id) on delete cascade,
  player_id  uuid   not null references players(id) on delete cascade,
  show_id    bigint not null references shows(id) on delete cascade,
  slot       text not null,
  songname   text not null,
  updated_at timestamptz not null default now(),
  unique (player_id, bracket_id, show_id, slot)
);

drop table if exists scores cascade;
create table scores (
  bracket_id bigint not null references brackets(id) on delete cascade,
  player_id  uuid   not null references players(id) on delete cascade,
  show_id    bigint not null references shows(id) on delete cascade,
  points     int not null default 0,
  breakdown  jsonb not null default '[]',
  updated_at timestamptz not null default now(),
  primary key (player_id, bracket_id, show_id)
);

-- setlist_songs stays GLOBAL (keyed by show only). Wipe it clean for launch.
truncate table setlist_songs;

-- songs_cache stays GLOBAL and is KEPT (catalog, not gameplay).

-- banned_names becomes per-league. Drop the old global one; recreate scoped.
drop table if exists banned_names cascade;
create table banned_names (
  league_id bigint not null references leagues(id) on delete cascade,
  name      text not null,
  banned_at timestamptz not null default now(),
  primary key (league_id, name)
);
-- global (app-wide) name ban for the nuclear boot:
create table if not exists global_banned_names (
  name      text primary key,
  banned_at timestamptz not null default now()
);

-- Drop the old single global config table (replaced by brackets.config).
drop table if exists game_config cascade;

-- ============================================================
-- SECTION 5 — MIGRATION: seed Ambassadors, move players, wipe gameplay
-- ============================================================

do $$
declare
  amb_id  bigint;
  off_id  bigint;
  cas_id  bigint;
  -- Instance constant: default slot config seeded for new brackets.
  def_cfg jsonb := '{
    "slots": [
      {"key":"opener","type":"opener","label":"Opener","points":2},
      {"key":"closer","type":"closer","label":"Closer","points":2},
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
  -- 5.1 Ambassadors league (only if it doesn't already exist)
  select id into amb_id from leagues where name = 'Ambassadors';
  if amb_id is null then
    insert into leagues (name) values ('Ambassadors') returning id into amb_id;
  end if;

  -- 5.2 two brackets
  select id into off_id from brackets where league_id = amb_id and kind = 'official';
  if off_id is null then
    insert into brackets (league_id, name, kind, config)
      values (amb_id, 'Official', 'official', def_cfg) returning id into off_id;
  end if;
  select id into cas_id from brackets where league_id = amb_id and kind = 'casual';
  if cas_id is null then
    insert into brackets (league_id, name, kind, config)
      values (amb_id, 'Casual', 'casual', def_cfg) returning id into cas_id;
  end if;

  -- 5.3 move every existing player into Ambassadors.
  --     Grandfather current players into Official (opt_in = true).
  --     Preserve admin: former global admins become league admins here too.
  insert into league_members (league_id, player_id, is_league_admin, official_opt_in)
    select amb_id, p.id, p.is_global_admin, true
    from players p
    on conflict (league_id, player_id) do nothing;

  -- 5.4 per-league overlay for every existing global show, defaulting
  --     cutoff/format/status. (Cutoffs get re-defaulted by the edge fn on
  --     next sync; here we just make the shows visible to Ambassadors.)
  insert into league_shows (league_id, show_id, cutoff_at, format, status)
    select amb_id, s.id, s.cutoff_at, coalesce(s.format,'standard'), coalesce(s.status,'upcoming')
    from shows s
    on conflict (league_id, show_id) do nothing;
end $$;

-- 5.5 Now that per-show cutoff/status/format live on league_shows, drop them
--     off the global shows table (they were copied above).
alter table shows drop column if exists cutoff_at;
alter table shows drop column if exists status;
alter table shows drop column if exists format;
alter table shows drop column if exists remind_sent;
alter table shows drop column if exists lock_sent;
alter table shows drop column if exists winner_sent;

-- ============================================================
-- SECTION 6 — RLS: lock everything; public read only on global tables
-- ============================================================

alter table leagues             enable row level security;
alter table brackets            enable row level security;
alter table league_members      enable row level security;
alter table league_shows        enable row level security;
alter table seasons             enable row level security;
alter table season_rosters      enable row level security;
alter table picks               enable row level security;
alter table scores              enable row level security;
alter table setlist_songs       enable row level security;
alter table songs_cache         enable row level security;
alter table shows               enable row level security;
alter table banned_names        enable row level security;
alter table global_banned_names enable row level security;
alter table players             enable row level security;

-- Truly-global, safe to read publicly:
drop policy if exists "pub shows"   on shows;
create policy "pub shows"   on shows         for select using (true);
drop policy if exists "pub songs"   on songs_cache;
create policy "pub songs"   on songs_cache   for select using (true);
drop policy if exists "pub setlist" on setlist_songs;
create policy "pub setlist" on setlist_songs for select using (true);
drop policy if exists "pub leagues" on leagues;
create policy "pub leagues" on leagues       for select using (true);  -- names only, for the switcher
drop policy if exists "pub brackets" on brackets;
create policy "pub brackets" on brackets     for select using (true);  -- config is read to render pick sheets
-- Everything else: NO select policy => unreadable via anon key; reads go through RPCs (Stage B/C).

-- ============================================================
-- SECTION 7 — verification (run these AFTER; all should look sane)
-- ============================================================
-- select 'players kept'      as check, count(*) from players
-- union all select 'ambassadors members', count(*) from league_members
-- union all select 'brackets (want 2)',   count(*) from brackets
-- union all select 'picks (want 0)',      count(*) from picks
-- union all select 'scores (want 0)',     count(*) from scores
-- union all select 'seasons (want 0)',    count(*) from seasons
-- union all select 'league_shows',        count(*) from league_shows
-- union all select 'global admins',       count(*) from players where is_global_admin;
--
-- Expect: players = your beta count, ambassadors members = same, brackets = 2,
-- picks/scores/seasons = 0, league_shows = number of shows synced, global admins >= 1 (you).
