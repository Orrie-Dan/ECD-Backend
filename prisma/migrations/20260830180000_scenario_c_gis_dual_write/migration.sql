-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "postgis" WITH SCHEMA "public";

-- AlterTable
ALTER TABLE "administrative_unit" ADD COLUMN     "geom" geometry(Point, 4326),
ADD COLUMN     "level_id" UUID,
ADD COLUMN     "objectid" SERIAL,
ALTER COLUMN "latitude" SET DATA TYPE DOUBLE PRECISION,
ALTER COLUMN "longitude" SET DATA TYPE DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "attendance_record" ADD COLUMN     "absent_reason_id" UUID,
ADD COLUMN     "status_id" UUID;

-- AlterTable
ALTER TABLE "center_feeding_month_summary" ADD COLUMN     "food_source_id" UUID,
ALTER COLUMN "milk_liters" SET DATA TYPE DECIMAL(12,3),
ALTER COLUMN "flour_kg" SET DATA TYPE DECIMAL(12,3);

-- AlterTable
ALTER TABLE "center_support" ADD COLUMN     "support_category_id" UUID;

-- AlterTable
ALTER TABLE "child" ADD COLUMN     "gender_id" UUID,
ADD COLUMN     "status_id" UUID;

-- AlterTable
ALTER TABLE "child_nutrition_screening" ADD COLUMN     "meal_quality_id" UUID,
ADD COLUMN     "nutrition_status_id" UUID,
ALTER COLUMN "weight_kg" SET DATA TYPE DECIMAL(6,2),
ALTER COLUMN "muac_cm" SET DATA TYPE DECIMAL(5,1),
ALTER COLUMN "height_cm" SET DATA TYPE DECIMAL(5,1),
ALTER COLUMN "head_circumference_cm" SET DATA TYPE DECIMAL(5,1);

-- AlterTable
ALTER TABLE "child_transfer" ADD COLUMN     "status_id" UUID;

-- AlterTable
ALTER TABLE "classroom" ADD COLUMN     "grade_id" UUID;

-- AlterTable
ALTER TABLE "compliance_assessment" ADD COLUMN     "assessment_type_id" UUID,
ADD COLUMN     "overall_classification_id" UUID,
ADD COLUMN     "status_id" UUID;

-- AlterTable
ALTER TABLE "compliance_assessment_item" ADD COLUMN     "gap_severity_id" UUID,
ADD COLUMN     "gap_status_id" UUID,
ADD COLUMN     "response_id" UUID,
ALTER COLUMN "score" SET DATA TYPE DECIMAL(8,2);

-- AlterTable
ALTER TABLE "ecd_center" ADD COLUMN     "current_compliance_level_id" UUID,
ADD COLUMN     "geom" geometry(Point, 4326),
ADD COLUMN     "objectid" SERIAL,
ADD COLUMN     "status_id" UUID,
ALTER COLUMN "latitude" SET DATA TYPE DOUBLE PRECISION,
ALTER COLUMN "longitude" SET DATA TYPE DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "ecd_standard" ADD COLUMN     "domain_id" UUID,
ALTER COLUMN "weight" SET DATA TYPE DECIMAL(6,3);

-- AlterTable
ALTER TABLE "parent_contribution" ADD COLUMN     "contribution_type_id" UUID,
ADD COLUMN     "item_type_id" UUID;

-- AlterTable
ALTER TABLE "referral" ADD COLUMN     "source_type_id" UUID,
ADD COLUMN     "status_id" UUID;

-- AlterTable
ALTER TABLE "sted_assessment" ADD COLUMN     "age_band_id" UUID;

-- AlterTable
ALTER TABLE "wash_indicator" ADD COLUMN     "water_source_type_id" UUID;

-- CreateTable
CREATE TABLE "sted_milestone_result" (
    "id" UUID NOT NULL,
    "assessment_id" TEXT NOT NULL,
    "milestone_code" VARCHAR(100) NOT NULL,
    "result_kind" VARCHAR(20) NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sted_milestone_result_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sted_physical_finding" (
    "id" UUID NOT NULL,
    "assessment_id" TEXT NOT NULL,
    "finding_code" VARCHAR(100),
    "finding_kind" VARCHAR(20) NOT NULL,
    "severity" VARCHAR(50),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sted_physical_finding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sted_outcome_summary" (
    "id" UUID NOT NULL,
    "assessment_id" TEXT NOT NULL,
    "referral_required" BOOLEAN NOT NULL DEFAULT false,
    "has_physical_problems" BOOLEAN NOT NULL DEFAULT false,
    "has_failed_milestones" BOOLEAN NOT NULL DEFAULT false,
    "outcome_code" VARCHAR(100),
    "delay_level" VARCHAR(50),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sted_outcome_summary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lookup_ecd_center_status" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "label_en" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "lookup_ecd_center_status_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lookup_compliance_classification" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "label_en" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "lookup_compliance_classification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lookup_administrative_level" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "label_en" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "lookup_administrative_level_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lookup_nutrition_status" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "label_en" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "lookup_nutrition_status_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lookup_meal_quality" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "label_en" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "lookup_meal_quality_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lookup_assessment_type" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "label_en" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "lookup_assessment_type_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lookup_assessment_status" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "label_en" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "lookup_assessment_status_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lookup_item_response" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "label_en" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "lookup_item_response_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lookup_gap_severity" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "label_en" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "lookup_gap_severity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lookup_gap_status" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "label_en" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "lookup_gap_status_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lookup_standard_domain" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "label_en" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "lookup_standard_domain_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lookup_child_gender" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "label_en" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "lookup_child_gender_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lookup_child_status" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "label_en" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "lookup_child_status_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lookup_attendance_status" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "label_en" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "lookup_attendance_status_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lookup_absent_reason" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "label_en" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "lookup_absent_reason_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lookup_sted_age_band" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "label_en" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "lookup_sted_age_band_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lookup_referral_source_type" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "label_en" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "lookup_referral_source_type_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lookup_referral_status" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "label_en" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "lookup_referral_status_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lookup_transfer_status" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "label_en" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "lookup_transfer_status_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lookup_classroom_grade" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "label_en" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "lookup_classroom_grade_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lookup_parent_contribution_type" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "label_en" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "lookup_parent_contribution_type_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lookup_in_kind_item_type" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "label_en" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "lookup_in_kind_item_type_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lookup_center_support_category" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "label_en" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "lookup_center_support_category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lookup_water_source_type" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "label_en" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "lookup_water_source_type_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lookup_food_source" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "label_en" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "lookup_food_source_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sted_milestone_result_assessment_id_idx" ON "sted_milestone_result"("assessment_id");

-- CreateIndex
CREATE INDEX "sted_physical_finding_assessment_id_idx" ON "sted_physical_finding"("assessment_id");

-- CreateIndex
CREATE UNIQUE INDEX "sted_outcome_summary_assessment_id_key" ON "sted_outcome_summary"("assessment_id");

-- CreateIndex
CREATE UNIQUE INDEX "lookup_ecd_center_status_code_key" ON "lookup_ecd_center_status"("code");

-- CreateIndex
CREATE UNIQUE INDEX "lookup_compliance_classification_code_key" ON "lookup_compliance_classification"("code");

-- CreateIndex
CREATE UNIQUE INDEX "lookup_administrative_level_code_key" ON "lookup_administrative_level"("code");

-- CreateIndex
CREATE UNIQUE INDEX "lookup_nutrition_status_code_key" ON "lookup_nutrition_status"("code");

-- CreateIndex
CREATE UNIQUE INDEX "lookup_meal_quality_code_key" ON "lookup_meal_quality"("code");

-- CreateIndex
CREATE UNIQUE INDEX "lookup_assessment_type_code_key" ON "lookup_assessment_type"("code");

-- CreateIndex
CREATE UNIQUE INDEX "lookup_assessment_status_code_key" ON "lookup_assessment_status"("code");

-- CreateIndex
CREATE UNIQUE INDEX "lookup_item_response_code_key" ON "lookup_item_response"("code");

-- CreateIndex
CREATE UNIQUE INDEX "lookup_gap_severity_code_key" ON "lookup_gap_severity"("code");

-- CreateIndex
CREATE UNIQUE INDEX "lookup_gap_status_code_key" ON "lookup_gap_status"("code");

-- CreateIndex
CREATE UNIQUE INDEX "lookup_standard_domain_code_key" ON "lookup_standard_domain"("code");

-- CreateIndex
CREATE UNIQUE INDEX "lookup_child_gender_code_key" ON "lookup_child_gender"("code");

-- CreateIndex
CREATE UNIQUE INDEX "lookup_child_status_code_key" ON "lookup_child_status"("code");

-- CreateIndex
CREATE UNIQUE INDEX "lookup_attendance_status_code_key" ON "lookup_attendance_status"("code");

-- CreateIndex
CREATE UNIQUE INDEX "lookup_absent_reason_code_key" ON "lookup_absent_reason"("code");

-- CreateIndex
CREATE UNIQUE INDEX "lookup_sted_age_band_code_key" ON "lookup_sted_age_band"("code");

-- CreateIndex
CREATE UNIQUE INDEX "lookup_referral_source_type_code_key" ON "lookup_referral_source_type"("code");

-- CreateIndex
CREATE UNIQUE INDEX "lookup_referral_status_code_key" ON "lookup_referral_status"("code");

-- CreateIndex
CREATE UNIQUE INDEX "lookup_transfer_status_code_key" ON "lookup_transfer_status"("code");

-- CreateIndex
CREATE UNIQUE INDEX "lookup_classroom_grade_code_key" ON "lookup_classroom_grade"("code");

-- CreateIndex
CREATE UNIQUE INDEX "lookup_parent_contribution_type_code_key" ON "lookup_parent_contribution_type"("code");

-- CreateIndex
CREATE UNIQUE INDEX "lookup_in_kind_item_type_code_key" ON "lookup_in_kind_item_type"("code");

-- CreateIndex
CREATE UNIQUE INDEX "lookup_center_support_category_code_key" ON "lookup_center_support_category"("code");

-- CreateIndex
CREATE UNIQUE INDEX "lookup_water_source_type_code_key" ON "lookup_water_source_type"("code");

-- CreateIndex
CREATE UNIQUE INDEX "lookup_food_source_code_key" ON "lookup_food_source"("code");

-- CreateIndex
CREATE UNIQUE INDEX "administrative_unit_objectid_key" ON "administrative_unit"("objectid");

-- CreateIndex
CREATE INDEX "classroom_grade_id_idx" ON "classroom"("grade_id");

-- CreateIndex
CREATE UNIQUE INDEX "ecd_center_objectid_key" ON "ecd_center"("objectid");

-- CreateIndex
CREATE INDEX "ecd_center_status_id_idx" ON "ecd_center"("status_id");

-- AddForeignKey
ALTER TABLE "administrative_unit" ADD CONSTRAINT "administrative_unit_level_id_fkey" FOREIGN KEY ("level_id") REFERENCES "lookup_administrative_level"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ecd_center" ADD CONSTRAINT "ecd_center_status_id_fkey" FOREIGN KEY ("status_id") REFERENCES "lookup_ecd_center_status"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ecd_center" ADD CONSTRAINT "ecd_center_current_compliance_level_id_fkey" FOREIGN KEY ("current_compliance_level_id") REFERENCES "lookup_compliance_classification"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "classroom" ADD CONSTRAINT "classroom_grade_id_fkey" FOREIGN KEY ("grade_id") REFERENCES "lookup_classroom_grade"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "child" ADD CONSTRAINT "child_gender_id_fkey" FOREIGN KEY ("gender_id") REFERENCES "lookup_child_gender"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "child" ADD CONSTRAINT "child_status_id_fkey" FOREIGN KEY ("status_id") REFERENCES "lookup_child_status"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "child_transfer" ADD CONSTRAINT "child_transfer_status_id_fkey" FOREIGN KEY ("status_id") REFERENCES "lookup_transfer_status"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_record" ADD CONSTRAINT "attendance_record_status_id_fkey" FOREIGN KEY ("status_id") REFERENCES "lookup_attendance_status"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_record" ADD CONSTRAINT "attendance_record_absent_reason_id_fkey" FOREIGN KEY ("absent_reason_id") REFERENCES "lookup_absent_reason"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "child_nutrition_screening" ADD CONSTRAINT "child_nutrition_screening_nutrition_status_id_fkey" FOREIGN KEY ("nutrition_status_id") REFERENCES "lookup_nutrition_status"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "child_nutrition_screening" ADD CONSTRAINT "child_nutrition_screening_meal_quality_id_fkey" FOREIGN KEY ("meal_quality_id") REFERENCES "lookup_meal_quality"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "center_feeding_month_summary" ADD CONSTRAINT "center_feeding_month_summary_food_source_id_fkey" FOREIGN KEY ("food_source_id") REFERENCES "lookup_food_source"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sted_assessment" ADD CONSTRAINT "sted_assessment_age_band_id_fkey" FOREIGN KEY ("age_band_id") REFERENCES "lookup_sted_age_band"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sted_milestone_result" ADD CONSTRAINT "sted_milestone_result_assessment_id_fkey" FOREIGN KEY ("assessment_id") REFERENCES "sted_assessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sted_physical_finding" ADD CONSTRAINT "sted_physical_finding_assessment_id_fkey" FOREIGN KEY ("assessment_id") REFERENCES "sted_assessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sted_outcome_summary" ADD CONSTRAINT "sted_outcome_summary_assessment_id_fkey" FOREIGN KEY ("assessment_id") REFERENCES "sted_assessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral" ADD CONSTRAINT "referral_source_type_id_fkey" FOREIGN KEY ("source_type_id") REFERENCES "lookup_referral_source_type"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral" ADD CONSTRAINT "referral_status_id_fkey" FOREIGN KEY ("status_id") REFERENCES "lookup_referral_status"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ecd_standard" ADD CONSTRAINT "ecd_standard_domain_id_fkey" FOREIGN KEY ("domain_id") REFERENCES "lookup_standard_domain"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_assessment" ADD CONSTRAINT "compliance_assessment_assessment_type_id_fkey" FOREIGN KEY ("assessment_type_id") REFERENCES "lookup_assessment_type"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_assessment" ADD CONSTRAINT "compliance_assessment_status_id_fkey" FOREIGN KEY ("status_id") REFERENCES "lookup_assessment_status"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_assessment" ADD CONSTRAINT "compliance_assessment_overall_classification_id_fkey" FOREIGN KEY ("overall_classification_id") REFERENCES "lookup_compliance_classification"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_assessment_item" ADD CONSTRAINT "compliance_assessment_item_response_id_fkey" FOREIGN KEY ("response_id") REFERENCES "lookup_item_response"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_assessment_item" ADD CONSTRAINT "compliance_assessment_item_gap_severity_id_fkey" FOREIGN KEY ("gap_severity_id") REFERENCES "lookup_gap_severity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_assessment_item" ADD CONSTRAINT "compliance_assessment_item_gap_status_id_fkey" FOREIGN KEY ("gap_status_id") REFERENCES "lookup_gap_status"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wash_indicator" ADD CONSTRAINT "wash_indicator_water_source_type_id_fkey" FOREIGN KEY ("water_source_type_id") REFERENCES "lookup_water_source_type"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parent_contribution" ADD CONSTRAINT "parent_contribution_contribution_type_id_fkey" FOREIGN KEY ("contribution_type_id") REFERENCES "lookup_parent_contribution_type"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parent_contribution" ADD CONSTRAINT "parent_contribution_item_type_id_fkey" FOREIGN KEY ("item_type_id") REFERENCES "lookup_in_kind_item_type"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "center_support" ADD CONSTRAINT "center_support_support_category_id_fkey" FOREIGN KEY ("support_category_id") REFERENCES "lookup_center_support_category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Seed lookup tables (Scenario C dual-write)
INSERT INTO "lookup_ecd_center_status" ("id", "code", "label_en", "sort_order") VALUES
  (gen_random_uuid(), 'active', 'Active', 1),
  (gen_random_uuid(), 'inactive', 'Inactive', 2) ON CONFLICT ("code") DO NOTHING;
INSERT INTO "lookup_compliance_classification" ("id", "code", "label_en", "sort_order") VALUES
  (gen_random_uuid(), 'compliant', 'Compliant', 1),
  (gen_random_uuid(), 'partially_compliant', 'Partially Compliant', 2),
  (gen_random_uuid(), 'non_compliant', 'Non-Compliant', 3) ON CONFLICT ("code") DO NOTHING;
INSERT INTO "lookup_administrative_level" ("id", "code", "label_en", "sort_order") VALUES
  (gen_random_uuid(), 'province', 'Province', 1),
  (gen_random_uuid(), 'sector', 'Sector', 2),
  (gen_random_uuid(), 'cell', 'Cell', 3),
  (gen_random_uuid(), 'village', 'Village', 4) ON CONFLICT ("code") DO NOTHING;
INSERT INTO "lookup_nutrition_status" ("id", "code", "label_en", "sort_order") VALUES
  (gen_random_uuid(), 'normal', 'Normal', 1),
  (gen_random_uuid(), 'at_risk', 'At Risk', 2),
  (gen_random_uuid(), 'moderate', 'Moderate', 3),
  (gen_random_uuid(), 'severe', 'Severe', 4) ON CONFLICT ("code") DO NOTHING;
INSERT INTO "lookup_assessment_type" ("id", "code", "label_en", "sort_order") VALUES
  (gen_random_uuid(), 'self_assessment', 'Self Assessment', 1),
  (gen_random_uuid(), 'supportive_supervision', 'Supportive Supervision', 2),
  (gen_random_uuid(), 'external_audit', 'External Audit', 3) ON CONFLICT ("code") DO NOTHING;
INSERT INTO "lookup_assessment_status" ("id", "code", "label_en", "sort_order") VALUES
  (gen_random_uuid(), 'draft', 'Draft', 1),
  (gen_random_uuid(), 'submitted', 'Submitted', 2),
  (gen_random_uuid(), 'verified', 'Verified', 3),
  (gen_random_uuid(), 'rejected', 'Rejected', 4) ON CONFLICT ("code") DO NOTHING;
INSERT INTO "lookup_item_response" ("id", "code", "label_en", "sort_order") VALUES
  (gen_random_uuid(), 'met', 'Met', 1),
  (gen_random_uuid(), 'partially_met', 'Partially Met', 2),
  (gen_random_uuid(), 'not_met', 'Not Met', 3),
  (gen_random_uuid(), 'not_applicable', 'Not Applicable', 4) ON CONFLICT ("code") DO NOTHING;
INSERT INTO "lookup_gap_severity" ("id", "code", "label_en", "sort_order") VALUES
  (gen_random_uuid(), 'low', 'Low', 1),
  (gen_random_uuid(), 'medium', 'Medium', 2),
  (gen_random_uuid(), 'high', 'High', 3) ON CONFLICT ("code") DO NOTHING;
INSERT INTO "lookup_gap_status" ("id", "code", "label_en", "sort_order") VALUES
  (gen_random_uuid(), 'open', 'Open', 1),
  (gen_random_uuid(), 'in_progress', 'In Progress', 2),
  (gen_random_uuid(), 'resolved', 'Resolved', 3) ON CONFLICT ("code") DO NOTHING;
INSERT INTO "lookup_standard_domain" ("id", "code", "label_en", "sort_order") VALUES
  (gen_random_uuid(), 'wash', 'WASH', 1),
  (gen_random_uuid(), 'safety', 'Safety', 2),
  (gen_random_uuid(), 'nutrition', 'Nutrition', 3),
  (gen_random_uuid(), 'learning_environment', 'Learning Environment', 4) ON CONFLICT ("code") DO NOTHING;
INSERT INTO "lookup_child_gender" ("id", "code", "label_en", "sort_order") VALUES
  (gen_random_uuid(), 'male', 'Male', 1),
  (gen_random_uuid(), 'female', 'Female', 2) ON CONFLICT ("code") DO NOTHING;
INSERT INTO "lookup_child_status" ("id", "code", "label_en", "sort_order") VALUES
  (gen_random_uuid(), 'active', 'Active', 1),
  (gen_random_uuid(), 'transferred', 'Transferred', 2),
  (gen_random_uuid(), 'archived', 'Archived', 3) ON CONFLICT ("code") DO NOTHING;
INSERT INTO "lookup_attendance_status" ("id", "code", "label_en", "sort_order") VALUES
  (gen_random_uuid(), 'present', 'Present', 1),
  (gen_random_uuid(), 'absent', 'Absent', 2) ON CONFLICT ("code") DO NOTHING;
INSERT INTO "lookup_absent_reason" ("id", "code", "label_en", "sort_order") VALUES
  (gen_random_uuid(), 'sick', 'Sick', 1),
  (gen_random_uuid(), 'family', 'Family', 2),
  (gen_random_uuid(), 'transport', 'Transport', 3),
  (gen_random_uuid(), 'weather', 'Weather', 4),
  (gen_random_uuid(), 'unknown', 'Unknown', 5),
  (gen_random_uuid(), 'other', 'Other', 6) ON CONFLICT ("code") DO NOTHING;
INSERT INTO "lookup_sted_age_band" ("id", "code", "label_en", "sort_order") VALUES
  (gen_random_uuid(), 'band_1_3', 'Band 1-3', 1),
  (gen_random_uuid(), 'band_4_6', 'Band 4-6', 2) ON CONFLICT ("code") DO NOTHING;
INSERT INTO "lookup_referral_source_type" ("id", "code", "label_en", "sort_order") VALUES
  (gen_random_uuid(), 'nutrition', 'Nutrition', 1),
  (gen_random_uuid(), 'sted', 'STED', 2) ON CONFLICT ("code") DO NOTHING;
INSERT INTO "lookup_referral_status" ("id", "code", "label_en", "sort_order") VALUES
  (gen_random_uuid(), 'pending', 'Pending', 1),
  (gen_random_uuid(), 'completed', 'Completed', 2),
  (gen_random_uuid(), 'cancelled', 'Cancelled', 3) ON CONFLICT ("code") DO NOTHING;
INSERT INTO "lookup_transfer_status" ("id", "code", "label_en", "sort_order") VALUES
  (gen_random_uuid(), 'pending', 'Pending', 1),
  (gen_random_uuid(), 'accepted', 'Accepted', 2),
  (gen_random_uuid(), 'cancelled', 'Cancelled', 3) ON CONFLICT ("code") DO NOTHING;
INSERT INTO "lookup_classroom_grade" ("id", "code", "label_en", "sort_order") VALUES
  (gen_random_uuid(), 'grade_1', 'Grade 1', 1),
  (gen_random_uuid(), 'grade_2', 'Grade 2', 2),
  (gen_random_uuid(), 'grade_3', 'Grade 3', 3) ON CONFLICT ("code") DO NOTHING;
INSERT INTO "lookup_parent_contribution_type" ("id", "code", "label_en", "sort_order") VALUES
  (gen_random_uuid(), 'cash', 'Cash', 1),
  (gen_random_uuid(), 'in_kind', 'In Kind', 2) ON CONFLICT ("code") DO NOTHING;
INSERT INTO "lookup_in_kind_item_type" ("id", "code", "label_en", "sort_order") VALUES
  (gen_random_uuid(), 'flour', 'Flour', 1),
  (gen_random_uuid(), 'potatoes', 'Potatoes', 2),
  (gen_random_uuid(), 'maize', 'Maize', 3),
  (gen_random_uuid(), 'milk', 'Milk', 4),
  (gen_random_uuid(), 'firewood', 'Firewood', 5),
  (gen_random_uuid(), 'other', 'Other', 6) ON CONFLICT ("code") DO NOTHING;
INSERT INTO "lookup_center_support_category" ("id", "code", "label_en", "sort_order") VALUES
  (gen_random_uuid(), 'food', 'Food', 1),
  (gen_random_uuid(), 'equipment', 'Equipment', 2),
  (gen_random_uuid(), 'other', 'Other', 3) ON CONFLICT ("code") DO NOTHING;

-- Backfill *_id from existing enum/string columns
UPDATE "ecd_center" e SET "status_id" = l."id" FROM "lookup_ecd_center_status" l WHERE l."code" = e."status"::text AND e."status_id" IS NULL;
UPDATE "ecd_center" e SET "current_compliance_level_id" = l."id" FROM "lookup_compliance_classification" l WHERE l."code" = e."current_compliance_level"::text AND e."current_compliance_level_id" IS NULL;
UPDATE "administrative_unit" a SET "level_id" = l."id" FROM "lookup_administrative_level" l WHERE l."code" = a."level"::text AND a."level_id" IS NULL;
UPDATE "child_nutrition_screening" c SET "nutrition_status_id" = l."id" FROM "lookup_nutrition_status" l WHERE l."code" = c."nutrition_status"::text AND c."nutrition_status_id" IS NULL;
UPDATE "compliance_assessment" c SET "assessment_type_id" = l."id" FROM "lookup_assessment_type" l WHERE l."code" = c."assessment_type"::text AND c."assessment_type_id" IS NULL;
UPDATE "compliance_assessment" c SET "status_id" = l."id" FROM "lookup_assessment_status" l WHERE l."code" = c."status"::text AND c."status_id" IS NULL;
UPDATE "compliance_assessment" c SET "overall_classification_id" = l."id" FROM "lookup_compliance_classification" l WHERE l."code" = c."overall_classification"::text AND c."overall_classification_id" IS NULL;
UPDATE "compliance_assessment_item" c SET "response_id" = l."id" FROM "lookup_item_response" l WHERE l."code" = c."response"::text AND c."response_id" IS NULL;
UPDATE "compliance_assessment_item" c SET "gap_severity_id" = l."id" FROM "lookup_gap_severity" l WHERE l."code" = c."gap_severity"::text AND c."gap_severity_id" IS NULL;
UPDATE "compliance_assessment_item" c SET "gap_status_id" = l."id" FROM "lookup_gap_status" l WHERE l."code" = c."gap_status"::text AND c."gap_status_id" IS NULL;
UPDATE "ecd_standard" e SET "domain_id" = l."id" FROM "lookup_standard_domain" l WHERE l."code" = e."domain"::text AND e."domain_id" IS NULL;
UPDATE "child" c SET "gender_id" = l."id" FROM "lookup_child_gender" l WHERE l."code" = c."gender"::text AND c."gender_id" IS NULL;
UPDATE "child" c SET "status_id" = l."id" FROM "lookup_child_status" l WHERE l."code" = c."status"::text AND c."status_id" IS NULL;
UPDATE "attendance_record" a SET "status_id" = l."id" FROM "lookup_attendance_status" l WHERE l."code" = a."status"::text AND a."status_id" IS NULL;
UPDATE "attendance_record" a SET "absent_reason_id" = l."id" FROM "lookup_absent_reason" l WHERE l."code" = a."absent_reason"::text AND a."absent_reason_id" IS NULL;
UPDATE "sted_assessment" s SET "age_band_id" = l."id" FROM "lookup_sted_age_band" l WHERE l."code" = s."age_band"::text AND s."age_band_id" IS NULL;
UPDATE "referral" r SET "source_type_id" = l."id" FROM "lookup_referral_source_type" l WHERE l."code" = r."source_type"::text AND r."source_type_id" IS NULL;
UPDATE "referral" r SET "status_id" = l."id" FROM "lookup_referral_status" l WHERE l."code" = r."status"::text AND r."status_id" IS NULL;
UPDATE "child_transfer" c SET "status_id" = l."id" FROM "lookup_transfer_status" l WHERE l."code" = c."status"::text AND c."status_id" IS NULL;
UPDATE "classroom" c SET "grade_id" = l."id" FROM "lookup_classroom_grade" l WHERE l."code" = c."grade"::text AND c."grade_id" IS NULL;
UPDATE "parent_contribution" p SET "contribution_type_id" = l."id" FROM "lookup_parent_contribution_type" l WHERE l."code" = p."contribution_type"::text AND p."contribution_type_id" IS NULL;
UPDATE "parent_contribution" p SET "item_type_id" = l."id" FROM "lookup_in_kind_item_type" l WHERE p."item_type" IS NOT NULL AND l."code" = p."item_type"::text AND p."item_type_id" IS NULL;
UPDATE "center_support" c SET "support_category_id" = l."id" FROM "lookup_center_support_category" l WHERE l."code" = c."support_category"::text AND c."support_category_id" IS NULL;

-- PostGIS: backfill geom, spatial indexes, lat/lon sync triggers
UPDATE "ecd_center" SET "geom" = ST_SetSRID(ST_MakePoint("longitude", "latitude"), 4326)
  WHERE "latitude" IS NOT NULL AND "longitude" IS NOT NULL AND "geom" IS NULL;
UPDATE "administrative_unit" SET "geom" = ST_SetSRID(ST_MakePoint("longitude", "latitude"), 4326)
  WHERE "latitude" IS NOT NULL AND "longitude" IS NOT NULL AND "geom" IS NULL;
CREATE INDEX IF NOT EXISTS "idx_ecd_center_geom" ON "ecd_center" USING GIST ("geom");
CREATE INDEX IF NOT EXISTS "idx_administrative_unit_geom" ON "administrative_unit" USING GIST ("geom");

CREATE OR REPLACE FUNCTION sync_point_geom() RETURNS trigger AS $$
BEGIN
  IF NEW.latitude IS NOT NULL AND NEW.longitude IS NOT NULL THEN
    NEW.geom := ST_SetSRID(ST_MakePoint(NEW.longitude, NEW.latitude), 4326);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ecd_center_geom ON "ecd_center";
CREATE TRIGGER trg_ecd_center_geom BEFORE INSERT OR UPDATE OF "latitude", "longitude"
  ON "ecd_center" FOR EACH ROW EXECUTE FUNCTION sync_point_geom();

DROP TRIGGER IF EXISTS trg_administrative_unit_geom ON "administrative_unit";
CREATE TRIGGER trg_administrative_unit_geom BEFORE INSERT OR UPDATE OF "latitude", "longitude"
  ON "administrative_unit" FOR EACH ROW EXECUTE FUNCTION sync_point_geom();

-- ArcGIS export views: run npm run gis:migrate:phase -- --phase 6 --through 9 after this migration
