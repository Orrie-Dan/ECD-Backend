-- Sprint 3.4: pending sync session recovery tracking
ALTER TABLE "sync_session" ADD COLUMN IF NOT EXISTS "retry_count" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "sync_session" ADD COLUMN IF NOT EXISTS "last_retry_at" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "sync_session_status_started_at_idx" ON "sync_session"("status", "started_at");
