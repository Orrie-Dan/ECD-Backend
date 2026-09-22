-- SF-13: caregiver CV / work experience history (1→many on user_account).
CREATE TABLE "sde"."caregiver_work_experience" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "employer" TEXT NOT NULL,
    "job_title" TEXT NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE,
    "description" TEXT,
    "recorded_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "caregiver_work_experience_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "caregiver_work_experience_user_id_start_date_idx" ON "sde"."caregiver_work_experience"("user_id", "start_date");
CREATE INDEX "caregiver_work_experience_recorded_by_idx" ON "sde"."caregiver_work_experience"("recorded_by");
CREATE INDEX "caregiver_work_experience_deleted_at_idx" ON "sde"."caregiver_work_experience"("deleted_at");

ALTER TABLE "sde"."caregiver_work_experience" ADD CONSTRAINT "caregiver_work_experience_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "sde"."user_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sde"."caregiver_work_experience" ADD CONSTRAINT "caregiver_work_experience_recorded_by_fkey" FOREIGN KEY ("recorded_by") REFERENCES "sde"."user_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
