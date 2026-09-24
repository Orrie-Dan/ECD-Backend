-- SELF-EVAL-ALIGN-02: immutable item snapshots for historical assessment safety.
-- Submitted item interpretation must not depend on mutable EcdStandard.weight/title.

ALTER TABLE "sde"."compliance_assessment_item"
  ADD COLUMN IF NOT EXISTS "question_code_snapshot" TEXT,
  ADD COLUMN IF NOT EXISTS "question_text_snapshot" TEXT,
  ADD COLUMN IF NOT EXISTS "weight_snapshot" DECIMAL(8,2),
  ADD COLUMN IF NOT EXISTS "section_code_snapshot" TEXT,
  ADD COLUMN IF NOT EXISTS "section_title_snapshot" TEXT,
  ADD COLUMN IF NOT EXISTS "question_order_snapshot" INTEGER;
