-- NCDA ECD coding, step 4: Survey123 uses the shared code generator.
--
-- Changes to survey.sync_ecd_mapping_form_row (latest: 20260924140000):
--   * Existing centers are matched by ecd_mapping_form.center_id first, then by
--     ecd_code against ecd_center.code, then against ecd_center.legacy_code.
--     Re-coding a center therefore never makes Survey123 create a duplicate.
--   * ecd_code is optional. A new center gets its code from
--     survey.issue_ecd_code (village MINALOC code + type letter from
--     settings_types + year of start_year_ecd). A non-NCDA ecd_code typed by
--     the surveyor is kept as legacy_code when unused.
--   * The issued code is written back to the new ecd_mapping_form.ncda_code
--     column (never to ecd_code: that would re-fire the update trigger and
--     overwrite the surveyor's input).
--   * Rows that cannot be coded (unmapped settings_types, no start_year_ecd,
--     village not in the MINALOC register) are marked failed, not created.

ALTER TABLE sde.ecd_mapping_form
  ADD COLUMN IF NOT EXISTS ncda_code text;

-- settings_types → NCDA type letter. Same source strings as
-- survey.map_settings_types_to_facility_type, split D (school) / E (model).
-- No Survey123 value maps to A (daycare); unmapped values return NULL.
CREATE OR REPLACE FUNCTION survey.map_settings_types_to_ncda_type(raw text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO sde, public, survey
AS $$
DECLARE
  v text := trim(coalesce(raw, ''));
BEGIN
  IF v IN ('Home based ECD', 'Home Based ECD') THEN
    RETURN 'B';
  END IF;
  IF v IN ('Community based ECD centre', 'Community Based ECD') THEN
    RETURN 'C';
  END IF;
  IF v IN ('School based ECD Centre', 'School Based ECD') THEN
    RETURN 'D';
  END IF;
  IF v IN ('Model ECD centre', 'Model ECD') THEN
    RETURN 'E';
  END IF;
  RETURN NULL;
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
  v_input_code text;
  v_code text;
  v_name text;
  v_status text;
  v_phone text;
  v_lon double precision;
  v_lat double precision;
  v_import_user text;
  v_type text;
  v_year integer;
  v_legacy text;
BEGIN
  SELECT * INTO r FROM sde.ecd_mapping_form WHERE objectid = p_objectid FOR UPDATE;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  v_input_code := nullif(trim(coalesce(r.ecd_code, '')), '');
  v_name := trim(coalesce(r.name_ecd_sercive, ''));

  IF v_name = '' THEN
    RAISE EXCEPTION 'name_ecd_sercive is required';
  END IF;

  SELECT district_id, village_id
  INTO v_district_id, v_village_id
  FROM survey.resolve_location_from_names(
    r.province_name, r.district_name, r.sector_name, r.cell_name, r.village_name
  );

  v_status := survey.normalize_center_status(r.active_not_active);
  v_type := survey.map_settings_types_to_ncda_type(r.settings_types);
  v_year := extract(year FROM r.start_year_ecd)::integer;

  IF r.phone_supervisor IS NOT NULL THEN
    v_phone := nullif(trim(r.phone_supervisor::text), '');
  ELSE
    v_phone := NULL;
  END IF;

  SELECT lon, lat INTO v_lon, v_lat FROM survey.extract_shape_coords(r.shape);

  v_import_user := survey.import_user_id();

  -- 1) linked row, 2) current code, 3) pre-NCDA code
  IF r.center_id IS NOT NULL THEN
    SELECT id INTO v_center_id FROM sde.ecd_center WHERE id = r.center_id AND deleted_at IS NULL;
  END IF;
  IF v_center_id IS NULL AND v_input_code IS NOT NULL THEN
    SELECT id INTO v_center_id FROM sde.ecd_center WHERE code = v_input_code AND deleted_at IS NULL;
  END IF;
  IF v_center_id IS NULL AND v_input_code IS NOT NULL THEN
    SELECT id INTO v_center_id FROM sde.ecd_center WHERE legacy_code = v_input_code AND deleted_at IS NULL;
  END IF;

  IF v_center_id IS NULL THEN
    IF v_type IS NULL THEN
      RAISE EXCEPTION 'settings_types "%" has no NCDA type letter; cannot code a new facility',
        coalesce(r.settings_types, '');
    END IF;
    IF v_year IS NULL THEN
      RAISE EXCEPTION 'start_year_ecd is required to code a new facility';
    END IF;

    v_center_id := gen_random_uuid()::text;
    v_code := survey.issue_ecd_code(v_center_id, v_village_id, v_type, v_year, v_import_user);

    v_legacy := NULL;
    IF v_input_code IS NOT NULL
       AND NOT survey.is_ncda_ecd_code(v_input_code)
       AND NOT EXISTS (
         SELECT 1 FROM sde.ecd_center WHERE legacy_code = v_input_code OR code = v_input_code
       ) THEN
      v_legacy := v_input_code;
    END IF;

    INSERT INTO sde.ecd_center (
      id, district_id, village_id, code, legacy_code, name, phone,
      latitude, longitude, status, facility_type, ncda_type_code, start_year, code_issued_at,
      created_by, updated_by, version, sync_status,
      created_at, updated_at, last_modified_at
    ) VALUES (
      v_center_id, v_district_id, v_village_id, v_code, v_legacy, v_name, v_phone,
      v_lat, v_lon, v_status, survey.ncda_type_to_facility_type(v_type), v_type, v_year, now(),
      v_import_user, v_import_user, 1, 'synced',
      now(), now(), now()
    );
    PERFORM survey.seed_classrooms_for_center(v_center_id);
    PERFORM survey.notify_center_created(v_center_id, v_district_id, v_name);
  ELSE
    -- The code is immutable: location/type/year edits never change it.
    UPDATE sde.ecd_center
    SET
      district_id = v_district_id,
      village_id = v_village_id,
      name = v_name,
      phone = v_phone,
      latitude = v_lat,
      longitude = v_lon,
      status = v_status,
      -- Only overwrite type when the survey value maps; keeps letter and facility_type consistent.
      ncda_type_code = coalesce(v_type, ncda_type_code),
      facility_type = CASE
        WHEN v_type IS NOT NULL THEN survey.ncda_type_to_facility_type(v_type)
        ELSE facility_type
      END,
      start_year = coalesce(v_year, start_year),
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
    ncda_code = (SELECT code FROM sde.ecd_center WHERE id = v_center_id),
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

COMMENT ON FUNCTION survey.sync_ecd_mapping_form_row(integer) IS
  'Upserts sde.ecd_center from sde.ecd_mapping_form (match: center_id, code, legacy_code); new centers get an NCDA code from survey.issue_ecd_code.';

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
    shape,
    settings_types,
    start_year_ecd
  ON sde.ecd_mapping_form
  FOR EACH ROW
  EXECUTE FUNCTION survey.trg_sync_ecd_mapping_form();

-- Keep ecd_mapping_form.ncda_code in step when a code is re-coded or overridden.
CREATE OR REPLACE FUNCTION survey.trg_ecd_center_code_to_mapping_form()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO sde, public, survey
AS $$
BEGIN
  UPDATE sde.ecd_mapping_form SET ncda_code = NEW.code WHERE center_id = NEW.id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ecd_center_code_to_mapping_form ON sde.ecd_center;
CREATE TRIGGER trg_ecd_center_code_to_mapping_form
  AFTER UPDATE ON sde.ecd_center
  FOR EACH ROW
  WHEN (OLD.code IS DISTINCT FROM NEW.code)
  EXECUTE FUNCTION survey.trg_ecd_center_code_to_mapping_form();
