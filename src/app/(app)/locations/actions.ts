"use server";

import { revalidatePath } from "next/cache";
import { runAction } from "@/lib/action";
import { idField, locationSchema, type LocationInput } from "@/lib/validation/masters";
import { createLocation, updateLocation } from "@/server/locations";

export async function createLocationAction(input: LocationInput) {
  return runAction("location:write", locationSchema, input, async (data, ctx) => {
    const created = await createLocation(data, ctx);
    revalidatePath("/locations");
    return { ok: true, data: { id: created.id }, message: `拠点「${created.name}」を登録しました。` };
  });
}

export async function updateLocationAction(input: LocationInput & { id: number }) {
  return runAction("location:write", locationSchema.extend(idField), input, async ({ id, ...data }, ctx) => {
    const updated = await updateLocation(id, data, ctx);
    revalidatePath("/locations");
    revalidatePath(`/locations/${id}`);
    return { ok: true, data: { id }, message: `拠点「${updated.name}」を更新しました。` };
  });
}
