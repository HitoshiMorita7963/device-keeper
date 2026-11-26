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

/** 取り込み時の追加設定 (端末のみ) */
export type ImportOptions = {
  /** CSV に資産種別の列がない場合に全行へ適用する資産種別 */
  defaultCategoryId: number | null;
  /** 見つからない社員・部署・拠点を自動で登録する */
  autoCreate: boolean;
};

export const DEFAULT_IMPORT_OPTIONS: ImportOptions = { defaultCategoryId: null, autoCreate: false };

export const IMPORT_LIMITS = { maxRows: 2000, maxColumns: 60, maxCellLength: 1000, maxFileBytes: 2 * 1024 * 1024 };

export const IMPORT_TARGETS: Record<ImportTarget, { label: string; keyField: string; keyLabel: string; fields: ImportField[] }> = {
  devices: {
    label: "端末",
    keyField: "assetNumber",
    keyLabel: "資産管理番号",
    fields: [
      { key: "assetNumber", label: "資産管理番号", aliases: ["端末番号", "端末No", "資産番号", "管理番号", "asset_number"], hint: "空欄の場合は資産種別の形式で自動採番" },
      { key: "name", label: "資産名称", aliases: ["名称", "端末名", "name"], hint: "空欄の場合は機種名 → ホスト名を名称にする" },
      { key: "category", label: "資産種別", required: true, aliases: ["種別", "カテゴリ", "category"], hint: "種別コードまたは種別名。列がない場合は取り込み時にまとめて指定" },
      { key: "manufacturer", label: "メーカー", aliases: ["製造元", "manufacturer"] },
      { key: "model", label: "型番 (機種名)", aliases: ["型番", "機種名", "機種", "モデル", "model"] },
      { key: "serialNumber", label: "シリアル番号", aliases: ["シリアル", "製造番号", "serial_number", "serial"] },
      { key: "hostname", label: "ホスト名", aliases: ["コンピューター名", "コンピュータ名", "PC名", "hostname"] },
      { key: "purpose", label: "用途", aliases: ["purpose"] },
      { key: "osName", label: "OS", aliases: ["os_name"] },
      { key: "osVersion", label: "OSバージョン", aliases: ["os_version"] },
      { key: "cpu", label: "CPU", aliases: ["プロセッサ"] },
      { key: "memory", label: "メモリ", aliases: ["RAM", "memory"] },
      { key: "disk", label: "ディスク", aliases: ["ストレージ", "HDD", "SSD", "disk"] },
      { key: "purchaseDate", label: "購入日", aliases: ["purchase_date"], hint: "2024/4/1・2024年4月1日・R6.4.1・Excel の日付値に対応" },
      { key: "purchasePrice", label: "購入金額", aliases: ["購入価格", "購入価格税抜", "金額", "価格", "purchase_price"], hint: "¥・円・カンマは自動で除去" },
      { key: "purchaseVendor", label: "購入先", aliases: ["仕入先", "purchase_vendor"] },
      { key: "warrantyExpiry", label: "保証期限", aliases: ["サポート", "サポート期限", "保守期限", "保証", "warranty_expiry"], hint: "日付でない値 (「あり」等) は備考に入れる" },
      { key: "location", label: "現在拠点", required: true, aliases: ["拠点", "設置場所", "location"], hint: "拠点コードまたは拠点名" },
      { key: "status", label: "端末状態", aliases: ["ステータス", "状態", "status"], hint: "使用中・貸出中 / 保管中・在庫 / 修理中 / 紛失 など。空欄は利用者がいれば使用中" },
      { key: "assigneeNumber", label: "利用者社員番号", aliases: ["使用者社員番号", "社員番号"], hint: "新規登録時のみ。指定すると貸出中として登録" },
      { key: "assigneeName", label: "利用者氏名", aliases: ["氏名", "利用者", "使用者", "名前"], hint: "社員番号がない場合に氏名で社員を照合 (新規登録時のみ)" },
      { key: "assigneeDepartment", label: "利用者の所属", aliases: ["所属", "利用者部署", "所属部署"], hint: "社員を自動登録する場合の部署" },
      { key: "assignedAt", label: "貸出日", aliases: ["assigned_at"], hint: "空欄の場合は本日" },
      { key: "expectedReturnAt", label: "返却予定日", aliases: ["expected_return_at"] },
      { key: "returnedAt", label: "返却日", aliases: ["returned_at"], hint: "入力がある場合は返却済みの貸出履歴として登録" },
      { key: "homeLoanedAt", label: "自宅貸出日", aliases: ["持ち帰り日"] },
      { key: "recovery", label: "リカバリ", aliases: ["recovery"] },
      { key: "initialUser", label: "初期ユーザ", aliases: ["初期ユーザー", "初期ユーザ名"] },
      { key: "initialPassword", label: "初期ユーザのパスワード", aliases: ["PW", "初期PW", "初期パスワード"], hint: "暗号化して保存 (管理者のみ表示可)" },
      { key: "loginUser", label: "ユーザー名", aliases: ["ユーザ名", "ログインユーザー"] },
      { key: "loginPassword", label: "ユーザーのパスワード", aliases: ["PW2", "パスワード", "パスワード2"], hint: "暗号化して保存 (管理者のみ表示可)" },
      { key: "notes", label: "備考", aliases: ["備考1", "メモ", "notes"] },
      { key: "notes2", label: "備考2", aliases: ["備考2"], hint: "備考の後に続けて保存" },
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
export function requiredMappingFields(target: ImportTarget, mode: ImportMode, options: ImportOptions = DEFAULT_IMPORT_OPTIONS): ImportField[] {
  const def = IMPORT_TARGETS[target];
  if (mode === "upsert") return def.fields.filter((f) => f.key === def.keyField);
  // 資産種別をまとめて指定した場合は、資産種別の列は不要
  return def.fields.filter((f) => f.required && !(f.key === "category" && options.defaultCategoryId));
}

/** 見出しの表記ゆれを吸収する (全角/半角・丸数字・空白・括弧) */
const normalizeHeader = (h: string) => h.normalize("NFKC").replace(/^\uFEFF/, "").replace(/[\s_\-()]/g, "").toLowerCase();

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
