-- ============================================================
-- FANTASY EGGY — STAGE Y: per-league Discord status (Part 2 of the split)
-- ============================================================
-- Run ONCE in the Supabase SQL Editor, BEFORE deploying the carton-sync
-- edge function and BEFORE the client push (build order:
-- docs/decisions/discord-routing.md → "Part 2 build record"). The function
-- writes the columns this file creates; the client reads discord_live off
-- my_leagues. Deployed first, every post's status write fails (logged, not
-- thrown) and the daily check never stamps ran_at.
-- Record: docs/decisions/discord-routing.md → "Per-league split: LOCKED
-- 2026-10-28" (D1, D5) and "Part 2 build record: APPROVED 2026-11-01".
--
-- WHAT:
--   1. leagues.discord_status text, discord_checked_at timestamptz,
--      discord_ok_at timestamptz — nullable, no default, NO backfill: null
--      is "never checked", and discord_live is false until the first daily
--      check (or post) after the edge deploy records something. Written by
--      the service-role edge function only (statusPatch in discord.js):
--      status and checked_at on every check or post, ok_at only on a
--      success, so ok_at is the LAST success. They are PUBLIC through "pub
--      leagues" (select using true), and they hold a status word and two
--      timestamps — never a URL, never a token.
--   2. A check constraint: discord_status is ok, no_key, error or
--      http_<3 digits>. A new status word needs a migration, by design
--      (the dev's call 6, 2026-11-01).
--   3. my_leagues gains discord_live, discord_status, discord_checked_at.
--      discord_live = discord_ok_at within 2 days AND discord_status not
--      in (http_404, http_401, no_key) — the dev's call 2, a REFINEMENT of
--      D1's "status ok, checked within about 2 days": a transient 429, 5xx
--      or network error keeps the hint; a deleted webhook, a bad token or
--      a missing secret drops it at once; two days without a success drops
--      it too. The return type changes, so the explicit drop is required
--      (the Stage S rule). The body is otherwise Stage S's.
--   4. The daily check's gate row, sync_state 'daily_discord_check', seeded
--      unstamped (the dev's call 1: its own row, like Stage U's
--      'daily_show_sync'). sync_state is already RLS-locked (Stage U).
--
-- NOTHING here stores a webhook URL. Routing stays on env vars (roadmap
-- decision 2); leagues.config is neither read nor written.
-- ============================================================

begin;

-- 1. the three columns ------------------------------------------
alter table leagues
  add column if not exists discord_status     text,
  add column if not exists discord_checked_at timestamptz,
  add column if not exists discord_ok_at      timestamptz;

-- 2. the vocabulary ---------------------------------------------
-- The same words discord.js's postOutcome produces (ok, http_<code>, error)
-- plus no_key, resolveHook's null. test/stageY.test.mjs checks the two
-- regexes are identical and that every outcome discord.js can produce
-- satisfies this one.
do $$
begin
  if not exists (select 1 from pg_constraint
                 where conrelid = 'public.leagues'::regclass and conname = 'leagues_discord_status_check') then
    alter table leagues add constraint leagues_discord_status_check
      check (discord_status is null or discord_status ~ '^(ok|no_key|error|http_[0-9]{3})$');
  end if;
end $$;

-- 3. my_leagues --------------------------------------------------
drop function if exists my_leagues(text,text);
create or replace function my_leagues(p_name text, p_pin text)
returns table(league_id bigint, league_name text, is_league_admin boolean,
              bracket_id bigint, bracket_kind text, bracket_name text, official_opt_in boolean,
              fb_url text, discord_url text,
              discord_live boolean, discord_status text, discord_checked_at timestamptz)
language plpgsql security definer set search_path = public, extensions as $$
declare pl players;
begin
  pl := _auth_player(p_name, p_pin);
  return query
    select l.id, l.name, lm.is_league_admin, b.id, b.kind, b.name, lm.official_opt_in,
           l.config->>'fb_url', l.config->>'discord_url',
           coalesce(l.discord_ok_at > now() - interval '2 days', false)
             and coalesce(l.discord_status, '') not in ('http_404', 'http_401', 'no_key'),
           l.discord_status, l.discord_checked_at
    from league_members lm
    join leagues l on l.id = lm.league_id
    join brackets b on b.league_id = l.id
    where lm.player_id = pl.id
    order by l.name, b.kind;
end $$;
grant execute on function my_leagues(text,text) to anon, authenticated;

-- 4. the gate row ------------------------------------------------
insert into sync_state (key) values ('daily_discord_check') on conflict (key) do nothing;

commit;

/* ============================================================
   FOOTER: steps 0, 2A, 2B and R. Everything below is inside this block
   comment, so running the whole file never runs it. Copy one step at a
   time: the text between its BEGIN and END marker lines (the reply that
   shipped this file has a PowerShell line for each). STEP 0 and STEP 2A
   are each ONE query: read its rows, and every row's "ok" must be true.
   Every "char" catalog column (polcmd, ...) is cast ::text where it meets
   text: text || "char" has no unique operator (ERROR 42725, the Stage X
   lesson). test/stageY.test.mjs recomputes every md5, return type and
   count quoted here from the files.

-- STEP 0 BEGIN
-- Read-only. Run BEFORE Stage Y. Five rows, every "ok" true:
--   Y0.1 the live my_leagues is Stage S's (one definition, its return type,
--        its whitespace-collapsed body md5). A mismatch means the live body
--        is not Stage S's: look first, with
--        select pg_get_functiondef('my_leagues(text,text)'::regprocedure);
--   Y0.2 leagues has exactly id, name, created_at, config — no discord_*
--        column yet (a half-applied earlier try would show here).
--   Y0.3 leagues has RLS on and exactly one policy, the public select "pub
--        leagues": the three new columns inherit exactly that exposure, and
--        no write policy exists, so the anon key cannot write a status.
--   Y0.4 the Stage Y constraint does not exist yet.
--   Y0.5 sync_state holds only daily_show_sync (Stage U's row).
with
lst as (
  select count(*) as n, max(pg_get_function_result(p.oid)) as ret,
         max(md5(regexp_replace(p.prosrc, '\s+', ' ', 'g'))) as md5
  from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
  where ns.nspname = 'public' and p.proname = 'my_leagues'
),
cols as (
  select string_agg(column_name, ', ' order by ordinal_position) as v
  from information_schema.columns where table_schema = 'public' and table_name = 'leagues'
),
pol as (
  select (select relrowsecurity from pg_class where oid = 'public.leagues'::regclass) as rls,
         (select string_agg(polname || ':' || polcmd::text, ', ' order by polname collate "C")
          from pg_policy where polrelid = 'public.leagues'::regclass) as v
),
con as (
  select string_agg(conname, ', ') as v from pg_constraint
  where conrelid = 'public.leagues'::regclass and conname = 'leagues_discord_status_check'
),
gate as (select string_agg(key, ', ' order by key collate "C") as v from sync_state)
select 'Y0.1 live my_leagues is Stage S''s' as check_name,
       coalesce(lst.n = 1 and lst.md5 = 'dd072ff27627e89fffa1a6c02745a2d6'
                and lst.ret = 'TABLE(league_id bigint, league_name text, is_league_admin boolean, bracket_id bigint, bracket_kind text, bracket_name text, official_opt_in boolean, fb_url text, discord_url text)', false) as ok,
       lst.n || ' definition(s) | ' || coalesce(lst.ret, '-') || ' | ' || coalesce(lst.md5, '-') as actual from lst
union all
select 'Y0.2 leagues has exactly id, name, created_at, config',
       coalesce(cols.v = 'id, name, created_at, config', false), coalesce(cols.v, '(none)') from cols
union all
select 'Y0.3 leagues: RLS on, exactly one policy, the public select',
       coalesce(pol.rls and pol.v = 'pub leagues:r', false),
       'rls=' || coalesce(pol.rls::text, '-') || ' | ' || coalesce(pol.v, '(none)') from pol
union all
select 'Y0.4 the Stage Y constraint does not exist yet', con.v is null, coalesce(con.v, '(none)') from con
union all
select 'Y0.5 sync_state holds only daily_show_sync',
       coalesce(gate.v = 'daily_show_sync', false), coalesce(gate.v, '(none)') from gate;
-- STEP 0 END

-- STEP 2A BEGIN
-- Read-only. Run AFTER Stage Y: did it deploy? Seven rows, every "ok" true.
-- A false row shows what it found in "actual"; the Stage S md5
-- (dd072ff2…) in Y2.1 means my_leagues did not change.
with
f as (
  select count(*) as n, max(pg_get_function_result(p.oid)) as ret,
         max(md5(regexp_replace(p.prosrc, '\s+', ' ', 'g'))) as md5
  from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
  where ns.nspname = 'public' and p.proname = 'my_leagues'
),
cols as (
  select string_agg(column_name || ':' || data_type || ':' || coalesce(column_default, '-'), ', ' order by ordinal_position) as v
  from information_schema.columns
  where table_schema = 'public' and table_name = 'leagues' and column_name like 'discord%'
),
con as (
  select pg_get_constraintdef(oid) as v from pg_constraint
  where conrelid = 'public.leagues'::regclass and conname = 'leagues_discord_status_check'
),
nul as (
  select count(*) filter (where discord_status is not null or discord_checked_at is not null or discord_ok_at is not null) as n,
         count(*) as total from leagues
),
pol as (
  select (select relrowsecurity from pg_class where oid = 'public.leagues'::regclass) as rls,
         (select string_agg(polname || ':' || polcmd::text, ', ' order by polname collate "C")
          from pg_policy where polrelid = 'public.leagues'::regclass) as v
),
gate as (
  select count(*) as n, bool_and(ran_at is null and attempted_at is null and note is null) as blank
  from sync_state where key = 'daily_discord_check'
)
select 'Y2.1 my_leagues: Stage Y body, new return type' as check_name,
       coalesce(f.n = 1 and f.md5 = '13d48d9aee5f65990eb706790748db28'
                and f.ret = 'TABLE(league_id bigint, league_name text, is_league_admin boolean, bracket_id bigint, bracket_kind text, bracket_name text, official_opt_in boolean, fb_url text, discord_url text, discord_live boolean, discord_status text, discord_checked_at timestamp with time zone)', false) as ok,
       f.n || ' definition(s) | ' || coalesce(f.ret, '-') || ' | ' || coalesce(f.md5, '-') as actual from f
union all
select 'Y2.2 three discord_* columns, nullable, no default',
       coalesce(cols.v = 'discord_status:text:-, discord_checked_at:timestamp with time zone:-, discord_ok_at:timestamp with time zone:-', false),
       coalesce(cols.v, '(none)') from cols
union all
select 'Y2.3 the vocabulary constraint is present',
       coalesce(con.v like '%^(ok|no_key|error|http_[0-9]{3})$%', false), coalesce(con.v, '(none)') from con
union all
select 'Y2.4 no backfill: every league null in all three',
       coalesce(nul.n = 0, false), nul.n || ' of ' || nul.total || ' league(s) hold a value' from nul
union all
select 'Y2.5 my_leagues is executable by anon and authenticated',
       has_function_privilege('anon', 'public.my_leagues(text,text)', 'EXECUTE')
       and has_function_privilege('authenticated', 'public.my_leagues(text,text)', 'EXECUTE'),
       'anon=' || has_function_privilege('anon', 'public.my_leagues(text,text)', 'EXECUTE')
       || ' authenticated=' || has_function_privilege('authenticated', 'public.my_leagues(text,text)', 'EXECUTE')
union all
select 'Y2.6 leagues: RLS still on, still exactly the public select (no write policy: the anon key cannot write a status)',
       coalesce(pol.rls and pol.v = 'pub leagues:r', false),
       'rls=' || coalesce(pol.rls::text, '-') || ' | ' || coalesce(pol.v, '(none)') from pol
union all
select 'Y2.7 gate row daily_discord_check seeded, unstamped',
       coalesce(gate.n = 1 and gate.blank, false), gate.n || ' row(s), blank=' || coalesce(gate.blank::text, '-') from gate;
-- STEP 2A END

-- STEP 2B BEGIN
-- The smoke test. Self-contained: two throwaway players and a throwaway
-- league (inside the block only), the REAL my_leagues driven through every
-- status case the edge function can leave, the constraint tried with two
-- bad words, and it ENDS IN raise exception carrying PASS/FAIL, so
-- everything it wrote is rolled back, every time. No real PIN is typed and
-- no real row is touched. The one trace: identity sequences are not
-- transactional, so the next real league and bracket ids skip a number
-- (harmless). Read the result in the ERROR panel: "STAGE Y SMOKE: 0 of 15
-- FAILED | PASS …". Any other error text means setup failed before the
-- checks ran; that is rolled back too.
do $smoke$
declare
  v_tag text := 'zzy' || txid_current()::text;
  v_pin text := '4242';
  v_link text := 'https://example.invalid/smoke';
  lg bigint; brk bigint; mem uuid; other uuid;
  r record; err text; n int;
  lbl text[] := '{}'; ok boolean[] := '{}'; res text := ''; fails int := 0;
begin
  -- ---------- setup ----------
  insert into players (name, pin_hash) values (v_tag || 'mem', extensions.crypt(v_pin, extensions.gen_salt('bf'))) returning id into mem;
  insert into players (name, pin_hash) values (v_tag || 'other', extensions.crypt(v_pin, extensions.gen_salt('bf'))) returning id into other;
  insert into leagues (name, config) values (v_tag || ' Y', jsonb_build_object('discord_url', v_link)) returning id into lg;
  insert into brackets (league_id, name, kind, config) values (lg, 'Casual', 'casual', '{}') returning id into brk;
  insert into league_members (league_id, player_id, is_league_admin) values (lg, mem, false);

  -- ---------- never checked ----------
  select * into r from my_leagues(v_tag || 'mem', v_pin) where league_id = lg;
  lbl := lbl || 'S1 never checked: discord_live false (not null), status and checked_at null, the Stage S columns intact (link, bracket, admin flag)'::text;
  ok := ok || coalesce(r.discord_live = false and r.discord_status is null and r.discord_checked_at is null
                   and r.discord_url = v_link and r.fb_url is null and r.bracket_id = brk and r.is_league_admin = false, false);

  -- ---------- a success ----------
  update leagues set discord_status = 'ok', discord_checked_at = now(), discord_ok_at = now() where id = lg;
  select * into r from my_leagues(v_tag || 'mem', v_pin) where league_id = lg;
  lbl := lbl || 'S2 ok, checked now: live true, status ok, checked_at = now()'::text;
  ok := ok || coalesce(r.discord_live and r.discord_status = 'ok' and r.discord_checked_at = now(), false);

  update leagues set discord_checked_at = now() - interval '3 days', discord_ok_at = now() - interval '3 days' where id = lg;
  select * into r from my_leagues(v_tag || 'mem', v_pin) where league_id = lg;
  lbl := lbl || 'S3 ok but the last success is 3 days old: live false (stale), status still ok, checked_at still returned'::text;
  ok := ok || coalesce(r.discord_live = false and r.discord_status = 'ok' and r.discord_checked_at = now() - interval '3 days', false);

  update leagues set discord_ok_at = now() - interval '2 days' + interval '1 minute' where id = lg;
  select * into r from my_leagues(v_tag || 'mem', v_pin) where league_id = lg;
  lbl := lbl || 'S4 a success just inside 2 days: live'::text;
  ok := ok || coalesce(r.discord_live, false);

  update leagues set discord_ok_at = now() - interval '2 days' - interval '1 minute' where id = lg;
  select * into r from my_leagues(v_tag || 'mem', v_pin) where league_id = lg;
  lbl := lbl || 'S5 a success just outside 2 days: not live'::text;
  ok := ok || coalesce(r.discord_live = false, false);

  -- ---------- a transient failure after a recent success keeps the hint ----------
  update leagues set discord_status = 'http_429', discord_checked_at = now(), discord_ok_at = now() - interval '1 hour' where id = lg;
  select * into r from my_leagues(v_tag || 'mem', v_pin) where league_id = lg;
  lbl := lbl || 'S6 http_429 an hour after a success: still live, status http_429 reported'::text;
  ok := ok || coalesce(r.discord_live and r.discord_status = 'http_429', false);

  update leagues set discord_status = 'http_500' where id = lg;
  select * into r from my_leagues(v_tag || 'mem', v_pin) where league_id = lg;
  lbl := lbl || 'S7 http_500 after a recent success: still live'::text;
  ok := ok || coalesce(r.discord_live, false);

  update leagues set discord_status = 'error' where id = lg;
  select * into r from my_leagues(v_tag || 'mem', v_pin) where league_id = lg;
  lbl := lbl || 'S8 error (the fetch itself threw) after a recent success: still live'::text;
  ok := ok || coalesce(r.discord_live, false);

  -- ---------- the three words that drop it at once ----------
  update leagues set discord_status = 'http_404' where id = lg;
  select * into r from my_leagues(v_tag || 'mem', v_pin) where league_id = lg;
  lbl := lbl || 'S9 http_404 (webhook deleted) an hour after a success: NOT live'::text;
  ok := ok || coalesce(r.discord_live = false and r.discord_status = 'http_404', false);

  update leagues set discord_status = 'http_401' where id = lg;
  select * into r from my_leagues(v_tag || 'mem', v_pin) where league_id = lg;
  lbl := lbl || 'S10 http_401 (bad token): NOT live'::text;
  ok := ok || coalesce(r.discord_live = false, false);

  update leagues set discord_status = 'no_key' where id = lg;
  select * into r from my_leagues(v_tag || 'mem', v_pin) where league_id = lg;
  lbl := lbl || 'S11 no_key (no secret for the league name): NOT live'::text;
  ok := ok || coalesce(r.discord_live = false, false);

  -- ---------- the constraint ----------
  begin
    update leagues set discord_status = 'dead' where id = lg; err := 'no error';
  exception when check_violation then err := 'check_violation'; when others then err := sqlerrm; end;
  lbl := lbl || ('S12 a word outside the vocabulary is refused (got: ' || err || '), the row unchanged')::text;
  ok := ok || (err = 'check_violation' and (select discord_status from leagues where id = lg) = 'no_key');
  begin
    update leagues set discord_status = 'http_NaN' where id = lg; err := 'no error';
  exception when check_violation then err := 'check_violation'; when others then err := sqlerrm; end;
  lbl := lbl || ('S13 http_NaN is refused (got: ' || err || ')')::text;
  ok := ok || (err = 'check_violation');
  err := '';
  begin update leagues set discord_status = 'ok' where id = lg; exception when others then err := err || ' ok:' || sqlerrm; end;
  begin update leagues set discord_status = 'no_key' where id = lg; exception when others then err := err || ' no_key:' || sqlerrm; end;
  begin update leagues set discord_status = 'error' where id = lg; exception when others then err := err || ' error:' || sqlerrm; end;
  begin update leagues set discord_status = 'http_500' where id = lg; exception when others then err := err || ' http_500:' || sqlerrm; end;
  begin update leagues set discord_status = null where id = lg; exception when others then err := err || ' null:' || sqlerrm; end;
  lbl := lbl || ('S14 the vocabulary is accepted — ok, no_key, error, http_<3 digits>, null (errors:' || coalesce(nullif(err, ''), ' none') || ')')::text;
  ok := ok || (err = '');

  -- ---------- scoping unchanged ----------
  select count(*) into n from my_leagues(v_tag || 'other', v_pin);
  lbl := lbl || 'S15 a player outside the league gets no row for it (membership scoping as before)'::text;
  ok := ok || (n = 0);

  -- ---------- report, and roll everything back ----------
  for i in 1 .. array_length(lbl, 1) loop
    res := res || case when coalesce(ok[i], false) then ' | PASS ' else ' | FAIL ' end || lbl[i];
    if not coalesce(ok[i], false) then fails := fails + 1; end if;
  end loop;
  raise exception 'STAGE Y SMOKE: % of % FAILED%  [rolled back: this block always raises]', fails, array_length(lbl, 1), res;
end $smoke$;
-- STEP 2B END

-- STEP R BEGIN
-- ROLLBACK of Stage Y. Only while the Part 2 edge function is NOT deployed
-- (or after it has been rolled back to bb2dea4): a deployed Part 2 function
-- would then log a failed status write on every post. Puts my_leagues back
-- to Stage S's body (sql/stage_s_league_config.sql, verbatim —
-- test/stageY.test.mjs checks the md5), drops the constraint, the three
-- columns and the gate row. Run as ONE statement block.
begin;
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
alter table leagues drop constraint if exists leagues_discord_status_check;
alter table leagues
  drop column if exists discord_status,
  drop column if exists discord_checked_at,
  drop column if exists discord_ok_at;
delete from sync_state where key = 'daily_discord_check';
commit;
-- STEP R END

============================================================ */
