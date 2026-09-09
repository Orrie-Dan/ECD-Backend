-- Persist ECD Standards self-evaluation percent + color rank for monitoring charts.
ALTER TABLE "sde"."compliance_assessment"
  ADD COLUMN IF NOT EXISTS "overall_percent" DECIMAL(5,2),
  ADD COLUMN IF NOT EXISTS "overall_rank" TEXT;

CREATE INDEX IF NOT EXISTS "compliance_assessment_overall_rank_idx"
  ON "sde"."compliance_assessment" ("overall_rank");
