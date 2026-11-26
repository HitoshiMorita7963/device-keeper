"use server";

import { revalidatePath } from "next/cache";
import { runAction } from "@/lib/action";
import { assignSchema, returnSchema, type AssignInput, type ReturnInput } from "@/lib/validation/assignments";
import { assignDevice, returnDevice } from "@/server/assignments";

function revalidateAll(deviceId: number, employeeId: number) {
  for (const path of ["/", "/assignments", "/assignments/history", "/devices", `/devices/${deviceId}`, `/employees/${employeeId}`, "/my"]) {
    revalidatePath(path);
  }
}

export async function assignDeviceAction(input: AssignInput) {
  return runAction("assignment:write", assignSchema, input, async (data, ctx) => {
    const { device, employee } = await assignDevice(data, ctx);
    revalidateAll(device.id, employee.id);
    return { ok: true, data: { deviceId: device.id, employeeId: employee.id }, message: `${device.assetNumber} を ${employee.name} さんに貸し出しました。` };
  });
}

export async function returnDeviceAction(input: ReturnInput) {
  return runAction("assignment:write", returnSchema, input, async (data, ctx) => {
    const { device, employee } = await returnDevice(data, ctx);
    revalidateAll(device.id, employee.id);
    return { ok: true, data: { deviceId: device.id }, message: `${device.assetNumber} の返却を登録しました (${employee.name} さん)。` };
  });
}
