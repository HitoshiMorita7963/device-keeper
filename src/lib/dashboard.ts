import { db } from "@/lib/db";
import { addDays, todayJst } from "@/lib/dates";

/** 保証期限「間近」とみなす日数 */
export const WARRANTY_WARNING_DAYS = 60;

export async function getDashboardSummary() {
  const today = todayJst();
  const active = { deletedAt: null, status: { not: "DISPOSED" as const } };

  const [byStatus, overdue, warrantySoon, byLocation, locations, recentLogs] = await Promise.all([
    db.device.groupBy({ by: ["status"], where: { deletedAt: null }, _count: { _all: true } }),
    db.deviceAssignment.count({
      where: { returnedAt: null, expectedReturnAt: { lt: today }, device: { deletedAt: null } },
    }),
    db.device.count({
      where: { ...active, warrantyExpiry: { gte: today, lte: addDays(today, WARRANTY_WARNING_DAYS) } },
    }),
    db.device.groupBy({ by: ["currentLocationId"], where: active, _count: { _all: true } }),
    db.location.findMany({ select: { id: true, name: true, isActive: true }, orderBy: { locationCode: "asc" } }),
    db.auditLog.findMany({
      take: 10,
      orderBy: { createdAt: "desc" },
      where: { action: { notIn: ["LOGIN", "LOGIN_FAILED"] } },
      include: { user: { select: { displayName: true } } },
    }),
  ]);

  const count = (status: string) => byStatus.find((s) => s.status === status)?._count._all ?? 0;
  const perLocation = new Map(byLocation.map((l) => [l.currentLocationId, l._count._all]));

  return {
    total: byStatus.filter((s) => s.status !== "DISPOSED").reduce((sum, s) => sum + s._count._all, 0),
    inUse: count("IN_USE"),
    inStock: count("IN_STOCK"),
    repair: count("REPAIR"),
    lost: count("LOST"),
    overdue,
    warrantySoon,
    // 使用停止中の拠点は端末が残っている場合のみ表示する
    byLocation: locations
      .filter((l) => l.isActive || perLocation.has(l.id))
      .map((l) => ({ id: l.id, name: l.name, count: perLocation.get(l.id) ?? 0 })),
    recentLogs,
  };
}
