-- Run once in the Supabase SQL Editor.
-- Adds: admin-only ban list viewing and unbanning.

create or replace function admin_list_bans(p_name text, p_pin text)
returns table(name text, banned_at timestamptz)
language plpgsql security definer set search_path = public, extensions as $$
declare pl players;
begin
  pl := _auth_player(p_name, p_pin);
  if not pl.is_admin then raise exception 'Admins only'; end if;
  return query select b.name, b.banned_at from banned_names b order by b.banned_at desc;
end $$;

create or replace function admin_unban(p_name text, p_pin text, p_banned text)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare pl players;
begin
  pl := _auth_player(p_name, p_pin);
  if not pl.is_admin then raise exception 'Admins only'; end if;
  delete from banned_names where name = lower(p_banned);
  return json_build_object('ok', true);
end $$;

grant execute on function admin_list_bans(text, text) to anon, authenticated;
grant execute on function admin_unban(text, text, text) to anon, authenticated;
