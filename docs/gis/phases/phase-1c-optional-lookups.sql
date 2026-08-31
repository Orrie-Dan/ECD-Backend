-- Phase 1c — Optional lookups (structure only — seed coded strings via phase-1c-seed-coded-lookups.sql)

CREATE TABLE IF NOT EXISTS lookup_classroom_grade (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code varchar(50) UNIQUE NOT NULL,
  label_en varchar(100) NOT NULL, sort_order int NOT NULL DEFAULT 0
);
INSERT INTO lookup_classroom_grade (code, label_en, sort_order) VALUES
  ('grade_1', 'Grade 1', 1), ('grade_2', 'Grade 2', 2), ('grade_3', 'Grade 3', 3) ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS lookup_parent_contribution_type (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code varchar(50) UNIQUE NOT NULL,
  label_en varchar(100) NOT NULL, sort_order int NOT NULL DEFAULT 0
);
INSERT INTO lookup_parent_contribution_type (code, label_en, sort_order) VALUES
  ('cash', 'Cash', 1), ('in_kind', 'In Kind', 2) ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS lookup_in_kind_item_type (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code varchar(50) UNIQUE NOT NULL,
  label_en varchar(100) NOT NULL, sort_order int NOT NULL DEFAULT 0
);
INSERT INTO lookup_in_kind_item_type (code, label_en, sort_order) VALUES
  ('flour', 'Flour', 1), ('potatoes', 'Potatoes', 2), ('maize', 'Maize', 3),
  ('milk', 'Milk', 4), ('firewood', 'Firewood', 5), ('other', 'Other', 6) ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS lookup_center_support_category (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code varchar(50) UNIQUE NOT NULL,
  label_en varchar(100) NOT NULL, sort_order int NOT NULL DEFAULT 0
);
INSERT INTO lookup_center_support_category (code, label_en, sort_order) VALUES
  ('food', 'Food', 1), ('equipment', 'Equipment', 2), ('other', 'Other', 3) ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS lookup_water_source_type (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code varchar(50) UNIQUE NOT NULL,
  label_en varchar(100) NOT NULL, sort_order int NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS lookup_food_source (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code varchar(50) UNIQUE NOT NULL,
  label_en varchar(100) NOT NULL, sort_order int NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS lookup_meal_quality (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code varchar(50) UNIQUE NOT NULL,
  label_en varchar(100) NOT NULL, sort_order int NOT NULL DEFAULT 0
);
