-- Phase 1b — Tier 2 lookup tables (8)

CREATE TABLE IF NOT EXISTS lookup_child_gender (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code varchar(50) UNIQUE NOT NULL,
  label_en varchar(100) NOT NULL, sort_order int NOT NULL DEFAULT 0
);
INSERT INTO lookup_child_gender (code, label_en, sort_order) VALUES
  ('male', 'Male', 1), ('female', 'Female', 2) ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS lookup_child_status (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code varchar(50) UNIQUE NOT NULL,
  label_en varchar(100) NOT NULL, sort_order int NOT NULL DEFAULT 0
);
INSERT INTO lookup_child_status (code, label_en, sort_order) VALUES
  ('active', 'Active', 1), ('transferred', 'Transferred', 2), ('archived', 'Archived', 3) ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS lookup_attendance_status (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code varchar(50) UNIQUE NOT NULL,
  label_en varchar(100) NOT NULL, sort_order int NOT NULL DEFAULT 0
);
INSERT INTO lookup_attendance_status (code, label_en, sort_order) VALUES
  ('present', 'Present', 1), ('absent', 'Absent', 2) ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS lookup_absent_reason (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code varchar(50) UNIQUE NOT NULL,
  label_en varchar(100) NOT NULL, sort_order int NOT NULL DEFAULT 0
);
INSERT INTO lookup_absent_reason (code, label_en, sort_order) VALUES
  ('sick', 'Sick', 1), ('family', 'Family', 2), ('transport', 'Transport', 3),
  ('weather', 'Weather', 4), ('unknown', 'Unknown', 5), ('other', 'Other', 6) ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS lookup_sted_age_band (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code varchar(50) UNIQUE NOT NULL,
  label_en varchar(100) NOT NULL, sort_order int NOT NULL DEFAULT 0
);
INSERT INTO lookup_sted_age_band (code, label_en, sort_order) VALUES
  ('band_1_3', 'Band 1-3', 1), ('band_4_6', 'Band 4-6', 2) ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS lookup_referral_source_type (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code varchar(50) UNIQUE NOT NULL,
  label_en varchar(100) NOT NULL, sort_order int NOT NULL DEFAULT 0
);
INSERT INTO lookup_referral_source_type (code, label_en, sort_order) VALUES
  ('nutrition', 'Nutrition', 1), ('sted', 'STED', 2) ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS lookup_referral_status (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code varchar(50) UNIQUE NOT NULL,
  label_en varchar(100) NOT NULL, sort_order int NOT NULL DEFAULT 0
);
INSERT INTO lookup_referral_status (code, label_en, sort_order) VALUES
  ('pending', 'Pending', 1), ('completed', 'Completed', 2), ('cancelled', 'Cancelled', 3) ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS lookup_transfer_status (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code varchar(50) UNIQUE NOT NULL,
  label_en varchar(100) NOT NULL, sort_order int NOT NULL DEFAULT 0
);
INSERT INTO lookup_transfer_status (code, label_en, sort_order) VALUES
  ('pending', 'Pending', 1), ('accepted', 'Accepted', 2), ('cancelled', 'Cancelled', 3) ON CONFLICT (code) DO NOTHING;
