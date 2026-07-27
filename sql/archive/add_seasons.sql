-- Run once in the Supabase SQL Editor.
-- Adds: seasons (tours/legs) as named date ranges + admin CRUD.

create table if not exists seasons (
  id         bigint generated always as identity primary key,
  name       text not null,
  start_date date not null,
  end_date   date not null
);
alter table seasons enable row level security;
create policy "public read seasons" on seasons for select using (true);

create or replace function admin_save_season(p_name text, p_pin text, p_id bigint, p_sname text, p_start date, p_end date)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare pl players;
begin
  pl := _auth_player(p_name, p_pin);
  if not pl.is_admin then raise exception 'Admins only'; end if;
  if coalesce(trim(p_sname),'') = '' then raise exception 'Season needs a name'; end if;
  if p_end < p_start then raise exception 'End date is before start date'; end if;
  if p_id is null then
    insert into seasons (name, start_date, end_date) values (trim(p_sname), p_start, p_end);
  else
    update seasons set name = trim(p_sname), start_date = p_start, end_date = p_end where id = p_id;
  end if;
  return json_build_object('ok', true);
end $$;

create or replace function admin_delete_season(p_name text, p_pin text, p_id bigint)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare pl players;
begin
  pl := _auth_player(p_name, p_pin);
  if not pl.is_admin then raise exception 'Admins only'; end if;
  delete from seasons where id = p_id;
  return json_build_object('ok', true);
end $$;

grant execute on function admin_save_season(text, text, bigint, text, date, date) to anon, authenticated;
grant execute on function admin_delete_season(text, text, bigint) to anon, authenticated;
