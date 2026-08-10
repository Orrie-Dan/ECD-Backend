-- AlterTable
ALTER TABLE "sync_operation" ADD COLUMN "client_operation_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "sync_operation_device_id_client_operation_id_key" ON "sync_operation"("device_id", "client_operation_id");
