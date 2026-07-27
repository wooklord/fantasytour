-- Run this once in the Supabase SQL Editor.
-- Adds: admin-only view of who has submitted picks for a show
-- (names + counts + last-saved time only — no songs, keeps it fair).

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
