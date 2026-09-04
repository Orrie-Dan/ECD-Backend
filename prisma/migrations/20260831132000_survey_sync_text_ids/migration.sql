-- EGDB deployment stores Prisma UUID columns as text; use text IDs throughout survey sync.

DROP FUNCTION IF EXISTS survey.sync_ecd_mapping_form_row(integer);
DROP FUNCTION IF EXISTS survey.seed_classrooms_for_center(uuid);
DROP FUNCTION IF EXISTS survey.resolve_location_from_names(text, text, text, text, text);
DROP FUNCTION IF EXISTS survey.import_user_id();

CREATE OR REPLACE FUNCTION survey.import_user_id()
RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path TO sde, public, survey
AS $$
DECLARE
  v_id text;
BEGIN
  SELECT id INTO v_id FROM sde.user_account WHERE username = 'survey_sync' LIMIT 1;
  RETURN v_id;
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
    (gen_random_uuid()::text, p_center_id, 'grade_1'::public.classroom_grade),
    (gen_random_uuid()::text, p_center_id, 'grade_2'::public.classroom_grade),
    (gen_random_uuid()::text, p_center_id, 'grade_3'::public.classroom_grade)
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
  WHERE level = 'province'::public.administrative_level AND code = v_province_code;

  IF v_province_id IS NULL THEN
    v_province_id := gen_random_uuid()::text;
    INSERT INTO sde.administrative_unit (id, level, code, name, parent_id, district_id)
    VALUES (v_province_id, 'province'::public.administrative_level, v_province_code, v_province, NULL, NULL);
  END IF;

  SELECT id INTO district_id FROM sde.district WHERE code = v_district_code;
  IF district_id IS NULL THEN
    district_id := gen_random_uuid()::text;
    INSERT INTO sde.district (id, province_id, code, name)
    VALUES (district_id, v_province_id, v_district_code, v_district);
  END IF;

  SELECT id INTO v_sector_id
  FROM sde.administrative_unit
  WHERE level = 'sector'::public.administrative_level AND code = v_sector_code;

  IF v_sector_id IS NULL THEN
    v_sector_id := gen_random_uuid()::text;
    INSERT INTO sde.administrative_unit (id, level, code, name, parent_id, district_id)
    VALUES (v_sector_id, 'sector'::public.administrative_level, v_sector_code, v_sector, NULL, district_id);
  END IF;

  SELECT id INTO v_cell_id
  FROM sde.administrative_unit
  WHERE level = 'cell'::public.administrative_level AND code = v_cell_code;

  IF v_cell_id IS NULL THEN
    v_cell_id := gen_random_uuid()::text;
    INSERT INTO sde.administrative_unit (id, level, code, name, parent_id, district_id)
    VALUES (v_cell_id, 'cell'::public.administrative_level, v_cell_code, v_cell, v_sector_id, NULL);
  END IF;

  SELECT id INTO village_id
  FROM sde.administrative_unit
  WHERE level = 'village'::public.administrative_level AND code = v_village_code;

  IF village_id IS NULL THEN
    village_id := gen_random_uuid()::text;
    INSERT INTO sde.administrative_unit (id, level, code, name, parent_id, district_id)
    VALUES (village_id, 'village'::public.administrative_level, v_village_code, v_village, v_cell_id, NULL);
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
  v_status public.ecd_center_status;
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
      v_import_user, v_import_user, 1, 'synced'::public.record_sync_status,
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
      sync_status = 'synced'::public.record_sync_status
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

-- Prefer text bridge column (matches ecd_center.id); migrate uuid column if present.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'sde' AND table_name = 'ecd_mapping_form'
      AND column_name = 'center_id' AND udt_name = 'uuid'
  ) THEN
    ALTER TABLE sde.ecd_mapping_form ALTER COLUMN center_id TYPE text USING center_id::text;
  END IF;
END $$;
