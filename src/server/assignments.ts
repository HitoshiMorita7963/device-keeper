import type { z } from "zod";
import { db } from "@/lib/db";
import { recordAudit } from "@/lib/audit";
import { BusinessRuleError } from "@/lib/auth/errors";
import { addDays, formatDate, todayJst } from "@/lib/dates";
import { DEVICE_STATUS_LABELS } from "@/lib/labels";
import { pageArgs, type PageQuery } from "@/lib/pagination";
import type { Prisma } from "@/generated/prisma/client";
import type { assignSchema, returnSchema } from "@/lib/validation/assignments";
import type { OperationContext } from "./context";

type Tx = Prisma.TransactionClient;
type AssignData = z.output<typeof assignSchema>;
type ReturnData = z.output<typeof returnSchema>;

/** 返却予定が近いとみなす日数 */
export const DUE_SOON_DAYS = 7;

/**
 * 端末行をロックして取得する。貸出・返却・移動など端末の状態を変える処理は、
 * 必ずこのロックを取ってから判定することで、同時操作による二重貸出などを防ぐ。
 */
export async function lockDevice(tx: Tx, deviceId: number) {
  await tx.$queryRaw`SELECT id FROM devices WHERE id = ${deviceId} FOR UPDATE`;
  const device = await tx.device.findUnique({ where: { id: deviceId } });
  if (!device || device.deletedAt) throw new BusinessRuleError("対象の端末が見つかりません。");
  return device;
}

/** 貸出・返却・移動などの担当者に指定できるのは、有効な管理者・IT資産管理担当者のみ */
export async function assertHandler(tx: Tx, userId: number, label: string) {
  const user = await tx.user.findUnique({ where: { id: userId } });
  if (!user || !user.isActive || user.role === "EMPLOYEE") {
    throw new BusinessRuleError(`${label}には、有効な管理者またはIT資産管理担当者を指定してください。`);
  }
}

export function assertNotFuture(date: Date, label: string) {
  if (date > todayJst()) throw new BusinessRuleError(`${label}に未来の日付は指定できません。`);
}

/**
 * 貸出登録。
 * 1. 貸与履歴を登録 2. 端末状態を使用中に変更 3. 現在利用者を更新 4. 操作履歴を記録
 * をひとつのトランザクションで行う。
 */
export async function assignDevice(data: AssignData, ctx: OperationContext) {
  assertNotFuture(data.assignedAt, "貸出日");
  return db.$transaction(async (tx) => {
    const device = await lockDevice(tx, data.deviceId);
    if (device.status !== "IN_STOCK") {
      throw new BusinessRuleError(
        `端末 ${device.assetNumber} は「${DEVICE_STATUS_LABELS[device.status]}」のため貸出できません。貸出できるのは保管中の端末のみです。`,
      );
    }
    const open = await tx.deviceAssignment.findFirst({ where: { deviceId: device.id, returnedAt: null } });
    if (open) throw new BusinessRuleError(`端末 ${device.assetNumber} には未返却の貸出が既にあります。`);

    const employee = await tx.employee.findUnique({ where: { id: data.employeeId } });
    if (!employee) throw new BusinessRuleError("貸出先の社員が見つかりません。");
    if (employee.employmentStatus === "RETIRED") throw new BusinessRuleError(`${employee.name} さんは退職済みのため貸出できません。`);
    await assertHandler(tx, data.assignedById, "貸出担当者");

    const assignment = await tx.deviceAssignment.create({
      data: {
        deviceId: device.id,
        employeeId: employee.id,
        assignedAt: data.assignedAt,
        expectedReturnAt: data.expectedReturnAt,
        assignedById: data.assignedById,
        notes: data.notes,
      },
    });
    const updated = await tx.device.update({
      where: { id: device.id },
      data: { status: "IN_USE", currentEmployeeId: employee.id },
    });
    await recordAudit(tx, {
      userId: ctx.user.id,
      action: "ASSIGN",
      entityType: "Device",
      entityId: device.id,
      before: { status: device.status, currentEmployeeId: device.currentEmployeeId },
      after: {
        status: updated.status,
        currentEmployeeId: employee.id,
        employee: `${employee.name} (${employee.employeeNumber})`,
        assignedAt: data.assignedAt,
        expectedReturnAt: data.expectedReturnAt,
        assignmentId: assignment.id,
      },
      ipAddress: ctx.ipAddress,
    });
    return { assignment, device: updated, employee };
  });
}

/**
 * 返却処理。
 * 1. 貸与履歴に返却日を登録 2. 端末状態を保管中に変更 3. 現在利用者を解除 4. 操作履歴を記録
 * 修理中の端末は修理が終わるまで修理中のままとする。
 */
export async function returnDevice(data: ReturnData, ctx: OperationContext) {
  assertNotFuture(data.returnedAt, "返却日");
  return db.$transaction(async (tx) => {
    const device = await lockDevice(tx, data.deviceId);
    const open = await tx.deviceAssignment.findFirst({
      where: { deviceId: device.id, returnedAt: null },
      include: { employee: true },
    });
    if (!open) throw new BusinessRuleError(`端末 ${device.assetNumber} は貸出中ではありません。`);
    if (data.returnedAt < open.assignedAt) {
      throw new BusinessRuleError(`返却日は貸出日 (${formatDate(open.assignedAt)}) 以降の日付にしてください。`);
    }
    await assertHandler(tx, data.returnedById, "返却担当者");

    const assignment = await tx.deviceAssignment.update({
      where: { id: open.id },
      data: {
        returnedAt: data.returnedAt,
        returnedById: data.returnedById,
        conditionOnReturn: data.conditionOnReturn,
        accessoriesChecked: data.accessoriesChecked,
        notes: [open.notes, data.notes && `[返却時] ${data.notes}`].filter(Boolean).join("\n") || null,
      },
    });
    const updated = await tx.device.update({
      where: { id: device.id },
      data: { status: device.status === "REPAIR" ? "REPAIR" : "IN_STOCK", currentEmployeeId: null },
    });
    await recordAudit(tx, {
      userId: ctx.user.id,
      action: "RETURN",
      entityType: "Device",
      entityId: device.id,
      before: { status: device.status, currentEmployeeId: device.currentEmployeeId },
      after: {
        status: updated.status,
        currentEmployeeId: null,
        employee: `${open.employee.name} (${open.employee.employeeNumber})`,
        returnedAt: data.returnedAt,
        conditionOnReturn: data.conditionOnReturn,
        accessoriesChecked: data.accessoriesChecked,
        assignmentId: assignment.id,
      },
      ipAddress: ctx.ipAddress,
    });
    return { assignment, device: updated, employee: open.employee };
  });
}

// ---------------------------------------------------------------------------
// 一覧・選択肢
// ---------------------------------------------------------------------------

export const ASSIGNMENT_SEARCH_KEYS = ["device", "employee", "state", "from", "to", "page"] as const;
export type AssignmentSearch = Partial<Record<(typeof ASSIGNMENT_SEARCH_KEYS)[number], string>> & PageQuery;

const contains = (value: string) => ({ contains: value.trim(), mode: "insensitive" as const });

/**
 * 貸与履歴の検索条件。state:
 *   open 貸出中 / overdue 返却期限超過 / due 返却予定が近い (7日以内) / returned 返却済み / 未指定 すべて
 */
export function assignmentWhere(query: AssignmentSearch, today = todayJst()): Prisma.DeviceAssignmentWhereInput {
  const and: Prisma.DeviceAssignmentWhereInput[] = [];
  if (query.device?.trim()) {
    and.push({ device: { OR: [{ assetNumber: contains(query.device) }, { name: contains(query.device) }] } });
  }
  if (query.employee?.trim()) {
    and.push({ employee: { OR: [{ name: contains(query.employee) }, { employeeNumber: contains(query.employee) }] } });
  }
  if (query.state === "open") and.push({ returnedAt: null });
  else if (query.state === "overdue") and.push({ returnedAt: null, expectedReturnAt: { lt: today } });
  else if (query.state === "due") and.push({ returnedAt: null, expectedReturnAt: { gte: today, lte: addDays(today, DUE_SOON_DAYS) } });
  else if (query.state === "returned") and.push({ returnedAt: { not: null } });

  const from = query.from ? new Date(`${query.from}T00:00:00Z`) : null;
  const to = query.to ? new Date(`${query.to}T00:00:00Z`) : null;
  if (from && !Number.isNaN(from.getTime())) and.push({ assignedAt: { gte: from } });
  if (to && !Number.isNaN(to.getTime())) and.push({ assignedAt: { lte: to } });
  return { AND: and };
}

const listInclude = {
  device: { select: { id: true, assetNumber: true, name: true, status: true, category: { select: { name: true } } } },
  employee: { select: { id: true, name: true, employeeNumber: true, department: { select: { name: true } } } },
  assignedBy: { select: { displayName: true } },
  returnedBy: { select: { displayName: true } },
} satisfies Prisma.DeviceAssignmentInclude;

export async function searchAssignments(query: AssignmentSearch) {
  const where = assignmentWhere(query);
  const [total, rows] = await Promise.all([
    db.deviceAssignment.count({ where }),
    db.deviceAssignment.findMany({
      where,
      // 貸出中を先に、返却予定日の近い順。返却済みは貸出日の新しい順
      orderBy: [
        { returnedAt: { sort: "desc", nulls: "first" } },
        { expectedReturnAt: { sort: "asc", nulls: "last" } },
        { assignedAt: "desc" },
        { id: "desc" },
      ],
      ...pageArgs(query),
      include: listInclude,
    }),
  ]);
  return { total, rows };
}

export async function assignmentSummary(today = todayJst()) {
  const [open, overdue, due] = await Promise.all([
    db.deviceAssignment.count({ where: { returnedAt: null } }),
    db.deviceAssignment.count({ where: { returnedAt: null, expectedReturnAt: { lt: today } } }),
    db.deviceAssignment.count({ where: { returnedAt: null, expectedReturnAt: { gte: today, lte: addDays(today, DUE_SOON_DAYS) } } }),
  ]);
  return { open, overdue, due };
}

/** 貸出対象として選択できる端末 (保管中のみ) */
export async function assignableDevices() {
  return db.device.findMany({
    where: { deletedAt: null, status: "IN_STOCK" },
    orderBy: { assetNumber: "asc" },
    select: { id: true, assetNumber: true, name: true, currentLocation: { select: { name: true } } },
  });
}

/** 返却対象として選択できる端末 (未返却の貸出があるもの) */
export async function returnableDevices() {
  return db.deviceAssignment.findMany({
    where: { returnedAt: null, device: { deletedAt: null } },
    orderBy: { device: { assetNumber: "asc" } },
    include: listInclude,
  });
}

/** 貸出先として選択できる社員 (退職者を除く) */
export async function assignableEmployees() {
  return db.employee.findMany({
    where: { employmentStatus: { not: "RETIRED" } },
    orderBy: { employeeNumber: "asc" },
    select: { id: true, name: true, employeeNumber: true, employmentStatus: true, department: { select: { name: true } } },
  });
}

/** 貸出・返却の担当者として選択できる利用者 */
export async function handlerUsers() {
  return db.user.findMany({
    where: { isActive: true, role: { in: ["ADMIN", "ASSET_MANAGER"] } },
    orderBy: { displayName: "asc" },
    select: { id: true, displayName: true },
  });
}
