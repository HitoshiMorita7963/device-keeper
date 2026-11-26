import { createHash, randomBytes } from "node:crypto";
import type { z } from "zod";
import { db } from "@/lib/db";
import { recordAudit } from "@/lib/audit";
import { BusinessRuleError } from "@/lib/auth/errors";
import type { managementNameSchema } from "@/lib/validation/device-names";
import type { OperationContext } from "./context";

/** 端末連携キーの接頭辞 (ログ等に紛れ込んだ場合に判別しやすくする) */
const TOKEN_PREFIX = "dkdev_";

export function hashAgentToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

async function findManageableDevice(id: number) {
  const device = await db.device.findUnique({ where: { id } });
  if (!device || device.deletedAt) throw new BusinessRuleError("対象の端末が見つかりません。");
  if (device.status === "DISPOSED") throw new BusinessRuleError("廃棄済みの端末は編集できません。");
  return device;
}

// ---------------------------------------------------------------------------
// 管理用端末名 (管理画面から編集)
// ---------------------------------------------------------------------------

export async function updateManagementName(data: z.output<typeof managementNameSchema>, ctx: OperationContext) {
  return db.$transaction(async (tx) => {
    const before = await tx.device.findUnique({ where: { id: data.id } });
    if (!before || before.deletedAt) throw new BusinessRuleError("対象の端末が見つかりません。");
    if (before.status === "DISPOSED") throw new BusinessRuleError("廃棄済みの端末は編集できません。");
    if (before.managementName === data.managementName) {
      throw new BusinessRuleError("管理用端末名は変更されていません。");
    }
    const updated = await tx.device.update({
      where: { id: before.id },
      data: { managementName: data.managementName, managementNameUpdatedAt: new Date(), managementNameUpdatedById: ctx.user.id },
    });
    await recordAudit(tx, {
      userId: ctx.user.id,
      action: "MANAGEMENT_NAME_UPDATE",
      entityType: "Device",
      entityId: before.id,
      before: { managementName: before.managementName },
      after: { managementName: updated.managementName },
      ipAddress: ctx.ipAddress,
    });
    return updated;
  });
}

// ---------------------------------------------------------------------------
// 端末連携キー (PC 名取得スクリプトの認証用。管理者のみ発行)
// ---------------------------------------------------------------------------

/**
 * 端末連携キーを発行する (再発行すると以前のキーは使えなくなる)。
 * キー本体は画面に 1 度だけ表示し、DB には SHA-256 のみ保存する。
 */
export async function issueAgentToken(deviceId: number, ctx: OperationContext) {
  const device = await findManageableDevice(deviceId);
  const token = `${TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
  await db.$transaction(async (tx) => {
    await tx.device.update({ where: { id: device.id }, data: { agentTokenHash: hashAgentToken(token), agentTokenIssuedAt: new Date() } });
    await recordAudit(tx, {
      userId: ctx.user.id,
      action: "AGENT_TOKEN_ISSUE",
      entityType: "Device",
      entityId: device.id,
      after: { reissued: Boolean(device.agentTokenIssuedAt) },
      ipAddress: ctx.ipAddress,
    });
  });
  return { token, device };
}

export async function revokeAgentToken(deviceId: number, ctx: OperationContext) {
  const device = await db.device.findUnique({ where: { id: deviceId } });
  if (!device || device.deletedAt) throw new BusinessRuleError("対象の端末が見つかりません。");
  if (!device.agentTokenIssuedAt) throw new BusinessRuleError("端末連携キーは発行されていません。");
  await db.$transaction(async (tx) => {
    await tx.device.update({ where: { id: device.id }, data: { agentTokenHash: null, agentTokenIssuedAt: null } });
    await recordAudit(tx, { userId: ctx.user.id, action: "AGENT_TOKEN_REVOKE", entityType: "Device", entityId: device.id, ipAddress: ctx.ipAddress });
  });
  return device;
}

// ---------------------------------------------------------------------------
// PC 名の受信 (端末の取得スクリプトから)
// ---------------------------------------------------------------------------

export type ComputerNameReport =
  | { ok: true; status: 200; deviceId: number; assetNumber: string; computerName: string; computerNameUpdatedAt: Date; changed: boolean }
  | { ok: false; status: 401 | 403 | 404 | 409; error: string };

/**
 * 端末から送信された PC 名を保存する。
 * 端末連携キーで送信元の端末を特定し、URL の端末 ID と一致する場合のみ受け付ける (PC 名だけで端末を特定しない)。
 * 認証の失敗は操作履歴に記録する (キーそのものは記録しない)。
 */
export async function reportComputerName(deviceId: number, token: string | null, computerName: string, ipAddress: string | null): Promise<ComputerNameReport> {
  const fail = async (status: 401 | 403, error: string, reason: string) => {
    await recordAudit(db, { userId: null, action: "AGENT_AUTH_FAILED", entityType: "Device", entityId: deviceId, after: { reason }, ipAddress });
    return { ok: false as const, status, error };
  };
  if (!token) return fail(401, "認証情報がありません。", "端末連携キーなし");
  const owner = await db.device.findUnique({ where: { agentTokenHash: hashAgentToken(token) }, select: { id: true } });
  if (!owner) return fail(401, "端末連携キーが正しくないか、無効になっています。", "不正な端末連携キー");
  if (owner.id !== deviceId) return fail(403, "この端末の PC 名を更新する権限がありません。", `別の端末 (ID ${owner.id}) のキー`);

  return db.$transaction(async (tx) => {
    const device = await tx.device.findUnique({ where: { id: deviceId } });
    if (!device || device.deletedAt) return { ok: false as const, status: 404 as const, error: "端末が見つかりません。" };
    if (device.status === "DISPOSED") return { ok: false as const, status: 409 as const, error: "廃棄済みの端末は更新できません。" };
    const now = new Date();
    const changed = device.computerName !== computerName;
    await tx.device.update({ where: { id: device.id }, data: { computerName, computerNameUpdatedAt: now } });
    // 定期実行で毎回届くため、PC 名が変わった場合のみ操作履歴に残す (取得日時は毎回更新)
    if (changed) {
      await recordAudit(tx, {
        userId: null,
        action: "COMPUTER_NAME_UPDATE",
        entityType: "Device",
        entityId: device.id,
        before: { computerName: device.computerName },
        after: { computerName, source: "端末の PC 名取得スクリプト" },
        ipAddress,
      });
    }
    return { ok: true as const, status: 200 as const, deviceId: device.id, assetNumber: device.assetNumber, computerName, computerNameUpdatedAt: now, changed };
  });
}
