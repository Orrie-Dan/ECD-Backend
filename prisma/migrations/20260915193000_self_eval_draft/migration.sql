-- Client draft identity for matching localStorage ↔ server assessments.
ALTER TABLE "sde"."compliance_assessment"
  ADD COLUMN IF NOT EXISTS "client_draft_id" TEXT;

CREATE INDEX IF NOT EXISTS "compliance_assessment_client_draft_id_idx"
  ON "sde"."compliance_assessment" ("client_draft_id");

CREATE INDEX IF NOT EXISTS "compliance_assessment_center_id_assessment_type_status_idx"
  ON "sde"."compliance_assessment" ("center_id", "assessment_type", "status");

-- One active self-evaluation draft per center. Soft-delete extras (keep newest)
-- so the unique index can be applied on existing databases.
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY center_id
      ORDER BY updated_at DESC, created_at DESC
    ) AS rn
  FROM "sde"."compliance_assessment"
  WHERE deleted_at IS NULL
    AND status = 'draft'
    AND assessment_type = 'self_assessment'
)
UPDATE "sde"."compliance_assessment" AS a
SET deleted_at = NOW()
FROM ranked AS r
WHERE a.id = r.id
  AND r.rn > 1;

-- Partial unique: one self_assessment draft per center (deleted drafts excluded).
CREATE UNIQUE INDEX IF NOT EXISTS "compliance_assessment_one_self_eval_draft"
  ON "sde"."compliance_assessment" ("center_id")
  WHERE deleted_at IS NULL
    AND status = 'draft'
    AND assessment_type = 'self_assessment';
