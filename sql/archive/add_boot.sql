-- Run once in the Supabase SQL Editor.
-- Adds: admin boot (delete player, cascades picks + scores) with optional name ban.

create table if not exists banned_names (
  name      text primary key,
  banned_at timestamptz not null default now()
);
alter table banned_names enable row level security;
-- no policies on purpose: invisible and untouchable via the anon key

create or replace function admin_boot_player(p_name text, p_pin text, p_player_id uuid, p_ban boolean default false)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare pl players; tgt players;
begin
  pl := _auth_player(p_name, p_pin);
  if not pl.is_admin then raise exception 'Admins only'; end if;
  select * into tgt from players where id = p_player_id;
  if tgt.id is null then raise exception 'Player not found'; end if;
  if tgt.id = pl.id then raise exception 'You cannot boot yourself'; end if;
  if tgt.is_admin then raise exception 'Cannot boot another admin'; end if;
  if p_ban then
    insert into banned_names (name) values (lower(tgt.name)) on conflict do nothing;
  end if;
  delete from players where id = tgt.id;
  return json_build_object('ok', true, 'booted', tgt.name);
end $$;

grant execute on function admin_boot_player(text, text, uuid, boolean) to anon, authenticated;

-- registration respects the blocklist (message deliberately vague)
create or replace function register_player(p_name text, p_pin text)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare pl players;
begin
  if length(trim(p_name)) < 2 then raise exception 'Name too short'; end if;
  if p_pin !~ '^\d{4,8}$' then raise exception 'PIN must be 4-8 digits'; end if;
  if exists (select 1 from banned_names where name = lower(trim(p_name))) then
    raise exception 'That name is not available';
  end if;
  insert into players (name, pin_hash)
    values (trim(p_name), crypt(p_pin, gen_salt('bf')))
    returning * into pl;
  return json_build_object('id', pl.id, 'name', pl.name, 'is_admin', pl.is_admin);
exception when unique_violation then
  raise exception 'That name is taken';
end $$;
