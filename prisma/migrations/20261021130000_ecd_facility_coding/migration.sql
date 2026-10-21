-- NCDA ECD coding, step 2: code format PPDDSSCCVV/T/YYYY/NN
--   PPDDSSCCVV  MINALOC village code (administrative_unit.minaloc_code)
--   T           ncda_type_code A–E
--   YYYY        start_year (year the facility started providing services)
--   NN          per-village counter (ecd_code_sequence), never reset
-- Guidelines: "Guidelines for coding ECD facilities" (NCDA, 24.9.2024).
--
-- Codes are issued only by survey.issue_ecd_code. A code is never reused
-- (ecd_code_registry primary key) and never changes except through
-- survey.recode_ecd_center (one-time legacy migration) or
-- survey.override_ecd_code (NCDA admin, audited by the API).

CREATE SCHEMA IF NOT EXISTS survey;

-- ---------------------------------------------------------------------------
-- ecd_center columns
-- ---------------------------------------------------------------------------
ALTER TABLE "sde"."ecd_center"
  ADD COLUMN IF NOT EXISTS "ncda_type_code" TEXT,
  ADD COLUMN IF NOT EXISTS "start_year" INTEGER,
  ADD COLUMN IF NOT EXISTS "legacy_code" TEXT,
  ADD COLUMN IF NOT EXISTS "code_issued_at" TIMESTAMP(3);

CREATE UNIQUE INDEX IF NOT EXISTS "ecd_center_legacy_code_key" ON "sde"."ecd_center"("legacy_code");

ALTER TABLE "sde"."ecd_center" DROP CONSTRAINT IF EXISTS "ecd_center_ncda_type_code_check";
ALTER TABLE "sde"."ecd_center" ADD CONSTRAINT "ecd_center_ncda_type_code_check"
  CHECK ("ncda_type_code" IS NULL OR "ncda_type_code" IN ('A', 'B', 'C', 'D', 'E'));

ALTER TABLE "sde"."ecd_center" DROP CONSTRAINT IF EXISTS "ecd_center_start_year_check";
ALTER TABLE "sde"."ecd_center" ADD CONSTRAINT "ecd_center_start_year_check"
  CHECK ("start_year" IS NULL OR "start_year" BETWEEN 1950 AND 2100);

-- Letter and canonical facility_type must agree (facility_type drives compliance routing).
ALTER TABLE "sde"."ecd_center" DROP CONSTRAINT IF EXISTS "ecd_center_ncda_type_matches_facility_type";
ALTER TABLE "sde"."ecd_center" ADD CONSTRAINT "ecd_center_ncda_type_matches_facility_type"
  CHECK (
    "ncda_type_code" IS NULL
    OR ("ncda_type_code" = 'A' AND "facility_type" = 'daycare')
    OR ("ncda_type_code" = 'B' AND "facility_type" = 'home_based')
    OR ("ncda_type_code" = 'C' AND "facility_type" = 'community_based')
    OR ("ncda_type_code" IN ('D', 'E') AND "facility_type" = 'ecd_3_5')
  );

-- ---------------------------------------------------------------------------
-- Counter + registry
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "sde"."ecd_code_sequence" (
  "village_id" TEXT NOT NULL,
  "last_seq" INTEGER NOT NULL DEFAULT 0,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ecd_code_sequence_pkey" PRIMARY KEY ("village_id"),
  CONSTRAINT "ecd_code_sequence_last_seq_check" CHECK ("last_seq" BETWEEN 0 AND 99)
);

ALTER TABLE "sde"."ecd_code_sequence" DROP CONSTRAINT IF EXISTS "ecd_code_sequence_village_id_fkey";
ALTER TABLE "sde"."ecd_code_sequence" ADD CONSTRAINT "ecd_code_sequence_village_id_fkey"
  FOREIGN KEY ("village_id") REFERENCES "sde"."administrative_unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "sde"."ecd_code_registry" (
  "code" TEXT NOT NULL,
  "center_id" TEXT NOT NULL,
  "issued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "issued_by" TEXT,
  "retired_at" TIMESTAMP(3),
  "retired_reason" TEXT,
  CONSTRAINT "ecd_code_registry_pkey" PRIMARY KEY ("code")
);

CREATE INDEX IF NOT EXISTS "ecd_code_registry_center_id_idx" ON "sde"."ecd_code_registry"("center_id");

-- Deferred so a code can be issued before the new center row is inserted in the same transaction.
ALTER TABLE "sde"."ecd_code_registry" DROP CONSTRAINT IF EXISTS "ecd_code_registry_center_id_fkey";
ALTER TABLE "sde"."ecd_code_registry" ADD CONSTRAINT "ecd_code_registry_center_id_fkey"
  FOREIGN KEY ("center_id") REFERENCES "sde"."ecd_center"("id") ON DELETE RESTRICT ON UPDATE CASCADE
  DEFERRABLE INITIALLY DEFERRED;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION survey.ncda_type_to_facility_type(p_type_code text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_type_code
    WHEN 'A' THEN 'daycare'
    WHEN 'B' THEN 'home_based'
    WHEN 'C' THEN 'community_based'
    WHEN 'D' THEN 'ecd_3_5'
    WHEN 'E' THEN 'ecd_3_5'
  END;
$$;

CREATE OR REPLACE FUNCTION survey.is_ncda_ecd_code(p_code text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT coalesce(p_code ~ '^[0-9]{10}/[A-E]/[0-9]{4}/[0-9]{2}$', false);
$$;

-- ---------------------------------------------------------------------------
-- Issue the next code for a village. Locks the village counter row, so
-- concurrent callers for the same village are serialized.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION survey.issue_ecd_code(
  p_center_id text,
  p_village_id text,
  p_type_code text,
  p_start_year integer,
  p_issued_by text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SET search_path TO sde, public, survey
AS $$
DECLARE
  v_geo text;
  v_seq integer;
  v_code text;
BEGIN
  IF p_center_id IS NULL OR p_village_id IS NULL THEN
    RAISE EXCEPTION 'ECD_CODE_INVALID_INPUT: center and village are required';
  END IF;
  IF p_type_code IS NULL OR p_type_code NOT IN ('A', 'B', 'C', 'D', 'E') THEN
    RAISE EXCEPTION 'ECD_CODE_INVALID_TYPE: type must be one of A, B, C, D, E (got %)', coalesce(p_type_code, 'null');
  END IF;
  IF p_start_year IS NULL
     OR p_start_year < 1950
     OR p_start_year > extract(year FROM current_date)::integer THEN
    RAISE EXCEPTION 'ECD_CODE_INVALID_YEAR: start year must be between 1950 and the current year (got %)',
      coalesce(p_start_year::text, 'null');
  END IF;

  SELECT minaloc_code INTO v_geo
  FROM sde.administrative_unit
  WHERE id = p_village_id AND level = 'village';

  IF v_geo IS NULL OR v_geo !~ '^[0-9]{10}$' THEN
    RAISE EXCEPTION 'ECD_CODE_VILLAGE_NOT_CODED: village % has no MINALOC code', p_village_id;
  END IF;

  INSERT INTO sde.ecd_code_sequence (village_id, last_seq)
  VALUES (p_village_id, 0)
  ON CONFLICT (village_id) DO NOTHING;

  SELECT last_seq INTO v_seq
  FROM sde.ecd_code_sequence
  WHERE village_id = p_village_id
  FOR UPDATE;

  -- Skip numbers already taken (e.g. by an NCDA override); never reuse.
  LOOP
    IF v_seq >= 99 THEN
      RAISE EXCEPTION 'ECD_CODE_SEQUENCE_EXHAUSTED: village % has used all 99 facility numbers', v_geo;
    END IF;
    v_seq := v_seq + 1;
    v_code := v_geo || '/' || p_type_code || '/' || p_start_year::text || '/' || lpad(v_seq::text, 2, '0');
    EXIT WHEN NOT EXISTS (SELECT 1 FROM sde.ecd_code_registry WHERE code = v_code);
  END LOOP;

  UPDATE sde.ecd_code_sequence
  SET last_seq = v_seq, updated_at = now()
  WHERE village_id = p_village_id;

  INSERT INTO sde.ecd_code_registry (code, center_id, issued_by)
  VALUES (v_code, p_center_id, p_issued_by);

  RETURN v_code;
END;
$$;

-- ---------------------------------------------------------------------------
-- Code immutability. Guards against accidental change from any writer
-- (API, sync, Survey123, scripts). Only the recode/override functions set the
-- transaction-local flag. Not a security boundary against a DB superuser.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION survey.trg_guard_ecd_center_code()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO sde, public, survey
AS $$
DECLARE
  v_allowed boolean := coalesce(current_setting('ecd.allow_code_change', true), '') = 'on';
BEGIN
  IF TG_OP = 'UPDATE' AND NOT v_allowed THEN
    RAISE EXCEPTION 'ECD_CODE_IMMUTABLE: center % code cannot be changed', OLD.id;
  END IF;

  IF TG_OP = 'INSERT' AND v_allowed THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM sde.ecd_code_registry
    WHERE code = NEW.code AND center_id = NEW.id AND retired_at IS NULL
  ) THEN
    RAISE EXCEPTION 'ECD_CODE_NOT_ISSUED: code % was not issued to center %', NEW.code, NEW.id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ecd_center_code_insert ON sde.ecd_center;
CREATE TRIGGER trg_ecd_center_code_insert
  BEFORE INSERT ON sde.ecd_center
  FOR EACH ROW
  EXECUTE FUNCTION survey.trg_guard_ecd_center_code();

DROP TRIGGER IF EXISTS trg_ecd_center_code_update ON sde.ecd_center;
CREATE TRIGGER trg_ecd_center_code_update
  BEFORE UPDATE ON sde.ecd_center
  FOR EACH ROW
  WHEN (OLD.code IS DISTINCT FROM NEW.code OR OLD.legacy_code IS DISTINCT FROM NEW.legacy_code)
  EXECUTE FUNCTION survey.trg_guard_ecd_center_code();

-- ---------------------------------------------------------------------------
-- One-time legacy → NCDA re-code (scripts/recode-ecd-centers.ts).
-- No-op when the center already has an NCDA-format code.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION survey.recode_ecd_center(
  p_center_id text,
  p_type_code text,
  p_start_year integer,
  p_actor text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SET search_path TO sde, public, survey
AS $$
DECLARE
  c sde.ecd_center%ROWTYPE;
  v_new text;
BEGIN
  SELECT * INTO c FROM sde.ecd_center WHERE id = p_center_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ECD_CODE_INVALID_INPUT: center % not found', p_center_id;
  END IF;
  IF survey.is_ncda_ecd_code(c.code) THEN
    RETURN c.code;
  END IF;
  IF c.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'ECD_CODE_INVALID_INPUT: center % is deleted', p_center_id;
  END IF;

  v_new := survey.issue_ecd_code(c.id, c.village_id, p_type_code, p_start_year, p_actor);

  PERFORM set_config('ecd.allow_code_change', 'on', true);
  UPDATE sde.ecd_center
  SET
    legacy_code = c.code,
    code = v_new,
    ncda_type_code = p_type_code,
    facility_type = survey.ncda_type_to_facility_type(p_type_code),
    start_year = p_start_year,
    code_issued_at = now(),
    updated_by = coalesce(p_actor, updated_by),
    updated_at = now(),
    last_modified_at = now(),
    version = version + 1
  WHERE id = c.id;
  PERFORM set_config('ecd.allow_code_change', 'off', true);

  RETURN v_new;
END;
$$;

-- ---------------------------------------------------------------------------
-- NCDA admin override for genuine errors. Correct the center's village, type
-- letter and start year first; the new code must then match them exactly
-- (geo = village MINALOC code, T = ncda_type_code, YYYY = start_year), be
-- well-formed, and never have been issued. Returns the old code.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION survey.override_ecd_code(
  p_center_id text,
  p_new_code text,
  p_reason text,
  p_actor text
)
RETURNS text
LANGUAGE plpgsql
SET search_path TO sde, public, survey
AS $$
DECLARE
  c sde.ecd_center%ROWTYPE;
  v_geo text;
BEGIN
  IF NOT survey.is_ncda_ecd_code(p_new_code) THEN
    RAISE EXCEPTION 'ECD_CODE_INVALID_FORMAT: % is not PPDDSSCCVV/T/YYYY/NN', coalesce(p_new_code, 'null');
  END IF;
  IF trim(coalesce(p_reason, '')) = '' THEN
    RAISE EXCEPTION 'ECD_CODE_INVALID_INPUT: an override reason is required';
  END IF;

  SELECT * INTO c FROM sde.ecd_center WHERE id = p_center_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ECD_CODE_INVALID_INPUT: center % not found', p_center_id;
  END IF;

  SELECT minaloc_code INTO v_geo FROM sde.administrative_unit WHERE id = c.village_id;
  IF v_geo IS NULL THEN
    RAISE EXCEPTION 'ECD_CODE_VILLAGE_NOT_CODED: village % has no MINALOC code', c.village_id;
  END IF;
  IF c.ncda_type_code IS NULL OR c.start_year IS NULL THEN
    RAISE EXCEPTION 'ECD_CODE_MISMATCH: set the center''s ncdaTypeCode and startYear before overriding its code';
  END IF;
  IF left(p_new_code, 10) <> v_geo
     OR substr(p_new_code, 12, 1) <> c.ncda_type_code
     OR substr(p_new_code, 14, 4) <> c.start_year::text THEN
    RAISE EXCEPTION 'ECD_CODE_MISMATCH: code must start with %/%/% to match the center''s village, type and start year',
      v_geo, c.ncda_type_code, c.start_year;
  END IF;
  IF EXISTS (SELECT 1 FROM sde.ecd_code_registry WHERE code = p_new_code) THEN
    RAISE EXCEPTION 'ECD_CODE_ALREADY_ISSUED: % has already been issued', p_new_code;
  END IF;

  UPDATE sde.ecd_code_registry
  SET retired_at = now(), retired_reason = p_reason
  WHERE code = c.code AND retired_at IS NULL;

  INSERT INTO sde.ecd_code_registry (code, center_id, issued_by)
  VALUES (p_new_code, c.id, p_actor);

  PERFORM set_config('ecd.allow_code_change', 'on', true);
  UPDATE sde.ecd_center
  SET
    -- Keep the first pre-NCDA code if there was one; otherwise remember the replaced code.
    legacy_code = CASE WHEN survey.is_ncda_ecd_code(c.code) THEN legacy_code ELSE c.code END,
    code = p_new_code,
    code_issued_at = now(),
    updated_by = coalesce(p_actor, updated_by),
    updated_at = now(),
    last_modified_at = now(),
    version = version + 1
  WHERE id = c.id;
  PERFORM set_config('ecd.allow_code_change', 'off', true);

  RETURN c.code;
END;
$$;
