import type { z } from "zod";
import { db } from "@/lib/db";
import { recordAudit } from "@/lib/audit";
import { BusinessRuleError } from "@/lib/auth/errors";
import type { categorySchema, departmentSchema } from "@/lib/validation/masters";
import type { OperationContext } from "./context";

type DepartmentData = z.output<typeof departmentSchema>;
type CategoryData = z.output<typeof categorySchema>;

// ---------------------------------------------------------------------------
// 部署
// ---------------------------------------------------------------------------

export async function createDepartment(data: DepartmentData, ctx: OperationContext) {
  return db.$transaction(async (tx) => {
    const created = await tx.department.create({ data });
    await recordAudit(tx, { userId: ctx.user.id, action: "CREATE", entityType: "Department", entityId: created.id, after: created, ipAddress: ctx.ipAddress });
    return created;
  });
}

export async function updateDepartment(id: number, data: DepartmentData, ctx: OperationContext) {
  return db.$transaction(async (tx) => {
    const before = await tx.department.findUniqueOrThrow({ where: { id } });
    if (before.isActive && !data.isActive) {
      const members = await tx.employee.count({ where: { departmentId: id, employmentStatus: { not: "RETIRED" } } });
      if (members > 0) {
        throw new BusinessRuleError(`在籍中の社員が ${members} 名所属しているため、使用停止にできません。先に社員の所属部署を変更してください。`);
      }
    }
    const updated = await tx.department.update({ where: { id }, data });
    await recordAudit(tx, { userId: ctx.user.id, action: "UPDATE", entityType: "Department", entityId: id, before, after: updated, ipAddress: ctx.ipAddress });
    return updated;
  });
}

// ---------------------------------------------------------------------------
// 資産種別
// ---------------------------------------------------------------------------

export async function createCategory(data: CategoryData, ctx: OperationContext) {
  return db.$transaction(async (tx) => {
    const created = await tx.deviceCategory.create({ data: { ...data, sequence: { create: {} } } });
    await recordAudit(tx, { userId: ctx.user.id, action: "CREATE", entityType: "DeviceCategory", entityId: created.id, after: created, ipAddress: ctx.ipAddress });
    return created;
  });
}

export async function updateCategory(id: number, data: CategoryData, ctx: OperationContext) {
  return db.$transaction(async (tx) => {
    const before = await tx.deviceCategory.findUniqueOrThrow({ where: { id } });
    const updated = await tx.deviceCategory.update({ where: { id }, data });
    // 採番カウンタが無い (手動で作成された) 種別にも用意しておく
    await tx.assetNumberSequence.upsert({ where: { categoryId: id }, update: {}, create: { categoryId: id } });
    await recordAudit(tx, { userId: ctx.user.id, action: "UPDATE", entityType: "DeviceCategory", entityId: id, before, after: updated, ipAddress: ctx.ipAddress });
    return updated;
  });
}

// ---------------------------------------------------------------------------
// 選択肢 (フォームのプルダウン用)
// ---------------------------------------------------------------------------

/** 使用中のマスタと、編集対象が現在参照している (使用停止済みの) 値を返す */
export async function departmentOptions(includeId?: number | null) {
  return db.department.findMany({
    where: { OR: [{ isActive: true }, ...(includeId ? [{ id: includeId }] : [])] },
    orderBy: { departmentCode: "asc" },
    select: { id: true, name: true, departmentCode: true, isActive: true },
  });
}

export async function locationOptions(includeId?: number | null) {
  return db.location.findMany({
    where: { OR: [{ isActive: true }, ...(includeId ? [{ id: includeId }] : [])] },
    orderBy: { locationCode: "asc" },
    select: { id: true, name: true, locationCode: true, isActive: true },
  });
}

export async function categoryOptions(includeId?: number | null) {
  return db.deviceCategory.findMany({
    where: { OR: [{ isActive: true }, ...(includeId ? [{ id: includeId }] : [])] },
    orderBy: { categoryCode: "asc" },
    select: { id: true, name: true, categoryCode: true, prefix: true, numberDigits: true, isActive: true },
  });
}
