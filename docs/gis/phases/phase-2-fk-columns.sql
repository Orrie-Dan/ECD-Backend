-- Phase 2 — Add *_id FK columns alongside existing enum/string columns (non-breaking).
-- Old enum columns are NOT dropped here.

ALTER TABLE ecd_center ADD COLUMN IF NOT EXISTS status_id uuid REFERENCES lookup_ecd_center_status(id);
UPDATE ecd_center e SET status_id = l.id FROM lookup_ecd_center_status l WHERE l.code = e.status::text AND e.status_id IS NULL;

ALTER TABLE ecd_center ADD COLUMN IF NOT EXISTS current_compliance_level_id uuid REFERENCES lookup_compliance_classification(id);
UPDATE ecd_center e SET current_compliance_level_id = l.id FROM lookup_compliance_classification l
  WHERE l.code = e.current_compliance_level::text AND e.current_compliance_level_id IS NULL;

ALTER TABLE administrative_unit ADD COLUMN IF NOT EXISTS level_id uuid REFERENCES lookup_administrative_level(id);
UPDATE administrative_unit a SET level_id = l.id FROM lookup_administrative_level l WHERE l.code = a.level::text AND a.level_id IS NULL;

ALTER TABLE child_nutrition_screening ADD COLUMN IF NOT EXISTS nutrition_status_id uuid REFERENCES lookup_nutrition_status(id);
UPDATE child_nutrition_screening c SET nutrition_status_id = l.id FROM lookup_nutrition_status l
  WHERE l.code = c.nutrition_status::text AND c.nutrition_status_id IS NULL;

ALTER TABLE child_nutrition_screening ADD COLUMN IF NOT EXISTS meal_quality_id uuid REFERENCES lookup_meal_quality(id);
UPDATE child_nutrition_screening c SET meal_quality_id = l.id FROM lookup_meal_quality l
  WHERE c.meal_quality IS NOT NULL
    AND l.code = lower(regexp_replace(trim(c.meal_quality), '\s+', '_', 'g'))
    AND c.meal_quality_id IS NULL;

ALTER TABLE compliance_assessment ADD COLUMN IF NOT EXISTS assessment_type_id uuid REFERENCES lookup_assessment_type(id);
UPDATE compliance_assessment c SET assessment_type_id = l.id FROM lookup_assessment_type l
  WHERE l.code = c.assessment_type::text AND c.assessment_type_id IS NULL;

ALTER TABLE compliance_assessment ADD COLUMN IF NOT EXISTS status_id uuid REFERENCES lookup_assessment_status(id);
UPDATE compliance_assessment c SET status_id = l.id FROM lookup_assessment_status l
  WHERE l.code = c.status::text AND c.status_id IS NULL;

ALTER TABLE compliance_assessment ADD COLUMN IF NOT EXISTS overall_classification_id uuid REFERENCES lookup_compliance_classification(id);
UPDATE compliance_assessment c SET overall_classification_id = l.id FROM lookup_compliance_classification l
  WHERE l.code = c.overall_classification::text AND c.overall_classification_id IS NULL;

ALTER TABLE compliance_assessment_item ADD COLUMN IF NOT EXISTS response_id uuid REFERENCES lookup_item_response(id);
UPDATE compliance_assessment_item c SET response_id = l.id FROM lookup_item_response l
  WHERE l.code = c.response::text AND c.response_id IS NULL;

ALTER TABLE compliance_assessment_item ADD COLUMN IF NOT EXISTS gap_severity_id uuid REFERENCES lookup_gap_severity(id);
UPDATE compliance_assessment_item c SET gap_severity_id = l.id FROM lookup_gap_severity l
  WHERE l.code = c.gap_severity::text AND c.gap_severity_id IS NULL;

ALTER TABLE compliance_assessment_item ADD COLUMN IF NOT EXISTS gap_status_id uuid REFERENCES lookup_gap_status(id);
UPDATE compliance_assessment_item c SET gap_status_id = l.id FROM lookup_gap_status l
  WHERE l.code = c.gap_status::text AND c.gap_status_id IS NULL;

ALTER TABLE ecd_standard ADD COLUMN IF NOT EXISTS domain_id uuid REFERENCES lookup_standard_domain(id);
UPDATE ecd_standard e SET domain_id = l.id FROM lookup_standard_domain l WHERE l.code = e.domain::text AND e.domain_id IS NULL;

ALTER TABLE wash_indicator ADD COLUMN IF NOT EXISTS water_source_type_id uuid REFERENCES lookup_water_source_type(id);
UPDATE wash_indicator w SET water_source_type_id = l.id FROM lookup_water_source_type l
  WHERE w.water_source_type IS NOT NULL
    AND l.code = lower(regexp_replace(trim(w.water_source_type), '\s+', '_', 'g'))
    AND w.water_source_type_id IS NULL;

ALTER TABLE center_feeding_month_summary ADD COLUMN IF NOT EXISTS food_source_id uuid REFERENCES lookup_food_source(id);
UPDATE center_feeding_month_summary c SET food_source_id = l.id FROM lookup_food_source l
  WHERE l.code = lower(regexp_replace(trim(c.food_source), '\s+', '_', 'g'))
    AND c.food_source_id IS NULL;

-- Tier 2
ALTER TABLE child ADD COLUMN IF NOT EXISTS gender_id uuid REFERENCES lookup_child_gender(id);
UPDATE child c SET gender_id = l.id FROM lookup_child_gender l WHERE l.code = c.gender::text AND c.gender_id IS NULL;

ALTER TABLE child ADD COLUMN IF NOT EXISTS status_id uuid REFERENCES lookup_child_status(id);
UPDATE child c SET status_id = l.id FROM lookup_child_status l WHERE l.code = c.status::text AND c.status_id IS NULL;

ALTER TABLE attendance_record ADD COLUMN IF NOT EXISTS status_id uuid REFERENCES lookup_attendance_status(id);
UPDATE attendance_record a SET status_id = l.id FROM lookup_attendance_status l WHERE l.code = a.status::text AND a.status_id IS NULL;

ALTER TABLE attendance_record ADD COLUMN IF NOT EXISTS absent_reason_id uuid REFERENCES lookup_absent_reason(id);
UPDATE attendance_record a SET absent_reason_id = l.id FROM lookup_absent_reason l
  WHERE l.code = a.absent_reason::text AND a.absent_reason_id IS NULL;

ALTER TABLE sted_assessment ADD COLUMN IF NOT EXISTS age_band_id uuid REFERENCES lookup_sted_age_band(id);
UPDATE sted_assessment s SET age_band_id = l.id FROM lookup_sted_age_band l WHERE l.code = s.age_band::text AND s.age_band_id IS NULL;

ALTER TABLE referral ADD COLUMN IF NOT EXISTS source_type_id uuid REFERENCES lookup_referral_source_type(id);
UPDATE referral r SET source_type_id = l.id FROM lookup_referral_source_type l WHERE l.code = r.source_type::text AND r.source_type_id IS NULL;

ALTER TABLE referral ADD COLUMN IF NOT EXISTS status_id uuid REFERENCES lookup_referral_status(id);
UPDATE referral r SET status_id = l.id FROM lookup_referral_status l WHERE l.code = r.status::text AND r.status_id IS NULL;

ALTER TABLE child_transfer ADD COLUMN IF NOT EXISTS status_id uuid REFERENCES lookup_transfer_status(id);
UPDATE child_transfer c SET status_id = l.id FROM lookup_transfer_status l WHERE l.code = c.status::text AND c.status_id IS NULL;

ALTER TABLE classroom ADD COLUMN IF NOT EXISTS grade_id uuid REFERENCES lookup_classroom_grade(id);
UPDATE classroom c SET grade_id = l.id FROM lookup_classroom_grade l WHERE l.code = c.grade::text AND c.grade_id IS NULL;

ALTER TABLE parent_contribution ADD COLUMN IF NOT EXISTS contribution_type_id uuid REFERENCES lookup_parent_contribution_type(id);
UPDATE parent_contribution p SET contribution_type_id = l.id FROM lookup_parent_contribution_type l
  WHERE l.code = p.contribution_type::text AND p.contribution_type_id IS NULL;

ALTER TABLE parent_contribution ADD COLUMN IF NOT EXISTS item_type_id uuid REFERENCES lookup_in_kind_item_type(id);
UPDATE parent_contribution p SET item_type_id = l.id FROM lookup_in_kind_item_type l
  WHERE p.item_type IS NOT NULL AND l.code = p.item_type::text AND p.item_type_id IS NULL;

ALTER TABLE center_support ADD COLUMN IF NOT EXISTS support_category_id uuid REFERENCES lookup_center_support_category(id);
UPDATE center_support c SET support_category_id = l.id FROM lookup_center_support_category l
  WHERE l.code = c.support_category::text AND c.support_category_id IS NULL;

-- Helpful indexes (nullable columns OK during dual-write period)
CREATE INDEX IF NOT EXISTS idx_ecd_center_status_id ON ecd_center(status_id);
CREATE INDEX IF NOT EXISTS idx_child_center_id ON child(center_id);
CREATE INDEX IF NOT EXISTS idx_classroom_grade_id ON classroom(grade_id);
