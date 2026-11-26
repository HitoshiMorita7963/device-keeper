import type { z } from "zod";
import { db } from "@/lib/db";
import { recordAudit } from "@/lib/audit";
import { BusinessRuleError } from "@/lib/auth/errors";
import { formatDate } from "@/lib/dates";
import { DEVICE_STATUS_LABELS, MAINTENANCE_STATUS_LABELS } from "@/lib/labels";
import { pageArgs, type PageQuery } from "@/lib/pagination";
import type { Prisma } from "@/generated/prisma/client";
import type { MaintenanceStatus } from "@/generated/prisma/enums";
import type { disposalSchema, maintenanceCreateSchema, maintenanceUpdateSchema } from "@/lib/validation/maintenance";
import { assertNotFuture, lockDevice } from "./assignments";
import type { OperationContext } from "./context";

type Tx = Prisma.TransactionClient;
type CreateData = z.output<typeof maintenanceCreateSchema>;
type UpdateData = z.output<typeof maintenanceUpdateSchema>;
type DisposalData = z.output<typeof disposalSchema>;

/** 対応中 (未完了) の修理状況 */
export const OPEN_MAINTENANCE: MaintenanceStatus[] = ["REPORTED", "IN_PROGRESS"];

export function findOpenMaintenance(tx: Tx, deviceId: number) {
  return tx.maintenanceRecord.findFirst({ where: { deviceId, status: { in: OPEN_MAINTENANCE } } });
}

// ---------------------------------------------------------------------------
// 修理・故障
// ---------------------------------------------------------------------------

/**
 * 修理受付。端末状態を修理中にし、修理完了時に戻すため受付前の状態 (使用中/保管中) を記録する。
 */
export async function createMaintenance(data: CreateData, ctx: OperationContext) {
  assertNotFuture(data.reportedAt, "受付日");
  return db.$transaction(async (tx) => {
    const device = await lockDevice(tx, data.deviceId);
    if (device.status === "DISPOSED" || device.status === "LOST") {
      throw new BusinessRuleError(`端末 ${device.assetNumber} は「${DEVICE_STATUS_LABELS[device.status]}」のため修理登録できません。`);
    }
    const open = await findOpenMaintenance(tx, device.id);
    if (open) throw new BusinessRuleError(`端末 ${device.assetNumber} には対応中の修理 (${formatDate(open.reportedAt)} 受付) があります。`);

    const openAssignment = await tx.deviceAssignment.findFirst({ where: { deviceId: device.id, returnedAt: null } });
    const previousDeviceStatus = device.status === "REPAIR" ? (openAssignment ? "IN_USE" : "IN_STOCK") : device.status;

    const record = await tx.maintenanceRecord.create({ data: { ...data, previousDeviceStatus } });
    await tx.device.update({ where: { id: device.id }, data: { status: "REPAIR" } });
    await recordAudit(tx, {
      userId: ctx.user.id,
      action: "MAINTENANCE_CREATE",
      entityType: "Device",
      entityId: device.id,
      before: { status: device.status },
      after: { status: "REPAIR", reportedAt: data.reportedAt, problemDescription: data.problemDescription, maintenanceId: record.id },
      ipAddress: ctx.ipAddress,
    });
    return { record, device };
  });
}

/**
 * 修理記録の更新。完了・取消にすると端末状態を戻す (貸出中なら使用中、そうでなければ保管中)。
 * 完了・取消済みの記録は状況を変更できない (業者・費用・備考の訂正のみ)。
 */
export async function updateMaintenance(data: UpdateData, ctx: OperationContext) {
  if (data.repairedAt) assertNotFuture(data.repairedAt, "修理完了日");
  return db.$transaction(async (tx) => {
    const current = await tx.maintenanceRecord.findUnique({ where: { id: data.id } });
    if (!current) throw new BusinessRuleError("修理記録が見つかりません。");
    const device = await lockDevice(tx, current.deviceId);
    const before = await tx.maintenanceRecord.findUniqueOrThrow({ where: { id: data.id } });

    const wasOpen = OPEN_MAINTENANCE.includes(before.status);
    const closing = wasOpen && !OPEN_MAINTENANCE.includes(data.status);
    if (!wasOpen && data.status !== before.status) {
      throw new BusinessRuleError(`「${MAINTENANCE_STATUS_LABELS[before.status]}」の修理記録は対応状況を変更できません。`);
    }
    if (data.repairedAt && data.repairedAt < before.reportedAt) {
      throw new BusinessRuleError(`修理完了日は受付日 (${formatDate(before.reportedAt)}) 以降の日付にしてください。`);
    }

    const record = await tx.maintenanceRecord.update({
      where: { id: before.id },
      data: {
        problemDescription: data.problemDescription,
        repairVendor: data.repairVendor,
        repairCost: data.repairCost,
        status: data.status,
        repairedAt: data.status === "COMPLETED" ? data.repairedAt : data.status === "CANCELLED" ? null : data.repairedAt,
        notes: data.notes,
      },
    });

    let deviceStatus = device.status;
    // 修理中のまま (手動で紛失等に変えられていない) 場合のみ、元の状態に戻す
    if (closing && device.status === "REPAIR") {
      const openAssignment = await tx.deviceAssignment.findFirst({ where: { deviceId: device.id, returnedAt: null } });
      deviceStatus = openAssignment ? "IN_USE" : "IN_STOCK";
      await tx.device.update({ where: { id: device.id }, data: { status: deviceStatus } });
    }
    await recordAudit(tx, {
      userId: ctx.user.id,
      action: "MAINTENANCE_UPDATE",
      entityType: "Device",
      entityId: device.id,
      before: { ...before, deviceStatus: device.status },
      after: { ...record, deviceStatus },
      ipAddress: ctx.ipAddress,
    });
    return { record, device, deviceStatus };
  });
}

export const MAINTENANCE_SEARCH_KEYS = ["device", "status", "vendor", "since", "until", "page"] as const;
export type MaintenanceSearch = Partial<Record<(typeof MAINTENANCE_SEARCH_KEYS)[number], string>> & PageQuery;

/** status: open 対応中 (既定) / all すべて / 各状況 */
export function maintenanceWhere(query: MaintenanceSearch): Prisma.MaintenanceRecordWhereInput {
  const and: Prisma.MaintenanceRecordWhereInput[] = [];
  const q = query.device?.trim();
  if (q) {
    and.push({ device: { OR: [{ assetNumber: { contains: q, mode: "insensitive" } }, { name: { contains: q, mode: "insensitive" } }] } });
  }
  if (query.vendor?.trim()) and.push({ repairVendor: { contains: query.vendor.trim(), mode: "insensitive" } });
  if (query.status === "all") {
    // 条件なし
  } else if (query.status && query.status in MAINTENANCE_STATUS_LABELS) {
    and.push({ status: query.status as MaintenanceStatus });
  } else {
    and.push({ status: { in: OPEN_MAINTENANCE } });
  }
  const since = query.since ? new Date(`${query.since}T00:00:00Z`) : null;
  const until = query.until ? new Date(`${query.until}T00:00:00Z`) : null;
  if (since && !Number.isNaN(since.getTime())) and.push({ reportedAt: { gte: since } });
  if (until && !Number.isNaN(until.getTime())) and.push({ reportedAt: { lte: until } });
  return { AND: and };
}

export async function searchMaintenance(query: MaintenanceSearch) {
  const where = maintenanceWhere(query);
  const [total, rows, cost] = await Promise.all([
    db.maintenanceRecord.count({ where }),
    db.maintenanceRecord.findMany({
      where,
      orderBy: [{ reportedAt: "desc" }, { id: "desc" }],
      ...pageArgs(query),
      include: { device: { select: { id: true, assetNumber: true, name: true, status: true } } },
    }),
    db.maintenanceRecord.aggregate({ where, _sum: { repairCost: true } }),
  ]);
  return { total, rows, totalCost: cost._sum.repairCost ?? 0 };
}

/** 修理登録の対象として選択できる端末 (廃棄済み・紛失・対応中の修理があるものを除く) */
export async function maintainableDevices() {
  return db.device.findMany({
    where: {
      deletedAt: null,
      status: { notIn: ["DISPOSED", "LOST"] },
      maintenance: { none: { status: { in: OPEN_MAINTENANCE } } },
    },
    orderBy: { assetNumber: "asc" },
    select: { id: true, assetNumber: true, name: true, status: true },
  });
}

// ---------------------------------------------------------------------------
// 廃棄
// ---------------------------------------------------------------------------

/**
 * 廃棄処理。貸出中・修理対応中の端末は、返却・修理完了 (取消) を先に行う。
 * 端末は削除せず「廃棄済み」にし、貸与・移動・修理の履歴はすべて保持する。
 */
export async function disposeDevice(data: DisposalData, ctx: OperationContext) {
  assertNotFuture(data.disposedAt, "廃棄日");
  return db.$transaction(async (tx) => {
    const device = await lockDevice(tx, data.deviceId);
    if (device.status === "DISPOSED") throw new BusinessRuleError(`端末 ${device.assetNumber} は既に廃棄済みです。`);
    const openAssignment = await tx.deviceAssignment.findFirst({ where: { deviceId: device.id, returnedAt: null } });
    if (openAssignment) throw new BusinessRuleError(`端末 ${device.assetNumber} は貸出中です。先に返却処理を行ってください。`);
    if (await findOpenMaintenance(tx, device.id)) {
      throw new BusinessRuleError(`端末 ${device.assetNumber} には対応中の修理があります。先に修理を完了または取消にしてください。`);
    }

    const { dataErasure, ...fields } = data;
    const record = await tx.disposalRecord.create({
      data: { ...fields, dataErasureConfirmed: dataErasure === "confirmed", disposedById: ctx.user.id },
    });
    await tx.device.update({ where: { id: device.id }, data: { status: "DISPOSED", currentEmployeeId: null } });
    await recordAudit(tx, {
      userId: ctx.user.id,
      action: "DISPOSE",
      entityType: "Device",
      entityId: device.id,
      before: { status: device.status },
      after: {
        status: "DISPOSED",
        disposedAt: data.disposedAt,
        reason: data.disposalReason,
        disposalMethod: data.disposalMethod,
        dataErasure: dataErasure === "confirmed" ? "消去済み" : "不要",
        disposalId: record.id,
      },
      ipAddress: ctx.ipAddress,
    });
    return { record, device };
  });
}

export const DISPOSAL_SEARCH_KEYS = ["device", "since", "until", "page"] as const;
export type DisposalSearch = Partial<Record<(typeof DISPOSAL_SEARCH_KEYS)[number], string>> & PageQuery;

export async function searchDisposals(query: DisposalSearch) {
  const and: Prisma.DisposalRecordWhereInput[] = [];
  const q = query.device?.trim();
  if (q) and.push({ device: { OR: [{ assetNumber: { contains: q, mode: "insensitive" } }, { name: { contains: q, mode: "insensitive" } }] } });
  const since = query.since ? new Date(`${query.since}T00:00:00Z`) : null;
  const until = query.until ? new Date(`${query.until}T00:00:00Z`) : null;
  if (since && !Number.isNaN(since.getTime())) and.push({ disposedAt: { gte: since } });
  if (until && !Number.isNaN(until.getTime())) and.push({ disposedAt: { lte: until } });
  const where = { AND: and };
  const [total, rows] = await Promise.all([
    db.disposalRecord.count({ where }),
    db.disposalRecord.findMany({
      where,
      orderBy: [{ disposedAt: "desc" }, { id: "desc" }],
      ...pageArgs(query),
      include: {
        device: { select: { id: true, assetNumber: true, name: true, category: { select: { name: true } } } },
        disposedBy: { select: { displayName: true } },
      },
    }),
  ]);
  return { total, rows };
}

/** 廃棄対象として選択できる端末 (貸出中・修理対応中・廃棄済みを除く) */
export async function disposableDevices() {
  return db.device.findMany({
    where: {
      deletedAt: null,
      status: { not: "DISPOSED" },
      assignments: { none: { returnedAt: null } },
      maintenance: { none: { status: { in: OPEN_MAINTENANCE } } },
    },
    orderBy: { assetNumber: "asc" },
    select: { id: true, assetNumber: true, name: true, status: true, category: { select: { name: true } } },
  });
}
