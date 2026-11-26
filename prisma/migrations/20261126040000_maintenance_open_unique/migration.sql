-- CreateIndex
CREATE UNIQUE INDEX "maintenance_records_one_open_per_device" ON "maintenance_records"("device_id") WHERE (status IN ('REPORTED', 'IN_PROGRESS'));

