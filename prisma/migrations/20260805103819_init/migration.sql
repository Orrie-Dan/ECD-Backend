-- CreateEnum
CREATE TYPE "ecd_center_status" AS ENUM ('active', 'inactive');

-- CreateEnum
CREATE TYPE "user_role" AS ENUM ('caregiver', 'district_focal_person', 'ncda_admin');

-- CreateEnum
CREATE TYPE "user_account_status" AS ENUM ('active', 'inactive');

-- CreateEnum
CREATE TYPE "child_gender" AS ENUM ('male', 'female');

-- CreateEnum
CREATE TYPE "child_status" AS ENUM ('active', 'transferred', 'archived');

-- CreateEnum
CREATE TYPE "attendance_status" AS ENUM ('present', 'absent');

-- CreateEnum
CREATE TYPE "absent_reason" AS ENUM ('sick', 'family', 'transport', 'weather', 'unknown', 'other');

-- CreateEnum
CREATE TYPE "nutrition_status" AS ENUM ('normal', 'at_risk', 'moderate', 'severe');

-- CreateEnum
CREATE TYPE "transfer_status" AS ENUM ('pending', 'accepted', 'cancelled');

-- CreateEnum
CREATE TYPE "sted_age_band" AS ENUM ('band_1_3', 'band_4_6');

-- CreateEnum
CREATE TYPE "referral_source_type" AS ENUM ('nutrition', 'sted');

-- CreateEnum
CREATE TYPE "referral_status" AS ENUM ('pending', 'completed', 'cancelled');

-- CreateEnum
CREATE TYPE "audit_action" AS ENUM ('create', 'update', 'delete');

-- CreateEnum
CREATE TYPE "assessment_type" AS ENUM ('self_assessment', 'supportive_supervision', 'external_audit');

-- CreateEnum
CREATE TYPE "assessment_status" AS ENUM ('draft', 'submitted', 'verified', 'rejected');

-- CreateEnum
CREATE TYPE "compliance_classification" AS ENUM ('compliant', 'partially_compliant', 'non_compliant');

-- CreateEnum
CREATE TYPE "item_response" AS ENUM ('met', 'partially_met', 'not_met', 'not_applicable');

-- CreateEnum
CREATE TYPE "gap_severity" AS ENUM ('low', 'medium', 'high');

-- CreateEnum
CREATE TYPE "gap_status" AS ENUM ('open', 'in_progress', 'resolved');

-- CreateEnum
CREATE TYPE "standard_domain" AS ENUM ('wash', 'safety', 'nutrition', 'learning_environment');

-- CreateEnum
CREATE TYPE "record_sync_status" AS ENUM ('synced', 'pending', 'conflict');

-- CreateEnum
CREATE TYPE "device_status" AS ENUM ('active', 'inactive');

-- CreateEnum
CREATE TYPE "sync_operation_status" AS ENUM ('pending', 'applied', 'conflict', 'failed');

-- CreateEnum
CREATE TYPE "sync_session_status" AS ENUM ('started', 'completed', 'failed');

-- CreateEnum
CREATE TYPE "administrative_level" AS ENUM ('province', 'sector', 'cell', 'village');

-- CreateTable
CREATE TABLE "administrative_unit" (
    "id" TEXT NOT NULL,
    "level" "administrative_level" NOT NULL,
    "parent_id" TEXT,
    "district_id" TEXT,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "latitude" DECIMAL(65,30),
    "longitude" DECIMAL(65,30),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "administrative_unit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "district" (
    "id" TEXT NOT NULL,
    "province_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "district_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ecd_center" (
    "id" TEXT NOT NULL,
    "district_id" TEXT NOT NULL,
    "village_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "capacity" INTEGER,
    "latitude" DECIMAL(65,30),
    "longitude" DECIMAL(65,30),
    "status" "ecd_center_status" NOT NULL DEFAULT 'active',
    "current_compliance_level" "compliance_classification",
    "current_compliance_assessed_at" DATE,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" TEXT,
    "deleted_at" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "sync_status" "record_sync_status" NOT NULL DEFAULT 'synced',
    "last_modified_by_device_id" TEXT,
    "last_modified_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ecd_center_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_account" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "role" "user_role" NOT NULL,
    "district_id" TEXT,
    "center_id" TEXT,
    "status" "user_account_status" NOT NULL DEFAULT 'active',
    "last_login_at" TIMESTAMP(3),
    "failed_login_attempts" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMP(3),
    "password_changed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" TEXT,

    CONSTRAINT "user_account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_reset_token" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_token_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "device_uuid" TEXT NOT NULL,
    "platform" TEXT,
    "app_version" TEXT,
    "status" "device_status" NOT NULL DEFAULT 'active',
    "last_sync_at" TIMESTAMP(3),
    "registered_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "device_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_session" (
    "id" TEXT NOT NULL,
    "device_id" TEXT NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "total_operations" INTEGER NOT NULL DEFAULT 0,
    "successful_operations" INTEGER NOT NULL DEFAULT 0,
    "failed_operations" INTEGER NOT NULL DEFAULT 0,
    "status" "sync_session_status" NOT NULL DEFAULT 'started',

    CONSTRAINT "sync_session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_operation" (
    "id" TEXT NOT NULL,
    "device_id" TEXT NOT NULL,
    "session_id" TEXT,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "local_id" TEXT,
    "operation" "audit_action" NOT NULL,
    "payload" JSONB,
    "status" "sync_operation_status" NOT NULL DEFAULT 'pending',
    "conflict_reason" TEXT,
    "client_timestamp" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMP(3),

    CONSTRAINT "sync_operation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "child" (
    "id" TEXT NOT NULL,
    "registration_number" TEXT NOT NULL,
    "first_name" TEXT NOT NULL,
    "middle_name" TEXT,
    "last_name" TEXT,
    "center_id" TEXT NOT NULL,
    "date_of_birth" DATE NOT NULL,
    "gender" "child_gender" NOT NULL,
    "status" "child_status" NOT NULL DEFAULT 'active',
    "special_needs" TEXT,
    "disability_notes" TEXT,
    "guardian_name" TEXT NOT NULL,
    "guardian_phone" TEXT NOT NULL,
    "guardian_relation" TEXT NOT NULL,
    "guardian2_name" TEXT,
    "guardian2_phone" TEXT,
    "guardian2_relation" TEXT,
    "home_village_id" TEXT NOT NULL,
    "registered_at" DATE NOT NULL,
    "archive_reason" TEXT,
    "archived_at" DATE,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" TEXT,
    "deleted_at" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "sync_status" "record_sync_status" NOT NULL DEFAULT 'synced',
    "last_modified_by_device_id" TEXT,
    "last_modified_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "child_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "child_transfer" (
    "id" TEXT NOT NULL,
    "child_id" TEXT NOT NULL,
    "from_center_id" TEXT NOT NULL,
    "to_center_id" TEXT NOT NULL,
    "transfer_date" DATE NOT NULL,
    "reason" TEXT NOT NULL,
    "notes" TEXT,
    "status" "transfer_status" NOT NULL DEFAULT 'pending',
    "initiated_by" TEXT NOT NULL,
    "accepted_at" TIMESTAMP(3),
    "accepted_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "sync_status" "record_sync_status" NOT NULL DEFAULT 'synced',
    "last_modified_by_device_id" TEXT,
    "last_modified_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "child_transfer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_record" (
    "id" TEXT NOT NULL,
    "child_id" TEXT NOT NULL,
    "center_id" TEXT NOT NULL,
    "attendance_date" DATE NOT NULL,
    "status" "attendance_status" NOT NULL,
    "brought_by" TEXT,
    "brought_by_other" TEXT,
    "arrived_at" TIMESTAMP(3),
    "absent_reason" "absent_reason",
    "notes" TEXT,
    "recorded_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" TEXT,
    "deleted_at" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "sync_status" "record_sync_status" NOT NULL DEFAULT 'synced',
    "last_modified_by_device_id" TEXT,
    "last_modified_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendance_record_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "child_nutrition_screening" (
    "id" TEXT NOT NULL,
    "child_id" TEXT NOT NULL,
    "screening_date" DATE NOT NULL,
    "weight_kg" DECIMAL(65,30) NOT NULL,
    "muac_cm" DECIMAL(65,30) NOT NULL,
    "height_cm" DECIMAL(65,30),
    "head_circumference_cm" DECIMAL(65,30),
    "nutrition_status" "nutrition_status" NOT NULL,
    "requires_referral" BOOLEAN NOT NULL DEFAULT false,
    "meal_quality" TEXT,
    "feeding_concern" BOOLEAN NOT NULL DEFAULT false,
    "diet_notes" TEXT,
    "recorded_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "sync_status" "record_sync_status" NOT NULL DEFAULT 'synced',
    "last_modified_by_device_id" TEXT,
    "last_modified_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "child_nutrition_screening_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "center_feeding_day" (
    "id" TEXT NOT NULL,
    "center_id" TEXT NOT NULL,
    "recorded_date" DATE NOT NULL,
    "milk_served" BOOLEAN NOT NULL DEFAULT false,
    "porridge_served" BOOLEAN NOT NULL DEFAULT false,
    "balanced_meal_served" BOOLEAN NOT NULL DEFAULT false,
    "cereals_or_tubers" BOOLEAN NOT NULL DEFAULT false,
    "legumes" BOOLEAN NOT NULL DEFAULT false,
    "dairy" BOOLEAN NOT NULL DEFAULT false,
    "animal_products" BOOLEAN NOT NULL DEFAULT false,
    "fruits_vegetables" BOOLEAN NOT NULL DEFAULT false,
    "added_fat" BOOLEAN NOT NULL DEFAULT false,
    "recorded_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "sync_status" "record_sync_status" NOT NULL DEFAULT 'synced',
    "last_modified_by_device_id" TEXT,
    "last_modified_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "center_feeding_day_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "center_feeding_month_summary" (
    "id" TEXT NOT NULL,
    "center_id" TEXT NOT NULL,
    "year_month" TEXT NOT NULL,
    "milk_liters" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "flour_kg" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "food_source" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" TEXT,
    "deleted_at" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "sync_status" "record_sync_status" NOT NULL DEFAULT 'synced',
    "last_modified_by_device_id" TEXT,
    "last_modified_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "center_feeding_month_summary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sted_assessment" (
    "id" TEXT NOT NULL,
    "child_id" TEXT NOT NULL,
    "center_id" TEXT NOT NULL,
    "assessment_date" DATE NOT NULL,
    "age_band" "sted_age_band" NOT NULL,
    "consent_obtained" BOOLEAN NOT NULL DEFAULT false,
    "physical_assessment" JSONB NOT NULL,
    "milestone_results" JSONB NOT NULL,
    "outcome" JSONB NOT NULL,
    "follow_up_in_6_months" BOOLEAN NOT NULL DEFAULT false,
    "follow_up_due_date" DATE,
    "notes" TEXT,
    "assessed_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "sync_status" "record_sync_status" NOT NULL DEFAULT 'synced',
    "last_modified_by_device_id" TEXT,
    "last_modified_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sted_assessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "referral" (
    "id" TEXT NOT NULL,
    "child_id" TEXT NOT NULL,
    "center_id" TEXT NOT NULL,
    "source_type" "referral_source_type" NOT NULL,
    "source_id" TEXT NOT NULL,
    "referral_date" DATE NOT NULL,
    "reason" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "status" "referral_status" NOT NULL DEFAULT 'pending',
    "implemented_at" DATE,
    "notes" TEXT,
    "recorded_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "sync_status" "record_sync_status" NOT NULL DEFAULT 'synced',
    "last_modified_by_device_id" TEXT,
    "last_modified_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "referral_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ecd_standard" (
    "id" TEXT NOT NULL,
    "domain" "standard_domain" NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "weight" DECIMAL(65,30),
    "version" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ecd_standard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compliance_assessment" (
    "id" TEXT NOT NULL,
    "center_id" TEXT NOT NULL,
    "standards_version" TEXT NOT NULL,
    "assessment_type" "assessment_type" NOT NULL,
    "assessment_date" DATE NOT NULL,
    "status" "assessment_status" NOT NULL DEFAULT 'draft',
    "submitted_by" TEXT,
    "submitted_at" TIMESTAMP(3),
    "verified_by" TEXT,
    "verified_at" TIMESTAMP(3),
    "overall_classification" "compliance_classification",
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "sync_status" "record_sync_status" NOT NULL DEFAULT 'synced',
    "last_modified_by_device_id" TEXT,
    "last_modified_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "compliance_assessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compliance_assessment_item" (
    "id" TEXT NOT NULL,
    "assessment_id" TEXT NOT NULL,
    "standard_id" TEXT NOT NULL,
    "response" "item_response" NOT NULL,
    "score" DECIMAL(65,30),
    "evidence_notes" TEXT,
    "gap_severity" "gap_severity",
    "gap_improvement_action" TEXT,
    "gap_target_date" DATE,
    "gap_status" "gap_status",
    "gap_resolved_at" DATE,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "sync_status" "record_sync_status" NOT NULL DEFAULT 'synced',
    "last_modified_by_device_id" TEXT,
    "last_modified_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "compliance_assessment_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wash_indicator" (
    "id" TEXT NOT NULL,
    "center_id" TEXT NOT NULL,
    "recorded_date" DATE NOT NULL,
    "water_source_available" BOOLEAN NOT NULL DEFAULT false,
    "water_source_type" TEXT,
    "sanitation_facility_available" BOOLEAN NOT NULL DEFAULT false,
    "latrine_count" INTEGER,
    "handwashing_facility_available" BOOLEAN NOT NULL DEFAULT false,
    "waste_management_available" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "recorded_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "sync_status" "record_sync_status" NOT NULL DEFAULT 'synced',
    "last_modified_by_device_id" TEXT,
    "last_modified_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wash_indicator_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_setting" (
    "id" TEXT NOT NULL,
    "district_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" TEXT,

    CONSTRAINT "app_setting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "action" "audit_action" NOT NULL,
    "changed_by" TEXT,
    "changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "old_values" JSONB,
    "new_values" JSONB,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "administrative_unit_parent_id_idx" ON "administrative_unit"("parent_id");

-- CreateIndex
CREATE INDEX "administrative_unit_district_id_idx" ON "administrative_unit"("district_id");

-- CreateIndex
CREATE UNIQUE INDEX "administrative_unit_level_code_key" ON "administrative_unit"("level", "code");

-- CreateIndex
CREATE UNIQUE INDEX "district_code_key" ON "district"("code");

-- CreateIndex
CREATE INDEX "district_code_idx" ON "district"("code");

-- CreateIndex
CREATE UNIQUE INDEX "ecd_center_code_key" ON "ecd_center"("code");

-- CreateIndex
CREATE INDEX "ecd_center_district_id_idx" ON "ecd_center"("district_id");

-- CreateIndex
CREATE INDEX "ecd_center_status_idx" ON "ecd_center"("status");

-- CreateIndex
CREATE INDEX "ecd_center_village_id_idx" ON "ecd_center"("village_id");

-- CreateIndex
CREATE INDEX "ecd_center_current_compliance_level_idx" ON "ecd_center"("current_compliance_level");

-- CreateIndex
CREATE INDEX "ecd_center_deleted_at_idx" ON "ecd_center"("deleted_at");

-- CreateIndex
CREATE INDEX "ecd_center_sync_status_idx" ON "ecd_center"("sync_status");

-- CreateIndex
CREATE INDEX "ecd_center_last_modified_at_idx" ON "ecd_center"("last_modified_at");

-- CreateIndex
CREATE INDEX "ecd_center_last_modified_by_device_id_idx" ON "ecd_center"("last_modified_by_device_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_account_username_key" ON "user_account"("username");

-- CreateIndex
CREATE INDEX "user_account_username_idx" ON "user_account"("username");

-- CreateIndex
CREATE INDEX "user_account_role_idx" ON "user_account"("role");

-- CreateIndex
CREATE INDEX "user_account_status_idx" ON "user_account"("status");

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_token_token_hash_key" ON "password_reset_token"("token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "device_device_uuid_key" ON "device"("device_uuid");

-- CreateIndex
CREATE INDEX "device_user_id_idx" ON "device"("user_id");

-- CreateIndex
CREATE INDEX "device_device_uuid_idx" ON "device"("device_uuid");

-- CreateIndex
CREATE INDEX "sync_session_device_id_idx" ON "sync_session"("device_id");

-- CreateIndex
CREATE INDEX "sync_session_status_idx" ON "sync_session"("status");

-- CreateIndex
CREATE INDEX "sync_operation_device_id_idx" ON "sync_operation"("device_id");

-- CreateIndex
CREATE INDEX "sync_operation_session_id_idx" ON "sync_operation"("session_id");

-- CreateIndex
CREATE INDEX "sync_operation_entity_type_entity_id_idx" ON "sync_operation"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "sync_operation_status_idx" ON "sync_operation"("status");

-- CreateIndex
CREATE UNIQUE INDEX "child_registration_number_key" ON "child"("registration_number");

-- CreateIndex
CREATE INDEX "child_center_id_idx" ON "child"("center_id");

-- CreateIndex
CREATE INDEX "child_status_idx" ON "child"("status");

-- CreateIndex
CREATE INDEX "child_first_name_idx" ON "child"("first_name");

-- CreateIndex
CREATE INDEX "child_last_name_idx" ON "child"("last_name");

-- CreateIndex
CREATE INDEX "child_registration_number_idx" ON "child"("registration_number");

-- CreateIndex
CREATE INDEX "child_home_village_id_idx" ON "child"("home_village_id");

-- CreateIndex
CREATE INDEX "child_deleted_at_idx" ON "child"("deleted_at");

-- CreateIndex
CREATE INDEX "child_sync_status_idx" ON "child"("sync_status");

-- CreateIndex
CREATE INDEX "child_last_modified_at_idx" ON "child"("last_modified_at");

-- CreateIndex
CREATE INDEX "child_last_modified_by_device_id_idx" ON "child"("last_modified_by_device_id");

-- CreateIndex
CREATE INDEX "child_transfer_child_id_idx" ON "child_transfer"("child_id");

-- CreateIndex
CREATE INDEX "child_transfer_from_center_id_idx" ON "child_transfer"("from_center_id");

-- CreateIndex
CREATE INDEX "child_transfer_to_center_id_idx" ON "child_transfer"("to_center_id");

-- CreateIndex
CREATE INDEX "child_transfer_transfer_date_idx" ON "child_transfer"("transfer_date");

-- CreateIndex
CREATE INDEX "child_transfer_status_idx" ON "child_transfer"("status");

-- CreateIndex
CREATE INDEX "child_transfer_initiated_by_idx" ON "child_transfer"("initiated_by");

-- CreateIndex
CREATE INDEX "child_transfer_accepted_by_idx" ON "child_transfer"("accepted_by");

-- CreateIndex
CREATE INDEX "child_transfer_deleted_at_idx" ON "child_transfer"("deleted_at");

-- CreateIndex
CREATE INDEX "child_transfer_sync_status_idx" ON "child_transfer"("sync_status");

-- CreateIndex
CREATE INDEX "child_transfer_last_modified_at_idx" ON "child_transfer"("last_modified_at");

-- CreateIndex
CREATE INDEX "child_transfer_last_modified_by_device_id_idx" ON "child_transfer"("last_modified_by_device_id");

-- CreateIndex
CREATE INDEX "attendance_record_center_id_attendance_date_idx" ON "attendance_record"("center_id", "attendance_date");

-- CreateIndex
CREATE INDEX "attendance_record_recorded_by_idx" ON "attendance_record"("recorded_by");

-- CreateIndex
CREATE INDEX "attendance_record_deleted_at_idx" ON "attendance_record"("deleted_at");

-- CreateIndex
CREATE INDEX "attendance_record_sync_status_idx" ON "attendance_record"("sync_status");

-- CreateIndex
CREATE INDEX "attendance_record_last_modified_at_idx" ON "attendance_record"("last_modified_at");

-- CreateIndex
CREATE INDEX "attendance_record_last_modified_by_device_id_idx" ON "attendance_record"("last_modified_by_device_id");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_record_child_id_attendance_date_key" ON "attendance_record"("child_id", "attendance_date");

-- CreateIndex
CREATE INDEX "child_nutrition_screening_child_id_screening_date_idx" ON "child_nutrition_screening"("child_id", "screening_date");

-- CreateIndex
CREATE INDEX "child_nutrition_screening_nutrition_status_idx" ON "child_nutrition_screening"("nutrition_status");

-- CreateIndex
CREATE INDEX "child_nutrition_screening_requires_referral_idx" ON "child_nutrition_screening"("requires_referral");

-- CreateIndex
CREATE INDEX "child_nutrition_screening_recorded_by_idx" ON "child_nutrition_screening"("recorded_by");

-- CreateIndex
CREATE INDEX "child_nutrition_screening_deleted_at_idx" ON "child_nutrition_screening"("deleted_at");

-- CreateIndex
CREATE INDEX "child_nutrition_screening_sync_status_idx" ON "child_nutrition_screening"("sync_status");

-- CreateIndex
CREATE INDEX "child_nutrition_screening_last_modified_at_idx" ON "child_nutrition_screening"("last_modified_at");

-- CreateIndex
CREATE INDEX "child_nutrition_screening_last_modified_by_device_id_idx" ON "child_nutrition_screening"("last_modified_by_device_id");

-- CreateIndex
CREATE INDEX "center_feeding_day_recorded_by_idx" ON "center_feeding_day"("recorded_by");

-- CreateIndex
CREATE INDEX "center_feeding_day_deleted_at_idx" ON "center_feeding_day"("deleted_at");

-- CreateIndex
CREATE INDEX "center_feeding_day_sync_status_idx" ON "center_feeding_day"("sync_status");

-- CreateIndex
CREATE INDEX "center_feeding_day_last_modified_at_idx" ON "center_feeding_day"("last_modified_at");

-- CreateIndex
CREATE INDEX "center_feeding_day_last_modified_by_device_id_idx" ON "center_feeding_day"("last_modified_by_device_id");

-- CreateIndex
CREATE UNIQUE INDEX "center_feeding_day_center_id_recorded_date_key" ON "center_feeding_day"("center_id", "recorded_date");

-- CreateIndex
CREATE INDEX "center_feeding_month_summary_updated_by_idx" ON "center_feeding_month_summary"("updated_by");

-- CreateIndex
CREATE INDEX "center_feeding_month_summary_deleted_at_idx" ON "center_feeding_month_summary"("deleted_at");

-- CreateIndex
CREATE INDEX "center_feeding_month_summary_sync_status_idx" ON "center_feeding_month_summary"("sync_status");

-- CreateIndex
CREATE INDEX "center_feeding_month_summary_last_modified_at_idx" ON "center_feeding_month_summary"("last_modified_at");

-- CreateIndex
CREATE INDEX "center_feeding_month_summary_last_modified_by_device_id_idx" ON "center_feeding_month_summary"("last_modified_by_device_id");

-- CreateIndex
CREATE UNIQUE INDEX "center_feeding_month_summary_center_id_year_month_key" ON "center_feeding_month_summary"("center_id", "year_month");

-- CreateIndex
CREATE INDEX "sted_assessment_child_id_assessment_date_idx" ON "sted_assessment"("child_id", "assessment_date");

-- CreateIndex
CREATE INDEX "sted_assessment_center_id_idx" ON "sted_assessment"("center_id");

-- CreateIndex
CREATE INDEX "sted_assessment_age_band_idx" ON "sted_assessment"("age_band");

-- CreateIndex
CREATE INDEX "sted_assessment_assessed_by_idx" ON "sted_assessment"("assessed_by");

-- CreateIndex
CREATE INDEX "sted_assessment_follow_up_due_date_idx" ON "sted_assessment"("follow_up_due_date");

-- CreateIndex
CREATE INDEX "sted_assessment_deleted_at_idx" ON "sted_assessment"("deleted_at");

-- CreateIndex
CREATE INDEX "sted_assessment_sync_status_idx" ON "sted_assessment"("sync_status");

-- CreateIndex
CREATE INDEX "sted_assessment_last_modified_at_idx" ON "sted_assessment"("last_modified_at");

-- CreateIndex
CREATE INDEX "sted_assessment_last_modified_by_device_id_idx" ON "sted_assessment"("last_modified_by_device_id");

-- CreateIndex
CREATE INDEX "referral_child_id_idx" ON "referral"("child_id");

-- CreateIndex
CREATE INDEX "referral_center_id_idx" ON "referral"("center_id");

-- CreateIndex
CREATE INDEX "referral_source_type_source_id_idx" ON "referral"("source_type", "source_id");

-- CreateIndex
CREATE INDEX "referral_referral_date_idx" ON "referral"("referral_date");

-- CreateIndex
CREATE INDEX "referral_status_idx" ON "referral"("status");

-- CreateIndex
CREATE INDEX "referral_recorded_by_idx" ON "referral"("recorded_by");

-- CreateIndex
CREATE INDEX "referral_deleted_at_idx" ON "referral"("deleted_at");

-- CreateIndex
CREATE INDEX "referral_sync_status_idx" ON "referral"("sync_status");

-- CreateIndex
CREATE INDEX "referral_last_modified_at_idx" ON "referral"("last_modified_at");

-- CreateIndex
CREATE INDEX "referral_last_modified_by_device_id_idx" ON "referral"("last_modified_by_device_id");

-- CreateIndex
CREATE UNIQUE INDEX "ecd_standard_code_key" ON "ecd_standard"("code");

-- CreateIndex
CREATE INDEX "ecd_standard_domain_idx" ON "ecd_standard"("domain");

-- CreateIndex
CREATE INDEX "ecd_standard_version_idx" ON "ecd_standard"("version");

-- CreateIndex
CREATE INDEX "compliance_assessment_center_id_assessment_date_idx" ON "compliance_assessment"("center_id", "assessment_date");

-- CreateIndex
CREATE INDEX "compliance_assessment_status_idx" ON "compliance_assessment"("status");

-- CreateIndex
CREATE INDEX "compliance_assessment_submitted_by_idx" ON "compliance_assessment"("submitted_by");

-- CreateIndex
CREATE INDEX "compliance_assessment_verified_by_idx" ON "compliance_assessment"("verified_by");

-- CreateIndex
CREATE INDEX "compliance_assessment_deleted_at_idx" ON "compliance_assessment"("deleted_at");

-- CreateIndex
CREATE INDEX "compliance_assessment_sync_status_idx" ON "compliance_assessment"("sync_status");

-- CreateIndex
CREATE INDEX "compliance_assessment_last_modified_at_idx" ON "compliance_assessment"("last_modified_at");

-- CreateIndex
CREATE INDEX "compliance_assessment_last_modified_by_device_id_idx" ON "compliance_assessment"("last_modified_by_device_id");

-- CreateIndex
CREATE INDEX "compliance_assessment_item_standard_id_idx" ON "compliance_assessment_item"("standard_id");

-- CreateIndex
CREATE INDEX "compliance_assessment_item_gap_status_idx" ON "compliance_assessment_item"("gap_status");

-- CreateIndex
CREATE INDEX "compliance_assessment_item_deleted_at_idx" ON "compliance_assessment_item"("deleted_at");

-- CreateIndex
CREATE INDEX "compliance_assessment_item_sync_status_idx" ON "compliance_assessment_item"("sync_status");

-- CreateIndex
CREATE INDEX "compliance_assessment_item_last_modified_at_idx" ON "compliance_assessment_item"("last_modified_at");

-- CreateIndex
CREATE INDEX "compliance_assessment_item_last_modified_by_device_id_idx" ON "compliance_assessment_item"("last_modified_by_device_id");

-- CreateIndex
CREATE UNIQUE INDEX "compliance_assessment_item_assessment_id_standard_id_key" ON "compliance_assessment_item"("assessment_id", "standard_id");

-- CreateIndex
CREATE INDEX "wash_indicator_center_id_recorded_date_idx" ON "wash_indicator"("center_id", "recorded_date");

-- CreateIndex
CREATE INDEX "wash_indicator_recorded_by_idx" ON "wash_indicator"("recorded_by");

-- CreateIndex
CREATE INDEX "wash_indicator_deleted_at_idx" ON "wash_indicator"("deleted_at");

-- CreateIndex
CREATE INDEX "wash_indicator_sync_status_idx" ON "wash_indicator"("sync_status");

-- CreateIndex
CREATE INDEX "wash_indicator_last_modified_at_idx" ON "wash_indicator"("last_modified_at");

-- CreateIndex
CREATE INDEX "wash_indicator_last_modified_by_device_id_idx" ON "wash_indicator"("last_modified_by_device_id");

-- CreateIndex
CREATE UNIQUE INDEX "app_setting_district_id_key_key" ON "app_setting"("district_id", "key");

-- CreateIndex
CREATE INDEX "audit_log_entity_type_entity_id_idx" ON "audit_log"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_log_changed_at_idx" ON "audit_log"("changed_at");

-- AddForeignKey
ALTER TABLE "administrative_unit" ADD CONSTRAINT "administrative_unit_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "administrative_unit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "administrative_unit" ADD CONSTRAINT "administrative_unit_district_id_fkey" FOREIGN KEY ("district_id") REFERENCES "district"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "district" ADD CONSTRAINT "district_province_id_fkey" FOREIGN KEY ("province_id") REFERENCES "administrative_unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ecd_center" ADD CONSTRAINT "ecd_center_district_id_fkey" FOREIGN KEY ("district_id") REFERENCES "district"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ecd_center" ADD CONSTRAINT "ecd_center_village_id_fkey" FOREIGN KEY ("village_id") REFERENCES "administrative_unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ecd_center" ADD CONSTRAINT "ecd_center_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "user_account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ecd_center" ADD CONSTRAINT "ecd_center_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "user_account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ecd_center" ADD CONSTRAINT "ecd_center_last_modified_by_device_id_fkey" FOREIGN KEY ("last_modified_by_device_id") REFERENCES "device"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_account" ADD CONSTRAINT "user_account_district_id_fkey" FOREIGN KEY ("district_id") REFERENCES "district"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_account" ADD CONSTRAINT "user_account_center_id_fkey" FOREIGN KEY ("center_id") REFERENCES "ecd_center"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_account" ADD CONSTRAINT "user_account_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "user_account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_account" ADD CONSTRAINT "user_account_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "user_account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_reset_token" ADD CONSTRAINT "password_reset_token_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device" ADD CONSTRAINT "device_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_session" ADD CONSTRAINT "sync_session_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "device"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_operation" ADD CONSTRAINT "sync_operation_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "device"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_operation" ADD CONSTRAINT "sync_operation_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sync_session"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "child" ADD CONSTRAINT "child_center_id_fkey" FOREIGN KEY ("center_id") REFERENCES "ecd_center"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "child" ADD CONSTRAINT "child_home_village_id_fkey" FOREIGN KEY ("home_village_id") REFERENCES "administrative_unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "child" ADD CONSTRAINT "child_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "user_account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "child" ADD CONSTRAINT "child_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "user_account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "child" ADD CONSTRAINT "child_last_modified_by_device_id_fkey" FOREIGN KEY ("last_modified_by_device_id") REFERENCES "device"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "child_transfer" ADD CONSTRAINT "child_transfer_child_id_fkey" FOREIGN KEY ("child_id") REFERENCES "child"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "child_transfer" ADD CONSTRAINT "child_transfer_from_center_id_fkey" FOREIGN KEY ("from_center_id") REFERENCES "ecd_center"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "child_transfer" ADD CONSTRAINT "child_transfer_to_center_id_fkey" FOREIGN KEY ("to_center_id") REFERENCES "ecd_center"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "child_transfer" ADD CONSTRAINT "child_transfer_initiated_by_fkey" FOREIGN KEY ("initiated_by") REFERENCES "user_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "child_transfer" ADD CONSTRAINT "child_transfer_accepted_by_fkey" FOREIGN KEY ("accepted_by") REFERENCES "user_account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "child_transfer" ADD CONSTRAINT "child_transfer_last_modified_by_device_id_fkey" FOREIGN KEY ("last_modified_by_device_id") REFERENCES "device"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_record" ADD CONSTRAINT "attendance_record_child_id_fkey" FOREIGN KEY ("child_id") REFERENCES "child"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_record" ADD CONSTRAINT "attendance_record_center_id_fkey" FOREIGN KEY ("center_id") REFERENCES "ecd_center"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_record" ADD CONSTRAINT "attendance_record_recorded_by_fkey" FOREIGN KEY ("recorded_by") REFERENCES "user_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_record" ADD CONSTRAINT "attendance_record_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "user_account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_record" ADD CONSTRAINT "attendance_record_last_modified_by_device_id_fkey" FOREIGN KEY ("last_modified_by_device_id") REFERENCES "device"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "child_nutrition_screening" ADD CONSTRAINT "child_nutrition_screening_child_id_fkey" FOREIGN KEY ("child_id") REFERENCES "child"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "child_nutrition_screening" ADD CONSTRAINT "child_nutrition_screening_recorded_by_fkey" FOREIGN KEY ("recorded_by") REFERENCES "user_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "child_nutrition_screening" ADD CONSTRAINT "child_nutrition_screening_last_modified_by_device_id_fkey" FOREIGN KEY ("last_modified_by_device_id") REFERENCES "device"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "center_feeding_day" ADD CONSTRAINT "center_feeding_day_center_id_fkey" FOREIGN KEY ("center_id") REFERENCES "ecd_center"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "center_feeding_day" ADD CONSTRAINT "center_feeding_day_recorded_by_fkey" FOREIGN KEY ("recorded_by") REFERENCES "user_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "center_feeding_day" ADD CONSTRAINT "center_feeding_day_last_modified_by_device_id_fkey" FOREIGN KEY ("last_modified_by_device_id") REFERENCES "device"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "center_feeding_month_summary" ADD CONSTRAINT "center_feeding_month_summary_center_id_fkey" FOREIGN KEY ("center_id") REFERENCES "ecd_center"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "center_feeding_month_summary" ADD CONSTRAINT "center_feeding_month_summary_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "user_account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "center_feeding_month_summary" ADD CONSTRAINT "center_feeding_month_summary_last_modified_by_device_id_fkey" FOREIGN KEY ("last_modified_by_device_id") REFERENCES "device"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sted_assessment" ADD CONSTRAINT "sted_assessment_child_id_fkey" FOREIGN KEY ("child_id") REFERENCES "child"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sted_assessment" ADD CONSTRAINT "sted_assessment_center_id_fkey" FOREIGN KEY ("center_id") REFERENCES "ecd_center"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sted_assessment" ADD CONSTRAINT "sted_assessment_assessed_by_fkey" FOREIGN KEY ("assessed_by") REFERENCES "user_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sted_assessment" ADD CONSTRAINT "sted_assessment_last_modified_by_device_id_fkey" FOREIGN KEY ("last_modified_by_device_id") REFERENCES "device"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral" ADD CONSTRAINT "referral_child_id_fkey" FOREIGN KEY ("child_id") REFERENCES "child"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral" ADD CONSTRAINT "referral_center_id_fkey" FOREIGN KEY ("center_id") REFERENCES "ecd_center"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral" ADD CONSTRAINT "referral_recorded_by_fkey" FOREIGN KEY ("recorded_by") REFERENCES "user_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral" ADD CONSTRAINT "referral_last_modified_by_device_id_fkey" FOREIGN KEY ("last_modified_by_device_id") REFERENCES "device"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_assessment" ADD CONSTRAINT "compliance_assessment_center_id_fkey" FOREIGN KEY ("center_id") REFERENCES "ecd_center"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_assessment" ADD CONSTRAINT "compliance_assessment_submitted_by_fkey" FOREIGN KEY ("submitted_by") REFERENCES "user_account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_assessment" ADD CONSTRAINT "compliance_assessment_verified_by_fkey" FOREIGN KEY ("verified_by") REFERENCES "user_account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_assessment" ADD CONSTRAINT "compliance_assessment_last_modified_by_device_id_fkey" FOREIGN KEY ("last_modified_by_device_id") REFERENCES "device"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_assessment_item" ADD CONSTRAINT "compliance_assessment_item_assessment_id_fkey" FOREIGN KEY ("assessment_id") REFERENCES "compliance_assessment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_assessment_item" ADD CONSTRAINT "compliance_assessment_item_standard_id_fkey" FOREIGN KEY ("standard_id") REFERENCES "ecd_standard"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_assessment_item" ADD CONSTRAINT "compliance_assessment_item_last_modified_by_device_id_fkey" FOREIGN KEY ("last_modified_by_device_id") REFERENCES "device"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wash_indicator" ADD CONSTRAINT "wash_indicator_center_id_fkey" FOREIGN KEY ("center_id") REFERENCES "ecd_center"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wash_indicator" ADD CONSTRAINT "wash_indicator_recorded_by_fkey" FOREIGN KEY ("recorded_by") REFERENCES "user_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wash_indicator" ADD CONSTRAINT "wash_indicator_last_modified_by_device_id_fkey" FOREIGN KEY ("last_modified_by_device_id") REFERENCES "device"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_setting" ADD CONSTRAINT "app_setting_district_id_fkey" FOREIGN KEY ("district_id") REFERENCES "district"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_setting" ADD CONSTRAINT "app_setting_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "user_account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_changed_by_fkey" FOREIGN KEY ("changed_by") REFERENCES "user_account"("id") ON DELETE SET NULL ON UPDATE CASCADE;
