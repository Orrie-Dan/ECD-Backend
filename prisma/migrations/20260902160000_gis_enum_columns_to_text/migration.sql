-- GIS architecture: convert domain columns from PostgreSQL enums to TEXT.
-- Allowed values are enforced by ArcGIS coded-value domains (GIS writes)
-- and NestJS local domain enums + DTO validation (API writes).
--
-- Unchanged PostgreSQL enums (still referenced by Prisma):
--   referral_source_type, referral_status, audit_action,
--   compliance_classification, record_sync_status (referral + parent_contribution),
--   sync_operation_status, in_kind_item_type, notification_type

-- ---------------------------------------------------------------------------
-- 1. administrative_unit
-- ---------------------------------------------------------------------------
ALTER TABLE sde.administrative_unit
  ALTER COLUMN level TYPE TEXT USING level::text;

-- ---------------------------------------------------------------------------
-- 2. ecd_center
-- ---------------------------------------------------------------------------
ALTER TABLE sde.ecd_center
  ALTER COLUMN status DROP DEFAULT;
ALTER TABLE sde.ecd_center
  ALTER COLUMN status TYPE TEXT USING status::text;
ALTER TABLE sde.ecd_center
  ALTER COLUMN status SET DEFAULT 'active';

ALTER TABLE sde.ecd_center
  ALTER COLUMN current_compliance_level TYPE TEXT USING current_compliance_level::text;

ALTER TABLE sde.ecd_center
  ALTER COLUMN sync_status DROP DEFAULT;
ALTER TABLE sde.ecd_center
  ALTER COLUMN sync_status TYPE TEXT USING sync_status::text;
ALTER TABLE sde.ecd_center
  ALTER COLUMN sync_status SET DEFAULT 'synced';

-- ---------------------------------------------------------------------------
-- 3. classroom + assignment history
-- ---------------------------------------------------------------------------
ALTER TABLE sde.classroom
  ALTER COLUMN grade TYPE TEXT USING grade::text;

ALTER TABLE sde.classroom_assignment_history
  ALTER COLUMN reason TYPE TEXT USING reason::text;

-- ---------------------------------------------------------------------------
-- 4. user_account
-- ---------------------------------------------------------------------------
ALTER TABLE sde.user_account
  ALTER COLUMN status DROP DEFAULT;
ALTER TABLE sde.user_account
  ALTER COLUMN status TYPE TEXT USING status::text;
ALTER TABLE sde.user_account
  ALTER COLUMN status SET DEFAULT 'active';

ALTER TABLE sde.user_account
  ALTER COLUMN role TYPE TEXT USING role::text;

ALTER TABLE sde.user_account
  ALTER COLUMN gender TYPE TEXT USING gender::text;

ALTER TABLE sde.user_account
  ALTER COLUMN education_level TYPE TEXT USING education_level::text;

-- ---------------------------------------------------------------------------
-- 5. device + sync_session
-- ---------------------------------------------------------------------------
ALTER TABLE sde.device
  ALTER COLUMN status DROP DEFAULT;
ALTER TABLE sde.device
  ALTER COLUMN status TYPE TEXT USING status::text;
ALTER TABLE sde.device
  ALTER COLUMN status SET DEFAULT 'active';

ALTER TABLE sde.sync_session
  ALTER COLUMN status DROP DEFAULT;
ALTER TABLE sde.sync_session
  ALTER COLUMN status TYPE TEXT USING status::text;
ALTER TABLE sde.sync_session
  ALTER COLUMN status SET DEFAULT 'started';

-- ---------------------------------------------------------------------------
-- 6. child + transfer
-- ---------------------------------------------------------------------------
ALTER TABLE sde.child
  ALTER COLUMN status DROP DEFAULT;
ALTER TABLE sde.child
  ALTER COLUMN status TYPE TEXT USING status::text;
ALTER TABLE sde.child
  ALTER COLUMN status SET DEFAULT 'active';

ALTER TABLE sde.child
  ALTER COLUMN gender TYPE TEXT USING gender::text;

ALTER TABLE sde.child
  ALTER COLUMN sync_status DROP DEFAULT;
ALTER TABLE sde.child
  ALTER COLUMN sync_status TYPE TEXT USING sync_status::text;
ALTER TABLE sde.child
  ALTER COLUMN sync_status SET DEFAULT 'synced';

ALTER TABLE sde.child_transfer
  ALTER COLUMN status DROP DEFAULT;
ALTER TABLE sde.child_transfer
  ALTER COLUMN status TYPE TEXT USING status::text;
ALTER TABLE sde.child_transfer
  ALTER COLUMN status SET DEFAULT 'pending';

ALTER TABLE sde.child_transfer
  ALTER COLUMN sync_status DROP DEFAULT;
ALTER TABLE sde.child_transfer
  ALTER COLUMN sync_status TYPE TEXT USING sync_status::text;
ALTER TABLE sde.child_transfer
  ALTER COLUMN sync_status SET DEFAULT 'synced';

-- ---------------------------------------------------------------------------
-- 7. attendance
-- ---------------------------------------------------------------------------
ALTER TABLE sde.attendance_record
  ALTER COLUMN status TYPE TEXT USING status::text;

ALTER TABLE sde.attendance_record
  ALTER COLUMN absent_reason TYPE TEXT USING absent_reason::text;

ALTER TABLE sde.attendance_record
  ALTER COLUMN sync_status DROP DEFAULT;
ALTER TABLE sde.attendance_record
  ALTER COLUMN sync_status TYPE TEXT USING sync_status::text;
ALTER TABLE sde.attendance_record
  ALTER COLUMN sync_status SET DEFAULT 'synced';

-- ---------------------------------------------------------------------------
-- 8. nutrition screening
-- ---------------------------------------------------------------------------
ALTER TABLE sde.child_nutrition_screening
  ALTER COLUMN nutrition_status TYPE TEXT USING nutrition_status::text;

ALTER TABLE sde.child_nutrition_screening
  ALTER COLUMN sync_status DROP DEFAULT;
ALTER TABLE sde.child_nutrition_screening
  ALTER COLUMN sync_status TYPE TEXT USING sync_status::text;
ALTER TABLE sde.child_nutrition_screening
  ALTER COLUMN sync_status SET DEFAULT 'synced';

-- ---------------------------------------------------------------------------
-- 9. feeding
-- ---------------------------------------------------------------------------
ALTER TABLE sde.center_feeding_day
  ALTER COLUMN sync_status DROP DEFAULT;
ALTER TABLE sde.center_feeding_day
  ALTER COLUMN sync_status TYPE TEXT USING sync_status::text;
ALTER TABLE sde.center_feeding_day
  ALTER COLUMN sync_status SET DEFAULT 'synced';

ALTER TABLE sde.center_feeding_month_summary
  ALTER COLUMN sync_status DROP DEFAULT;
ALTER TABLE sde.center_feeding_month_summary
  ALTER COLUMN sync_status TYPE TEXT USING sync_status::text;
ALTER TABLE sde.center_feeding_month_summary
  ALTER COLUMN sync_status SET DEFAULT 'synced';

-- ---------------------------------------------------------------------------
-- 10. sted
-- ---------------------------------------------------------------------------
ALTER TABLE sde.sted_assessment
  ALTER COLUMN age_band TYPE TEXT USING age_band::text;

ALTER TABLE sde.sted_assessment
  ALTER COLUMN sync_status DROP DEFAULT;
ALTER TABLE sde.sted_assessment
  ALTER COLUMN sync_status TYPE TEXT USING sync_status::text;
ALTER TABLE sde.sted_assessment
  ALTER COLUMN sync_status SET DEFAULT 'synced';

-- ---------------------------------------------------------------------------
-- 11. compliance (overall_classification stays compliance_classification enum)
-- ---------------------------------------------------------------------------
ALTER TABLE sde.compliance_assessment
  ALTER COLUMN assessment_type TYPE TEXT USING assessment_type::text;

ALTER TABLE sde.compliance_assessment
  ALTER COLUMN status DROP DEFAULT;
ALTER TABLE sde.compliance_assessment
  ALTER COLUMN status TYPE TEXT USING status::text;
ALTER TABLE sde.compliance_assessment
  ALTER COLUMN status SET DEFAULT 'draft';

ALTER TABLE sde.compliance_assessment
  ALTER COLUMN sync_status DROP DEFAULT;
ALTER TABLE sde.compliance_assessment
  ALTER COLUMN sync_status TYPE TEXT USING sync_status::text;
ALTER TABLE sde.compliance_assessment
  ALTER COLUMN sync_status SET DEFAULT 'synced';

ALTER TABLE sde.compliance_assessment_item
  ALTER COLUMN response TYPE TEXT USING response::text;

ALTER TABLE sde.compliance_assessment_item
  ALTER COLUMN gap_severity TYPE TEXT USING gap_severity::text;

ALTER TABLE sde.compliance_assessment_item
  ALTER COLUMN gap_status TYPE TEXT USING gap_status::text;

ALTER TABLE sde.compliance_assessment_item
  ALTER COLUMN sync_status DROP DEFAULT;
ALTER TABLE sde.compliance_assessment_item
  ALTER COLUMN sync_status TYPE TEXT USING sync_status::text;
ALTER TABLE sde.compliance_assessment_item
  ALTER COLUMN sync_status SET DEFAULT 'synced';

ALTER TABLE sde.ecd_standard
  ALTER COLUMN domain TYPE TEXT USING domain::text;

-- ---------------------------------------------------------------------------
-- 12. wash + NCDA register sections
-- ---------------------------------------------------------------------------
ALTER TABLE sde.wash_indicator
  ALTER COLUMN sync_status DROP DEFAULT;
ALTER TABLE sde.wash_indicator
  ALTER COLUMN sync_status TYPE TEXT USING sync_status::text;
ALTER TABLE sde.wash_indicator
  ALTER COLUMN sync_status SET DEFAULT 'synced';

ALTER TABLE sde.parent_contribution
  ALTER COLUMN contribution_type TYPE TEXT USING contribution_type::text;

ALTER TABLE sde.parenting_session
  ALTER COLUMN sync_status DROP DEFAULT;
ALTER TABLE sde.parenting_session
  ALTER COLUMN sync_status TYPE TEXT USING sync_status::text;
ALTER TABLE sde.parenting_session
  ALTER COLUMN sync_status SET DEFAULT 'synced';

ALTER TABLE sde.ecd_committee_member
  ALTER COLUMN sync_status DROP DEFAULT;
ALTER TABLE sde.ecd_committee_member
  ALTER COLUMN sync_status TYPE TEXT USING sync_status::text;
ALTER TABLE sde.ecd_committee_member
  ALTER COLUMN sync_status SET DEFAULT 'synced';

ALTER TABLE sde.center_support
  ALTER COLUMN support_category TYPE TEXT USING support_category::text;

ALTER TABLE sde.center_support
  ALTER COLUMN sync_status DROP DEFAULT;
ALTER TABLE sde.center_support
  ALTER COLUMN sync_status TYPE TEXT USING sync_status::text;
ALTER TABLE sde.center_support
  ALTER COLUMN sync_status SET DEFAULT 'synced';

ALTER TABLE sde.center_visit
  ALTER COLUMN sync_status DROP DEFAULT;
ALTER TABLE sde.center_visit
  ALTER COLUMN sync_status TYPE TEXT USING sync_status::text;
ALTER TABLE sde.center_visit
  ALTER COLUMN sync_status SET DEFAULT 'synced';

ALTER TABLE sde.staff_training
  ALTER COLUMN sync_status DROP DEFAULT;
ALTER TABLE sde.staff_training
  ALTER COLUMN sync_status TYPE TEXT USING sync_status::text;
ALTER TABLE sde.staff_training
  ALTER COLUMN sync_status SET DEFAULT 'synced';

-- ---------------------------------------------------------------------------
-- 13. Survey123 sync functions — use TEXT literals (enum types removed below)
-- Must DROP before recreate when return type changes (ecd_center_status → text).
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS survey.sync_ecd_mapping_form_row(integer);
DROP FUNCTION IF EXISTS survey.normalize_center_status(text);

CREATE OR REPLACE FUNCTION survey.normalize_center_status(raw text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO sde, public, survey
AS $$
DECLARE
  v text := lower(trim(coalesce(raw, '')));
BEGIN
  IF v IN ('inactive', 'not active', 'not_active', 'not active ', '0', 'no', 'false') THEN
    RETURN 'inactive';
  END IF;
  RETURN 'active';
END;
$$;

CREATE OR REPLACE FUNCTION survey.seed_classrooms_for_center(p_center_id text)
RETURNS void
LANGUAGE plpgsql
SET search_path TO sde, public, survey
AS $$
BEGIN
  INSERT INTO sde.classroom (id, center_id, grade)
  VALUES
    (gen_random_uuid()::text, p_center_id, 'grade_1'),
    (gen_random_uuid()::text, p_center_id, 'grade_2'),
    (gen_random_uuid()::text, p_center_id, 'grade_3')
  ON CONFLICT (center_id, grade) DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION survey.resolve_location_from_names(
  p_province text,
  p_district text,
  p_sector text,
  p_cell text,
  p_village text,
  OUT district_id text,
  OUT village_id text
)
LANGUAGE plpgsql
SET search_path TO sde, public, survey
AS $$
DECLARE
  v_province text := survey.clean_name(p_province);
  v_district text := survey.clean_name(p_district);
  v_sector text := survey.clean_name(p_sector);
  v_cell text := survey.clean_name(p_cell);
  v_village text := survey.clean_name(p_village);
  v_province_code text;
  v_district_code text;
  v_sector_code text;
  v_cell_code text;
  v_village_code text;
  v_province_id text;
  v_sector_id text;
  v_cell_id text;
BEGIN
  IF v_province = '' OR v_district = '' OR v_sector = '' OR v_cell = '' OR v_village = '' THEN
    RAISE EXCEPTION 'Incomplete location hierarchy (province through village are required)';
  END IF;

  v_province_code := survey.slug(v_province);
  v_district_code := v_province_code || '-' || survey.slug(v_district);
  v_sector_code := v_district_code || '-' || survey.slug(v_sector);
  v_cell_code := v_sector_code || '-' || survey.slug(v_cell);
  v_village_code := v_cell_code || '-' || survey.slug(v_village);

  SELECT id INTO v_province_id
  FROM sde.administrative_unit
  WHERE level = 'province' AND code = v_province_code;

  IF v_province_id IS NULL THEN
    v_province_id := gen_random_uuid()::text;
    INSERT INTO sde.administrative_unit (id, level, code, name, parent_id, district_id)
    VALUES (v_province_id, 'province', v_province_code, v_province, NULL, NULL);
  END IF;

  SELECT id INTO district_id FROM sde.district WHERE code = v_district_code;
  IF district_id IS NULL THEN
    district_id := gen_random_uuid()::text;
    INSERT INTO sde.district (id, province_id, code, name)
    VALUES (district_id, v_province_id, v_district_code, v_district);
  END IF;

  SELECT id INTO v_sector_id
  FROM sde.administrative_unit
  WHERE level = 'sector' AND code = v_sector_code;

  IF v_sector_id IS NULL THEN
    v_sector_id := gen_random_uuid()::text;
    INSERT INTO sde.administrative_unit (id, level, code, name, parent_id, district_id)
    VALUES (v_sector_id, 'sector', v_sector_code, v_sector, NULL, district_id);
  END IF;

  SELECT id INTO v_cell_id
  FROM sde.administrative_unit
  WHERE level = 'cell' AND code = v_cell_code;

  IF v_cell_id IS NULL THEN
    v_cell_id := gen_random_uuid()::text;
    INSERT INTO sde.administrative_unit (id, level, code, name, parent_id, district_id)
    VALUES (v_cell_id, 'cell', v_cell_code, v_cell, v_sector_id, NULL);
  END IF;

  SELECT id INTO village_id
  FROM sde.administrative_unit
  WHERE level = 'village' AND code = v_village_code;

  IF village_id IS NULL THEN
    village_id := gen_random_uuid()::text;
    INSERT INTO sde.administrative_unit (id, level, code, name, parent_id, district_id)
    VALUES (village_id, 'village', v_village_code, v_village, v_cell_id, NULL);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION survey.sync_ecd_mapping_form_row(p_objectid integer)
RETURNS void
LANGUAGE plpgsql
SET search_path TO sde, public, survey
AS $$
DECLARE
  r sde.ecd_mapping_form%ROWTYPE;
  v_district_id text;
  v_village_id text;
  v_center_id text;
  v_code text;
  v_name text;
  v_status text;
  v_phone text;
  v_lon double precision;
  v_lat double precision;
  v_import_user text;
BEGIN
  SELECT * INTO r FROM sde.ecd_mapping_form WHERE objectid = p_objectid FOR UPDATE;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  v_code := trim(coalesce(r.ecd_code, ''));
  v_name := trim(coalesce(r.name_ecd_sercive, ''));

  IF v_code = '' THEN
    RAISE EXCEPTION 'ecd_code is required';
  END IF;
  IF v_name = '' THEN
    RAISE EXCEPTION 'name_ecd_sercive is required';
  END IF;

  SELECT district_id, village_id
  INTO v_district_id, v_village_id
  FROM survey.resolve_location_from_names(
    r.province_name, r.district_name, r.sector_name, r.cell_name, r.village_name
  );

  v_status := survey.normalize_center_status(r.active_not_active);

  IF r.phone_supervisor IS NOT NULL THEN
    v_phone := trim(r.phone_supervisor::text);
    IF v_phone = '' THEN
      v_phone := NULL;
    END IF;
  ELSE
    v_phone := NULL;
  END IF;

  SELECT lon, lat INTO v_lon, v_lat FROM survey.extract_shape_coords(r.shape);

  v_import_user := survey.import_user_id();

  SELECT id INTO v_center_id FROM sde.ecd_center WHERE code = v_code AND deleted_at IS NULL;

  IF v_center_id IS NULL THEN
    v_center_id := gen_random_uuid()::text;
    INSERT INTO sde.ecd_center (
      id, district_id, village_id, code, name, phone,
      latitude, longitude, status,
      created_by, updated_by, version, sync_status,
      created_at, updated_at, last_modified_at
    ) VALUES (
      v_center_id, v_district_id, v_village_id, v_code, v_name, v_phone,
      v_lat, v_lon, v_status,
      v_import_user, v_import_user, 1, 'synced',
      now(), now(), now()
    );
    PERFORM survey.seed_classrooms_for_center(v_center_id);
  ELSE
    UPDATE sde.ecd_center
    SET
      district_id = v_district_id,
      village_id = v_village_id,
      name = v_name,
      phone = v_phone,
      latitude = v_lat,
      longitude = v_lon,
      status = v_status,
      updated_by = coalesce(v_import_user, updated_by),
      updated_at = now(),
      last_modified_at = now(),
      version = version + 1,
      sync_status = 'synced'
    WHERE id = v_center_id;
  END IF;

  UPDATE sde.ecd_mapping_form
  SET
    center_id = v_center_id,
    sync_status = 'applied',
    sync_error = NULL,
    synced_at = now()
  WHERE objectid = p_objectid;
EXCEPTION
  WHEN OTHERS THEN
    UPDATE sde.ecd_mapping_form
    SET
      sync_status = 'failed',
      sync_error = left(SQLERRM, 2000),
      synced_at = now()
    WHERE objectid = p_objectid;
END;
$$;

-- ---------------------------------------------------------------------------
-- 14. Drop orphaned enum types (no remaining column references)
-- ---------------------------------------------------------------------------
DROP TYPE IF EXISTS public.ecd_center_status;
DROP TYPE IF EXISTS public.user_role;
DROP TYPE IF EXISTS public.user_account_status;
DROP TYPE IF EXISTS public.child_gender;
DROP TYPE IF EXISTS public.child_status;
DROP TYPE IF EXISTS public.attendance_status;
DROP TYPE IF EXISTS public.absent_reason;
DROP TYPE IF EXISTS public.nutrition_status;
DROP TYPE IF EXISTS public.transfer_status;
DROP TYPE IF EXISTS public.sted_age_band;
DROP TYPE IF EXISTS public.assessment_type;
DROP TYPE IF EXISTS public.assessment_status;
DROP TYPE IF EXISTS public.item_response;
DROP TYPE IF EXISTS public.gap_severity;
DROP TYPE IF EXISTS public.gap_status;
DROP TYPE IF EXISTS public.standard_domain;
DROP TYPE IF EXISTS public.device_status;
DROP TYPE IF EXISTS public.sync_session_status;
DROP TYPE IF EXISTS public.administrative_level;
DROP TYPE IF EXISTS public.classroom_grade;
DROP TYPE IF EXISTS public.classroom_assignment_reason;
DROP TYPE IF EXISTS public.person_sex;
DROP TYPE IF EXISTS public.education_level;
DROP TYPE IF EXISTS public.parent_contribution_type;
DROP TYPE IF EXISTS public.center_support_category;
