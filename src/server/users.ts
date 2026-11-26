import type { z } from "zod";
import { db } from "@/lib/db";
import { recordAudit } from "@/lib/audit";
import { BusinessRuleError } from "@/lib/auth/errors";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import type { Prisma } from "@/generated/prisma/client";
import type { passwordChangeSchema, passwordResetSchema, userCreateSchema, userUpdateSchema } from "@/lib/validation/users";
import type { OperationContext } from "./context";

type Tx = Prisma.TransactionClient;

/** 監査ログ・画面に渡してよい項目 (パスワードハッシュを含めない) */
const PUBLIC_FIELDS = {
  id: true,
  email: true,
  displayName: true,
  role: true,
  employeeId: true,
  isActive: true,
  lockedUntil: true,
  lastLoginAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.UserSelect;

async function assertEmployeeLink(tx: Tx, employeeId: number | null, userId?: number) {
  if (!employeeId) return;
  const employee = await tx.employee.findUnique({ where: { id: employeeId }, include: { user: true } });
  if (!employee) throw new BusinessRuleError("選択された社員が見つかりません。");
  if (employee.employmentStatus === "RETIRED") throw new BusinessRuleError(`${employee.name} さんは退職済みのため紐付けできません。`);
  if (employee.user && employee.user.id !== userId) {
    throw new BusinessRuleError(`${employee.name} さんには既に利用者 (${employee.user.email}) が紐付いています。`);
  }
}

export async function createUser(data: z.output<typeof userCreateSchema>, ctx: OperationContext) {
  const { password, ...fields } = data;
  const passwordHash = await hashPassword(password);
  return db.$transaction(async (tx) => {
    await assertEmployeeLink(tx, fields.employeeId);
    const created = await tx.user.create({ data: { ...fields, passwordHash }, select: PUBLIC_FIELDS });
    await recordAudit(tx, { userId: ctx.user.id, action: "CREATE", entityType: "User", entityId: created.id, after: created, ipAddress: ctx.ipAddress });
    return created;
  });
}

/**
 * 利用者の更新。自分自身の権限変更・無効化と、有効な管理者がいなくなる変更は受け付けない。
 * 権限変更・無効化の場合はログイン中のセッションを破棄し、新しい権限で再ログインさせる。
 */
export async function updateUser(data: z.output<typeof userUpdateSchema>, ctx: OperationContext) {
  const { id, ...fields } = data;
  return db.$transaction(async (tx) => {
    // 管理者数の判定が同時更新で崩れないよう、利用者表をロックする
    await tx.$executeRaw`LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE`;
    const before = await tx.user.findUnique({ where: { id }, select: PUBLIC_FIELDS });
    if (!before) throw new BusinessRuleError("利用者が見つかりません。");
    if (id === ctx.user.id && (fields.role !== before.role || !fields.isActive)) {
      throw new BusinessRuleError("自分自身の権限変更・無効化はできません。別の管理者に依頼してください。");
    }
    const losesAdmin = before.role === "ADMIN" && before.isActive && (fields.role !== "ADMIN" || !fields.isActive);
    if (losesAdmin) {
      const admins = await tx.user.count({ where: { role: "ADMIN", isActive: true } });
      if (admins <= 1) throw new BusinessRuleError("有効な管理者が 1 人もいなくなるため、この変更はできません。");
    }
    await assertEmployeeLink(tx, fields.employeeId, id);

    const updated = await tx.user.update({
      where: { id },
      // 再度有効にした場合はログイン試行のロックも解除する
      data: { ...fields, ...(fields.isActive && !before.isActive ? { failedLoginCount: 0, lockedUntil: null } : {}) },
      select: PUBLIC_FIELDS,
    });
    if (fields.role !== before.role || !fields.isActive) await tx.session.deleteMany({ where: { userId: id } });
    await recordAudit(tx, { userId: ctx.user.id, action: "UPDATE", entityType: "User", entityId: id, before, after: updated, ipAddress: ctx.ipAddress });
    return updated;
  });
}

/** 管理者によるパスワード再設定。ロックを解除し、対象利用者のセッションをすべて破棄する */
export async function resetPassword(data: z.output<typeof passwordResetSchema>, ctx: OperationContext) {
  const passwordHash = await hashPassword(data.password);
  return db.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: data.id }, select: PUBLIC_FIELDS });
    if (!user) throw new BusinessRuleError("利用者が見つかりません。");
    if (data.password.toLowerCase() === user.email) throw new BusinessRuleError("メールアドレスと同じパスワードは使用できません。");
    await tx.user.update({ where: { id: user.id }, data: { passwordHash, failedLoginCount: 0, lockedUntil: null } });
    await tx.session.deleteMany({ where: { userId: user.id } });
    await recordAudit(tx, { userId: ctx.user.id, action: "PASSWORD_RESET", entityType: "User", entityId: user.id, after: { email: user.email }, ipAddress: ctx.ipAddress });
    return user;
  });
}

/** 本人によるパスワード変更。現在のセッション以外のログインは無効にする */
export async function changeOwnPassword(data: z.output<typeof passwordChangeSchema>, ctx: OperationContext & { currentSessionId: string | null }) {
  const user = await db.user.findUniqueOrThrow({ where: { id: ctx.user.id } });
  if (!user.passwordHash || !(await verifyPassword(data.currentPassword, user.passwordHash))) {
    throw new BusinessRuleError("現在のパスワードが正しくありません。");
  }
  if (data.newPassword.toLowerCase() === user.email) throw new BusinessRuleError("メールアドレスと同じパスワードは使用できません。");
  const passwordHash = await hashPassword(data.newPassword);
  await db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: user.id }, data: { passwordHash } });
    await tx.session.deleteMany({ where: { userId: user.id, ...(ctx.currentSessionId ? { id: { not: ctx.currentSessionId } } : {}) } });
    await recordAudit(tx, { userId: user.id, action: "PASSWORD_CHANGE", entityType: "User", entityId: user.id, ipAddress: ctx.ipAddress });
  });
}

export async function listUsers() {
  return db.user.findMany({
    orderBy: [{ isActive: "desc" }, { role: "asc" }, { displayName: "asc" }],
    select: { ...PUBLIC_FIELDS, employee: { select: { id: true, name: true, employeeNumber: true } } },
  });
}

export async function getUser(id: number) {
  return db.user.findUnique({ where: { id }, select: PUBLIC_FIELDS });
}

/** 利用者に紐付けできる社員 (退職者と、他の利用者に紐付いている社員を除く) */
export async function linkableEmployees(userId?: number) {
  return db.employee.findMany({
    where: { employmentStatus: { not: "RETIRED" }, OR: [{ user: null }, ...(userId ? [{ user: { id: userId } }] : [])] },
    orderBy: { employeeNumber: "asc" },
    select: { id: true, name: true, employeeNumber: true, email: true },
  });
}
