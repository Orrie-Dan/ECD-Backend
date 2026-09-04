-- Align survey sync with ecd_center columns present in EGDB (no status_id / geom on some deployments).

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
