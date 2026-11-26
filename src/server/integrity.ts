import { db, type AppPrismaClient } from "@/lib/db";
import { DEVICE_STATUS_LABELS } from "@/lib/labels";

export type IntegrityIssue = {
  severity: "error" | "warning";
  check: string;
  deviceId?: number;
  assetNumber?: string;
  message: string;
};

const OPEN_MAINTENANCE = new Set(["REPORTED", "IN_PROGRESS"]);

/**
 * 端末状態と各履歴の整合性を確認する (読み取りのみ)。
 * error: 業務処理の不具合や DB の直接編集などで生じた矛盾。warning: 運用上起こりうるが確認が必要な状態。
 * バックアップから復元した後の確認にも使う (scripts/check-integrity.ts)。
 */
export async function checkIntegrity(client: Pick<AppPrismaClient, "device" | "employee"> = db): Promise<IntegrityIssue[]> {
  const issues: IntegrityIssue[] = [];
  const devices = await client.device.findMany({
    orderBy: { assetNumber: "asc" },
    include: {
      assignments: { where: { returnedAt: null } },
      maintenance: { select: { status: true } },
      disposal: { select: { id: true } },
      locationHistory: { orderBy: [{ movedAt: "desc" }, { id: "desc" }], take: 1 },
    },
  });

  for (const d of devices) {
    const add = (severity: IntegrityIssue["severity"], check: string, message: string) =>
      issues.push({ severity, check, deviceId: d.id, assetNumber: d.assetNumber, message });
    const open = d.assignments;
    const openMaintenance = d.maintenance.filter((m) => OPEN_MAINTENANCE.has(m.status)).length;
    const status = DEVICE_STATUS_LABELS[d.status];

    if (open.length > 1) add("error", "貸与", `未返却の貸与が ${open.length} 件あります。`);
    if (d.status === "IN_USE" && open.length === 0) add("error", "貸与", "使用中ですが未返却の貸与がありません。");
    if (open.length > 0 && (d.status === "IN_STOCK" || d.status === "DISPOSED")) add("error", "貸与", `未返却の貸与がありますが状態が「${status}」です。`);
    const openEmployee = open[0]?.employeeId ?? null;
    if (d.currentEmployeeId !== openEmployee) add("error", "利用者", "現在利用者と未返却の貸与の社員が一致しません。");
    if (d.deletedAt && open.length > 0) add("error", "削除", "削除済みですが未返却の貸与があります。");

    if (d.status === "DISPOSED" && !d.disposal) add("error", "廃棄", "廃棄済みですが廃棄記録がありません。");
    if (d.disposal && d.status !== "DISPOSED") add("error", "廃棄", `廃棄記録がありますが状態が「${status}」です。`);

    if (openMaintenance > 1) add("error", "修理", `対応中の修理が ${openMaintenance} 件あります。`);
    if (openMaintenance > 0 && d.status !== "REPAIR" && d.status !== "LOST") add("error", "修理", `対応中の修理がありますが状態が「${status}」です。`);
    if (d.status === "REPAIR" && openMaintenance === 0) add("warning", "修理", "修理中ですが対応中の修理記録がありません (状態変更で修理中にした端末)。");

    const lastMove = d.locationHistory[0];
    if (lastMove && lastMove.toLocationId !== d.currentLocationId) add("error", "拠点", "現在拠点が最後の移動履歴の移動先と一致しません。");
  }

  const retiredWithDevices = await client.employee.findMany({
    where: { employmentStatus: "RETIRED", assignments: { some: { returnedAt: null } } },
    select: { employeeNumber: true, name: true, _count: { select: { assignments: { where: { returnedAt: null } } } } },
  });
  for (const e of retiredWithDevices) {
    issues.push({
      severity: "warning",
      check: "退職者",
      message: `退職済みの ${e.name} (${e.employeeNumber}) さんに未返却の端末が ${e._count.assignments} 台あります。`,
    });
  }
  return issues;
}
