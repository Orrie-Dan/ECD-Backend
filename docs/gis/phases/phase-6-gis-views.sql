-- Phase 6 — GIS export views (ArcGIS reads gis.*, not public.*)
-- Booleans cast to smallint; soft-deleted rows excluded where deleted_at exists.

CREATE OR REPLACE VIEW gis.ecd_center AS
SELECT
  e.objectid,
  e.id,
  e.code,
  e.name,
  e.phone,
  e.capacity,
  e.geom,
  s.label_en  AS status,
  cc.label_en AS current_compliance_level,
  e.current_compliance_assessed_at
FROM ecd_center e
LEFT JOIN lookup_ecd_center_status s ON s.id = e.status_id
LEFT JOIN lookup_compliance_classification cc ON cc.id = e.current_compliance_level_id
WHERE e.deleted_at IS NULL;

CREATE OR REPLACE VIEW gis.administrative_unit AS
SELECT
  a.objectid,
  a.id,
  a.name,
  a.code,
  a.geom,
  l.label_en AS level
FROM administrative_unit a
LEFT JOIN lookup_administrative_level l ON l.id = a.level_id;

CREATE OR REPLACE VIEW gis.compliance_assessment_latest AS
SELECT DISTINCT ON (ca.center_id)
  ca.id, ca.center_id, e.geom,
  at.label_en AS assessment_type,
  ast.label_en AS status,
  oc.label_en AS overall_classification,
  ca.assessment_date
FROM compliance_assessment ca
JOIN ecd_center e ON e.id = ca.center_id AND e.deleted_at IS NULL
LEFT JOIN lookup_assessment_type at ON at.id = ca.assessment_type_id
LEFT JOIN lookup_assessment_status ast ON ast.id = ca.status_id
LEFT JOIN lookup_compliance_classification oc ON oc.id = ca.overall_classification_id
WHERE ca.deleted_at IS NULL
ORDER BY ca.center_id, ca.assessment_date DESC;

CREATE OR REPLACE VIEW gis.wash_indicator_latest AS
SELECT DISTINCT ON (w.center_id)
  w.id, w.center_id, e.geom,
  (w.water_source_available::int) AS water_source_available,
  wst.label_en AS water_source_type,
  (w.sanitation_facility_available::int) AS sanitation_facility_available,
  w.latrine_count,
  (w.handwashing_facility_available::int) AS handwashing_facility_available,
  (w.waste_management_available::int) AS waste_management_available,
  w.recorded_date
FROM wash_indicator w
JOIN ecd_center e ON e.id = w.center_id AND e.deleted_at IS NULL
LEFT JOIN lookup_water_source_type wst ON wst.id = w.water_source_type_id
WHERE w.deleted_at IS NULL
ORDER BY w.center_id, w.recorded_date DESC;

CREATE OR REPLACE VIEW gis.child_nutrition_screening AS
SELECT
  cns.id, cns.child_id, ch.center_id, e.geom,
  cns.screening_date, cns.weight_kg, cns.muac_cm, cns.height_cm,
  cns.head_circumference_cm,
  ns.label_en AS nutrition_status,
  (cns.requires_referral::int) AS requires_referral
FROM child_nutrition_screening cns
JOIN child ch ON ch.id = cns.child_id AND ch.deleted_at IS NULL
JOIN ecd_center e ON e.id = ch.center_id AND e.deleted_at IS NULL
LEFT JOIN lookup_nutrition_status ns ON ns.id = cns.nutrition_status_id
WHERE cns.deleted_at IS NULL;

CREATE OR REPLACE VIEW gis.referral AS
SELECT
  r.id, r.child_id, r.center_id, e.geom,
  st.label_en AS source_type, r.referral_date, r.reason, r.destination,
  rs.label_en AS status
FROM referral r
JOIN ecd_center e ON e.id = r.center_id AND e.deleted_at IS NULL
LEFT JOIN lookup_referral_source_type st ON st.id = r.source_type_id
LEFT JOIN lookup_referral_status rs ON rs.id = r.status_id
WHERE r.deleted_at IS NULL;

CREATE OR REPLACE VIEW gis.attendance_summary AS
SELECT
  a.center_id, e.geom,
  date_trunc('month', a.attendance_date)::date AS month,
  count(*) FILTER (WHERE ast.code = 'present') AS present_count,
  count(*) FILTER (WHERE ast.code = 'absent')  AS absent_count
FROM attendance_record a
JOIN ecd_center e ON e.id = a.center_id AND e.deleted_at IS NULL
LEFT JOIN lookup_attendance_status ast ON ast.id = a.status_id
WHERE a.deleted_at IS NULL
GROUP BY a.center_id, e.geom, date_trunc('month', a.attendance_date);

CREATE OR REPLACE VIEW gis.sted_assessment AS
SELECT
  s.id, s.child_id, s.center_id, e.geom,
  s.assessment_date, ab.label_en AS age_band,
  (s.consent_obtained::int) AS consent_obtained,
  os.outcome_code,
  (os.referral_required::int) AS referral_required,
  (os.has_physical_problems::int) AS has_physical_problems,
  (os.has_failed_milestones::int) AS has_failed_milestones,
  os.delay_level,
  (s.follow_up_in_6_months::int) AS follow_up_in_6_months
FROM sted_assessment s
JOIN ecd_center e ON e.id = s.center_id AND e.deleted_at IS NULL
LEFT JOIN lookup_sted_age_band ab ON ab.id = s.age_band_id
LEFT JOIN sted_outcome_summary os ON os.assessment_id = s.id
WHERE s.deleted_at IS NULL;

CREATE OR REPLACE VIEW gis.parent_contribution AS
SELECT
  p.id, p.center_id, e.geom, p.amount, p.quantity,
  ct.label_en AS contribution_type, it.label_en AS item_type
FROM parent_contribution p
JOIN ecd_center e ON e.id = p.center_id AND e.deleted_at IS NULL
LEFT JOIN lookup_parent_contribution_type ct ON ct.id = p.contribution_type_id
LEFT JOIN lookup_in_kind_item_type it ON it.id = p.item_type_id
WHERE p.deleted_at IS NULL;

CREATE OR REPLACE VIEW gis.center_support AS
SELECT
  c.id, c.center_id, e.geom, c.quantity,
  sc.label_en AS support_category
FROM center_support c
JOIN ecd_center e ON e.id = c.center_id AND e.deleted_at IS NULL
LEFT JOIN lookup_center_support_category sc ON sc.id = c.support_category_id
WHERE c.deleted_at IS NULL;

-- Q5: classroom / staff_training inherit center geometry (no standalone child layer per Q6)
CREATE OR REPLACE VIEW gis.classroom_by_center AS
SELECT
  cr.center_id,
  e.geom,
  g.label_en AS grade,
  count(*)::int AS classroom_count
FROM classroom cr
JOIN ecd_center e ON e.id = cr.center_id AND e.deleted_at IS NULL
LEFT JOIN lookup_classroom_grade g ON g.id = cr.grade_id
GROUP BY cr.center_id, e.geom, g.label_en;

CREATE OR REPLACE VIEW gis.staff_training_by_center AS
SELECT
  st.center_id,
  e.geom,
  date_trunc('month', st.training_date)::date AS month,
  count(*)::int AS training_sessions,
  sum(st.duration_days)::int AS total_duration_days
FROM staff_training st
JOIN ecd_center e ON e.id = st.center_id AND e.deleted_at IS NULL
WHERE st.deleted_at IS NULL
GROUP BY st.center_id, e.geom, date_trunc('month', st.training_date);
