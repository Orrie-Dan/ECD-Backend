-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "notification_type" ADD VALUE 'child_archived';
ALTER TYPE "notification_type" ADD VALUE 'referral_updated';
ALTER TYPE "notification_type" ADD VALUE 'nutrition_alert';
ALTER TYPE "notification_type" ADD VALUE 'sted_followup';
ALTER TYPE "notification_type" ADD VALUE 'capacity_warning';
