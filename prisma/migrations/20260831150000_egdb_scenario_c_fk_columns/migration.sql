-- EGDB: scenario_c *_id FK columns missing on sde tables.
-- The 20260830180000_scenario_c_gis_dual_write migration ran before multi-schema (sde);
-- this backfills the same columns on sde.* explicitly. PostGIS geom columns omitted.

-- Optional coded-string lookup tables (also missing from sde)
CREATE TABLE IF NOT EXISTS sde.lookup_meal_quality (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text UNIQUE NOT NULL,
  label_en text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sde.lookup_food_source (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text UNIQUE NOT NULL,
  label_en text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sde.lookup_water_source_type (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text UNIQUE NOT NULL,
  label_en text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0
);

INSERT INTO sde.lookup_water_source_type (code, label_en, sort_order)
SELECT DISTINCT
  lower(regexp_replace(trim(water_source_type), '\s+', '_', 'g')) AS code,
  trim(water_source_type) AS label_en,
  row_number() OVER (ORDER BY trim(water_source_type))
FROM sde.wash_indicator
WHERE water_source_type IS NOT NULL AND trim(water_source_type) <> ''
ON CONFLICT (code) DO NOTHING;

INSERT INTO sde.lookup_food_source (code, label_en, sort_order)
SELECT DISTINCT
  lower(regexp_replace(trim(food_source), '\s+', '_', 'g')) AS code,
  trim(food_source) AS label_en,
  row_number() OVER (ORDER BY trim(food_source))
FROM sde.center_feeding_month_summary
WHERE food_source IS NOT NULL AND trim(food_source) <> ''
ON CONFLICT (code) DO NOTHING;

INSERT INTO sde.lookup_meal_quality (code, label_en, sort_order)
SELECT DISTINCT
  lower(regexp_replace(trim(meal_quality), '\s+', '_', 'g')) AS code,
  trim(meal_quality) AS label_en,
  row_number() OVER (ORDER BY trim(meal_quality))
FROM sde.child_nutrition_screening
WHERE meal_quality IS NOT NULL AND trim(meal_quality) <> ''
ON CONFLICT (code) DO NOTHING;

-- Add FK columns
ALTER TABLE sde.attendance_record
  ADD COLUMN IF NOT EXISTS absent_reason_id uuid,
  ADD COLUMN IF NOT EXISTS status_id uuid;

ALTER TABLE sde.center_feeding_month_summary
  ADD COLUMN IF NOT EXISTS food_source_id uuid;

ALTER TABLE sde.center_support
  ADD COLUMN IF NOT EXISTS support_category_id uuid;

ALTER TABLE sde.child
  ADD COLUMN IF NOT EXISTS gender_id uuid,
  ADD COLUMN IF NOT EXISTS status_id uuid;

ALTER TABLE sde.child_nutrition_screening
  ADD COLUMN IF NOT EXISTS meal_quality_id uuid,
  ADD COLUMN IF NOT EXISTS nutrition_status_id uuid;

ALTER TABLE sde.child_transfer
  ADD COLUMN IF NOT EXISTS status_id uuid;

ALTER TABLE sde.classroom
  ADD COLUMN IF NOT EXISTS grade_id uuid;

ALTER TABLE sde.compliance_assessment
  ADD COLUMN IF NOT EXISTS assessment_type_id uuid,
  ADD COLUMN IF NOT EXISTS overall_classification_id uuid,
  ADD COLUMN IF NOT EXISTS status_id uuid;

ALTER TABLE sde.compliance_assessment_item
  ADD COLUMN IF NOT EXISTS gap_severity_id uuid,
  ADD COLUMN IF NOT EXISTS gap_status_id uuid,
  ADD COLUMN IF NOT EXISTS response_id uuid;

ALTER TABLE sde.ecd_standard
  ADD COLUMN IF NOT EXISTS domain_id uuid;

ALTER TABLE sde.parent_contribution
  ADD COLUMN IF NOT EXISTS contribution_type_id uuid,
  ADD COLUMN IF NOT EXISTS item_type_id uuid;

ALTER TABLE sde.referral
  ADD COLUMN IF NOT EXISTS source_type_id uuid,
  ADD COLUMN IF NOT EXISTS status_id uuid;

ALTER TABLE sde.sted_assessment
  ADD COLUMN IF NOT EXISTS age_band_id uuid;

ALTER TABLE sde.wash_indicator
  ADD COLUMN IF NOT EXISTS water_source_type_id uuid;

-- Backfill from existing enum/string columns
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'sde' AND table_name = 'lookup_nutrition_status') THEN
    UPDATE sde.child_nutrition_screening c
    SET nutrition_status_id = l.id
    FROM sde.lookup_nutrition_status l
    WHERE l.code = c.nutrition_status::text AND c.nutrition_status_id IS NULL;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'sde' AND table_name = 'lookup_meal_quality') THEN
    UPDATE sde.child_nutrition_screening c
    SET meal_quality_id = l.id
    FROM sde.lookup_meal_quality l
    WHERE c.meal_quality IS NOT NULL
      AND l.code = lower(regexp_replace(trim(c.meal_quality), '\s+', '_', 'g'))
      AND c.meal_quality_id IS NULL;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'sde' AND table_name = 'lookup_transfer_status') THEN
    UPDATE sde.child_transfer c
    SET status_id = l.id
    FROM sde.lookup_transfer_status l
    WHERE l.code = c.status::text AND c.status_id IS NULL;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'sde' AND table_name = 'lookup_food_source') THEN
    UPDATE sde.center_feeding_month_summary c
    SET food_source_id = l.id
    FROM sde.lookup_food_source l
    WHERE l.code = lower(regexp_replace(trim(c.food_source), '\s+', '_', 'g'))
      AND c.food_source_id IS NULL;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'sde' AND table_name = 'lookup_water_source_type') THEN
    UPDATE sde.wash_indicator w
    SET water_source_type_id = l.id
    FROM sde.lookup_water_source_type l
    WHERE w.water_source_type IS NOT NULL
      AND l.code = lower(regexp_replace(trim(w.water_source_type), '\s+', '_', 'g'))
      AND w.water_source_type_id IS NULL;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'sde' AND table_name = 'lookup_attendance_status') THEN
    UPDATE sde.attendance_record a
    SET status_id = l.id
    FROM sde.lookup_attendance_status l
    WHERE l.code = a.status::text AND a.status_id IS NULL;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'sde' AND table_name = 'lookup_absent_reason') THEN
    UPDATE sde.attendance_record a
    SET absent_reason_id = l.id
    FROM sde.lookup_absent_reason l
    WHERE l.code = a.absent_reason::text AND a.absent_reason_id IS NULL;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'sde' AND table_name = 'lookup_child_gender') THEN
    UPDATE sde.child c
    SET gender_id = l.id
    FROM sde.lookup_child_gender l
    WHERE l.code = c.gender::text AND c.gender_id IS NULL;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'sde' AND table_name = 'lookup_child_status') THEN
    UPDATE sde.child c
    SET status_id = l.id
    FROM sde.lookup_child_status l
    WHERE l.code = c.status::text AND c.status_id IS NULL;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'sde' AND table_name = 'lookup_classroom_grade') THEN
    UPDATE sde.classroom c
    SET grade_id = l.id
    FROM sde.lookup_classroom_grade l
    WHERE l.code = c.grade::text AND c.grade_id IS NULL;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'sde' AND table_name = 'lookup_assessment_type') THEN
    UPDATE sde.compliance_assessment c
    SET assessment_type_id = l.id
    FROM sde.lookup_assessment_type l
    WHERE l.code = c.assessment_type::text AND c.assessment_type_id IS NULL;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'sde' AND table_name = 'lookup_assessment_status') THEN
    UPDATE sde.compliance_assessment c
    SET status_id = l.id
    FROM sde.lookup_assessment_status l
    WHERE l.code = c.status::text AND c.status_id IS NULL;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'sde' AND table_name = 'lookup_compliance_classification') THEN
    UPDATE sde.compliance_assessment c
    SET overall_classification_id = l.id
    FROM sde.lookup_compliance_classification l
    WHERE l.code = c.overall_classification::text AND c.overall_classification_id IS NULL;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'sde' AND table_name = 'lookup_item_response') THEN
    UPDATE sde.compliance_assessment_item c
    SET response_id = l.id
    FROM sde.lookup_item_response l
    WHERE l.code = c.response::text AND c.response_id IS NULL;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'sde' AND table_name = 'lookup_gap_severity') THEN
    UPDATE sde.compliance_assessment_item c
    SET gap_severity_id = l.id
    FROM sde.lookup_gap_severity l
    WHERE l.code = c.gap_severity::text AND c.gap_severity_id IS NULL;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'sde' AND table_name = 'lookup_gap_status') THEN
    UPDATE sde.compliance_assessment_item c
    SET gap_status_id = l.id
    FROM sde.lookup_gap_status l
    WHERE l.code = c.gap_status::text AND c.gap_status_id IS NULL;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'sde' AND table_name = 'lookup_standard_domain') THEN
    UPDATE sde.ecd_standard e
    SET domain_id = l.id
    FROM sde.lookup_standard_domain l
    WHERE l.code = e.domain::text AND e.domain_id IS NULL;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'sde' AND table_name = 'lookup_sted_age_band') THEN
    UPDATE sde.sted_assessment s
    SET age_band_id = l.id
    FROM sde.lookup_sted_age_band l
    WHERE l.code = s.age_band::text AND s.age_band_id IS NULL;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'sde' AND table_name = 'lookup_referral_source_type') THEN
    UPDATE sde.referral r
    SET source_type_id = l.id
    FROM sde.lookup_referral_source_type l
    WHERE l.code = r.source_type::text AND r.source_type_id IS NULL;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'sde' AND table_name = 'lookup_referral_status') THEN
    UPDATE sde.referral r
    SET status_id = l.id
    FROM sde.lookup_referral_status l
    WHERE l.code = r.status::text AND r.status_id IS NULL;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'sde' AND table_name = 'lookup_parent_contribution_type') THEN
    UPDATE sde.parent_contribution p
    SET contribution_type_id = l.id
    FROM sde.lookup_parent_contribution_type l
    WHERE l.code = p.contribution_type::text AND p.contribution_type_id IS NULL;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'sde' AND table_name = 'lookup_in_kind_item_type') THEN
    UPDATE sde.parent_contribution p
    SET item_type_id = l.id
    FROM sde.lookup_in_kind_item_type l
    WHERE p.item_type IS NOT NULL AND l.code = p.item_type::text AND p.item_type_id IS NULL;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'sde' AND table_name = 'lookup_center_support_category') THEN
    UPDATE sde.center_support c
    SET support_category_id = l.id
    FROM sde.lookup_center_support_category l
    WHERE l.code = c.support_category::text AND c.support_category_id IS NULL;
  END IF;
END $$;

-- Foreign keys (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'child_nutrition_screening_nutrition_status_id_fkey') THEN
    ALTER TABLE sde.child_nutrition_screening
      ADD CONSTRAINT child_nutrition_screening_nutrition_status_id_fkey
      FOREIGN KEY (nutrition_status_id) REFERENCES sde.lookup_nutrition_status(id)
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'child_nutrition_screening_meal_quality_id_fkey') THEN
    ALTER TABLE sde.child_nutrition_screening
      ADD CONSTRAINT child_nutrition_screening_meal_quality_id_fkey
      FOREIGN KEY (meal_quality_id) REFERENCES sde.lookup_meal_quality(id)
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'child_transfer_status_id_fkey') THEN
    ALTER TABLE sde.child_transfer
      ADD CONSTRAINT child_transfer_status_id_fkey
      FOREIGN KEY (status_id) REFERENCES sde.lookup_transfer_status(id)
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'center_feeding_month_summary_food_source_id_fkey') THEN
    ALTER TABLE sde.center_feeding_month_summary
      ADD CONSTRAINT center_feeding_month_summary_food_source_id_fkey
      FOREIGN KEY (food_source_id) REFERENCES sde.lookup_food_source(id)
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'wash_indicator_water_source_type_id_fkey') THEN
    ALTER TABLE sde.wash_indicator
      ADD CONSTRAINT wash_indicator_water_source_type_id_fkey
      FOREIGN KEY (water_source_type_id) REFERENCES sde.lookup_water_source_type(id)
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
