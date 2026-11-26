/**
 * CSV インポートの対象と項目定義 (画面の項目対応付けとサーバーの検証で共通)。
 * aliases は CSV 見出しの自動対応付けに使う (エクスポートした CSV の見出しもそのまま取り込める)。
 */

export type ImportTarget = "devices" | "employees" | "locations";

export type ImportField = {
  key: string;
  label: string;
  required?: boolean;
  aliases?: string[];
  hint?: string;
};

export type ImportMode = "skip" | "upsert";

export const IMPORT_LIMITS = { maxRows: 2000, maxColumns: 60, maxCellLength: 1000, maxFileBytes: 2 * 1024 * 1024 };

export const IMPORT_TARGETS: Record<ImportTarget, { label: string; keyField: string; keyLabel: string; fields: ImportField[] }> = {
  devices: {
    label: "端末",
    keyField: "assetNumber",
    keyLabel: "資産管理番号",
    fields: [
      { key: "assetNumber", label: "資産管理番号", aliases: ["資産番号", "管理番号", "asset_number"], hint: "空欄の場合は資産種別の形式で自動採番" },
      { key: "name", label: "資産名称", required: true, aliases: ["名称", "端末名", "name"] },
      { key: "category", label: "資産種別", required: true, aliases: ["種別", "カテゴリ", "category"], hint: "種別コードまたは種別名" },
      { key: "manufacturer", label: "メーカー", aliases: ["製造元", "manufacturer"] },
      { key: "model", label: "型番", aliases: ["モデル", "model"] },
      { key: "serialNumber", label: "シリアル番号", aliases: ["シリアル", "製造番号", "serial_number", "serial"] },
      { key: "osName", label: "OS", aliases: ["os_name"] },
      { key: "osVersion", label: "OSバージョン", aliases: ["os_version"] },
      { key: "purchaseDate", label: "購入日", aliases: ["purchase_date"], hint: "YYYY-MM-DD または YYYY/MM/DD" },
      { key: "purchasePrice", label: "購入金額", aliases: ["金額", "価格", "purchase_price"] },
      { key: "purchaseVendor", label: "購入先", aliases: ["仕入先", "purchase_vendor"] },
      { key: "warrantyExpiry", label: "保証期限", aliases: ["保証", "warranty_expiry"] },
      { key: "location", label: "現在拠点", required: true, aliases: ["拠点", "設置場所", "location"], hint: "拠点コードまたは拠点名" },
      { key: "status", label: "端末状態", aliases: ["状態", "status"], hint: "保管中 / 修理中 / 紛失 (空欄は保管中)。利用者を指定した場合は使用中" },
      { key: "assigneeNumber", label: "利用者社員番号", aliases: ["利用者", "使用者社員番号", "社員番号"], hint: "新規登録時のみ。指定すると貸出中として登録" },
      { key: "assignedAt", label: "貸出日", aliases: ["assigned_at"], hint: "空欄の場合は本日" },
      { key: "expectedReturnAt", label: "返却予定日", aliases: ["expected_return_at"] },
      { key: "notes", label: "備考", aliases: ["メモ", "notes"] },
    ],
  },
  employees: {
    label: "社員",
    keyField: "employeeNumber",
    keyLabel: "社員番号",
    fields: [
      { key: "employeeNumber", label: "社員番号", required: true, aliases: ["社員ID", "employee_number"] },
      { key: "name", label: "氏名", required: true, aliases: ["名前", "name"] },
      { key: "email", label: "メールアドレス", aliases: ["メール", "email"] },
      { key: "department", label: "部署", aliases: ["所属部署", "department"], hint: "部署コードまたは部署名" },
      { key: "homeLocation", label: "所属拠点", aliases: ["拠点", "home_location"], hint: "拠点コードまたは拠点名" },
      { key: "employmentStatus", label: "在籍状態", aliases: ["状態", "employment_status"], hint: "在籍 / 休職 (空欄は在籍)。退職は退職処理で行う" },
      { key: "joinedAt", label: "入社日", aliases: ["joined_at"] },
    ],
  },
  locations: {
    label: "拠点",
    keyField: "locationCode",
    keyLabel: "拠点コード",
    fields: [
      { key: "locationCode", label: "拠点コード", required: true, aliases: ["コード", "location_code"] },
      { key: "name", label: "拠点名", required: true, aliases: ["名称", "name"] },
      { key: "address", label: "住所", aliases: ["所在地", "address"] },
      { key: "managerName", label: "拠点責任者", aliases: ["責任者", "manager_name"] },
      { key: "phone", label: "電話番号", aliases: ["電話", "TEL", "phone"] },
    ],
  },
};

/**
 * 列の対応付けが必須の項目。
 * 新規のみ登録する場合は登録に必要な項目すべて、更新する場合は既存データを特定するキー項目のみ
 * (更新用の CSV は変更したい列だけでよい。新規登録になる行で不足する値は行ごとのエラーになる)。
 */
export function requiredMappingFields(target: ImportTarget, mode: ImportMode): ImportField[] {
  const def = IMPORT_TARGETS[target];
  return mode === "upsert" ? def.fields.filter((f) => f.key === def.keyField) : def.fields.filter((f) => f.required);
}

const normalizeHeader = (h: string) => h.replace(/^﻿/, "").replace(/[\s_\-（）()]/g, "").toLowerCase();

/** CSV の見出しから項目の対応付けを推定する。戻り値は 項目key → 列番号 */
export function guessMapping(target: ImportTarget, headers: string[]): Record<string, number | null> {
  const normalized = headers.map(normalizeHeader);
  const used = new Set<number>();
  const mapping: Record<string, number | null> = {};
  for (const field of IMPORT_TARGETS[target].fields) {
    const candidates = [field.label, field.key, ...(field.aliases ?? [])].map(normalizeHeader);
    const index = candidates.map((c) => normalized.findIndex((h, i) => h === c && !used.has(i))).find((i) => i >= 0);
    mapping[field.key] = index ?? null;
    if (index !== undefined) used.add(index);
  }
  return mapping;
}
