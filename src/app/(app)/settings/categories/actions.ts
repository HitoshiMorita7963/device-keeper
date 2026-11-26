"use server";

import { revalidatePath } from "next/cache";
import { runAction } from "@/lib/action";
import { categorySchema, idField, type CategoryInput } from "@/lib/validation/masters";
import { createCategory, updateCategory } from "@/server/masters";

export async function createCategoryAction(input: CategoryInput) {
  return runAction("master:write", categorySchema, input, async (data, ctx) => {
    const created = await createCategory(data, ctx);
    revalidatePath("/settings/categories");
    return { ok: true, data: { id: created.id }, message: `資産種別「${created.name}」を登録しました。` };
  });
}

export async function updateCategoryAction(input: CategoryInput & { id: number }) {
  return runAction("master:write", categorySchema.extend(idField), input, async ({ id, ...data }, ctx) => {
    const updated = await updateCategory(id, data, ctx);
    revalidatePath("/settings/categories");
    return { ok: true, data: { id }, message: `資産種別「${updated.name}」を更新しました。` };
  });
}
