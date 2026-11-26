"use server";

import { revalidatePath } from "next/cache";
import { runAction } from "@/lib/action";
import { DEVICE_STATUS_LABELS, MAINTENANCE_STATUS_LABELS } from "@/lib/labels";
import {
  maintenanceCreateSchema,
  maintenanceUpdateSchema,
  type MaintenanceCreateInput,
  type MaintenanceUpdateInput,
} from "@/lib/validation/maintenance";
import { createMaintenance, updateMaintenance } from "@/server/maintenance";

function revalidateAll(deviceId: number, recordId: number) {
  for (const path of ["/", "/maintenance", `/maintenance/${recordId}`, "/devices", `/devices/${deviceId}`]) revalidatePath(path);
}

export async function createMaintenanceAction(input: MaintenanceCreateInput) {
  return runAction("maintenance:write", maintenanceCreateSchema, input, async (data, ctx) => {
    const { record, device } = await createMaintenance(data, ctx);
    revalidateAll(device.id, record.id);
    return { ok: true, data: { id: record.id, deviceId: device.id }, message: `${device.assetNumber} の修理を受け付けました (端末状態: 修理中)。` };
  });
}

export async function updateMaintenanceAction(input: MaintenanceUpdateInput) {
  return runAction("maintenance:write", maintenanceUpdateSchema, input, async (data, ctx) => {
    const { record, device, deviceStatus } = await updateMaintenance(data, ctx);
    revalidateAll(device.id, record.id);
    const statusNote = deviceStatus !== device.status ? ` 端末状態を「${DEVICE_STATUS_LABELS[deviceStatus]}」に戻しました。` : "";
    return { ok: true, data: { id: record.id, deviceId: device.id }, message: `修理記録を更新しました (${MAINTENANCE_STATUS_LABELS[record.status]})。${statusNote}` };
  });
}
