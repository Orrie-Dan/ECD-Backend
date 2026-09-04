-- Backfill district_id on cells and villages under district-tagged sectors.
-- Enables GET /admin-units?districtId=&level=village without parent drill-down.

UPDATE sde.administrative_unit c
SET district_id = s.district_id
FROM sde.administrative_unit s
WHERE c.parent_id = s.id
  AND c.level = 'cell'::public.administrative_level
  AND c.district_id IS NULL
  AND s.district_id IS NOT NULL;

UPDATE sde.administrative_unit v
SET district_id = sec.district_id
FROM sde.administrative_unit c
JOIN sde.administrative_unit sec ON sec.id = c.parent_id
WHERE v.parent_id = c.id
  AND v.level = 'village'::public.administrative_level
  AND v.district_id IS NULL
  AND sec.district_id IS NOT NULL;
