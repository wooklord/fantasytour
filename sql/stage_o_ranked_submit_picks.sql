-- ============================================================
-- STAGE O — submit_picks accepts ranked-choice picks
-- ============================================================
-- !! WRITTEN BUT **NOT APPLIED** TO THE DATABASE (as of 2026-08-13) !!
-- The presence of this file in sql/ does NOT mean it has been run. Unlike
-- every other stage file here, this one is deliberately pending.
--
-- Apply it as ONE BATCH together with:
--   1. src/features/picks.js  (the ranked pick sheet — not built yet)
--   2. supabase functions deploy carton-sync  (the ranked scorer — written,
--      committed, not deployed)
--   3. RANKED_CHOICE_ENABLED = true in src/core/config.js
--
-- Applying it alone opens a window where submit_picks accepts rank1..rankN
-- slots that no UI can produce and no deployed scorer can score. Nothing
-- breaks in that window — it is a no-op for every bracket that exists today,
-- since all of them are slot mode — but it is an untestable half-state, and
-- the ranked half would sit unverified in production for however long
-- picks.js takes. There is no urgency to run it early precisely BECAUSE it
-- is a no-op for existing brackets.
--
-- Verification step 3 below cannot be run until that batch lands.
-- ============================================================
-- Body-only re-touch of submit_picks (same signature as
-- stage_n_reject_pending_pin_change_writes.sql, which is its current live
-- definition). Same idiom as stage_d re-touching admin_set_season_roster or
-- stage_c2a re-touching submit_picks: everything outside the two marked
-- blocks below is byte-identical to the live body, so a mechanical diff
-- against it should show exactly those two changes and nothing else.
--
-- submit_picks is the ONLY server-side function that reads slot-shaped
-- config. That was established by an exhaustive scan of all 24 files in
-- sql/ plus the edge function, after two earlier "no SQL needed" claims for
-- Module B turned out false — see the server-side trace section in
-- docs/module_b_ranked_choice_plan.md, including why the live definition of
-- a function is the LAST file that defines it rather than the obvious one.
--
-- This file contains two changes with very different standing, and they are
-- kept visibly separate on purpose:
--
--   CHANGE 1 (REQUIRED) — build valid_slots from the ladder in ranked mode.
--     Without this nothing works at all: valid_slots is derived from
--     cfg->'slots', a ranked bracket's config still carries its slots-mode
--     slots (preserved deliberately by admin.js's read-through save
--     guards), and no rankN key appears anywhere in it. Every ranked save
--     therefore raises 'Invalid slot: rank1' today. This is a bug fix, not
--     a design choice.
--
--   CHANGE 2 (DESIGN DECISION, chosen 2026-08-13) — duplicates are always
--     rejected in ranked mode, regardless of cfg.allow_duplicates.
--     scoreRankedPicks checks played.has(...) per pick with no cross-pick
--     comparison, so the same song entered at Rank 1 and Rank 2 pays both.
--     On a 5/4/3/2/1 ladder, putting one likely song in all five ranks
--     scores 15 if it plays and 0 if not — roughly 12 expected points for
--     an 80%-likely song, against roughly 8.4 for a genuine five-song
--     spread. That is not merely viable, it strictly dominates, and it
--     collapses the game to a single guess. This was CHOSEN on that
--     reasoning; it is not forced by anything structural, and a future
--     reader should feel free to revisit it if the ladder is ever
--     redesigned (e.g. flat values, or diminishing returns). It mirrors how
--     scoreRankedPicks suppresses cover/debut/wildcard structurally rather
--     than via a toggle: an admin cannot flip a ranked bracket into the
--     broken configuration, because the control is not exposed in ranked
--     mode and this check ignores it anyway.
--
-- NOT changed here, deliberately: the duplicate comparison still uses
-- lower() while the scorer matches with norm(). Those disagree — "Voice Of
-- Them All!" evades a check that "voice of them all" trips — which is a
-- real pre-existing bug in slots mode, out of scope for this file, and
-- recorded as an open question in the plan file.

begin;

create or replace function submit_picks(p_name text, p_pin text, p_bracket_id bigint, p_show_id bigint, p_picks jsonb)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare
  pl players; brk brackets; ls league_shows; sh shows;
  cfg jsonb; sect jsonb; item jsonb; gate record;
  valid_slots text[]; songs text[]; n_flat int;
  is_ranked boolean; n_ladder int;
begin
  pl := _auth_player(p_name, p_pin);
  perform _reject_if_must_change_pin(pl);

  select * into brk from brackets where id = p_bracket_id;
  if brk.id is null then raise exception 'Bracket not found'; end if;

  if not exists (select 1 from league_members where league_id = brk.league_id and player_id = pl.id) then
    raise exception 'You are not a member of this league';
  end if;

  select * into sh from shows where id = p_show_id;
  if sh.id is null then raise exception 'Show not found'; end if;

  select * into ls from league_shows where league_id = brk.league_id and show_id = p_show_id;
  if ls.league_id is null then raise exception 'This show is not on this league''s schedule'; end if;

  cfg := brk.config;
  if coalesce(cfg->>'voting_override','auto') = 'locked' then
    raise exception 'Voting is locked by the admin';
  end if;
  if coalesce(cfg->>'voting_override','auto') = 'open' then
    if sh.showdate < current_date then raise exception 'That show already happened'; end if;
  else
    if ls.cutoff_at is null then raise exception 'Picks are not open for this show yet'; end if;
    if now() >= ls.cutoff_at then raise exception 'Picks are locked for this show'; end if;
  end if;

  select * into gate from _official_gate(p_bracket_id, p_show_id, pl.id);
  if not gate.ok then raise exception '%', gate.reason; end if;

  -- ---- CHANGE 1 (REQUIRED): valid slot keys, per scoring mode ----
  -- A config with no 'mode' key is slot mode. That is every bracket that
  -- existed before ranked choice, so absence must keep behaving exactly as
  -- before — hence coalesce rather than a bare comparison.
  is_ranked := coalesce(cfg->>'mode', 'slots') = 'ranked_choice';

  if is_ranked then
    -- FORMAT INDEPENDENCE IS THE POINT OF THIS BRANCH, not a side effect.
    -- Locked decision 3: a ranked bracket's row count never varies by show
    -- format. Slot mode splits on ls.format because its slot keys name set
    -- structure ("Set 2 Closer") that a one-set show does not have; a rank
    -- names nothing structural.
    --
    -- CONCRETELY, AND THIS IS THE INVARIANT TO PRESERVE: for a ranked
    -- bracket, valid_slots MUST be identical for a one-set show and a
    -- standard show. It is, because ls.format, sect, and cfg->'oneset' are
    -- all three absent from this branch — the only inputs are
    -- cfg->'ranked'->'ladder', read from the TOP LEVEL, and the loop
    -- counter. ls.format cannot reach valid_slots here because nothing in
    -- this branch reads it.
    --
    -- That guarantee currently rests on WHERE the `sect` assignment sits
    -- (inside the else, so it never executes for a ranked bracket), which
    -- is exactly the kind of thing a future edit could quietly undo by
    -- hoisting it above this if/else for tidiness. If you are tempted to do
    -- that: don't. Hoisting it would not change behaviour today, since the
    -- ranked branch ignores sect — but it would put a format-dependent
    -- expression on the ranked code path, one edit away from being read.
    -- Keep sect derived only where it is used.
    n_ladder := coalesce(jsonb_array_length(cfg->'ranked'->'ladder'), 0);
    if n_ladder = 0 then
      raise exception 'This bracket has no ranks configured yet — an admin needs to set up the ladder';
    end if;
    valid_slots := array[]::text[];
    for i in 1..n_ladder loop valid_slots := valid_slots || ('rank' || i); end loop;
  else
    sect := case when ls.format = 'one_set' and cfg ? 'oneset' then cfg->'oneset' else cfg end;
    n_flat := coalesce((sect->>'flat_picks')::int, 0);
    select array_agg(s->>'key') into valid_slots from jsonb_array_elements(sect->'slots') s;
    for i in 1..n_flat loop valid_slots := valid_slots || ('flat' || i); end loop;
  end if;
  -- ---- end CHANGE 1 ----

  songs := array[]::text[];
  for item in select * from jsonb_array_elements(p_picks) loop
    if not (item->>'slot' = any(valid_slots)) then
      raise exception 'Invalid slot: %', item->>'slot';
    end if;
    if coalesce(trim(item->>'songname'), '') = '' then
      -- Explicitly submitted blank: clear any existing pick in this slot
      -- (the catch-all delete below only removes slots absent from
      -- p_picks entirely, so a resubmitted-blank slot needs its own delete
      -- or a previously-saved pick here would never actually clear).
      delete from picks where player_id = pl.id and bracket_id = p_bracket_id
        and show_id = p_show_id and slot = item->>'slot';
      continue;
    end if;
    -- ---- CHANGE 2 (DESIGN DECISION): ranked mode ignores allow_duplicates ----
    -- `is_ranked or ...` rather than a separate branch, so slot mode's
    -- behaviour is provably untouched: with is_ranked false this is the
    -- original condition, character for character.
    --
    -- Note what is NOT mode-dependent here: the comparison itself. Ranked
    -- mode changes only WHETHER this check fires, never WHAT it compares —
    -- lower() and the `songs` accumulator sit outside the is_ranked
    -- disjunct, and there is exactly one lower() in this function. So the
    -- ranked path inherits the SAME known disagreement with the scorer's
    -- norm() that slot mode already has ("Voice Of Them All!" evades a
    -- check that "voice of them all" trips), rather than introducing a
    -- second, different normalization. One recorded bug is a bug; two
    -- would be a mess. Fixing it is out of scope for this file and is
    -- tracked as an open question in docs/module_b_ranked_choice_plan.md.
    if (is_ranked or not coalesce((cfg->>'allow_duplicates')::bool, false))
       and lower(item->>'songname') = any(songs) then
      raise exception 'Duplicate pick: %', item->>'songname';
    end if;
    -- ---- end CHANGE 2 ----
    songs := songs || lower(item->>'songname');
    insert into picks (player_id, bracket_id, show_id, slot, songname, updated_at)
      values (pl.id, p_bracket_id, p_show_id, item->>'slot', trim(item->>'songname'), now())
      on conflict (player_id, bracket_id, show_id, slot)
      do update set songname = excluded.songname, updated_at = now();
  end loop;
  delete from picks where player_id = pl.id and bracket_id = p_bracket_id and show_id = p_show_id
    and not (slot = any(select jsonb_array_elements(p_picks)->>'slot'));
  return json_build_object('ok', true, 'saved', coalesce(array_length(songs,1),0));
end $$;

commit;

-- ============================================================
-- VERIFICATION
-- ============================================================
-- 1) Function still exists with the same signature (one row):
-- select proname, pg_get_function_identity_arguments(oid)
--   from pg_proc where proname = 'submit_picks';
--
-- 2) Slot mode is unchanged. Pick any existing slots-mode bracket and
--    confirm a normal pick sheet still saves, and that a duplicate song is
--    still accepted/rejected exactly as cfg.allow_duplicates says. Nothing
--    in this file should alter that path — `is_ranked` is false there and
--    both changed expressions reduce to their original form.
--
-- 3) Ranked mode. Requires a bracket with config.mode = 'ranked_choice'
--    and a non-empty config.ranked.ladder. There is no such bracket in
--    production yet (RANKED_CHOICE_ENABLED is false in src/core/config.js
--    and the edge function is not deployed), so this is only testable after
--    those land — do NOT create one solely to test this, since picks would
--    accumulate against a scorer that isn't running.
--    Once one exists:
--      a. rank1..rankN save successfully (previously: 'Invalid slot: rank1')
--      b. rank{N+1} raises 'Invalid slot: rankN+1'
--      c. the same song at two different ranks raises 'Duplicate pick: X'
--         EVEN IF cfg.allow_duplicates is true  <-- CHANGE 2
--      d. toggling that show between 1 set and 2 set changes nothing about
--         which slots are accepted  <-- locked decision 3
