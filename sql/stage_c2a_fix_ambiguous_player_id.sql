-- ============================================================
-- FIX: get_bracket_scores raised "column reference player_id is ambiguous"
-- ============================================================
-- Bug: the membership-check subquery referenced `player_id` (and `league_id`)
-- unqualified, against a SINGLE-table FROM clause (league_members) — normally
-- fine, but this function's own `returns table(player_id uuid, ...)` output
-- columns are in-scope PL/pgSQL variables for the whole function body. An
-- unqualified `player_id` inside the function is therefore genuinely
-- ambiguous between "the league_members.player_id column" and "the
-- player_id output variable" — Postgres raises rather than guessing.
--
-- Only surfaced for a caller whose `is_global_admin` is false: the guard is
-- `not pl.is_global_admin and not exists(...)`, and boolean AND short-
-- circuits, so a global admin never even reaches the ambiguous subquery. A
-- plain league admin (the real-world case that hit this on-device) always
-- does.
--
-- Same body fix already applied to sql/stage_c2a_rpcs.sql's source (so a
-- fresh full-file run on a clean database won't reintroduce this) — this
-- file is the one-shot correction for the database that already ran the
-- buggy version. Signature is unchanged, so this is a plain create or
-- replace, no drop needed.
-- ============================================================

create or replace function get_bracket_scores(p_name text, p_pin text, p_bracket_id bigint, p_show_id bigint default null)
returns table(player_id uuid, player_name text, show_id bigint, points int, breakdown jsonb, updated_at timestamptz)
language plpgsql security definer set search_path = public, extensions as $$
declare pl players; v_league_id bigint;
begin
  pl := _auth_player(p_name, p_pin);
  select league_id into v_league_id from brackets where id = p_bracket_id;
  if v_league_id is null then raise exception 'Bracket not found'; end if;
  if not pl.is_global_admin and not exists (
    select 1 from league_members lm where lm.league_id = v_league_id and lm.player_id = pl.id
  ) then
    raise exception 'Not a member of this league';
  end if;
  return query
    select s.player_id, p.name, s.show_id, s.points, s.breakdown, s.updated_at
    from scores s
    join players p on p.id = s.player_id
    where s.bracket_id = p_bracket_id
      and (p_show_id is null or s.show_id = p_show_id);
end $$;

-- ============================================================
-- VERIFICATION
-- ============================================================
-- Run as a real non-global-admin league member (the exact path that broke) —
-- expect a clean result set (possibly empty, that's fine), not an exception:
--
-- select * from get_bracket_scores('NAME', 'PIN', <casual_or_official_bracket_id>);
