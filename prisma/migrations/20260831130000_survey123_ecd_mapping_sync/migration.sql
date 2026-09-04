-- Survey123 → ECD backend sync (sde.ecd_mapping_form → sde.ecd_center + classrooms)
-- Soft sync: failures set sync_status = 'failed' without blocking Survey123 inserts.

CREATE SCHEMA IF NOT EXISTS survey;

-- Enums live in public; app tables in sde (see DATABASE_URL ?schema=sde).
-- Bridge + business key columns on the Survey123 feature class
ALTER TABLE sde.ecd_mapping_form
  ADD COLUMN IF NOT EXISTS ecd_code varchar(100),
  ADD COLUMN IF NOT EXISTS center_id uuid,
  ADD COLUMN IF NOT EXISTS sync_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS sync_error text,
  ADD COLUMN IF NOT EXISTS synced_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_ecd_mapping_form_ecd_code
  ON sde.ecd_mapping_form (ecd_code)
  WHERE ecd_code IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ecd_mapping_form_sync_pending
  ON sde.ecd_mapping_form (sync_status)
  WHERE sync_status = 'pending';

CREATE UNIQUE INDEX IF NOT EXISTS idx_ecd_mapping_form_center_id
  ON sde.ecd_mapping_form (center_id)
  WHERE center_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION survey.clean_name(raw text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO sde, public, survey
AS $$
DECLARE
  v text := trim(coalesce(raw, ''));
BEGIN
  IF v = '' THEN
    RETURN '';
  END IF;
  IF lower(v) IN ('null', 'n/a', 'na', 'undefined') THEN
    RETURN '';
  END IF;
  RETURN v;
END;
$$;

CREATE OR REPLACE FUNCTION survey.slug(raw text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO sde, public, survey
AS $$
  SELECT trim(both '-' FROM regexp_replace(lower(trim(coalesce($1, ''))), '[^a-z0-9]+', '-', 'g'));
$$;

CREATE OR REPLACE FUNCTION survey.normalize_center_status(raw text)
RETURNS public.ecd_center_status
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO sde, public, survey
AS $$
DECLARE
  v text := lower(trim(coalesce(raw, '')));
BEGIN
  IF v IN ('inactive', 'not active', 'not_active', 'not active ', '0', 'no', 'false') THEN
    RETURN 'inactive'::public.ecd_center_status;
  END IF;
  RETURN 'active'::public.ecd_center_status;
END;
$$;

CREATE OR REPLACE FUNCTION survey.import_user_id()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SET search_path TO sde, public, survey
AS $$
DECLARE
  v_id text;
BEGIN
  SELECT id::text INTO v_id FROM sde.user_account WHERE username = 'survey_sync' LIMIT 1;
  IF v_id IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN v_id::uuid;
END;
$$;

CREATE OR REPLACE FUNCTION survey.extract_shape_coords(shape sde.st_point, OUT lon double precision, OUT lat double precision)
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO sde, public, survey
AS $$
BEGIN
  IF shape IS NULL THEN
    lon := NULL;
    lat := NULL;
    RETURN;
  END IF;
  lon := sde.st_x(shape);
  lat := sde.st_y(shape);
END;
$$;

-- Upsert province → district → sector → cell → village (mirrors scripts/location-resolver.ts)
CREATE OR REPLACE FUNCTION survey.resolve_location_from_names(
  p_province text,
  p_district text,
  p_sector text,
  p_cell text,
  p_village text,
  OUT district_id uuid,
  OUT village_id uuid
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
  v_province_id uuid;
  v_sector_id uuid;
  v_cell_id uuid;
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
    v_province_id := gen_random_uuid();
    INSERT INTO sde.administrative_unit (id, level, code, name, parent_id, district_id)
    VALUES (v_province_id, 'province'::public.administrative_level, v_province_code, v_province, NULL, NULL);
  END IF;

  SELECT id INTO district_id FROM sde.district WHERE code = v_district_code;
  IF district_id IS NULL THEN
    district_id := gen_random_uuid();
    INSERT INTO sde.district (id, province_id, code, name)
    VALUES (district_id, v_province_id, v_district_code, v_district);
  END IF;

  SELECT id INTO v_sector_id
  FROM sde.administrative_unit
  WHERE level = 'sector'::public.administrative_level AND code = v_sector_code;

  IF v_sector_id IS NULL THEN
    v_sector_id := gen_random_uuid();
    INSERT INTO sde.administrative_unit (id, level, code, name, parent_id, district_id)
    VALUES (v_sector_id, 'sector'::public.administrative_level, v_sector_code, v_sector, NULL, district_id);
  END IF;

  SELECT id INTO v_cell_id
  FROM sde.administrative_unit
  WHERE level = 'cell'::public.administrative_level AND code = v_cell_code;

  IF v_cell_id IS NULL THEN
    v_cell_id := gen_random_uuid();
    INSERT INTO sde.administrative_unit (id, level, code, name, parent_id, district_id)
    VALUES (v_cell_id, 'cell'::public.administrative_level, v_cell_code, v_cell, v_sector_id, NULL);
  END IF;

  SELECT id INTO village_id
  FROM sde.administrative_unit
  WHERE level = 'village'::public.administrative_level AND code = v_village_code;

  IF village_id IS NULL THEN
    village_id := gen_random_uuid();
    INSERT INTO sde.administrative_unit (id, level, code, name, parent_id, district_id)
    VALUES (village_id, 'village'::public.administrative_level, v_village_code, v_village, v_cell_id, NULL);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION survey.seed_classrooms_for_center(p_center_id uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path TO sde, public, survey
AS $$
BEGIN
  INSERT INTO sde.classroom (id, center_id, grade)
  VALUES
    (gen_random_uuid(), p_center_id, 'grade_1'::public.classroom_grade),
    (gen_random_uuid(), p_center_id, 'grade_2'::public.classroom_grade),
    (gen_random_uuid(), p_center_id, 'grade_3'::public.classroom_grade)
  ON CONFLICT (center_id, grade) DO NOTHING;
END;
$$;

-- ---------------------------------------------------------------------------
-- Core sync
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION survey.sync_ecd_mapping_form_row(p_objectid integer)
RETURNS void
LANGUAGE plpgsql
SET search_path TO sde, public, survey
AS $$
DECLARE
  r sde.ecd_mapping_form%ROWTYPE;
  v_district_id uuid;
  v_village_id uuid;
  v_center_id uuid;
  v_code text;
  v_name text;
  v_status public.ecd_center_status;
  v_phone text;
  v_lon double precision;
  v_lat double precision;
  v_import_user uuid;
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
    v_center_id := gen_random_uuid();
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

CREATE OR REPLACE FUNCTION survey.trg_sync_ecd_mapping_form()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO sde, public, survey
AS $$
BEGIN
  PERFORM survey.sync_ecd_mapping_form_row(NEW.objectid);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ecd_mapping_form_sync_insert ON sde.ecd_mapping_form;
CREATE TRIGGER trg_ecd_mapping_form_sync_insert
  AFTER INSERT ON sde.ecd_mapping_form
  FOR EACH ROW
  EXECUTE FUNCTION survey.trg_sync_ecd_mapping_form();

DROP TRIGGER IF EXISTS trg_ecd_mapping_form_sync_update ON sde.ecd_mapping_form;
CREATE TRIGGER trg_ecd_mapping_form_sync_update
  AFTER UPDATE OF
    ecd_code,
    name_ecd_sercive,
    province_name,
    district_name,
    sector_name,
    cell_name,
    village_name,
    active_not_active,
    phone_supervisor,
    shape
  ON sde.ecd_mapping_form
  FOR EACH ROW
  EXECUTE FUNCTION survey.trg_sync_ecd_mapping_form();

COMMENT ON FUNCTION survey.sync_ecd_mapping_form_row(integer) IS
  'Upserts sde.ecd_center from sde.ecd_mapping_form by ecd_code; seeds classrooms on first create. WASH skipped.';
