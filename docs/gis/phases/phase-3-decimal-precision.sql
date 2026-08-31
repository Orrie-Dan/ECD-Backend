-- Phase 3 — Decimal precision fixes
-- Pre-check (run manually; abort if any row fails bounds):

-- SELECT max(abs(latitude)), max(abs(longitude)) FROM ecd_center WHERE latitude IS NOT NULL;
-- SELECT max(weight_kg), max(muac_cm), max(height_cm), max(head_circumference_cm) FROM child_nutrition_screening;

-- Phase 4 may have run first on partial deploys; drop geom triggers so lat/lon can be altered.
DROP TRIGGER IF EXISTS trg_ecd_center_geom ON ecd_center;
DROP TRIGGER IF EXISTS trg_administrative_unit_geom ON administrative_unit;

ALTER TABLE administrative_unit
  ALTER COLUMN latitude  TYPE double precision USING latitude::double precision,
  ALTER COLUMN longitude TYPE double precision USING longitude::double precision;

ALTER TABLE ecd_center
  ALTER COLUMN latitude  TYPE double precision USING latitude::double precision,
  ALTER COLUMN longitude TYPE double precision USING longitude::double precision;

ALTER TABLE child_nutrition_screening
  ALTER COLUMN weight_kg              TYPE numeric(6,2) USING weight_kg::numeric(6,2),
  ALTER COLUMN muac_cm                TYPE numeric(5,1) USING muac_cm::numeric(5,1),
  ALTER COLUMN height_cm              TYPE numeric(5,1) USING height_cm::numeric(5,1),
  ALTER COLUMN head_circumference_cm  TYPE numeric(5,1) USING head_circumference_cm::numeric(5,1);

ALTER TABLE compliance_assessment_item
  ALTER COLUMN score TYPE numeric(8,2) USING score::numeric(8,2);

ALTER TABLE ecd_standard
  ALTER COLUMN weight TYPE numeric(6,3) USING weight::numeric(6,3);

ALTER TABLE center_feeding_month_summary
  ALTER COLUMN milk_liters TYPE numeric(12,3) USING milk_liters::numeric(12,3),
  ALTER COLUMN flour_kg    TYPE numeric(12,3) USING flour_kg::numeric(12,3);

-- parent_contribution / center_support already use DECIMAL(14,2/3) in Prisma — no change.
