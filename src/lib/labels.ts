import type { DeviceStatus, EmploymentStatus, MaintenanceStatus, Role } from "@/generated/prisma/enums";
import { ROLE_LABELS } from "@/lib/auth/permissions";

export const DEVICE_STATUS_LABELS: Record<DeviceStatus, string> = {
  IN_STOCK: "保管中",
  IN_USE: "使用中",
  REPAIR: "修理中",
  LOST: "紛失",
  DISPOSED: "廃棄済み",
};

export const EMPLOYMENT_STATUS_LABELS: Record<EmploymentStatus, string> = {
  ACTIVE: "在籍",
  ON_LEAVE: "休職",
  RETIRED: "退職",
};

export const MAINTENANCE_STATUS_LABELS: Record<MaintenanceStatus, string> = {
  REPORTED: "受付",
  IN_PROGRESS: "修理中",
  COMPLETED: "完了",
  CANCELLED: "取消",
};

const ACTION_LABELS: Record<string, string> = {
  LOGIN: "ログイン",
  LOGIN_FAILED: "ログイン失敗",
  ACCOUNT_LOCKED: "アカウントロック",
  CREATE: "登録",
  UPDATE: "更新",
  DELETE: "削除",
  STATUS_CHANGE: "状態変更",
  ASSIGN: "貸出",
  RETURN: "返却",
  MOVE: "拠点移動",
  MAINTENANCE_CREATE: "修理受付",
  MAINTENANCE_UPDATE: "修理更新",
  DISPOSE: "廃棄",
  RETIRE: "退職処理",
  CSV_IMPORT: "CSVインポート",
  CSV_EXPORT: "CSVエクスポート",
  PASSWORD_RESET: "パスワード再設定",
  PASSWORD_CHANGE: "パスワード変更",
  SECRET_VIEW: "端末パスワード表示",
  SECRET_UPDATE: "端末ログイン情報変更",
  MANAGEMENT_NAME_UPDATE: "管理用端末名変更",
  COMPUTER_NAME_UPDATE: "PC名取得",
  AGENT_TOKEN_ISSUE: "端末連携キー発行",
  AGENT_TOKEN_REVOKE: "端末連携キー無効化",
  AGENT_AUTH_FAILED: "PC名送信の認証失敗",
};

const ENTITY_LABELS: Record<string, string> = {
  User: "利用者",
  Device: "端末",
  Employee: "社員",
  Location: "拠点",
  Department: "部署",
  DeviceCategory: "資産種別",
  DeviceAssignment: "貸与",
  MaintenanceRecord: "修理",
  DisposalRecord: "廃棄",
  Csv: "CSV",
};

export function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action;
}

export function entityLabel(entityType: string): string {
  return ENTITY_LABELS[entityType] ?? entityType;
}

/** 操作履歴の変更内容を表示するときの項目名 */
const FIELD_LABELS: Record<string, string> = {
  assetNumber: "資産管理番号",
  name: "名称",
  categoryId: "資産種別",
  manufacturer: "メーカー",
  model: "型番",
  serialNumber: "シリアル番号",
  osName: "OS",
  osVersion: "OSバージョン",
  purchaseDate: "購入日",
  purchasePrice: "購入金額",
  purchaseVendor: "購入先",
  warrantyExpiry: "保証期限",
  currentLocationId: "現在拠点",
  currentEmployeeId: "現在利用者",
  status: "状態",
  notes: "備考",
  reason: "理由",
  deletedAt: "削除日時",
  employeeNumber: "社員番号",
  email: "メールアドレス",
  departmentId: "部署",
  homeLocationId: "所属拠点",
  employmentStatus: "在籍状態",
  joinedAt: "入社日",
  retiredAt: "退職日",
  locationCode: "拠点コード",
  address: "住所",
  managerName: "拠点責任者",
  phone: "電話番号",
  isActive: "使用状態",
  departmentCode: "部署コード",
  categoryCode: "種別コード",
  prefix: "採番プレフィックス",
  numberDigits: "採番桁数",
  role: "権限",
  displayName: "表示名",
  // Excel 台帳から引き継いだ端末項目
  hostname: "ホスト名",
  computerName: "PC名",
  managementName: "管理用端末名",
  reissued: "再発行",
  purpose: "用途",
  cpu: "CPU",
  memory: "メモリ",
  disk: "ディスク",
  homeLoanedAt: "自宅貸出日",
  recovery: "リカバリ",
  initialUser: "初期ユーザ",
  loginUser: "ユーザー名",
  field: "対象",
  initialPasswordChanged: "初期ユーザのPW",
  loginPasswordChanged: "ユーザーのPW",
  // 貸出・返却・移動
  employee: "利用者",
  location: "拠点",
  assignedAt: "貸出日",
  expectedReturnAt: "返却予定日",
  returnedAt: "返却日",
  conditionOnReturn: "返却時状態",
  accessoriesChecked: "付属品確認",
  movedAt: "移動日",
  // 修理・廃棄
  reportedAt: "受付日",
  problemDescription: "故障内容",
  repairVendor: "修理業者",
  repairCost: "修理費用",
  repairedAt: "修理完了日",
  deviceStatus: "端末状態",
  previousDeviceStatus: "受付前の端末状態",
  disposedAt: "廃棄日",
  disposalReason: "廃棄理由",
  disposalMethod: "廃棄方法",
  disposalVendor: "廃棄業者",
  dataErasure: "データ消去",
  // 退職処理
  openAssignments: "貸与中の端末数",
  note: "補足",
  userDeactivated: "利用者アカウント無効化",
  // CSV
  source: "登録方法",
  target: "対象",
  type: "出力内容",
  mode: "既存データの扱い",
  count: "件数",
  conditions: "条件",
  total: "全行",
  create: "登録",
  update: "更新",
  skip: "スキップ",
  error: "エラー",
};

export function fieldLabel(key: string): string {
  return FIELD_LABELS[key] ?? key;
}

/** 操作履歴の値を表示用文字列にする */
export function formatAuditValue(key: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return "(なし)";
  if (typeof value === "string") {
    // 状態は端末・修理のどちらの記録かを値から判定する
    if ((key === "status" || key === "deviceStatus" || key === "previousDeviceStatus") && value in DEVICE_STATUS_LABELS) {
      return DEVICE_STATUS_LABELS[value as DeviceStatus];
    }
    if (key === "status" && value in MAINTENANCE_STATUS_LABELS) return MAINTENANCE_STATUS_LABELS[value as MaintenanceStatus];
    if (key === "employmentStatus" && value in EMPLOYMENT_STATUS_LABELS) return EMPLOYMENT_STATUS_LABELS[value as EmploymentStatus];
    if (key === "role" && value in ROLE_LABELS) return ROLE_LABELS[value as Role];
    if (key === "mode") return value === "upsert" ? "更新する" : value === "skip" ? "スキップする" : value;
  }
  if (key === "conditions" && value && typeof value === "object" && Object.keys(value).length === 0) return "なし (全件)";
  if (typeof value === "boolean") return key === "isActive" ? (value ? "使用中" : "使用停止") : value ? "はい" : "いいえ";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T00:00:00(\.000)?Z$/.test(value)) return value.slice(0, 10).replaceAll("-", "/");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/** 操作履歴の絞り込みに使う選択肢 */
export const AUDIT_ACTION_OPTIONS = Object.entries(ACTION_LABELS).map(([value, label]) => ({ value, label }));
export const AUDIT_ENTITY_OPTIONS = Object.entries(ENTITY_LABELS).map(([value, label]) => ({ value, label }));

/** 操作対象の詳細画面 (存在する場合) */
export function entityHref(entityType: string, entityId: string | null): string | null {
  if (!entityId || !/^\d+$/.test(entityId)) return null;
  const base: Record<string, string> = { Device: "/devices", Employee: "/employees", Location: "/locations" };
  return base[entityType] ? `${base[entityType]}/${entityId}` : null;
}
