-- SECTOR-USER-02: assign sector_focal_person users to an AdministrativeUnit (sector).
ALTER TABLE "sde"."user_account"
  ADD COLUMN IF NOT EXISTS "sector_id" TEXT;

CREATE INDEX IF NOT EXISTS "user_account_sector_id_idx"
  ON "sde"."user_account"("sector_id");

CREATE INDEX IF NOT EXISTS "user_account_district_id_idx"
  ON "sde"."user_account"("district_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'user_account_sector_id_fkey'
  ) THEN
    ALTER TABLE "sde"."user_account"
      ADD CONSTRAINT "user_account_sector_id_fkey"
      FOREIGN KEY ("sector_id")
      REFERENCES "sde"."administrative_unit"("id")
      ON DELETE SET NULL
      ON UPDATE CASCADE;
  END IF;
END $$;
