-- NOTIF-05: Add dedupe_key for logical notification identity and DB-level uniqueness.
-- Nullable for legacy rows; PostgreSQL treats NULL as distinct in unique indexes.

ALTER TABLE "sde"."notification" ADD COLUMN IF NOT EXISTS "dedupe_key" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "notification_user_id_dedupe_key_key"
  ON "sde"."notification" ("user_id", "dedupe_key");
