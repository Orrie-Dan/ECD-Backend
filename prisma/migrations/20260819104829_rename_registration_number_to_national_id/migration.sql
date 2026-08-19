-- DropIndex
DROP INDEX IF EXISTS "child_registration_number_key";
DROP INDEX IF EXISTS "child_registration_number_idx";

-- RenameColumn
ALTER TABLE "child" RENAME COLUMN "registration_number" TO "national_id";

-- CreateIndex
CREATE UNIQUE INDEX "child_national_id_key" ON "child"("national_id");
CREATE INDEX "child_national_id_idx" ON "child"("national_id");
