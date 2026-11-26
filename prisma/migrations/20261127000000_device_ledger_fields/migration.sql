-- DropIndex
DROP INDEX "maintenance_records_one_open_per_device";

-- AlterTable
ALTER TABLE "devices" ADD COLUMN     "cpu" TEXT,
ADD COLUMN     "disk" TEXT,
ADD COLUMN     "home_loaned_at" DATE,
ADD COLUMN     "hostname" TEXT,
ADD COLUMN     "initial_password_enc" TEXT,
ADD COLUMN     "initial_user" TEXT,
ADD COLUMN     "login_password_enc" TEXT,
ADD COLUMN     "login_user" TEXT,
ADD COLUMN     "memory" TEXT,
ADD COLUMN     "purpose" TEXT,
ADD COLUMN     "recovery" TEXT;

-- CreateIndex
CREATE INDEX "devices_hostname_idx" ON "devices"("hostname");

-- CreateIndex
CREATE UNIQUE INDEX "maintenance_records_one_open_per_device" ON "maintenance_records"("device_id") WHERE (status IN ('REPORTED', 'IN_PROGRESS'));

