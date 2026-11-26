import { db } from "@/lib/db";
import { pageArgs, type PageQuery } from "@/lib/pagination";
import type { Prisma } from "@/generated/prisma/client";

export const AUDIT_SEARCH_KEYS = ["user", "action", "entity", "entityId", "since", "until", "page"] as const;
export type AuditSearch = Partial<Record<(typeof AUDIT_SEARCH_KEYS)[number], string>> & PageQuery;

/** 期間は日本時間の日付で指定する (until はその日の終わりまで) */
function jstDayStart(value: string, addDays = 0): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const d = new Date(`${value}T00:00:00+09:00`);
  return Number.isNaN(d.getTime()) ? null : new Date(d.getTime() + addDays * 86_400_000);
}

export function auditWhere(query: AuditSearch): Prisma.AuditLogWhereInput {
  const and: Prisma.AuditLogWhereInput[] = [];
  if (Number(query.user) > 0) and.push({ userId: Number(query.user) });
  if (query.action) and.push({ action: query.action });
  if (query.entity) and.push({ entityType: query.entity });
  if (query.entityId?.trim()) and.push({ entityId: query.entityId.trim() });
  const since = query.since ? jstDayStart(query.since) : null;
  const until = query.until ? jstDayStart(query.until, 1) : null;
  if (since) and.push({ createdAt: { gte: since } });
  if (until) and.push({ createdAt: { lt: until } });
  return { AND: and };
}

export async function searchAuditLogs(query: AuditSearch) {
  const where = auditWhere(query);
  const [total, rows] = await Promise.all([
    db.auditLog.count({ where }),
    db.auditLog.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      ...pageArgs(query),
      include: { user: { select: { displayName: true, email: true } } },
    }),
  ]);
  return { total, rows };
}
