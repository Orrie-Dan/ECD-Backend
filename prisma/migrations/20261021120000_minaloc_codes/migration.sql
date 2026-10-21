-- NCDA ECD coding, step 1: official MINALOC administrative codes.
-- Populated by scripts/import-minaloc-codes.ts from data/minaloc/villages.csv.
-- Slug `code` columns are unchanged (Survey123 location resolution depends on them).

ALTER TABLE "sde"."district" ADD COLUMN IF NOT EXISTS "minaloc_code" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "district_minaloc_code_key" ON "sde"."district"("minaloc_code");
ALTER TABLE "sde"."district" DROP CONSTRAINT IF EXISTS "district_minaloc_code_format";
ALTER TABLE "sde"."district" ADD CONSTRAINT "district_minaloc_code_format"
  CHECK ("minaloc_code" IS NULL OR "minaloc_code" ~ '^[0-9]{4}$');

ALTER TABLE "sde"."administrative_unit" ADD COLUMN IF NOT EXISTS "minaloc_code" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "administrative_unit_level_minaloc_code_key"
  ON "sde"."administrative_unit"("level", "minaloc_code");
ALTER TABLE "sde"."administrative_unit" DROP CONSTRAINT IF EXISTS "administrative_unit_minaloc_code_format";
ALTER TABLE "sde"."administrative_unit" ADD CONSTRAINT "administrative_unit_minaloc_code_format"
  CHECK (
    "minaloc_code" IS NULL
    OR ("level" = 'province' AND "minaloc_code" ~ '^[0-9]{2}$')
    OR ("level" = 'sector'   AND "minaloc_code" ~ '^[0-9]{6}$')
    OR ("level" = 'cell'     AND "minaloc_code" ~ '^[0-9]{8}$')
    OR ("level" = 'village'  AND "minaloc_code" ~ '^[0-9]{10}$')
  );
