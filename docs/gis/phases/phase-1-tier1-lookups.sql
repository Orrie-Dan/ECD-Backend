-- Phase 1 — Tier 1 lookup tables (10)

CREATE TABLE IF NOT EXISTS lookup_ecd_center_status (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code       varchar(50) UNIQUE NOT NULL,
  label_en   varchar(100) NOT NULL,
  sort_order int NOT NULL DEFAULT 0
);
INSERT INTO lookup_ecd_center_status (code, label_en, sort_order) VALUES
  ('active', 'Active', 1),
  ('inactive', 'Inactive', 2) ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS lookup_compliance_classification (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code       varchar(50) UNIQUE NOT NULL,
  label_en   varchar(100) NOT NULL,
  sort_order int NOT NULL DEFAULT 0
);
INSERT INTO lookup_compliance_classification (code, label_en, sort_order) VALUES
  ('compliant', 'Compliant', 1),
  ('partially_compliant', 'Partially Compliant', 2),
  ('non_compliant', 'Non-Compliant', 3) ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS lookup_administrative_level (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code       varchar(50) UNIQUE NOT NULL,
  label_en   varchar(100) NOT NULL,
  sort_order int NOT NULL DEFAULT 0
);
INSERT INTO lookup_administrative_level (code, label_en, sort_order) VALUES
  ('province', 'Province', 1),
  ('sector', 'Sector', 2),
  ('cell', 'Cell', 3),
  ('village', 'Village', 4) ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS lookup_nutrition_status (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code       varchar(50) UNIQUE NOT NULL,
  label_en   varchar(100) NOT NULL,
  sort_order int NOT NULL DEFAULT 0
);
INSERT INTO lookup_nutrition_status (code, label_en, sort_order) VALUES
  ('normal', 'Normal', 1),
  ('at_risk', 'At Risk', 2),
  ('moderate', 'Moderate', 3),
  ('severe', 'Severe', 4) ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS lookup_assessment_type (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code       varchar(50) UNIQUE NOT NULL,
  label_en   varchar(100) NOT NULL,
  sort_order int NOT NULL DEFAULT 0
);
INSERT INTO lookup_assessment_type (code, label_en, sort_order) VALUES
  ('self_assessment', 'Self Assessment', 1),
  ('supportive_supervision', 'Supportive Supervision', 2),
  ('external_audit', 'External Audit', 3) ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS lookup_assessment_status (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code       varchar(50) UNIQUE NOT NULL,
  label_en   varchar(100) NOT NULL,
  sort_order int NOT NULL DEFAULT 0
);
INSERT INTO lookup_assessment_status (code, label_en, sort_order) VALUES
  ('draft', 'Draft', 1),
  ('submitted', 'Submitted', 2),
  ('verified', 'Verified', 3),
  ('rejected', 'Rejected', 4) ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS lookup_item_response (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code       varchar(50) UNIQUE NOT NULL,
  label_en   varchar(100) NOT NULL,
  sort_order int NOT NULL DEFAULT 0
);
INSERT INTO lookup_item_response (code, label_en, sort_order) VALUES
  ('met', 'Met', 1),
  ('partially_met', 'Partially Met', 2),
  ('not_met', 'Not Met', 3),
  ('not_applicable', 'Not Applicable', 4) ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS lookup_gap_severity (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code       varchar(50) UNIQUE NOT NULL,
  label_en   varchar(100) NOT NULL,
  sort_order int NOT NULL DEFAULT 0
);
INSERT INTO lookup_gap_severity (code, label_en, sort_order) VALUES
  ('low', 'Low', 1),
  ('medium', 'Medium', 2),
  ('high', 'High', 3) ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS lookup_gap_status (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code       varchar(50) UNIQUE NOT NULL,
  label_en   varchar(100) NOT NULL,
  sort_order int NOT NULL DEFAULT 0
);
INSERT INTO lookup_gap_status (code, label_en, sort_order) VALUES
  ('open', 'Open', 1),
  ('in_progress', 'In Progress', 2),
  ('resolved', 'Resolved', 3) ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS lookup_standard_domain (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code       varchar(50) UNIQUE NOT NULL,
  label_en   varchar(100) NOT NULL,
  sort_order int NOT NULL DEFAULT 0
);
INSERT INTO lookup_standard_domain (code, label_en, sort_order) VALUES
  ('wash', 'WASH', 1),
  ('safety', 'Safety', 2),
  ('nutrition', 'Nutrition', 3),
  ('learning_environment', 'Learning Environment', 4) ON CONFLICT (code) DO NOTHING;
