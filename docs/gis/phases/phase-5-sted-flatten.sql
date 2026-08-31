-- Phase 5 — STED JSON normalization
-- Keys derived from src/modules/sted/mappers/sted.mapper.ts (extractStedReferralSignals).
-- Original jsonb columns retained as snapshots until cutover QA passes.

CREATE TABLE IF NOT EXISTS sted_milestone_result (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id  text NOT NULL REFERENCES sted_assessment(id) ON DELETE CASCADE,
  milestone_code varchar(100) NOT NULL,
  result_kind    varchar(20) NOT NULL CHECK (result_kind IN ('failed', 'delayed')),
  notes          text,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sted_milestone_result_assessment ON sted_milestone_result(assessment_id);

CREATE TABLE IF NOT EXISTS sted_physical_finding (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id  text NOT NULL REFERENCES sted_assessment(id) ON DELETE CASCADE,
  finding_code   varchar(100),
  finding_kind   varchar(20) NOT NULL CHECK (finding_kind IN ('problem', 'flag')),
  severity       varchar(50),
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sted_physical_finding_assessment ON sted_physical_finding(assessment_id);

CREATE TABLE IF NOT EXISTS sted_outcome_summary (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id        text NOT NULL UNIQUE REFERENCES sted_assessment(id) ON DELETE CASCADE,
  referral_required    boolean NOT NULL DEFAULT false,
  has_physical_problems boolean NOT NULL DEFAULT false,
  has_failed_milestones boolean NOT NULL DEFAULT false,
  outcome_code         varchar(100),
  delay_level          varchar(50),
  created_at           timestamptz NOT NULL DEFAULT now()
);

-- Idempotent backfill: clear derived rows before re-run (tables must exist)
TRUNCATE sted_milestone_result, sted_physical_finding, sted_outcome_summary;

INSERT INTO sted_outcome_summary (
  assessment_id,
  referral_required,
  has_physical_problems,
  has_failed_milestones,
  outcome_code,
  delay_level
)
SELECT
  s.id,
  COALESCE(
    (s.outcome->>'referred')::boolean,
    (s.outcome->>'referralRequested')::boolean,
    (s.outcome->>'requiresReferral')::boolean,
    false
  ),
  COALESCE(
    (s.physical_assessment->>'hasProblems')::boolean,
    (s.physical_assessment->>'problemsDetected')::boolean,
    jsonb_array_length(COALESCE(s.physical_assessment->'problems', '[]'::jsonb)) > 0,
    jsonb_array_length(COALESCE(s.physical_assessment->'flags', '[]'::jsonb)) > 0,
    false
  ),
  COALESCE(
    (s.milestone_results->>'hasFailed')::boolean,
    (s.milestone_results->>'anyFailed')::boolean,
    jsonb_array_length(COALESCE(s.milestone_results->'failed', '[]'::jsonb)) > 0,
    jsonb_array_length(COALESCE(s.milestone_results->'delayed', '[]'::jsonb)) > 0,
    false
  ),
  CASE
    WHEN COALESCE((s.milestone_results->>'hasFailed')::boolean, false)
      OR jsonb_array_length(COALESCE(s.milestone_results->'failed', '[]'::jsonb)) > 0
      THEN 'failed_milestones'
    WHEN COALESCE((s.milestone_results->>'anyFailed')::boolean, false)
      THEN 'failed_milestones'
    WHEN s.outcome ? 'summary' THEN s.outcome->>'summary'
    WHEN s.outcome ? 'code' THEN s.outcome->>'code'
    ELSE NULL
  END,
  CASE
    WHEN jsonb_array_length(COALESCE(s.milestone_results->'delayed', '[]'::jsonb)) > 0 THEN 'delayed'
    ELSE NULL
  END
FROM sted_assessment s
WHERE s.deleted_at IS NULL;

-- Expand milestone_results.failed[] and .delayed[] arrays into rows
INSERT INTO sted_milestone_result (assessment_id, milestone_code, result_kind)
SELECT s.id, elem::text, 'failed'
FROM sted_assessment s
CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(s.milestone_results->'failed', '[]'::jsonb)) AS elem
WHERE s.deleted_at IS NULL;

INSERT INTO sted_milestone_result (assessment_id, milestone_code, result_kind)
SELECT s.id, elem::text, 'delayed'
FROM sted_assessment s
CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(s.milestone_results->'delayed', '[]'::jsonb)) AS elem
WHERE s.deleted_at IS NULL;

-- Expand physical_assessment.problems[] and .flags[]
INSERT INTO sted_physical_finding (assessment_id, finding_code, finding_kind)
SELECT s.id, elem::text, 'problem'
FROM sted_assessment s
CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(s.physical_assessment->'problems', '[]'::jsonb)) AS elem
WHERE s.deleted_at IS NULL;

INSERT INTO sted_physical_finding (assessment_id, finding_code, finding_kind)
SELECT s.id, elem::text, 'flag'
FROM sted_assessment s
CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(s.physical_assessment->'flags', '[]'::jsonb)) AS elem
WHERE s.deleted_at IS NULL;
