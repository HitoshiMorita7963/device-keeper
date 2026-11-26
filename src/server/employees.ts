import type { z } from "zod";
import { db } from "@/lib/db";
import { recordAudit } from "@/lib/audit";
import { BusinessRuleError } from "@/lib/auth/errors";
import { pageArgs, type PageQuery } from "@/lib/pagination";
import type { Prisma } from "@/generated/prisma/client";
import type { EmploymentStatus } from "@/generated/prisma/enums";
import type { employeeSchema, retireEmployeeSchema } from "@/lib/validation/masters";
import type { OperationContext } from "./context";

type EmployeeData = z.output<typeof employeeSchema>;
type RetireData = z.output<typeof retireEmployeeSchema>;

const RETIRE_VIA_PROCESS = "退職への変更は社員詳細画面の「退職処理」から行ってください。";

export async function createEmployee(data: EmployeeData, ctx: OperationContext) {
  if (data.employmentStatus === "RETIRED") throw new BusinessRuleError(RETIRE_VIA_PROCESS);
  return db.$transaction(async (tx) => {
    const created = await tx.employee.create({ data });
    await recordAudit(tx, { userId: ctx.user.id, action: "CREATE", entityType: "Employee", entityId: created.id, after: created, ipAddress: ctx.ipAddress });
    return created;
  });
}

export async function updateEmployee(id: number, data: EmployeeData, ctx: OperationContext) {
  return db.$transaction(async (tx) => {
    const before = await tx.employee.findUniqueOrThrow({ where: { id } });
    if (data.employmentStatus === "RETIRED" && before.employmentStatus !== "RETIRED") {
      throw new BusinessRuleError(RETIRE_VIA_PROCESS);
    }
    // 退職者を在籍・休職に戻す場合は再入社扱いとし、退職日を消す
    const reinstated = before.employmentStatus === "RETIRED" && data.employmentStatus !== "RETIRED";
    const updated = await tx.employee.update({
      where: { id },
      data: { ...data, ...(reinstated ? { retiredAt: null } : {}) },
    });
    await recordAudit(tx, {
      userId: ctx.user.id,
      action: "UPDATE",
      entityType: "Employee",
      entityId: id,
      before,
      after: { ...updated, ...(reinstated ? { note: "退職者の在籍状態を変更 (再入社)" } : {}) },
      ipAddress: ctx.ipAddress,
    });
    return updated;
  });
}

/**
 * 退職処理。貸与中の端末がある場合は、利用者が確認した場合のみ続行する。
 * 社員に紐づくシステム利用者は無効化し、ログイン中のセッションも破棄する。
 */
export async function retireEmployee(data: RetireData, ctx: OperationContext) {
  return db.$transaction(async (tx) => {
    const before = await tx.employee.findUniqueOrThrow({ where: { id: data.employeeId }, include: { user: true } });
    if (before.employmentStatus === "RETIRED") throw new BusinessRuleError("この社員は既に退職処理済みです。");

    const openAssignments = await tx.deviceAssignment.count({ where: { employeeId: before.id, returnedAt: null } });
    if (openAssignments > 0 && !data.acknowledgeAssignedDevices) {
      throw new BusinessRuleError(`貸与中の端末が ${openAssignments} 台あります。返却処理を行うか、確認のうえ退職処理を続行してください。`);
    }

    const updated = await tx.employee.update({
      where: { id: before.id },
      data: { employmentStatus: "RETIRED", retiredAt: data.retiredAt },
    });
    if (before.user?.isActive) {
      await tx.user.update({ where: { id: before.user.id }, data: { isActive: false } });
      await tx.session.deleteMany({ where: { userId: before.user.id } });
    }
    await recordAudit(tx, {
      userId: ctx.user.id,
      action: "RETIRE",
      entityType: "Employee",
      entityId: before.id,
      before: { ...before, user: undefined },
      after: { ...updated, openAssignments, userDeactivated: Boolean(before.user?.isActive) },
      ipAddress: ctx.ipAddress,
    });
    return { employee: updated, openAssignments };
  });
}

export type EmployeeSearch = {
  q?: string;
  department?: string;
  location?: string;
  /** 未指定は在籍・休職のみ。"all" で退職者を含む */
  status?: string;
} & PageQuery;

const STATUSES: EmploymentStatus[] = ["ACTIVE", "ON_LEAVE", "RETIRED"];

export function employeeWhere(query: EmployeeSearch): Prisma.EmployeeWhereInput {
  const q = query.q?.trim();
  const where: Prisma.EmployeeWhereInput = {};
  if (q) {
    where.OR = [
      { employeeNumber: { contains: q, mode: "insensitive" } },
      { name: { contains: q, mode: "insensitive" } },
      { email: { contains: q, mode: "insensitive" } },
    ];
  }
  if (Number(query.department) > 0) where.departmentId = Number(query.department);
  if (Number(query.location) > 0) where.homeLocationId = Number(query.location);
  if (query.status === "all") {
    // 条件なし
  } else if (STATUSES.includes(query.status as EmploymentStatus)) {
    where.employmentStatus = query.status as EmploymentStatus;
  } else {
    where.employmentStatus = { not: "RETIRED" };
  }
  return where;
}

export async function searchEmployees(query: EmployeeSearch) {
  const where = employeeWhere(query);
  const [total, rows] = await Promise.all([
    db.employee.count({ where }),
    db.employee.findMany({
      where,
      orderBy: { employeeNumber: "asc" },
      ...pageArgs(query),
      include: {
        department: { select: { name: true } },
        homeLocation: { select: { name: true } },
        _count: { select: { assignments: { where: { returnedAt: null } } } },
      },
    }),
  ]);
  return { total, rows };
}

export async function getEmployeeDetail(id: number) {
  const employee = await db.employee.findUnique({
    where: { id },
    include: {
      department: true,
      homeLocation: true,
      user: { select: { email: true, role: true, isActive: true } },
    },
  });
  if (!employee) return null;

  const assignments = await db.deviceAssignment.findMany({
    where: { employeeId: id },
    orderBy: [{ assignedAt: "desc" }, { id: "desc" }],
    include: {
      device: { select: { id: true, assetNumber: true, name: true, category: { select: { name: true } } } },
      assignedBy: { select: { displayName: true } },
    },
  });
  const current = assignments.filter((a) => !a.returnedAt);
  return {
    employee,
    current,
    past: assignments.filter((a) => a.returnedAt),
    // 返却予定日が設定されている貸与中端末を期限の近い順に
    upcomingReturns: current
      .filter((a) => a.expectedReturnAt)
      .sort((a, b) => a.expectedReturnAt!.getTime() - b.expectedReturnAt!.getTime()),
  };
}
