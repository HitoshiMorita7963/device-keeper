import type { z } from "zod";
import { db } from "@/lib/db";
import { recordAudit } from "@/lib/audit";
import { BusinessRuleError } from "@/lib/auth/errors";
import { addDays, todayJst } from "@/lib/dates";
import { WARRANTY_WARNING_DAYS } from "@/lib/dashboard";
import { DEVICE_STATUS_LABELS } from "@/lib/labels";
import { pageArgs, type PageQuery } from "@/lib/pagination";
import type { Prisma } from "@/generated/prisma/client";
import type { DeviceStatus } from "@/generated/prisma/enums";
import type {
  deviceCreateSchema,
  deviceDeleteSchema,
  deviceStatusChangeSchema,
  deviceUpdateSchema,
} from "@/lib/validation/devices";
import type { OperationContext } from "./context";

type Tx = Prisma.TransactionClient;
type CreateData = z.output<typeof deviceCreateSchema>;
type UpdateData = z.output<typeof deviceUpdateSchema>;
type StatusChangeData = z.output<typeof deviceStatusChangeSchema>;
type DeleteData = z.output<typeof deviceDeleteSchema>;

// ---------------------------------------------------------------------------
// 資産管理番号の自動採番
// ---------------------------------------------------------------------------

export function formatAssetNumber(prefix: string, digits: number, n: number): string {
  return `${prefix}-${String(n).padStart(digits, "0")}`;
}

/**
 * 資産種別のカウンタを 1 進めて資産管理番号を発行する。
 * カウンタ行の更新ロックはトランザクション終了まで保持されるため、同時登録でも番号は重複しない。
 * 手入力で既に使われている番号は飛ばす。
 */
export async function issueAssetNumber(tx: Tx, categoryId: number): Promise<string> {
  const category = await tx.deviceCategory.findUniqueOrThrow({ where: { id: categoryId } });
  for (let attempt = 0; attempt < 10_000; attempt++) {
    const [{ last_number }] = await tx.$queryRaw<{ last_number: number }[]>`
      INSERT INTO asset_number_sequences (category_id, last_number, updated_at)
      VALUES (${categoryId}, 1, now())
      ON CONFLICT (category_id)
      DO UPDATE SET last_number = asset_number_sequences.last_number + 1, updated_at = now()
      RETURNING last_number`;
    const candidate = formatAssetNumber(category.prefix, category.numberDigits, last_number);
    if (!(await tx.device.findUnique({ where: { assetNumber: candidate }, select: { id: true } }))) return candidate;
  }
  throw new BusinessRuleError("資産管理番号を採番できませんでした。資産種別の採番設定を確認してください。");
}

// ---------------------------------------------------------------------------
// 登録・編集・状態変更・削除
// ---------------------------------------------------------------------------

async function assertActiveMasters(tx: Tx, categoryId: number | null, locationId: number | null) {
  if (categoryId !== null) {
    const category = await tx.deviceCategory.findUnique({ where: { id: categoryId } });
    if (!category) throw new BusinessRuleError("選択された資産種別が存在しません。");
    if (!category.isActive) throw new BusinessRuleError(`資産種別「${category.name}」は使用停止中のため選択できません。`);
  }
  if (locationId !== null) {
    const location = await tx.location.findUnique({ where: { id: locationId } });
    if (!location) throw new BusinessRuleError("選択された拠点が存在しません。");
    if (!location.isActive) throw new BusinessRuleError(`拠点「${location.name}」は使用停止中のため選択できません。`);
  }
}

/** 編集・状態変更の対象として取得する。削除済み・廃棄済みは通常の編集対象外 */
async function findEditableDevice(tx: Tx, id: number) {
  const device = await tx.device.findUnique({ where: { id } });
  if (!device || device.deletedAt) throw new BusinessRuleError("対象の端末が見つかりません。");
  if (device.status === "DISPOSED") throw new BusinessRuleError("廃棄済みの端末は編集できません。");
  return device;
}

export async function createDevice(data: CreateData, ctx: OperationContext) {
  const { assetNumberMode, assetNumber, ...fields } = data;
  return db.$transaction(async (tx) => {
    await assertActiveMasters(tx, fields.categoryId, fields.currentLocationId);
    const number = assetNumberMode === "auto" ? await issueAssetNumber(tx, fields.categoryId) : assetNumber;
    const created = await tx.device.create({ data: { ...fields, assetNumber: number } });
    await recordAudit(tx, {
      userId: ctx.user.id,
      action: "CREATE",
      entityType: "Device",
      entityId: created.id,
      after: { ...created, assetNumberMode },
      ipAddress: ctx.ipAddress,
    });
    return created;
  });
}

export async function updateDevice(data: UpdateData, ctx: OperationContext) {
  const { id, ...fields } = data;
  return db.$transaction(async (tx) => {
    const before = await findEditableDevice(tx, id);
    await assertActiveMasters(tx, fields.categoryId !== before.categoryId ? fields.categoryId : null, null);
    const updated = await tx.device.update({ where: { id }, data: fields });
    await recordAudit(tx, { userId: ctx.user.id, action: "UPDATE", entityType: "Device", entityId: id, before, after: updated, ipAddress: ctx.ipAddress });
    return updated;
  });
}

/**
 * 状態変更 (紛失・修理中への変更や、発見・修理完了による復帰)。
 * 使用中⇔保管中の切り替えは貸出・返却処理、廃棄は廃棄処理で行い、ここでは受け付けない。
 */
export async function changeDeviceStatus(data: StatusChangeData, ctx: OperationContext) {
  return db.$transaction(async (tx) => {
    const before = await findEditableDevice(tx, data.id);
    if (before.status === data.status) {
      throw new BusinessRuleError(`既に「${DEVICE_STATUS_LABELS[data.status]}」です。`);
    }
    const openAssignment = await tx.deviceAssignment.findFirst({ where: { deviceId: before.id, returnedAt: null } });
    if (data.status === "IN_USE" && !openAssignment) {
      throw new BusinessRuleError("貸出中ではない端末を使用中にするには、貸出処理を行ってください。");
    }
    // 修理記録と端末状態がずれないよう、対応中の修理がある間は修理・故障管理から完了させる
    const openMaintenance = await tx.maintenanceRecord.findFirst({
      where: { deviceId: before.id, status: { in: ["REPORTED", "IN_PROGRESS"] } },
    });
    if (openMaintenance && data.status !== "LOST") {
      throw new BusinessRuleError("対応中の修理があります。修理・故障管理で修理を完了または取消にしてください。");
    }
    if (data.status === "IN_STOCK" && openAssignment) {
      throw new BusinessRuleError("貸出中の端末を保管中にするには、返却処理を行ってください。");
    }

    const updated = await tx.device.update({ where: { id: before.id }, data: { status: data.status } });
    await recordAudit(tx, {
      userId: ctx.user.id,
      action: "STATUS_CHANGE",
      entityType: "Device",
      entityId: before.id,
      before: { status: before.status },
      after: { status: updated.status, reason: data.reason },
      ipAddress: ctx.ipAddress,
    });
    return updated;
  });
}

/**
 * 誤登録した端末の削除 (論理削除)。
 * 貸与・移動・修理・廃棄の履歴がある端末は、履歴保全のため削除できない。
 */
export async function deleteDevice(data: DeleteData, ctx: OperationContext) {
  return db.$transaction(async (tx) => {
    const before = await tx.device.findUnique({
      where: { id: data.id },
      include: { _count: { select: { assignments: true, locationHistory: true, maintenance: true } }, disposal: true },
    });
    if (!before || before.deletedAt) throw new BusinessRuleError("対象の端末が見つかりません。");
    const { _count, disposal, ...device } = before;
    if (_count.assignments + _count.locationHistory + _count.maintenance > 0 || disposal) {
      throw new BusinessRuleError("貸与・移動・修理・廃棄の履歴がある端末は削除できません。不要になった端末は廃棄処理を行ってください。");
    }
    const deleted = await tx.device.update({ where: { id: device.id }, data: { deletedAt: new Date() } });
    await recordAudit(tx, {
      userId: ctx.user.id,
      action: "DELETE",
      entityType: "Device",
      entityId: device.id,
      before: device,
      after: { deletedAt: deleted.deletedAt, reason: data.reason },
      ipAddress: ctx.ipAddress,
    });
    return deleted;
  });
}

// ---------------------------------------------------------------------------
// 検索
// ---------------------------------------------------------------------------

export const DEVICE_SEARCH_KEYS = [
  "assetNumber",
  "name",
  "serial",
  "category",
  "manufacturer",
  "user",
  "department",
  "location",
  "status",
  "warranty",
  "overdue",
  "page",
] as const;

export type DeviceSearch = Partial<Record<(typeof DEVICE_SEARCH_KEYS)[number], string>> & PageQuery;

const STATUSES = Object.keys(DEVICE_STATUS_LABELS) as DeviceStatus[];
const contains = (value: string) => ({ contains: value.trim(), mode: "insensitive" as const });

/** 端末一覧の検索条件。指定された条件はすべて AND で組み合わせる */
export function deviceWhere(query: DeviceSearch, today = todayJst()): Prisma.DeviceWhereInput {
  const and: Prisma.DeviceWhereInput[] = [{ deletedAt: null }];

  if (query.assetNumber?.trim()) and.push({ assetNumber: contains(query.assetNumber) });
  if (query.name?.trim()) and.push({ name: contains(query.name) });
  if (query.serial?.trim()) and.push({ serialNumber: contains(query.serial) });
  if (query.manufacturer?.trim()) and.push({ manufacturer: contains(query.manufacturer) });
  if (Number(query.category) > 0) and.push({ categoryId: Number(query.category) });
  if (Number(query.location) > 0) and.push({ currentLocationId: Number(query.location) });
  if (query.user?.trim()) {
    and.push({
      currentEmployee: { OR: [{ name: contains(query.user) }, { employeeNumber: contains(query.user) }] },
    });
  }
  if (Number(query.department) > 0) and.push({ currentEmployee: { departmentId: Number(query.department) } });

  // 状態: 未指定は廃棄済みを除く。"all" で廃棄済みを含む
  if (STATUSES.includes(query.status as DeviceStatus)) and.push({ status: query.status as DeviceStatus });
  else if (query.status !== "all") and.push({ status: { not: "DISPOSED" } });

  if (query.warranty === "soon") and.push({ warrantyExpiry: { gte: today, lte: addDays(today, WARRANTY_WARNING_DAYS) } });
  else if (query.warranty === "expired") and.push({ warrantyExpiry: { lt: today } });
  else if (query.warranty === "none") and.push({ warrantyExpiry: null });

  if (query.overdue === "1") {
    and.push({ assignments: { some: { returnedAt: null, expectedReturnAt: { lt: today } } } });
  }
  return { AND: and };
}

export async function searchDevices(query: DeviceSearch) {
  const where = deviceWhere(query);
  const [total, rows] = await Promise.all([
    db.device.count({ where }),
    db.device.findMany({
      where,
      orderBy: { assetNumber: "asc" },
      ...pageArgs(query),
      include: {
        category: { select: { name: true } },
        currentLocation: { select: { name: true } },
        currentEmployee: { select: { id: true, name: true, department: { select: { name: true } } } },
      },
    }),
  ]);
  return { total, rows };
}

// ---------------------------------------------------------------------------
// 詳細
// ---------------------------------------------------------------------------

export async function getDeviceDetail(id: number) {
  const device = await db.device.findFirst({
    where: { id, deletedAt: null },
    include: {
      category: true,
      currentLocation: true,
      currentEmployee: { include: { department: true } },
      disposal: { include: { disposedBy: { select: { displayName: true } } } },
    },
  });
  if (!device) return null;

  const [assignments, moves, maintenance, logs] = await Promise.all([
    db.deviceAssignment.findMany({
      where: { deviceId: id },
      orderBy: [{ assignedAt: "desc" }, { id: "desc" }],
      include: {
        employee: { select: { id: true, name: true, employeeNumber: true } },
        assignedBy: { select: { displayName: true } },
        returnedBy: { select: { displayName: true } },
      },
    }),
    db.deviceLocationHistory.findMany({
      where: { deviceId: id },
      orderBy: [{ movedAt: "desc" }, { id: "desc" }],
      include: {
        fromLocation: { select: { name: true } },
        toLocation: { select: { name: true } },
        movedBy: { select: { displayName: true } },
      },
    }),
    db.maintenanceRecord.findMany({ where: { deviceId: id }, orderBy: [{ reportedAt: "desc" }, { id: "desc" }] }),
    db.auditLog.findMany({
      where: { entityType: "Device", entityId: String(id) },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { user: { select: { displayName: true } } },
    }),
  ]);

  return {
    device,
    currentAssignment: assignments.find((a) => !a.returnedAt) ?? null,
    assignments,
    moves,
    maintenance,
    logs,
  };
}
