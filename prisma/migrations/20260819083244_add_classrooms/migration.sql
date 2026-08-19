-- CreateEnum
CREATE TYPE "classroom_grade" AS ENUM ('grade_1', 'grade_2', 'grade_3');

-- CreateEnum
CREATE TYPE "classroom_assignment_reason" AS ENUM ('initial_enrollment', 'promotion', 'manual_reassignment');

-- AlterTable
ALTER TABLE "child" ADD COLUMN     "classroom_id" TEXT;

-- CreateTable
CREATE TABLE "classroom" (
    "id" TEXT NOT NULL,
    "center_id" TEXT NOT NULL,
    "grade" "classroom_grade" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "classroom_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "classroom_assignment_history" (
    "id" TEXT NOT NULL,
    "child_id" TEXT NOT NULL,
    "from_classroom_id" TEXT,
    "to_classroom_id" TEXT NOT NULL,
    "reason" "classroom_assignment_reason" NOT NULL,
    "effective_date" DATE NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,

    CONSTRAINT "classroom_assignment_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "classroom_center_id_idx" ON "classroom"("center_id");

-- CreateIndex
CREATE UNIQUE INDEX "classroom_center_id_grade_key" ON "classroom"("center_id", "grade");

-- CreateIndex
CREATE INDEX "classroom_assignment_history_child_id_idx" ON "classroom_assignment_history"("child_id");

-- CreateIndex
CREATE INDEX "classroom_assignment_history_from_classroom_id_idx" ON "classroom_assignment_history"("from_classroom_id");

-- CreateIndex
CREATE INDEX "classroom_assignment_history_to_classroom_id_idx" ON "classroom_assignment_history"("to_classroom_id");

-- CreateIndex
CREATE INDEX "child_classroom_id_idx" ON "child"("classroom_id");

-- AddForeignKey
ALTER TABLE "classroom" ADD CONSTRAINT "classroom_center_id_fkey" FOREIGN KEY ("center_id") REFERENCES "ecd_center"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "classroom_assignment_history" ADD CONSTRAINT "classroom_assignment_history_child_id_fkey" FOREIGN KEY ("child_id") REFERENCES "child"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "classroom_assignment_history" ADD CONSTRAINT "classroom_assignment_history_from_classroom_id_fkey" FOREIGN KEY ("from_classroom_id") REFERENCES "classroom"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "classroom_assignment_history" ADD CONSTRAINT "classroom_assignment_history_to_classroom_id_fkey" FOREIGN KEY ("to_classroom_id") REFERENCES "classroom"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "classroom_assignment_history" ADD CONSTRAINT "classroom_assignment_history_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "user_account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "child" ADD CONSTRAINT "child_classroom_id_fkey" FOREIGN KEY ("classroom_id") REFERENCES "classroom"("id") ON DELETE SET NULL ON UPDATE CASCADE;
