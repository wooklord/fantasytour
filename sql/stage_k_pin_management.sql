-- ============================================================
-- FANTASY EGGY — STAGE K: must_change_pin flag + self-service PIN change
-- ============================================================
-- Run ONCE in the Supabase SQL Editor. Session 4, step 2 (see CLAUDE.md's
-- "2.0 REBUILD roadmap" — Session 4 is manual-approval execution mode:
-- review this file on its own before running it, and before building the
-- admin-facing reset RPC (stage_l) or the Global console (stage_m) on top
-- of it).
--
-- Adds the schema flag + forced-change plumbing a future PIN reset needs:
-- `players.must_change_pin` and `change_own_pin` (the RPC a forced-change
-- interstitial submits to — also reusable later by a voluntary
-- self-service "change my PIN" control, no new RPC needed then).
--
-- register_player is deliberately untouched here: new accounts get
-- must_change_pin=false from the column default, nothing to change.
-- ============================================================

begin;

alter table players add column if not exists must_change_pin boolean not null default false;

create or replace function login(p_name text, p_pin text)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare pl players;
begin
  pl := _auth_player(p_name, p_pin);
  return json_build_object('id', pl.id, 'name', pl.name,
    'is_global_admin', pl.is_global_admin, 'must_change_pin', pl.must_change_pin);
end $$;

create or replace function change_own_pin(p_name text, p_pin text, p_new_pin text)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare pl players;
begin
  pl := _auth_player(p_name, p_pin);
  if p_new_pin !~ '^\d{4,8}$' then raise exception 'PIN must be 4-8 digits'; end if;
  update players set pin_hash = crypt(p_new_pin, gen_salt('bf')), must_change_pin = false where id = pl.id;
  return json_build_object('ok', true);
end $$;

grant execute on function login(text,text) to anon, authenticated;
grant execute on function change_own_pin(text,text,text) to anon, authenticated;

commit;

-- Verification:
--   select column_name from information_schema.columns
--   where table_name = 'players' and column_name = 'must_change_pin';
--   -- expect one row
