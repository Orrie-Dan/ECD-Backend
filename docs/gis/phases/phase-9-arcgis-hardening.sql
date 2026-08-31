-- Phase 9 — ArcGIS Pro hardening for gis.* export views
-- Re-run safe via gis:deploy / gis:migrate:phase --phase 9
--
-- Why: ArcGIS rejects public.* tables that contain PostgreSQL ENUM / UUID columns.
--      Register gis.ecd_center and gis.administrative_unit — NOT public.ecd_center.
--      Uses CAST() instead of :: casts (ArcGIS Pro can mis-parse :: in query layers).

-- Require non-null ObjectID for spatial registration (Esri prerequisite)
UPDATE ecd_center SET objectid = DEFAULT WHERE objectid IS NULL;
UPDATE administrative_unit SET objectid = DEFAULT WHERE objectid IS NULL;
ALTER TABLE ecd_center ALTER COLUMN objectid SET NOT NULL;
ALTER TABLE administrative_unit ALTER COLUMN objectid SET NOT NULL;

-- Drop views so column types can be recreated with explicit CAST targets
DROP VIEW IF EXISTS gis.device_registry;
DROP VIEW IF EXISTS gis.center_feeding_month_summary;
DROP VIEW IF EXISTS gis.staff_training_by_center;
DROP VIEW IF EXISTS gis.classroom_by_center;
DROP VIEW IF EXISTS gis.center_support;
DROP VIEW IF EXISTS gis.parent_contribution;
DROP VIEW IF EXISTS gis.sted_assessment;
DROP VIEW IF EXISTS gis.attendance_summary;
DROP VIEW IF EXISTS gis.referral;
DROP VIEW IF EXISTS gis.child_nutrition_screening;
DROP VIEW IF EXISTS gis.wash_indicator_latest;
DROP VIEW IF EXISTS gis.compliance_assessment_latest;
DROP VIEW IF EXISTS gis.administrative_unit;
DROP VIEW IF EXISTS gis.ecd_center;

CREATE VIEW gis.ecd_center AS
SELECT
  CAST(e.objectid AS integer)              AS objectid,
  CAST(e.id AS text)                       AS id,
  e.code,
  e.name,
  e.phone,
  e.capacity,
  e.geom,
  CAST(s.label_en AS text)                   AS status,
  CAST(cc.label_en AS text)                  AS current_compliance_level,
  e.current_compliance_assessed_at
FROM ecd_center e
LEFT JOIN lookup_ecd_center_status s ON s.id = e.status_id
LEFT JOIN lookup_compliance_classification cc ON cc.id = e.current_compliance_level_id
WHERE e.deleted_at IS NULL;

CREATE VIEW gis.administrative_unit AS
SELECT
  CAST(a.objectid AS integer)              AS objectid,
  CAST(a.id AS text)                         AS id,
  a.name,
  a.code,
  a.geom,
  CAST(l.label_en AS text)                   AS level
FROM administrative_unit a
LEFT JOIN lookup_administrative_level l ON l.id = a.level_id;

CREATE VIEW gis.compliance_assessment_latest AS
SELECT DISTINCT ON (ca.center_id)
  CAST(ca.id AS text)                       AS id,
  CAST(ca.center_id AS text)                 AS center_id,
  e.geom,
  CAST(at.label_en AS text)                  AS assessment_type,
  CAST(ast.label_en AS text)                 AS status,
  CAST(oc.label_en AS text)                  AS overall_classification,
  ca.assessment_date
FROM compliance_assessment ca
JOIN ecd_center e ON e.id = ca.center_id AND e.deleted_at IS NULL
LEFT JOIN lookup_assessment_type at ON at.id = ca.assessment_type_id
LEFT JOIN lookup_assessment_status ast ON ast.id = ca.status_id
LEFT JOIN lookup_compliance_classification oc ON oc.id = ca.overall_classification_id
WHERE ca.deleted_at IS NULL
ORDER BY ca.center_id, ca.assessment_date DESC;

CREATE VIEW gis.wash_indicator_latest AS
SELECT DISTINCT ON (w.center_id)
  CAST(w.id AS text)                         AS id,
  CAST(w.center_id AS text)                  AS center_id,
  e.geom,
  CAST(w.water_source_available AS integer)  AS water_source_available,
  CAST(wst.label_en AS text)                 AS water_source_type,
  CAST(w.sanitation_facility_available AS integer) AS sanitation_facility_available,
  w.latrine_count,
  CAST(w.handwashing_facility_available AS integer) AS handwashing_facility_available,
  CAST(w.waste_management_available AS integer) AS waste_management_available,
  w.recorded_date
FROM wash_indicator w
JOIN ecd_center e ON e.id = w.center_id AND e.deleted_at IS NULL
LEFT JOIN lookup_water_source_type wst ON wst.id = w.water_source_type_id
WHERE w.deleted_at IS NULL
ORDER BY w.center_id, w.recorded_date DESC;

CREATE VIEW gis.child_nutrition_screening AS
SELECT
  CAST(cns.id AS text)                       AS id,
  CAST(cns.child_id AS text)                 AS child_id,
  CAST(ch.center_id AS text)                 AS center_id,
  e.geom,
  cns.screening_date,
  cns.weight_kg,
  cns.muac_cm,
  cns.height_cm,
  cns.head_circumference_cm,
  CAST(ns.label_en AS text)                  AS nutrition_status,
  CAST(cns.requires_referral AS integer)     AS requires_referral
FROM child_nutrition_screening cns
JOIN child ch ON ch.id = cns.child_id AND ch.deleted_at IS NULL
JOIN ecd_center e ON e.id = ch.center_id AND e.deleted_at IS NULL
LEFT JOIN lookup_nutrition_status ns ON ns.id = cns.nutrition_status_id
WHERE cns.deleted_at IS NULL;

CREATE VIEW gis.referral AS
SELECT
  CAST(r.id AS text)                         AS id,
  CAST(r.child_id AS text)                   AS child_id,
  CAST(r.center_id AS text)                  AS center_id,
  e.geom,
  CAST(st.label_en AS text)                  AS source_type,
  r.referral_date,
  r.reason,
  r.destination,
  CAST(rs.label_en AS text)                  AS status
FROM referral r
JOIN ecd_center e ON e.id = r.center_id AND e.deleted_at IS NULL
LEFT JOIN lookup_referral_source_type st ON st.id = r.source_type_id
LEFT JOIN lookup_referral_status rs ON rs.id = r.status_id
WHERE r.deleted_at IS NULL;

CREATE VIEW gis.attendance_summary AS
SELECT
  CAST(a.center_id AS text)                  AS center_id,
  e.geom,
  CAST(date_trunc('month', a.attendance_date) AS date) AS month,
  CAST(count(*) FILTER (WHERE ast.code = 'present') AS integer) AS present_count,
  CAST(count(*) FILTER (WHERE ast.code = 'absent') AS integer)  AS absent_count
FROM attendance_record a
JOIN ecd_center e ON e.id = a.center_id AND e.deleted_at IS NULL
LEFT JOIN lookup_attendance_status ast ON ast.id = a.status_id
WHERE a.deleted_at IS NULL
GROUP BY a.center_id, e.geom, date_trunc('month', a.attendance_date);

CREATE VIEW gis.sted_assessment AS
SELECT
  CAST(s.id AS text)                         AS id,
  CAST(s.child_id AS text)                   AS child_id,
  CAST(s.center_id AS text)                  AS center_id,
  e.geom,
  s.assessment_date,
  CAST(ab.label_en AS text)                  AS age_band,
  CAST(s.consent_obtained AS integer)        AS consent_obtained,
  os.outcome_code,
  CAST(os.referral_required AS integer)      AS referral_required,
  CAST(os.has_physical_problems AS integer)  AS has_physical_problems,
  CAST(os.has_failed_milestones AS integer)  AS has_failed_milestones,
  os.delay_level,
  CAST(s.follow_up_in_6_months AS integer)   AS follow_up_in_6_months
FROM sted_assessment s
JOIN ecd_center e ON e.id = s.center_id AND e.deleted_at IS NULL
LEFT JOIN lookup_sted_age_band ab ON ab.id = s.age_band_id
LEFT JOIN sted_outcome_summary os ON os.assessment_id = s.id
WHERE s.deleted_at IS NULL;

CREATE VIEW gis.parent_contribution AS
SELECT
  CAST(p.id AS text)                         AS id,
  CAST(p.center_id AS text)                  AS center_id,
  e.geom,
  p.amount,
  p.quantity,
  CAST(ct.label_en AS text)                  AS contribution_type,
  CAST(it.label_en AS text)                  AS item_type
FROM parent_contribution p
JOIN ecd_center e ON e.id = p.center_id AND e.deleted_at IS NULL
LEFT JOIN lookup_parent_contribution_type ct ON ct.id = p.contribution_type_id
LEFT JOIN lookup_in_kind_item_type it ON it.id = p.item_type_id
WHERE p.deleted_at IS NULL;

CREATE VIEW gis.center_support AS
SELECT
  CAST(c.id AS text)                         AS id,
  CAST(c.center_id AS text)                  AS center_id,
  e.geom,
  c.quantity,
  CAST(sc.label_en AS text)                  AS support_category
FROM center_support c
JOIN ecd_center e ON e.id = c.center_id AND e.deleted_at IS NULL
LEFT JOIN lookup_center_support_category sc ON sc.id = c.support_category_id
WHERE c.deleted_at IS NULL;

CREATE VIEW gis.classroom_by_center AS
SELECT
  CAST(cr.center_id AS text)                 AS center_id,
  e.geom,
  CAST(g.label_en AS text)                   AS grade,
  CAST(count(*) AS integer)                  AS classroom_count
FROM classroom cr
JOIN ecd_center e ON e.id = cr.center_id AND e.deleted_at IS NULL
LEFT JOIN lookup_classroom_grade g ON g.id = cr.grade_id
GROUP BY cr.center_id, e.geom, g.label_en;

CREATE VIEW gis.staff_training_by_center AS
SELECT
  CAST(st.center_id AS text)                 AS center_id,
  e.geom,
  CAST(date_trunc('month', st.training_date) AS date) AS month,
  CAST(count(*) AS integer)                  AS training_sessions,
  CAST(sum(st.duration_days) AS integer)     AS total_duration_days
FROM staff_training st
JOIN ecd_center e ON e.id = st.center_id AND e.deleted_at IS NULL
WHERE st.deleted_at IS NULL
GROUP BY st.center_id, e.geom, date_trunc('month', st.training_date);

CREATE VIEW gis.center_feeding_month_summary AS
SELECT
  CAST(m.id AS text)                         AS id,
  CAST(m.center_id AS text)                  AS center_id,
  e.geom,
  m.year_month,
  m.milk_liters,
  m.flour_kg,
  CAST(fs.label_en AS text)                  AS food_source
FROM center_feeding_month_summary m
JOIN ecd_center e ON e.id = m.center_id AND e.deleted_at IS NULL
LEFT JOIN lookup_food_source fs ON fs.id = m.food_source_id
WHERE m.deleted_at IS NULL;

-- Optional: non-spatial device inventory (NOT a map layer — no geometry).
CREATE VIEW gis.device_registry AS
SELECT
  CAST(d.id AS text)                         AS id,
  CAST(d.user_id AS text)                    AS user_id,
  d.device_uuid,
  d.platform,
  d.app_version,
  CAST(d.status AS text)                     AS status,
  d.last_sync_at,
  d.registered_at
FROM device d;

COMMENT ON VIEW gis.ecd_center IS 'ArcGIS point layer — use instead of public.ecd_center';
COMMENT ON VIEW gis.administrative_unit IS 'ArcGIS point layer — use instead of public.administrative_unit';
COMMENT ON VIEW gis.device_registry IS 'ArcGIS table only (no geometry) — use instead of public.device';
