"use server";

import { revalidatePath } from "next/cache";
import { runAction } from "@/lib/action";
import { moveSchema, type MoveInput } from "@/lib/validation/moves";
import { moveDevice } from "@/server/moves";

export async function moveDeviceAction(input: MoveInput) {
  return runAction("move:write", moveSchema, input, async (data, ctx) => {
    const { device, from, to } = await moveDevice(data, ctx);
    for (const path of ["/", "/moves", "/devices", `/devices/${device.id}`, "/locations", `/locations/${from.id}`, `/locations/${to.id}`]) {
      revalidatePath(path);
    }
    return { ok: true, data: { deviceId: device.id }, message: `${device.assetNumber} を ${from.name} から ${to.name} へ移動しました。` };
  });
}
