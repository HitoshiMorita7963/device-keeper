"use server";

import { revalidatePath } from "next/cache";
import { runAction } from "@/lib/action";
import { DEVICE_STATUS_LABELS } from "@/lib/labels";
import {
  deviceCreateSchema,
  deviceDeleteSchema,
  deviceStatusChangeSchema,
  deviceUpdateSchema,
  type DeviceCreateInput,
  type DeviceStatusChangeInput,
  type DeviceUpdateInput,
} from "@/lib/validation/devices";
import { changeDeviceStatus, createDevice, deleteDevice, updateDevice } from "@/server/devices";

export async function createDeviceAction(input: DeviceCreateInput) {
  return runAction("device:write", deviceCreateSchema, input, async (data, ctx) => {
    const created = await createDevice(data, ctx);
    revalidatePath("/devices");
    return { ok: true, data: { id: created.id }, message: `端末 ${created.assetNumber} を登録しました。` };
  });
}

export async function updateDeviceAction(input: DeviceUpdateInput) {
  return runAction("device:write", deviceUpdateSchema, input, async (data, ctx) => {
    const updated = await updateDevice(data, ctx);
    revalidatePath("/devices");
    revalidatePath(`/devices/${updated.id}`);
    return { ok: true, data: { id: updated.id }, message: `端末 ${updated.assetNumber} を更新しました。` };
  });
}

export async function changeDeviceStatusAction(input: DeviceStatusChangeInput) {
  return runAction("device:write", deviceStatusChangeSchema, input, async (data, ctx) => {
    const updated = await changeDeviceStatus(data, ctx);
    revalidatePath("/devices");
    revalidatePath(`/devices/${updated.id}`);
    return { ok: true, data: { id: updated.id }, message: `端末の状態を「${DEVICE_STATUS_LABELS[updated.status]}」に変更しました。` };
  });
}

export async function deleteDeviceAction(input: { id: number; reason: string }) {
  return runAction("device:write", deviceDeleteSchema, input, async (data, ctx) => {
    const deleted = await deleteDevice(data, ctx);
    revalidatePath("/devices");
    return { ok: true, data: { id: deleted.id }, message: `端末 ${deleted.assetNumber} を削除しました。` };
  });
}
