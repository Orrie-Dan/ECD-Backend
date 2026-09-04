-- Remove GIS Scenario C lookup tables and duplicate *_id columns.
-- PostgreSQL enums remain the single source of truth.
-- Survey123 sync functions are unchanged.

-- ---------------------------------------------------------------------------
-- 1. Validate enum columns are populated where required
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  bad_count int;
  bad_detail text;
BEGIN
  -- Required enum columns must not be NULL
  SELECT count(*) INTO bad_count FROM sde.administrative_unit WHERE level IS NULL;
  IF bad_count > 0 THEN
    RAISE EXCEPTION 'administrative_unit: % rows have NULL level', bad_count;
  END IF;

  SELECT count(*) INTO bad_count FROM sde.ecd_center WHERE status IS NULL;
  IF bad_count > 0 THEN
    RAISE EXCEPTION 'ecd_center: % rows have NULL status', bad_count;
  END IF;

  SELECT count(*) INTO bad_count FROM sde.classroom WHERE grade IS NULL;
  IF bad_count > 0 THEN
    RAISE EXCEPTION 'classroom: % rows have NULL grade', bad_count;
  END IF;

  SELECT count(*) INTO bad_count FROM sde.child WHERE gender IS NULL OR status IS NULL;
  IF bad_count > 0 THEN
    RAISE EXCEPTION 'child: % rows have NULL gender or status', bad_count;
  END IF;

  SELECT count(*) INTO bad_count FROM sde.child_transfer WHERE status IS NULL;
  IF bad_count > 0 THEN
    RAISE EXCEPTION 'child_transfer: % rows have NULL status', bad_count;
  END IF;

  SELECT count(*) INTO bad_count FROM sde.attendance_record WHERE status IS NULL;
  IF bad_count > 0 THEN
    RAISE EXCEPTION 'attendance_record: % rows have NULL status', bad_count;
  END IF;

  SELECT count(*) INTO bad_count FROM sde.child_nutrition_screening WHERE nutrition_status IS NULL;
  IF bad_count > 0 THEN
    RAISE EXCEPTION 'child_nutrition_screening: % rows have NULL nutrition_status', bad_count;
  END IF;

  SELECT count(*) INTO bad_count FROM sde.center_feeding_month_summary WHERE food_source IS NULL OR trim(food_source) = '';
  IF bad_count > 0 THEN
    RAISE EXCEPTION 'center_feeding_month_summary: % rows have NULL or empty food_source', bad_count;
  END IF;

  SELECT count(*) INTO bad_count FROM sde.sted_assessment WHERE age_band IS NULL;
  IF bad_count > 0 THEN
    RAISE EXCEPTION 'sted_assessment: % rows have NULL age_band', bad_count;
  END IF;

  SELECT count(*) INTO bad_count FROM sde.referral WHERE source_type IS NULL OR status IS NULL;
  IF bad_count > 0 THEN
    RAISE EXCEPTION 'referral: % rows have NULL source_type or status', bad_count;
  END IF;

  SELECT count(*) INTO bad_count FROM sde.ecd_standard WHERE domain IS NULL;
  IF bad_count > 0 THEN
    RAISE EXCEPTION 'ecd_standard: % rows have NULL domain', bad_count;
  END IF;

  SELECT count(*) INTO bad_count FROM sde.compliance_assessment WHERE assessment_type IS NULL OR status IS NULL;
  IF bad_count > 0 THEN
    RAISE EXCEPTION 'compliance_assessment: % rows have NULL assessment_type or status', bad_count;
  END IF;

  SELECT count(*) INTO bad_count FROM sde.compliance_assessment_item WHERE response IS NULL;
  IF bad_count > 0 THEN
    RAISE EXCEPTION 'compliance_assessment_item: % rows have NULL response', bad_count;
  END IF;

  SELECT count(*) INTO bad_count FROM sde.parent_contribution WHERE contribution_type IS NULL;
  IF bad_count > 0 THEN
    RAISE EXCEPTION 'parent_contribution: % rows have NULL contribution_type', bad_count;
  END IF;

  SELECT count(*) INTO bad_count FROM sde.center_support WHERE support_category IS NULL;
  IF bad_count > 0 THEN
    RAISE EXCEPTION 'center_support: % rows have NULL support_category', bad_count;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Drop foreign-key constraints on duplicate lookup-ID columns
-- ---------------------------------------------------------------------------

ALTER TABLE sde.administrative_unit DROP CONSTRAINT IF EXISTS administrative_unit_level_id_fkey;
ALTER TABLE sde.ecd_center DROP CONSTRAINT IF EXISTS ecd_center_status_id_fkey;
ALTER TABLE sde.ecd_center DROP CONSTRAINT IF EXISTS ecd_center_current_compliance_level_id_fkey;
ALTER TABLE sde.classroom DROP CONSTRAINT IF EXISTS classroom_grade_id_fkey;
ALTER TABLE sde.child DROP CONSTRAINT IF EXISTS child_gender_id_fkey;
ALTER TABLE sde.child DROP CONSTRAINT IF EXISTS child_status_id_fkey;
ALTER TABLE sde.child_transfer DROP CONSTRAINT IF EXISTS child_transfer_status_id_fkey;
ALTER TABLE sde.attendance_record DROP CONSTRAINT IF EXISTS attendance_record_status_id_fkey;
ALTER TABLE sde.attendance_record DROP CONSTRAINT IF EXISTS attendance_record_absent_reason_id_fkey;
ALTER TABLE sde.child_nutrition_screening DROP CONSTRAINT IF EXISTS child_nutrition_screening_nutrition_status_id_fkey;
ALTER TABLE sde.child_nutrition_screening DROP CONSTRAINT IF EXISTS child_nutrition_screening_meal_quality_id_fkey;
ALTER TABLE sde.center_feeding_month_summary DROP CONSTRAINT IF EXISTS center_feeding_month_summary_food_source_id_fkey;
ALTER TABLE sde.sted_assessment DROP CONSTRAINT IF EXISTS sted_assessment_age_band_id_fkey;
ALTER TABLE sde.referral DROP CONSTRAINT IF EXISTS referral_source_type_id_fkey;
ALTER TABLE sde.referral DROP CONSTRAINT IF EXISTS referral_status_id_fkey;
ALTER TABLE sde.ecd_standard DROP CONSTRAINT IF EXISTS ecd_standard_domain_id_fkey;
ALTER TABLE sde.compliance_assessment DROP CONSTRAINT IF EXISTS compliance_assessment_assessment_type_id_fkey;
ALTER TABLE sde.compliance_assessment DROP CONSTRAINT IF EXISTS compliance_assessment_status_id_fkey;
ALTER TABLE sde.compliance_assessment DROP CONSTRAINT IF EXISTS compliance_assessment_overall_classification_id_fkey;
ALTER TABLE sde.compliance_assessment_item DROP CONSTRAINT IF EXISTS compliance_assessment_item_response_id_fkey;
ALTER TABLE sde.compliance_assessment_item DROP CONSTRAINT IF EXISTS compliance_assessment_item_gap_severity_id_fkey;
ALTER TABLE sde.compliance_assessment_item DROP CONSTRAINT IF EXISTS compliance_assessment_item_gap_status_id_fkey;
ALTER TABLE sde.wash_indicator DROP CONSTRAINT IF EXISTS wash_indicator_water_source_type_id_fkey;
ALTER TABLE sde.parent_contribution DROP CONSTRAINT IF EXISTS parent_contribution_contribution_type_id_fkey;
ALTER TABLE sde.parent_contribution DROP CONSTRAINT IF EXISTS parent_contribution_item_type_id_fkey;
ALTER TABLE sde.center_support DROP CONSTRAINT IF EXISTS center_support_support_category_id_fkey;

-- ---------------------------------------------------------------------------
-- 3. Drop indexes that only support lookup-ID columns
-- ---------------------------------------------------------------------------

DROP INDEX IF EXISTS sde.ecd_center_status_id_idx;
DROP INDEX IF EXISTS sde.classroom_grade_id_idx;

-- ---------------------------------------------------------------------------
-- 4. Drop duplicate lookup-ID columns
-- ---------------------------------------------------------------------------

ALTER TABLE sde.administrative_unit DROP COLUMN IF EXISTS level_id;
ALTER TABLE sde.ecd_center DROP COLUMN IF EXISTS status_id;
ALTER TABLE sde.ecd_center DROP COLUMN IF EXISTS current_compliance_level_id;
ALTER TABLE sde.classroom DROP COLUMN IF EXISTS grade_id;
ALTER TABLE sde.child DROP COLUMN IF EXISTS gender_id;
ALTER TABLE sde.child DROP COLUMN IF EXISTS status_id;
ALTER TABLE sde.child_transfer DROP COLUMN IF EXISTS status_id;
ALTER TABLE sde.attendance_record DROP COLUMN IF EXISTS status_id;
ALTER TABLE sde.attendance_record DROP COLUMN IF EXISTS absent_reason_id;
ALTER TABLE sde.child_nutrition_screening DROP COLUMN IF EXISTS nutrition_status_id;
ALTER TABLE sde.child_nutrition_screening DROP COLUMN IF EXISTS meal_quality_id;
ALTER TABLE sde.center_feeding_month_summary DROP COLUMN IF EXISTS food_source_id;
ALTER TABLE sde.sted_assessment DROP COLUMN IF EXISTS age_band_id;
ALTER TABLE sde.referral DROP COLUMN IF EXISTS source_type_id;
ALTER TABLE sde.referral DROP COLUMN IF EXISTS status_id;
ALTER TABLE sde.ecd_standard DROP COLUMN IF EXISTS domain_id;
ALTER TABLE sde.compliance_assessment DROP COLUMN IF EXISTS assessment_type_id;
ALTER TABLE sde.compliance_assessment DROP COLUMN IF EXISTS status_id;
ALTER TABLE sde.compliance_assessment DROP COLUMN IF EXISTS overall_classification_id;
ALTER TABLE sde.compliance_assessment_item DROP COLUMN IF EXISTS response_id;
ALTER TABLE sde.compliance_assessment_item DROP COLUMN IF EXISTS gap_severity_id;
ALTER TABLE sde.compliance_assessment_item DROP COLUMN IF EXISTS gap_status_id;
ALTER TABLE sde.wash_indicator DROP COLUMN IF EXISTS water_source_type_id;
ALTER TABLE sde.parent_contribution DROP COLUMN IF EXISTS contribution_type_id;
ALTER TABLE sde.parent_contribution DROP COLUMN IF EXISTS item_type_id;
ALTER TABLE sde.center_support DROP COLUMN IF EXISTS support_category_id;

-- ---------------------------------------------------------------------------
-- 5. Drop redundant lookup tables
-- ---------------------------------------------------------------------------

DROP TABLE IF EXISTS sde.lookup_ecd_center_status;
DROP TABLE IF EXISTS sde.lookup_compliance_classification;
DROP TABLE IF EXISTS sde.lookup_administrative_level;
DROP TABLE IF EXISTS sde.lookup_nutrition_status;
DROP TABLE IF EXISTS sde.lookup_meal_quality;
DROP TABLE IF EXISTS sde.lookup_assessment_type;
DROP TABLE IF EXISTS sde.lookup_assessment_status;
DROP TABLE IF EXISTS sde.lookup_item_response;
DROP TABLE IF EXISTS sde.lookup_gap_severity;
DROP TABLE IF EXISTS sde.lookup_gap_status;
DROP TABLE IF EXISTS sde.lookup_standard_domain;
DROP TABLE IF EXISTS sde.lookup_child_gender;
DROP TABLE IF EXISTS sde.lookup_child_status;
DROP TABLE IF EXISTS sde.lookup_attendance_status;
DROP TABLE IF EXISTS sde.lookup_absent_reason;
DROP TABLE IF EXISTS sde.lookup_sted_age_band;
DROP TABLE IF EXISTS sde.lookup_referral_source_type;
DROP TABLE IF EXISTS sde.lookup_referral_status;
DROP TABLE IF EXISTS sde.lookup_transfer_status;
DROP TABLE IF EXISTS sde.lookup_classroom_grade;
DROP TABLE IF EXISTS sde.lookup_parent_contribution_type;
DROP TABLE IF EXISTS sde.lookup_in_kind_item_type;
DROP TABLE IF EXISTS sde.lookup_center_support_category;
DROP TABLE IF EXISTS sde.lookup_water_source_type;
DROP TABLE IF EXISTS sde.lookup_food_source;
