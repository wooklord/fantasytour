-- ============================================================
-- FANTASY EGGY — STAGE I: admin_pick_status sorts by name only
-- ============================================================
-- Was `order by count(k.id) desc, p.name` — alphabetical within each
-- pick-count group, but the count came first, so a partial-picks player
-- (5 of 6 slots, say) got pushed below every full 6-pick player instead
-- of sitting alphabetically among them. Each row's own ✔/— marker and
-- pick count already show completion status, so the count doesn't need
-- to double as the sort key too. Body-only change, signature unchanged.
-- ============================================================

create or replace function admin_pick_status(p_name text, p_pin text, p_bracket_id bigint, p_show_id bigint)
returns table(player_name text, picks_count int, last_saved timestamptz)
language plpgsql security definer set search_path = public, extensions as $$
declare pl players; v_league_id bigint;
begin
  pl := _auth_player(p_name, p_pin);
  select league_id into v_league_id from brackets where id = p_bracket_id;
  if v_league_id is null then raise exception 'Bracket not found'; end if;
  if not _is_league_admin_or_global(pl.id, v_league_id) then raise exception 'League admins only'; end if;
  return query
    select p.name, count(k.id)::int, max(k.updated_at)
    from league_members lm
    join players p on p.id = lm.player_id
    left join picks k on k.player_id = p.id and k.bracket_id = p_bracket_id and k.show_id = p_show_id
    where lm.league_id = v_league_id
    group by p.name
    order by p.name;
end $$;

-- ============================================================
-- VERIFICATION
-- ============================================================
-- select * from admin_pick_status('NAME','PIN', <bracket_id>, <show_id>);
--   Expect: rows in plain alphabetical order by player_name, regardless
--   of picks_count.
