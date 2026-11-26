import type { z } from "zod";
import { db } from "@/lib/db";
import { recordAudit } from "@/lib/audit";
import { BusinessRuleError } from "@/lib/auth/errors";
import { formatDate } from "@/lib/dates";
import { DEVICE_STATUS_LABELS } from "@/lib/labels";
import { pageArgs, type PageQuery } from "@/lib/pagination";
import type { Prisma } from "@/generated/prisma/client";
import type { moveSchema } from "@/lib/validation/moves";
import { assertHandler, assertNotFuture, lockDevice } from "./assignments";
import type { OperationContext } from "./context";

type MoveData = z.output<typeof moveSchema>;

/**
 * 拠点間移動。移動元は端末の現在拠点とし、
 * 1. 移動履歴を登録 2. 端末の現在拠点を更新 3. 操作履歴を記録 をひとつのトランザクションで行う。
 */
export async function moveDevice(data: MoveData, ctx: OperationContext) {
  assertNotFuture(data.movedAt, "移動日");
  return db.$transaction(async (tx) => {
    const device = await lockDevice(tx, data.deviceId);
    if (device.status === "DISPOSED" || device.status === "LOST") {
      throw new BusinessRuleError(`端末 ${device.assetNumber} は「${DEVICE_STATUS_LABELS[device.status]}」のため移動できません。`);
    }
    if (device.currentLocationId === data.toLocationId) {
      throw new BusinessRuleError("移動先には現在の拠点と異なる拠点を選択してください。");
    }
    const to = await tx.location.findUnique({ where: { id: data.toLocationId } });
    if (!to) throw new BusinessRuleError("移動先の拠点が見つかりません。");
    if (!to.isActive) throw new BusinessRuleError(`拠点「${to.name}」は使用停止中のため移動先にできません。`);
    await assertHandler(tx, data.movedById, "担当者");

    // 履歴が時系列で矛盾しないよう、前回の移動日より前の日付は受け付けない
    const last = await tx.deviceLocationHistory.findFirst({ where: { deviceId: device.id }, orderBy: [{ movedAt: "desc" }, { id: "desc" }] });
    if (last && data.movedAt < last.movedAt) {
      throw new BusinessRuleError(`移動日は前回の移動日 (${formatDate(last.movedAt)}) 以降の日付にしてください。`);
    }

    const from = await tx.location.findUniqueOrThrow({ where: { id: device.currentLocationId } });
    const history = await tx.deviceLocationHistory.create({
      data: {
        deviceId: device.id,
        fromLocationId: from.id,
        toLocationId: to.id,
        movedAt: data.movedAt,
        movedById: data.movedById,
        reason: data.reason,
      },
    });
    const updated = await tx.device.update({ where: { id: device.id }, data: { currentLocationId: to.id } });
    await recordAudit(tx, {
      userId: ctx.user.id,
      action: "MOVE",
      entityType: "Device",
      entityId: device.id,
      before: { currentLocationId: from.id, location: from.name },
      after: { currentLocationId: to.id, location: to.name, movedAt: data.movedAt, reason: data.reason, historyId: history.id },
      ipAddress: ctx.ipAddress,
    });
    return { device: updated, from, to, history };
  });
}

// ---------------------------------------------------------------------------
// 移動履歴・選択肢・集計
// ---------------------------------------------------------------------------

export const MOVE_SEARCH_KEYS = ["device", "from", "to", "since", "until", "page"] as const;
export type MoveSearch = Partial<Record<(typeof MOVE_SEARCH_KEYS)[number], string>> & PageQuery;

export function moveWhere(query: MoveSearch): Prisma.DeviceLocationHistoryWhereInput {
  const and: Prisma.DeviceLocationHistoryWhereInput[] = [];
  const q = query.device?.trim();
  if (q) {
    and.push({
      device: { OR: [{ assetNumber: { contains: q, mode: "insensitive" } }, { name: { contains: q, mode: "insensitive" } }] },
    });
  }
  if (Number(query.from) > 0) and.push({ fromLocationId: Number(query.from) });
  if (Number(query.to) > 0) and.push({ toLocationId: Number(query.to) });
  const since = query.since ? new Date(`${query.since}T00:00:00Z`) : null;
  const until = query.until ? new Date(`${query.until}T00:00:00Z`) : null;
  if (since && !Number.isNaN(since.getTime())) and.push({ movedAt: { gte: since } });
  if (until && !Number.isNaN(until.getTime())) and.push({ movedAt: { lte: until } });
  return { AND: and };
}

export async function searchMoves(query: MoveSearch) {
  const where = moveWhere(query);
  const [total, rows] = await Promise.all([
    db.deviceLocationHistory.count({ where }),
    db.deviceLocationHistory.findMany({
      where,
      orderBy: [{ movedAt: "desc" }, { id: "desc" }],
      ...pageArgs(query),
      include: {
        device: { select: { id: true, assetNumber: true, name: true } },
        fromLocation: { select: { id: true, name: true } },
        toLocation: { select: { id: true, name: true } },
        movedBy: { select: { displayName: true } },
      },
    }),
  ]);
  return { total, rows };
}

/** 移動対象として選択できる端末 (廃棄済み・紛失を除く) */
export async function movableDevices() {
  return db.device.findMany({
    where: { deletedAt: null, status: { notIn: ["DISPOSED", "LOST"] } },
    orderBy: { assetNumber: "asc" },
    select: { id: true, assetNumber: true, name: true, currentLocationId: true, currentLocation: { select: { name: true } } },
  });
}

/** 拠点別・資産種別別の端末数 (廃棄済みを除く) */
export async function locationCategoryMatrix() {
  const [locations, categories, counts] = await Promise.all([
    db.location.findMany({ orderBy: { locationCode: "asc" }, select: { id: true, name: true, isActive: true } }),
    db.deviceCategory.findMany({ orderBy: { categoryCode: "asc" }, select: { id: true, name: true } }),
    db.device.groupBy({
      by: ["currentLocationId", "categoryId"],
      where: { deletedAt: null, status: { not: "DISPOSED" } },
      _count: { _all: true },
    }),
  ]);
  const cell = new Map(counts.map((c) => [`${c.currentLocationId}:${c.categoryId}`, c._count._all]));
  const usedCategories = categories.filter((c) => counts.some((x) => x.categoryId === c.id));
  const rows = locations
    .map((l) => {
      const values = usedCategories.map((c) => cell.get(`${l.id}:${c.id}`) ?? 0);
      return { location: l, values, total: values.reduce((a, b) => a + b, 0) };
    })
    .filter((r) => r.location.isActive || r.total > 0);
  const totals = usedCategories.map((_, i) => rows.reduce((sum, r) => sum + r.values[i], 0));
  return { categories: usedCategories, rows, totals, grandTotal: totals.reduce((a, b) => a + b, 0) };
}
