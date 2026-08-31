-- Phase 1c-seed — Populate coded-string lookups from existing row data.
-- Safe to re-run: ON CONFLICT DO NOTHING on code.
-- Run after phase-1c-optional-lookups.sql and before phase-2-fk-columns.sql backfill
-- for meal_quality_id, water_source_type_id, food_source_id.

INSERT INTO lookup_water_source_type (code, label_en, sort_order)
SELECT DISTINCT
  lower(regexp_replace(trim(water_source_type), '\s+', '_', 'g')) AS code,
  trim(water_source_type) AS label_en,
  row_number() OVER (ORDER BY trim(water_source_type))
FROM wash_indicator
WHERE water_source_type IS NOT NULL AND trim(water_source_type) <> ''
ON CONFLICT (code) DO NOTHING;

INSERT INTO lookup_food_source (code, label_en, sort_order)
SELECT DISTINCT
  lower(regexp_replace(trim(food_source), '\s+', '_', 'g')) AS code,
  trim(food_source) AS label_en,
  row_number() OVER (ORDER BY trim(food_source))
FROM center_feeding_month_summary
WHERE food_source IS NOT NULL AND trim(food_source) <> ''
ON CONFLICT (code) DO NOTHING;

INSERT INTO lookup_meal_quality (code, label_en, sort_order)
SELECT DISTINCT
  lower(regexp_replace(trim(meal_quality), '\s+', '_', 'g')) AS code,
  trim(meal_quality) AS label_en,
  row_number() OVER (ORDER BY trim(meal_quality))
FROM child_nutrition_screening
WHERE meal_quality IS NOT NULL AND trim(meal_quality) <> ''
ON CONFLICT (code) DO NOTHING;

-- Preview distinct values before seeding (optional):
-- SELECT DISTINCT water_source_type FROM wash_indicator WHERE water_source_type IS NOT NULL;
-- SELECT DISTINCT food_source FROM center_feeding_month_summary;
-- SELECT DISTINCT meal_quality FROM child_nutrition_screening WHERE meal_quality IS NOT NULL;
