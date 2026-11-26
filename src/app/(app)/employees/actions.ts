"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { runAction } from "@/lib/action";
import { employeeSchema, idField, retireEmployeeSchema, type EmployeeInput } from "@/lib/validation/masters";
import { createEmployee, retireEmployee, updateEmployee } from "@/server/employees";

export async function createEmployeeAction(input: EmployeeInput) {
  return runAction("employee:write", employeeSchema, input, async (data, ctx) => {
    const created = await createEmployee(data, ctx);
    revalidatePath("/employees");
    return { ok: true, data: { id: created.id }, message: `社員「${created.name}」を登録しました。` };
  });
}

export async function updateEmployeeAction(input: EmployeeInput & { id: number }) {
  return runAction("employee:write", employeeSchema.extend(idField), input, async ({ id, ...data }, ctx) => {
    const updated = await updateEmployee(id, data, ctx);
    revalidatePath("/employees");
    revalidatePath(`/employees/${id}`);
    return { ok: true, data: { id }, message: `社員「${updated.name}」を更新しました。` };
  });
}

export async function retireEmployeeAction(input: z.input<typeof retireEmployeeSchema>) {
  return runAction("employee:write", retireEmployeeSchema, input, async (data, ctx) => {
    const { employee } = await retireEmployee(data, ctx);
    revalidatePath("/employees");
    revalidatePath(`/employees/${employee.id}`);
    return { ok: true, data: { id: employee.id }, message: `社員「${employee.name}」の退職処理を行いました。` };
  });
}
