-- ============================================================
-- FANTASY EGGY — STAGE S: per-league config (community links, v1)
-- ============================================================
-- Run ONCE in the Supabase SQL Editor. Record: docs/decisions/onboarding.md
-- (LOCKED 2026-10-24, with the same-day join-code correction).
--
-- WHY A LEAGUE COLUMN: both brackets of a league share one community, so
-- the Facebook group and Discord invite belong to the league, not to
-- brackets.config. Links are data, not source — they never go in
-- src/core/config.js, a seed, or any tracked file.
--
-- EXPOSURE, ACCEPTED: leagues has a PUBLIC select policy on every column
-- ("pub leagues" ... for select using (true), stage_a_schema.sql:270).
-- Anything written to leagues.config is therefore readable with the anon
-- key. v1 writes ONLY fb_url and discord_url; the mitigation is a rotatable
-- non-expiring Discord invite.
--
-- JOIN CODES NEVER LIVE IN leagues.config. For exactly the reason above, a
-- code in this column would be published the moment it was written. Join
-- codes get their own RLS-locked table, league_join_codes, with no policies
-- and all anon/authenticated privileges revoked, reachable only through
-- security-definer RPCs (admin_get_join_code, admin_rotate_join_code,
-- join_league). That is Batch 4 — not this file. The whitelist below is the
-- enforcement: an unknown key is DROPPED, not stored, so neither a stale
-- client nor a typo can put a code into the public row. Do not widen it
-- without reading onboarding.md first.
-- ============================================================

begin;

alter table leagues
  add column if not exists config jsonb not null default '{}'::jsonb;

-- MERGE, not replace: config || p_data. This is deliberately NOT the
-- admin_update_config shape (whole-object replace), which forced the
-- two-writer merge discipline in docs/decisions/admin-panel.md. Unknown
-- keys are dropped rather than stored. Writing a key with JSON null clears
-- it (jsonb_strip_nulls after the merge).
create or replace function admin_update_league_config(p_name text, p_pin text, p_league_id bigint, p_data jsonb)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare pl players; allowed jsonb; k text;
begin
  pl := _auth_player(p_name, p_pin);
  perform _reject_if_must_change_pin(pl);
  if not exists (select 1 from leagues where id = p_league_id) then raise exception 'League not found'; end if;
  if not _is_league_admin_or_global(pl.id, p_league_id) then raise exception 'League admins only'; end if;
  if p_data is null or jsonb_typeof(p_data) <> 'object' then raise exception 'Config must be a JSON object'; end if;

  allowed := '{}'::jsonb;
  foreach k in array array['fb_url', 'discord_url'] loop
    if p_data ? k then
      allowed := allowed || jsonb_build_object(k, p_data -> k);
    end if;
  end loop;

  -- Values must be https URLs (any case) or JSON null; nothing else is
  -- stored. The client renders these as href, so the server is the last
  -- line against a javascript: or data: value from a compromised admin
  -- session. ~* so HTTPS:// is accepted.
  if (allowed ? 'fb_url') and jsonb_typeof(allowed->'fb_url') <> 'null'
     and (jsonb_typeof(allowed->'fb_url') <> 'string' or (allowed->>'fb_url') !~* '^https://') then
    raise exception 'Facebook link must start with https://';
  end if;
  if (allowed ? 'discord_url') and jsonb_typeof(allowed->'discord_url') <> 'null'
     and (jsonb_typeof(allowed->'discord_url') <> 'string' or (allowed->>'discord_url') !~* '^https://') then
    raise exception 'Discord link must start with https://';
  end if;

  update leagues set config = jsonb_strip_nulls(config || allowed) where id = p_league_id;
  return json_build_object('ok', true);
end $$;

revoke execute on function admin_update_league_config(text,text,bigint,jsonb) from public;
grant execute on function admin_update_league_config(text,text,bigint,jsonb) to anon, authenticated;

-- my_leagues gains the two links so the admin Community section never
-- needs a second fetch. Return type changes, so the explicit drop is
-- required (same rule stage_c2a applied when it added official_opt_in).
-- Body otherwise identical to stage_c2a_rpcs.sql:99.
drop function if exists my_leagues(text,text);
create or replace function my_leagues(p_name text, p_pin text)
returns table(league_id bigint, league_name text, is_league_admin boolean,
              bracket_id bigint, bracket_kind text, bracket_name text, official_opt_in boolean,
              fb_url text, discord_url text)
language plpgsql security definer set search_path = public, extensions as $$
declare pl players;
begin
  pl := _auth_player(p_name, p_pin);
  return query
    select l.id, l.name, lm.is_league_admin, b.id, b.kind, b.name, lm.official_opt_in,
           l.config->>'fb_url', l.config->>'discord_url'
    from league_members lm
    join leagues l on l.id = lm.league_id
    join brackets b on b.league_id = l.id
    where lm.player_id = pl.id
    order by l.name, b.kind;
end $$;
grant execute on function my_leagues(text,text) to anon, authenticated;

commit;

-- ============================================================
-- VERIFICATION (run separately) — deploy check FIRST, per the Stage Q lesson
-- ============================================================
-- 1. DID IT DEPLOY?
--   select p.oid::regprocedure::text, pg_get_function_result(p.oid)
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public' and p.proname in ('admin_update_league_config','my_leagues');
--   Expect exactly two rows; my_leagues' result must end "... fb_url text, discord_url text".
--
-- 2. Column present with the right default:
--   select column_name, data_type, column_default from information_schema.columns
--   where table_name = 'leagues' and column_name = 'config';
--   Expect: config | jsonb | '{}'::jsonb
--
-- 3. Whitelist (as a league admin, THROUGH THE RPC, not the table):
--   select admin_update_league_config('<your name>', '<your pin>', <league id>,
--     '{"join_code":"x","fb_url":"https://example.invalid/fb"}'::jsonb);
--   select config from leagues where id = <league id>;
--   Expect: {"fb_url": "https://example.invalid/fb"} — join_code ABSENT.
--
-- 4. Non-https must raise 'Discord link must start with https://':
--   select admin_update_league_config('<your name>', '<your pin>', <league id>,
--     '{"discord_url":"javascript:alert(1)"}'::jsonb);
--
-- 5. Clear a key: '{"fb_url": null}' → config no longer has fb_url.
--
-- 6. Unauthenticated must fail with P0001 'Wrong name or PIN', NOT PGRST202
--    (PGRST202 = not deployed):
--   curl -s -X POST '.../rest/v1/rpc/admin_update_league_config' \
--     -H "apikey: $ANON" -H "Authorization: Bearer $ANON" -H 'Content-Type: application/json' \
--     -d '{"p_name":"__nope__","p_pin":"0000","p_league_id":1,"p_data":{}}'
