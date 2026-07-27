-- Run once in the Supabase SQL Editor.
-- Adds: per-show format (standard / one_set), admin master voting override,
-- and per-format pick validation.

alter table shows add column if not exists format text not null default 'standard';

create or replace function admin_set_show_format(p_name text, p_pin text, p_show_id bigint, p_format text)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare pl players;
begin
  pl := _auth_player(p_name, p_pin);
  if not pl.is_admin then raise exception 'Admins only'; end if;
  if p_format not in ('standard','one_set') then raise exception 'Invalid format'; end if;
  update shows set format = p_format where id = p_show_id;
  return json_build_object('ok', true);
end $$;

grant execute on function admin_set_show_format(text, text, bigint, text) to anon, authenticated;

-- submit_picks now honors the master voting override and validates slots
-- against the standard or one-set rule section depending on the show.
create or replace function submit_picks(p_name text, p_pin text, p_show_id bigint, p_picks jsonb)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare
  pl players; sh shows; cfg jsonb; sect jsonb; ov text; item jsonb;
  valid_slots text[]; songs text[]; n_flat int;
begin
  pl := _auth_player(p_name, p_pin);
  select data into cfg from game_config where id = 1;
  ov := coalesce(cfg->>'voting_override','auto');
  if ov = 'locked' then raise exception 'Voting is locked by the admin'; end if;

  select * into sh from shows where id = p_show_id;
  if sh.id is null then raise exception 'Show not found'; end if;
  if sh.status = 'final' then raise exception 'This show is final'; end if;
  if ov = 'open' then
    if sh.showdate < current_date then raise exception 'That show already happened'; end if;
  else
    if sh.cutoff_at is null then raise exception 'Picks are not open for this show yet'; end if;
    if now() >= sh.cutoff_at then raise exception 'Picks are locked for this show'; end if;
  end if;

  if sh.format = 'one_set' and cfg ? 'oneset' then sect := cfg->'oneset'; else sect := cfg; end if;
  n_flat := coalesce((sect->>'flat_picks')::int, 0);
  select array_agg(s->>'key') into valid_slots from jsonb_array_elements(sect->'slots') s;
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
  delete from picks where player_id = pl.id and show_id = p_show_id
    and not (slot = any(select jsonb_array_elements(p_picks)->>'slot'));
  return json_build_object('ok', true, 'saved', coalesce(array_length(songs,1),0));
end $$;
