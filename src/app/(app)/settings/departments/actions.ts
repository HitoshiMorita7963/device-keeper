"use server";

import { revalidatePath } from "next/cache";
import { runAction } from "@/lib/action";
import { departmentSchema, idField, type DepartmentInput } from "@/lib/validation/masters";
import { createDepartment, updateDepartment } from "@/server/masters";

export async function createDepartmentAction(input: DepartmentInput) {
  return runAction("master:write", departmentSchema, input, async (data, ctx) => {
    const created = await createDepartment(data, ctx);
    revalidatePath("/settings/departments");
    return { ok: true, data: { id: created.id }, message: `部署「${created.name}」を登録しました。` };
  });
}

export async function updateDepartmentAction(input: DepartmentInput & { id: number }) {
  return runAction("master:write", departmentSchema.extend(idField), input, async ({ id, ...data }, ctx) => {
    const updated = await updateDepartment(id, data, ctx);
    revalidatePath("/settings/departments");
    return { ok: true, data: { id }, message: `部署「${updated.name}」を更新しました。` };
  });
}
