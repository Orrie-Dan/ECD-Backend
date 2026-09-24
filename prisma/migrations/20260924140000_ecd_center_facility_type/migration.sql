-- SELF-EVAL-ALIGN-05A: EcdCenter.facility_type + Survey123 settings_types sync/backfill
-- Canonical values: daycare | home_based | community_based | ecd_3_5 (TEXT, nullable)
-- Never invent values; only deterministic settings_types mappings are applied.
-- Bases on latest survey.sync_ecd_mapping_form_row (text IDs + notify_center_created).

ALTER TABLE sde.ecd_center
  ADD COLUMN IF NOT EXISTS facility_type text;

CREATE INDEX IF NOT EXISTS idx_ecd_center_facility_type
  ON sde.ecd_center (facility_type)
  WHERE facility_type IS NOT NULL AND deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- Map Survey123 settings_types → canonical facility_type
-- Only exact documented source strings; unknown → NULL
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION survey.map_settings_types_to_facility_type(raw text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO sde, public, survey
AS $$
DECLARE
  v text := trim(coalesce(raw, ''));
BEGIN
  IF v = '' THEN
    RETURN NULL;
  END IF;

  IF v IN ('Home based ECD', 'Home Based ECD') THEN
    RETURN 'home_based';
  END IF;

  IF v IN ('Community based ECD centre', 'Community Based ECD') THEN
    RETURN 'community_based';
  END IF;

  IF v IN (
    'School based ECD Centre',
    'School Based ECD',
    'Model ECD centre',
    'Model ECD'
  ) THEN
    RETURN 'ecd_3_5';
  END IF;

  -- Ambiguous / no official binding — leave unclassified:
  -- Centre Based, Faith-based, Market based, Mobile crèches,
  -- ECD in emergency settings, Cross-border ECD, ECD in prison
  RETURN NULL;
END;
$$;

-- ---------------------------------------------------------------------------
-- Refresh sync function from latest (notify_center_created) + facility_type
-- ---------------------------------------------------------------------------
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
  v_facility_type text;
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
  v_facility_type := survey.map_settings_types_to_facility_type(r.settings_types);

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
      latitude, longitude, status, facility_type,
      created_by, updated_by, version, sync_status,
      created_at, updated_at, last_modified_at
    ) VALUES (
      v_center_id, v_district_id, v_village_id, v_code, v_name, v_phone,
      v_lat, v_lon, v_status, v_facility_type,
      v_import_user, v_import_user, 1, 'synced',
      now(), now(), now()
    );
    PERFORM survey.seed_classrooms_for_center(v_center_id);
    PERFORM survey.notify_center_created(v_center_id, v_district_id, v_name);
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
      -- Only set when source maps deterministically; do not clear manual corrections
      -- with an unmapped/blank survey value.
      facility_type = COALESCE(v_facility_type, facility_type),
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

-- Re-bind update trigger to include settings_types
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
    settings_types
  ON sde.ecd_mapping_form
  FOR EACH ROW
  EXECUTE FUNCTION survey.trg_sync_ecd_mapping_form();

-- ---------------------------------------------------------------------------
-- One-time deterministic backfill from latest mapping_form.settings_types
-- Does NOT assign daycare by default. Does NOT overwrite non-null facility_type.
-- ---------------------------------------------------------------------------
WITH latest_mapping AS (
  SELECT DISTINCT ON (c.id)
    c.id AS center_id,
    survey.map_settings_types_to_facility_type(m.settings_types) AS mapped_type
  FROM sde.ecd_center c
  JOIN sde.ecd_mapping_form m
    ON (m.center_id = c.id OR m.ecd_code = c.code)
  WHERE c.deleted_at IS NULL
    AND c.facility_type IS NULL
  ORDER BY c.id, m.last_edited_date DESC NULLS LAST, m.objectid DESC
)
UPDATE sde.ecd_center c
SET
  facility_type = lm.mapped_type,
  updated_at = now(),
  last_modified_at = now()
FROM latest_mapping lm
WHERE c.id = lm.center_id
  AND lm.mapped_type IS NOT NULL
  AND c.facility_type IS NULL;
