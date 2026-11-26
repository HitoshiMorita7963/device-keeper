import type { z } from "zod";
import { db } from "@/lib/db";
import { recordAudit } from "@/lib/audit";
import { BusinessRuleError } from "@/lib/auth/errors";
import { pageArgs, type PageQuery } from "@/lib/pagination";
import type { locationSchema } from "@/lib/validation/masters";
import type { OperationContext } from "./context";

type LocationData = z.output<typeof locationSchema>;

const ACTIVE_DEVICE = { deletedAt: null, status: { not: "DISPOSED" as const } };

export async function createLocation(data: LocationData, ctx: OperationContext) {
  return db.$transaction(async (tx) => {
    const created = await tx.location.create({ data });
    await recordAudit(tx, { userId: ctx.user.id, action: "CREATE", entityType: "Location", entityId: created.id, after: created, ipAddress: ctx.ipAddress });
    return created;
  });
}

export async function updateLocation(id: number, data: LocationData, ctx: OperationContext) {
  return db.$transaction(async (tx) => {
    const before = await tx.location.findUniqueOrThrow({ where: { id } });
    if (before.isActive && !data.isActive) {
      const devices = await tx.device.count({ where: { currentLocationId: id, ...ACTIVE_DEVICE } });
      if (devices > 0) {
        throw new BusinessRuleError(`この拠点には端末が ${devices} 台あるため、使用停止にできません。先に端末を他拠点へ移動してください。`);
      }
    }
    const updated = await tx.location.update({ where: { id }, data });
    await recordAudit(tx, { userId: ctx.user.id, action: "UPDATE", entityType: "Location", entityId: id, before, after: updated, ipAddress: ctx.ipAddress });
    return updated;
  });
}

export type LocationSearch = { q?: string; active?: "1" | "0" } & PageQuery;

export async function searchLocations(query: LocationSearch) {
  const q = query.q?.trim();
  const where = {
    ...(q
      ? {
          OR: [
            { locationCode: { contains: q, mode: "insensitive" as const } },
            { name: { contains: q, mode: "insensitive" as const } },
            { address: { contains: q, mode: "insensitive" as const } },
          ],
        }
      : {}),
    ...(query.active === "1" ? { isActive: true } : query.active === "0" ? { isActive: false } : {}),
  };
  const [total, rows] = await Promise.all([
    db.location.count({ where }),
    db.location.findMany({
      where,
      orderBy: { locationCode: "asc" },
      ...pageArgs(query),
      include: { _count: { select: { devices: { where: ACTIVE_DEVICE } } } },
    }),
  ]);
  return { total, rows };
}

export async function getLocationDetail(id: number) {
  const location = await db.location.findUnique({ where: { id } });
  if (!location) return null;

  const [devices, byCategory, categories, moves] = await Promise.all([
    db.device.findMany({
      where: { currentLocationId: id, ...ACTIVE_DEVICE },
      orderBy: { assetNumber: "asc" },
      include: { category: { select: { name: true } }, currentEmployee: { select: { id: true, name: true } } },
    }),
    db.device.groupBy({ by: ["categoryId"], where: { currentLocationId: id, ...ACTIVE_DEVICE }, _count: { _all: true } }),
    db.deviceCategory.findMany({ select: { id: true, name: true }, orderBy: { categoryCode: "asc" } }),
    db.deviceLocationHistory.findMany({
      where: { OR: [{ fromLocationId: id }, { toLocationId: id }] },
      orderBy: [{ movedAt: "desc" }, { id: "desc" }],
      take: 50,
      include: {
        device: { select: { id: true, assetNumber: true, name: true } },
        fromLocation: { select: { name: true } },
        toLocation: { select: { name: true } },
        movedBy: { select: { displayName: true } },
      },
    }),
  ]);

  const counts = new Map(byCategory.map((c) => [c.categoryId, c._count._all]));
  return {
    location,
    devices,
    categorySummary: categories.filter((c) => counts.has(c.id)).map((c) => ({ ...c, count: counts.get(c.id)! })),
    moves,
  };
}
