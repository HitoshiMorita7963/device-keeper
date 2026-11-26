import { db } from "@/lib/db";
import { toCsv } from "@/lib/csv/format";
import { IMPORT_TARGETS, type ImportTarget } from "@/lib/csv/fields";
import { toDateInput } from "@/lib/dates";
import { DEVICE_STATUS_LABELS, EMPLOYMENT_STATUS_LABELS } from "@/lib/labels";
import { assignmentWhere, type AssignmentSearch } from "./assignments";
import { deviceWhere, type DeviceSearch } from "./devices";
import { employeeWhere, type EmployeeSearch } from "./employees";

export type ExportType = "devices" | "devices-by-location" | "employees" | "assignments";

export const EXPORT_TYPES: Record<ExportType, { label: string; filename: string }> = {
  devices: { label: "端末一覧", filename: "devices" },
  "devices-by-location": { label: "拠点別端末一覧", filename: "devices_by_location" },
  employees: { label: "社員一覧", filename: "employees" },
  assignments: { label: "貸出履歴", filename: "assignments" },
};

const date = (d: Date | null | undefined) => toDateInput(d);

/** 端末一覧。見出しはインポートの項目名と同じにし、そのまま再取り込みできるようにする */
async function devicesCsv(query: DeviceSearch, byLocation: boolean) {
  const devices = await db.device.findMany({
    where: deviceWhere(query),
    orderBy: byLocation ? [{ currentLocation: { locationCode: "asc" } }, { assetNumber: "asc" }] : { assetNumber: "asc" },
    include: {
      category: true,
      currentLocation: true,
      currentEmployee: { include: { department: true } },
      assignments: { where: { returnedAt: null }, take: 1 },
    },
  });
  const headers = [
    ...(byLocation ? ["拠点コード"] : []),
    "資産管理番号", "資産名称", "資産種別", "メーカー", "型番", "シリアル番号", "OS", "OSバージョン",
    "購入日", "購入金額", "購入先", "保証期限", "現在拠点", "端末状態",
    "利用者社員番号", "利用者氏名", "利用者部署", "貸出日", "返却予定日", "備考",
  ];
  const rows = devices.map((d) => {
    const open = d.assignments[0];
    return [
      ...(byLocation ? [d.currentLocation.locationCode] : []),
      d.assetNumber, d.name, d.category.name, d.manufacturer, d.model, d.serialNumber, d.osName, d.osVersion,
      date(d.purchaseDate), d.purchasePrice, d.purchaseVendor, date(d.warrantyExpiry), d.currentLocation.name,
      DEVICE_STATUS_LABELS[d.status],
      d.currentEmployee?.employeeNumber, d.currentEmployee?.name, d.currentEmployee?.department?.name,
      date(open?.assignedAt), date(open?.expectedReturnAt), d.notes,
    ];
  });
  return { csv: toCsv(headers, rows), count: rows.length };
}

async function employeesCsv(query: EmployeeSearch) {
  const employees = await db.employee.findMany({
    where: employeeWhere(query),
    orderBy: { employeeNumber: "asc" },
    include: { department: true, homeLocation: true, _count: { select: { assignments: { where: { returnedAt: null } } } } },
  });
  const headers = ["社員番号", "氏名", "メールアドレス", "部署", "所属拠点", "在籍状態", "入社日", "退職日", "貸与端末数"];
  const rows = employees.map((e) => [
    e.employeeNumber, e.name, e.email, e.department?.name, e.homeLocation?.name,
    EMPLOYMENT_STATUS_LABELS[e.employmentStatus], date(e.joinedAt), date(e.retiredAt), e._count.assignments,
  ]);
  return { csv: toCsv(headers, rows), count: rows.length };
}

async function assignmentsCsv(query: AssignmentSearch) {
  const assignments = await db.deviceAssignment.findMany({
    where: assignmentWhere(query),
    orderBy: [{ assignedAt: "desc" }, { id: "desc" }],
    include: {
      device: true,
      employee: { include: { department: true } },
      assignedBy: true,
      returnedBy: true,
    },
  });
  const headers = [
    "資産管理番号", "資産名称", "社員番号", "氏名", "部署", "貸出日", "返却予定日", "返却日",
    "返却時状態", "付属品確認", "貸出担当者", "返却担当者", "備考",
  ];
  const rows = assignments.map((a) => [
    a.device.assetNumber, a.device.name, a.employee.employeeNumber, a.employee.name, a.employee.department?.name,
    date(a.assignedAt), date(a.expectedReturnAt), date(a.returnedAt), a.conditionOnReturn,
    a.accessoriesChecked === null ? "" : a.accessoriesChecked ? "確認済み" : "未確認",
    a.assignedBy?.displayName, a.returnedBy?.displayName, a.notes,
  ]);
  return { csv: toCsv(headers, rows), count: rows.length };
}

export async function buildExport(type: ExportType, query: Record<string, string>) {
  switch (type) {
    case "devices":
      return devicesCsv(query, false);
    case "devices-by-location":
      return devicesCsv(query, true);
    case "employees":
      return employeesCsv(query);
    case "assignments":
      return assignmentsCsv(query);
  }
}

/** インポート用のテンプレート (見出し行のみ) */
export function buildTemplate(target: ImportTarget) {
  return toCsv(IMPORT_TARGETS[target].fields.map((f) => f.label), []);
}
