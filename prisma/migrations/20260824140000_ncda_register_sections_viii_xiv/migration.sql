-- CreateEnum
CREATE TYPE "person_sex" AS ENUM ('male', 'female');

-- CreateEnum
CREATE TYPE "education_level" AS ENUM ('none', 'primary', 'secondary', 'vocational', 'diploma', 'bachelor', 'postgraduate', 'other');

-- CreateEnum
CREATE TYPE "parent_contribution_type" AS ENUM ('cash', 'in_kind');

-- CreateEnum
CREATE TYPE "in_kind_item_type" AS ENUM ('flour', 'potatoes', 'maize', 'milk', 'firewood', 'other');

-- CreateEnum
CREATE TYPE "center_support_category" AS ENUM ('food', 'equipment', 'other');

-- AlterTable
ALTER TABLE "user_account" ADD COLUMN "gender" "person_sex",
ADD COLUMN "education_level" "education_level";

-- CreateTable
CREATE TABLE "parent_contribution" (
    "id" TEXT NOT NULL,
    "center_id" TEXT NOT NULL,
    "child_id" TEXT,
    "contributor_name" TEXT NOT NULL,
    "contributor_phone" TEXT,
    "contribution_date" DATE NOT NULL,
    "contribution_type" "parent_contribution_type" NOT NULL,
    "amount" DECIMAL(14,2),
    "item_type" "in_kind_item_type",
    "quantity" DECIMAL(14,3),
    "unit" TEXT,
    "description" TEXT,
    "notes" TEXT,
    "recorded_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "sync_status" "record_sync_status" NOT NULL DEFAULT 'synced',
    "last_modified_by_device_id" TEXT,
    "last_modified_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "parent_contribution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "parenting_session" (
    "id" TEXT NOT NULL,
    "center_id" TEXT NOT NULL,
    "session_date" DATE NOT NULL,
    "topic" TEXT NOT NULL,
    "facilitator_name" TEXT NOT NULL,
    "facilitator_role" TEXT,
    "facilitator_user_id" TEXT,
    "message_summary" TEXT NOT NULL,
    "male_attendees" INTEGER NOT NULL,
    "female_attendees" INTEGER NOT NULL,
    "notes" TEXT,
    "recorded_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "sync_status" "record_sync_status" NOT NULL DEFAULT 'synced',
    "last_modified_by_device_id" TEXT,
    "last_modified_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "parenting_session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ecd_committee_member" (
    "id" TEXT NOT NULL,
    "center_id" TEXT NOT NULL,
    "user_id" TEXT,
    "full_name" TEXT NOT NULL,
    "position" TEXT NOT NULL,
    "phone" TEXT,
    "start_date" DATE,
    "end_date" DATE,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "recorded_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "sync_status" "record_sync_status" NOT NULL DEFAULT 'synced',
    "last_modified_by_device_id" TEXT,
    "last_modified_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ecd_committee_member_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "center_support" (
    "id" TEXT NOT NULL,
    "center_id" TEXT NOT NULL,
    "received_date" DATE NOT NULL,
    "support_category" "center_support_category" NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(14,3),
    "unit" TEXT,
    "provider_name" TEXT NOT NULL,
    "provider_organization" TEXT,
    "received_by" TEXT,
    "received_by_name" TEXT,
    "notes" TEXT,
    "recorded_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "sync_status" "record_sync_status" NOT NULL DEFAULT 'synced',
    "last_modified_by_device_id" TEXT,
    "last_modified_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "center_support_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "center_visit" (
    "id" TEXT NOT NULL,
    "center_id" TEXT NOT NULL,
    "visit_date" DATE NOT NULL,
    "visitor_name" TEXT NOT NULL,
    "organization" TEXT,
    "occupation_or_role" TEXT,
    "purpose_or_message" TEXT NOT NULL,
    "hosted_by" TEXT,
    "notes" TEXT,
    "recorded_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "sync_status" "record_sync_status" NOT NULL DEFAULT 'synced',
    "last_modified_by_device_id" TEXT,
    "last_modified_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "center_visit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_training" (
    "id" TEXT NOT NULL,
    "center_id" TEXT NOT NULL,
    "trainee_user_id" TEXT,
    "trainee_name" TEXT NOT NULL,
    "trainee_role" TEXT NOT NULL,
    "training_date" DATE NOT NULL,
    "training_provider" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "duration_days" INTEGER NOT NULL,
    "certificate_received" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "recorded_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "sync_status" "record_sync_status" NOT NULL DEFAULT 'synced',
    "last_modified_by_device_id" TEXT,
    "last_modified_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_training_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "parent_contribution_center_id_contribution_date_idx" ON "parent_contribution"("center_id", "contribution_date");

-- CreateIndex
CREATE INDEX "parent_contribution_center_id_contribution_type_idx" ON "parent_contribution"("center_id", "contribution_type");

-- CreateIndex
CREATE INDEX "parent_contribution_child_id_idx" ON "parent_contribution"("child_id");

-- CreateIndex
CREATE INDEX "parent_contribution_recorded_by_idx" ON "parent_contribution"("recorded_by");

-- CreateIndex
CREATE INDEX "parent_contribution_deleted_at_idx" ON "parent_contribution"("deleted_at");

-- CreateIndex
CREATE INDEX "parent_contribution_sync_status_idx" ON "parent_contribution"("sync_status");

-- CreateIndex
CREATE INDEX "parent_contribution_last_modified_at_idx" ON "parent_contribution"("last_modified_at");

-- CreateIndex
CREATE INDEX "parent_contribution_last_modified_by_device_id_idx" ON "parent_contribution"("last_modified_by_device_id");

-- CreateIndex
CREATE INDEX "parenting_session_center_id_session_date_idx" ON "parenting_session"("center_id", "session_date");

-- CreateIndex
CREATE INDEX "parenting_session_facilitator_user_id_idx" ON "parenting_session"("facilitator_user_id");

-- CreateIndex
CREATE INDEX "parenting_session_recorded_by_idx" ON "parenting_session"("recorded_by");

-- CreateIndex
CREATE INDEX "parenting_session_deleted_at_idx" ON "parenting_session"("deleted_at");

-- CreateIndex
CREATE INDEX "parenting_session_sync_status_idx" ON "parenting_session"("sync_status");

-- CreateIndex
CREATE INDEX "parenting_session_last_modified_at_idx" ON "parenting_session"("last_modified_at");

-- CreateIndex
CREATE INDEX "parenting_session_last_modified_by_device_id_idx" ON "parenting_session"("last_modified_by_device_id");

-- CreateIndex
CREATE INDEX "ecd_committee_member_center_id_is_active_idx" ON "ecd_committee_member"("center_id", "is_active");

-- CreateIndex
CREATE INDEX "ecd_committee_member_user_id_idx" ON "ecd_committee_member"("user_id");

-- CreateIndex
CREATE INDEX "ecd_committee_member_recorded_by_idx" ON "ecd_committee_member"("recorded_by");

-- CreateIndex
CREATE INDEX "ecd_committee_member_deleted_at_idx" ON "ecd_committee_member"("deleted_at");

-- CreateIndex
CREATE INDEX "ecd_committee_member_sync_status_idx" ON "ecd_committee_member"("sync_status");

-- CreateIndex
CREATE INDEX "ecd_committee_member_last_modified_at_idx" ON "ecd_committee_member"("last_modified_at");

-- CreateIndex
CREATE INDEX "ecd_committee_member_last_modified_by_device_id_idx" ON "ecd_committee_member"("last_modified_by_device_id");

-- CreateIndex
CREATE INDEX "center_support_center_id_received_date_idx" ON "center_support"("center_id", "received_date");

-- CreateIndex
CREATE INDEX "center_support_support_category_idx" ON "center_support"("support_category");

-- CreateIndex
CREATE INDEX "center_support_recorded_by_idx" ON "center_support"("recorded_by");

-- CreateIndex
CREATE INDEX "center_support_received_by_idx" ON "center_support"("received_by");

-- CreateIndex
CREATE INDEX "center_support_deleted_at_idx" ON "center_support"("deleted_at");

-- CreateIndex
CREATE INDEX "center_support_sync_status_idx" ON "center_support"("sync_status");

-- CreateIndex
CREATE INDEX "center_support_last_modified_at_idx" ON "center_support"("last_modified_at");

-- CreateIndex
CREATE INDEX "center_support_last_modified_by_device_id_idx" ON "center_support"("last_modified_by_device_id");

-- CreateIndex
CREATE INDEX "center_visit_center_id_visit_date_idx" ON "center_visit"("center_id", "visit_date");

-- CreateIndex
CREATE INDEX "center_visit_hosted_by_idx" ON "center_visit"("hosted_by");

-- CreateIndex
CREATE INDEX "center_visit_recorded_by_idx" ON "center_visit"("recorded_by");

-- CreateIndex
CREATE INDEX "center_visit_deleted_at_idx" ON "center_visit"("deleted_at");

-- CreateIndex
CREATE INDEX "center_visit_sync_status_idx" ON "center_visit"("sync_status");

-- CreateIndex
CREATE INDEX "center_visit_last_modified_at_idx" ON "center_visit"("last_modified_at");

-- CreateIndex
CREATE INDEX "center_visit_last_modified_by_device_id_idx" ON "center_visit"("last_modified_by_device_id");

-- CreateIndex
CREATE INDEX "staff_training_center_id_training_date_idx" ON "staff_training"("center_id", "training_date");

-- CreateIndex
CREATE INDEX "staff_training_trainee_user_id_idx" ON "staff_training"("trainee_user_id");

-- CreateIndex
CREATE INDEX "staff_training_recorded_by_idx" ON "staff_training"("recorded_by");

-- CreateIndex
CREATE INDEX "staff_training_deleted_at_idx" ON "staff_training"("deleted_at");

-- CreateIndex
CREATE INDEX "staff_training_sync_status_idx" ON "staff_training"("sync_status");

-- CreateIndex
CREATE INDEX "staff_training_last_modified_at_idx" ON "staff_training"("last_modified_at");

-- CreateIndex
CREATE INDEX "staff_training_last_modified_by_device_id_idx" ON "staff_training"("last_modified_by_device_id");

-- AddForeignKey
ALTER TABLE "parent_contribution" ADD CONSTRAINT "parent_contribution_center_id_fkey" FOREIGN KEY ("center_id") REFERENCES "ecd_center"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parent_contribution" ADD CONSTRAINT "parent_contribution_child_id_fkey" FOREIGN KEY ("child_id") REFERENCES "child"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parent_contribution" ADD CONSTRAINT "parent_contribution_recorded_by_fkey" FOREIGN KEY ("recorded_by") REFERENCES "user_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parent_contribution" ADD CONSTRAINT "parent_contribution_last_modified_by_device_id_fkey" FOREIGN KEY ("last_modified_by_device_id") REFERENCES "device"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parenting_session" ADD CONSTRAINT "parenting_session_center_id_fkey" FOREIGN KEY ("center_id") REFERENCES "ecd_center"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parenting_session" ADD CONSTRAINT "parenting_session_facilitator_user_id_fkey" FOREIGN KEY ("facilitator_user_id") REFERENCES "user_account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parenting_session" ADD CONSTRAINT "parenting_session_recorded_by_fkey" FOREIGN KEY ("recorded_by") REFERENCES "user_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parenting_session" ADD CONSTRAINT "parenting_session_last_modified_by_device_id_fkey" FOREIGN KEY ("last_modified_by_device_id") REFERENCES "device"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ecd_committee_member" ADD CONSTRAINT "ecd_committee_member_center_id_fkey" FOREIGN KEY ("center_id") REFERENCES "ecd_center"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ecd_committee_member" ADD CONSTRAINT "ecd_committee_member_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user_account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ecd_committee_member" ADD CONSTRAINT "ecd_committee_member_recorded_by_fkey" FOREIGN KEY ("recorded_by") REFERENCES "user_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ecd_committee_member" ADD CONSTRAINT "ecd_committee_member_last_modified_by_device_id_fkey" FOREIGN KEY ("last_modified_by_device_id") REFERENCES "device"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "center_support" ADD CONSTRAINT "center_support_center_id_fkey" FOREIGN KEY ("center_id") REFERENCES "ecd_center"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "center_support" ADD CONSTRAINT "center_support_received_by_fkey" FOREIGN KEY ("received_by") REFERENCES "user_account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "center_support" ADD CONSTRAINT "center_support_recorded_by_fkey" FOREIGN KEY ("recorded_by") REFERENCES "user_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "center_support" ADD CONSTRAINT "center_support_last_modified_by_device_id_fkey" FOREIGN KEY ("last_modified_by_device_id") REFERENCES "device"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "center_visit" ADD CONSTRAINT "center_visit_center_id_fkey" FOREIGN KEY ("center_id") REFERENCES "ecd_center"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "center_visit" ADD CONSTRAINT "center_visit_hosted_by_fkey" FOREIGN KEY ("hosted_by") REFERENCES "user_account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "center_visit" ADD CONSTRAINT "center_visit_recorded_by_fkey" FOREIGN KEY ("recorded_by") REFERENCES "user_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "center_visit" ADD CONSTRAINT "center_visit_last_modified_by_device_id_fkey" FOREIGN KEY ("last_modified_by_device_id") REFERENCES "device"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_training" ADD CONSTRAINT "staff_training_center_id_fkey" FOREIGN KEY ("center_id") REFERENCES "ecd_center"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_training" ADD CONSTRAINT "staff_training_trainee_user_id_fkey" FOREIGN KEY ("trainee_user_id") REFERENCES "user_account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_training" ADD CONSTRAINT "staff_training_recorded_by_fkey" FOREIGN KEY ("recorded_by") REFERENCES "user_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_training" ADD CONSTRAINT "staff_training_last_modified_by_device_id_fkey" FOREIGN KEY ("last_modified_by_device_id") REFERENCES "device"("id") ON DELETE SET NULL ON UPDATE CASCADE;
