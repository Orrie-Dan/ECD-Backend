-- FIX-05: Collapse typo province "Estern Province" into canonical "Eastern Province".
-- Prefer the idempotent Node remediator for live DBs with data:
--   node scripts/merge-estern-into-eastern.cjs
--
-- This SQL documents the intended end state and is safe only when Estern has
-- already been emptied (centers remapped, child admin units removed).

-- Verify no Estern province remains:
-- SELECT id, name, code FROM sde.administrative_unit WHERE level = 'province' AND name ILIKE '%estern%';

DELETE FROM sde.administrative_unit
WHERE level = 'province'
  AND code = 'estern-province'
  AND name = 'Estern Province'
  AND NOT EXISTS (
    SELECT 1 FROM sde.district d WHERE d.province_id = administrative_unit.id
  );
