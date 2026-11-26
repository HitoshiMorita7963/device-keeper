"use server";

import { revalidatePath } from "next/cache";
import { runAction } from "@/lib/action";
import { disposalSchema, type DisposalInput } from "@/lib/validation/maintenance";
import { disposeDevice } from "@/server/maintenance";

export async function disposeDeviceAction(input: DisposalInput) {
  return runAction("disposal:write", disposalSchema, input, async (data, ctx) => {
    const { record, device } = await disposeDevice(data, ctx);
    for (const path of ["/", "/disposals", "/devices", `/devices/${device.id}`, "/locations"]) revalidatePath(path);
    return { ok: true, data: { id: record.id, deviceId: device.id }, message: `${device.assetNumber} を廃棄済みにしました。` };
  });
}
