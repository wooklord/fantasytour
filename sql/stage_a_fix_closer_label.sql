-- ============================================================
-- FIX: stage_a_schema.sql's seeded def_cfg used "label":"Closer" for the
-- `closer` slot. The vocabulary was later finalized as Set 1 Closer / Set 2
-- Closer / Show Closer (display labels only — the slot key stays `closer`),
-- but Stage A had already run and seeded the Ambassadors brackets before
-- that relabel landed in the seed file. Run this once to bring the
-- already-seeded live config in line with the corrected seed.
-- ============================================================

update brackets
set config = jsonb_set(
  config,
  '{slots}',
  (
    select jsonb_agg(
      case when elem->>'key' = 'closer' and elem->>'label' = 'Closer'
        then jsonb_set(elem, '{label}', '"Set 2 Closer"')
        else elem
      end
    )
    from jsonb_array_elements(config->'slots') elem
  )
)
where config->'slots' @> '[{"key":"closer","label":"Closer"}]';
