-- Phase 8 — add missing GIS export view for center feeding (ArcGIS rel_center_feeding)
-- Safe to re-run. Requires Phase 6 + lookup dual-write (food_source_id) from Phase 2/7.

CREATE OR REPLACE VIEW gis.center_feeding_month_summary AS
SELECT
  m.id,
  m.center_id,
  e.geom,
  m.year_month,
  m.milk_liters,
  m.flour_kg,
  fs.label_en AS food_source
FROM center_feeding_month_summary m
JOIN ecd_center e ON e.id = m.center_id AND e.deleted_at IS NULL
LEFT JOIN lookup_food_source fs ON fs.id = m.food_source_id
WHERE m.deleted_at IS NULL;
