-- Survey123 ECD create → inbox notifications for ncda_admin and district_focal_person.
-- Best-effort: notify failures must not fail the mapping-form sync.

CREATE OR REPLACE FUNCTION survey.notify_center_created(
  p_center_id text,
  p_district_id text,
  p_center_name text
)
RETURNS void
LANGUAGE plpgsql
SET search_path TO sde, public, survey
AS $$
DECLARE
  v_district_name text;
  v_message text;
  v_dedupe text;
BEGIN
  SELECT name INTO v_district_name FROM sde.district WHERE id = p_district_id;

  v_message := p_center_name || ' has been registered';
  IF v_district_name IS NOT NULL AND v_district_name <> '' THEN
    v_message := v_message || ' in ' || v_district_name;
  END IF;
  v_message := v_message || '.';

  v_dedupe := 'center_created:created:ecd_center:' || p_center_id;

  INSERT INTO sde.notification (
    id, user_id, type, title, message,
    is_read, entity_type, entity_id, dedupe_key, created_at
  )
  SELECT
    gen_random_uuid()::text,
    u.id,
    'center_created'::public.notification_type,
    'New ECD center registered',
    v_message,
    false,
    'ecd_center',
    p_center_id,
    v_dedupe,
    now()
  FROM sde.user_account u
  WHERE u.status = 'active'
    AND (
      u.role = 'ncda_admin'
      OR (u.role = 'district_focal_person' AND u.district_id = p_district_id)
    )
  ON CONFLICT (user_id, dedupe_key) DO NOTHING;
EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'survey.notify_center_created failed for %: %', p_center_id, SQLERRM;
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

COMMENT ON FUNCTION survey.notify_center_created(text, text, text) IS
  'Best-effort inbox rows for ncda_admin (national) and district_focal_person (center district) when an ECD is created.';
