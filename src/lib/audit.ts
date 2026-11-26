import type { DbClient } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";

/** 監査ログに残さない項目 */
const SECRET_KEYS = new Set(["passwordHash", "password", "token"]);

export type AuditInput = {
  userId: number | null;
  action: string;
  entityType: string;
  entityId?: string | number | null;
  before?: unknown;
  after?: unknown;
  ipAddress?: string | null;
};

function sanitize(value: unknown): Prisma.InputJsonValue | typeof Prisma.DbNull {
  if (value === undefined || value === null) return Prisma.DbNull;
  // Date などを JSON 互換の値に変換したうえで秘密情報を除外する
  return JSON.parse(
    JSON.stringify(value, (key, v) => (SECRET_KEYS.has(key) ? undefined : v)),
  ) as Prisma.InputJsonValue;
}

/**
 * 操作履歴を記録する。業務データの更新と同じトランザクション内で呼ぶこと
 * (更新が失敗した場合はログも残らず、ログだけ失敗した場合は更新も取り消される)。
 */
export async function recordAudit(client: DbClient, input: AuditInput): Promise<void> {
  await client.auditLog.create({
    data: {
      userId: input.userId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId == null ? null : String(input.entityId),
      beforeData: sanitize(input.before),
      afterData: sanitize(input.after),
      ipAddress: input.ipAddress ?? null,
    },
  });
}
