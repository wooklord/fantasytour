-- ============================================================
-- FANTASY TOUR — Supabase schema
-- Run this in the Supabase SQL editor (one shot, idempotent-ish).
-- Auth model: name + PIN. No Supabase Auth. All writes go through
-- SECURITY DEFINER RPCs that validate the PIN server-side, so the
-- anon key can never write tables directly and the pick cutoff
-- cannot be bypassed by editing client JS.
-- ============================================================

create extension if not exists pgcrypto;

-- ---------- TABLES ----------

create table if not exists players (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  pin_hash   text not null,
  is_admin   boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists shows (
  id         bigint primary key,            -- The Carton show_id
  showdate   date not null,
  venue      text,
  city       text,
  state      text,
  cutoff_at  timestamptz,                   -- picks lock at this moment
  status     text not null default 'upcoming',  -- upcoming | live | final
  created_at timestamptz not null default now()
);

create table if not exists picks (
  id         uuid primary key default gen_random_uuid(),
  player_id  uuid not null references players(id) on delete cascade,
  show_id    bigint not null references shows(id) on delete cascade,
  slot       text not null,                 -- 'opener','closer','encore','flat1'...
  songname   text not null,
  updated_at timestamptz not null default now(),
  unique (player_id, show_id, slot)
);

create table if not exists setlist_songs (
  show_id    bigint not null references shows(id) on delete cascade,
  position   int not null,
  setnumber  text,
  is_encore  boolean not null default false,
  songname   text not null,
  is_cover   boolean default false,
  footnote   text,
  primary key (show_id, position)
);

create table if not exists scores (
  player_id  uuid not null references players(id) on delete cascade,
  show_id    bigint not null references shows(id) on delete cascade,
  points     int not null default 0,
  breakdown  jsonb not null default '[]',   -- [{slot, songname, hit, points, reason}]
  updated_at timestamptz not null default now(),
  primary key (player_id, show_id)
);

create table if not exists songs_cache (
  songname     text primary key,
  times_played int,
  last_played  date,
  is_original  boolean
);

create table if not exists game_config (
  id   int primary key default 1 check (id = 1),
  data jsonb not null
);

insert into game_config (id, data) values (1, '{
  "slots": [
    {"key": "opener", "label": "Opener",  "points": 2},
    {"key": "closer", "label": "Closer",  "points": 2},
    {"key": "encore", "label": "Encore",  "points": 2}
  ],
  "flat_picks": 3,
  "flat_points": 1,
  "partial_credit": true,
  "partial_points": 1,
  "allow_duplicates": false,
  "bonuses": {"debut": 0, "cover": 0, "jamchart": 0}
}') on conflict (id) do nothing;

-- ---------- LOCK DOWN DIRECT ACCESS ----------

alter table players       enable row level security;
alter table shows         enable row level security;
alter table picks         enable row level security;
alter table setlist_songs enable row level security;
alter table scores        enable row level security;
alter table songs_cache   enable row level security;
alter table game_config   enable row level security;

-- Public (anon) may READ everything except players + picks.
create policy "public read shows"    on shows         for select using (true);
create policy "public read setlist"  on setlist_songs for select using (true);
create policy "public read scores"   on scores        for select using (true);
create policy "public read songs"    on songs_cache   for select using (true);
create policy "public read config"   on game_config   for select using (true);
-- No insert/update/delete policies => anon cannot write anything directly.
-- players and picks have NO select policy => reads only via RPC/view below.

create or replace view players_public
  with (security_invoker = off) as
  select id, name, is_admin, created_at from players;
grant select on players_public to anon, authenticated;

-- ---------- HELPERS ----------

create or replace function _auth_player(p_name text, p_pin text)
returns players language plpgsql security definer set search_path = public, extensions as $$
declare pl players;
begin
  select * into pl from players where lower(name) = lower(trim(p_name));
  if pl.id is null or pl.pin_hash <> crypt(p_pin, pl.pin_hash) then
    raise exception 'Wrong name or PIN';
  end if;
  return pl;
end $$;

-- ---------- RPCs (the only write path) ----------

create or replace function register_player(p_name text, p_pin text)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare pl players;
begin
  if length(trim(p_name)) < 2 then raise exception 'Name too short'; end if;
  if p_pin !~ '^\d{4,8}$' then raise exception 'PIN must be 4-8 digits'; end if;
  insert into players (name, pin_hash)
    values (trim(p_name), crypt(p_pin, gen_salt('bf')))
    returning * into pl;
  return json_build_object('id', pl.id, 'name', pl.name, 'is_admin', pl.is_admin);
exception when unique_violation then
  raise exception 'That name is taken';
end $$;

create or replace function login(p_name text, p_pin text)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare pl players;
begin
  pl := _auth_player(p_name, p_pin);
  return json_build_object('id', pl.id, 'name', pl.name, 'is_admin', pl.is_admin);
end $$;

-- Submit a full pick sheet. Enforces cutoff + config server-side.
create or replace function submit_picks(p_name text, p_pin text, p_show_id bigint, p_picks jsonb)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare
  pl players; sh shows; cfg jsonb; item jsonb;
  valid_slots text[]; songs text[]; n_flat int;
begin
  pl := _auth_player(p_name, p_pin);
  select * into sh from shows where id = p_show_id;
  if sh.id is null then raise exception 'Show not found'; end if;
  if sh.cutoff_at is null then raise exception 'Picks are not open for this show yet'; end if;
  if now() >= sh.cutoff_at then raise exception 'Picks are locked for this show'; end if;

  select data into cfg from game_config where id = 1;
  n_flat := coalesce((cfg->>'flat_picks')::int, 0);
  select array_agg(s->>'key') into valid_slots from jsonb_array_elements(cfg->'slots') s;
  for i in 1..n_flat loop valid_slots := valid_slots || ('flat' || i); end loop;

  songs := array[]::text[];
  for item in select * from jsonb_array_elements(p_picks) loop
    if not (item->>'slot' = any(valid_slots)) then
      raise exception 'Invalid slot: %', item->>'slot';
    end if;
    if coalesce(trim(item->>'songname'), '') = '' then continue; end if;
    if not coalesce((cfg->>'allow_duplicates')::bool, false)
       and lower(item->>'songname') = any(songs) then
      raise exception 'Duplicate pick: %', item->>'songname';
    end if;
    songs := songs || lower(item->>'songname');
    insert into picks (player_id, show_id, slot, songname, updated_at)
      values (pl.id, p_show_id, item->>'slot', trim(item->>'songname'), now())
      on conflict (player_id, show_id, slot)
      do update set songname = excluded.songname, updated_at = now();
  end loop;
  -- remove slots the player cleared
  delete from picks where player_id = pl.id and show_id = p_show_id
    and not (slot = any(select jsonb_array_elements(p_picks)->>'slot'));
  return json_build_object('ok', true, 'saved', coalesce(array_length(songs,1),0));
end $$;

-- Your own picks, any time.
create or replace function get_my_picks(p_name text, p_pin text, p_show_id bigint)
returns setof picks language plpgsql security definer set search_path = public, extensions as $$
declare pl players;
begin
  pl := _auth_player(p_name, p_pin);
  return query select * from picks where player_id = pl.id and show_id = p_show_id;
end $$;

-- Everyone's picks — only after cutoff (no scouting your rivals).
create or replace function get_show_picks(p_show_id bigint)
returns table(player_id uuid, player_name text, slot text, songname text)
language sql security definer set search_path = public, extensions as $$
  select p.player_id, pl.name, p.slot, p.songname
  from picks p join players pl on pl.id = p.player_id
  join shows s on s.id = p.show_id
  where p.show_id = p_show_id and now() >= s.cutoff_at;
$$;

-- ---------- ADMIN RPCs ----------

create or replace function admin_update_config(p_name text, p_pin text, p_data jsonb)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare pl players;
begin
  pl := _auth_player(p_name, p_pin);
  if not pl.is_admin then raise exception 'Admins only'; end if;
  update game_config set data = p_data where id = 1;
  return json_build_object('ok', true);
end $$;

create or replace function admin_set_cutoff(p_name text, p_pin text, p_show_id bigint, p_cutoff timestamptz)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare pl players;
begin
  pl := _auth_player(p_name, p_pin);
  if not pl.is_admin then raise exception 'Admins only'; end if;
  update shows set cutoff_at = p_cutoff where id = p_show_id;
  return json_build_object('ok', true);
end $$;

create or replace function admin_set_show_status(p_name text, p_pin text, p_show_id bigint, p_status text)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare pl players;
begin
  pl := _auth_player(p_name, p_pin);
  if not pl.is_admin then raise exception 'Admins only'; end if;
  update shows set status = p_status where id = p_show_id;
  return json_build_object('ok', true);
end $$;

grant execute on function register_player, login, submit_picks, get_my_picks,
  get_show_picks, admin_update_config, admin_set_cutoff, admin_set_show_status
  to anon, authenticated;

-- ---------- REALTIME ----------
alter publication supabase_realtime add table scores;
alter publication supabase_realtime add table setlist_songs;
alter publication supabase_realtime add table shows;

-- ---------- AFTER RUNNING ----------
-- 1. Register yourself in the app, then promote to admin:
--      update players set is_admin = true where name = 'YourName';
-- 2. Deploy the carton-sync edge function, then schedule it (see README).

create or replace function admin_pick_status(p_name text, p_pin text, p_show_id bigint)
returns table(player_name text, picks_count int, last_saved timestamptz)
language plpgsql security definer set search_path = public, extensions as $$
declare pl players;
begin
  pl := _auth_player(p_name, p_pin);
  if not pl.is_admin then raise exception 'Admins only'; end if;
  return query
    select p.name, count(k.id)::int, max(k.updated_at)
    from players p
    left join picks k on k.player_id = p.id and k.show_id = p_show_id
    group by p.name
    order by count(k.id) desc, p.name;
end $$;

grant execute on function admin_pick_status(text, text, bigint) to anon, authenticated;
