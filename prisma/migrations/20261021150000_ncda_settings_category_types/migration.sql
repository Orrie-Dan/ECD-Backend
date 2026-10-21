-- NCDA ECD coding, step 5: setting categories get an NCDA type.
--
-- NCDA's rule (2026-10-21) for Survey123 settings_types values that are a setting
-- category rather than one of the official types:
--   Centre Based, ECD in emergency settings, Cross-border ECD, ECD in prison → C
--   Faith-based                                                              → D
--   Market based, Mobile crèches                                             → A (daycare)
--
-- survey.map_settings_types_to_facility_type is now derived from the NCDA letter so
-- the two mappers cannot drift (D and E stay ecd_3_5, as before).

CREATE OR REPLACE FUNCTION survey.map_settings_types_to_ncda_type(raw text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO sde, public, survey
AS $$
DECLARE
  v text := trim(coalesce(raw, ''));
BEGIN
  IF v IN ('Market based', 'Mobile crèches') THEN
    RETURN 'A';
  END IF;
  IF v IN ('Home based ECD', 'Home Based ECD') THEN
    RETURN 'B';
  END IF;
  IF v IN (
    'Community based ECD centre',
    'Community Based ECD',
    'Centre Based',
    'ECD in emergency settings',
    'Cross-border ECD',
    'ECD in prison'
  ) THEN
    RETURN 'C';
  END IF;
  IF v IN ('School based ECD Centre', 'School Based ECD', 'Faith-based') THEN
    RETURN 'D';
  END IF;
  IF v IN ('Model ECD centre', 'Model ECD') THEN
    RETURN 'E';
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION survey.map_settings_types_to_facility_type(raw text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO sde, public, survey
AS $$
  SELECT survey.ncda_type_to_facility_type(survey.map_settings_types_to_ncda_type(raw));
$$;
