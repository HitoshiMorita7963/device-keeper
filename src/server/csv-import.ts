import type { z } from "zod";
import { db } from "@/lib/db";
import { recordAudit } from "@/lib/audit";
import { BusinessRuleError } from "@/lib/auth/errors";
import { decryptSecret, encryptSecret, hasSecretKey, SecretKeyError } from "@/lib/crypto/secret";
import { stripFormulaGuard } from "@/lib/csv/format";
import { IMPORT_TARGETS, requiredMappingFields, type ImportTarget } from "@/lib/csv/fields";
import { matchKey, normalizeAmountText, normalizeDateText, normalizeDeviceStatus } from "@/lib/csv/normalize";
import { parseDateOnly, todayJst, toDateInput } from "@/lib/dates";
import { DEVICE_STATUS_LABELS } from "@/lib/labels";
import type { Prisma } from "@/generated/prisma/client";
import type { DeviceStatus, EmploymentStatus } from "@/generated/prisma/enums";
import { deviceCreateSchema, deviceUpdateSchema } from "@/lib/validation/devices";
import { employeeSchema, locationSchema } from "@/lib/validation/masters";
import type { ImportRequest } from "@/lib/validation/csv";
import type { OperationContext } from "./context";
import { issueAssetNumber } from "./devices";

type Tx = Prisma.TransactionClient;

export type RowAction = "create" | "update" | "skip" | "error";

/** 画面に返す行ごとの判定結果 */
export type RowResult = { line: number; key: string; name: string; action: RowAction; messages: string[] };

export type ImportSummary = Record<RowAction, number> & { total: number };

/** 取り込みに合わせて自動登録するマスタ (画面の確認用) */
export type AutoCreated = { departments: string[]; locations: string[]; employees: string[] };

/** 既存データの ID、または同じ取り込みで新規登録するデータのキー */
type Ref = { id: number } | { newKey: string };

type DeviceSecrets = {
  initialUser?: string | null;
  loginUser?: string | null;
  initialPasswordEnc?: string;
  loginPasswordEnc?: string;
};

type DeviceAssignmentPlan = {
  employeeRef: Ref;
  employeeLabel: string;
  assignedAt: Date;
  expectedReturnAt: Date | null;
  returnedAt: Date | null;
};

/** 登録・更新の実行内容 (サーバー内部でのみ使用。暗号化前のパスワードは保持しない) */
type Plan =
  | {
      kind: "device-create";
      data: z.output<typeof deviceCreateSchema>;
      locationRef: Ref;
      status: DeviceStatus;
      secrets: DeviceSecrets;
      assignment: DeviceAssignmentPlan | null;
    }
  | { kind: "device-update"; id: number; before: Record<string, unknown>; data: Omit<z.output<typeof deviceUpdateSchema>, "id">; secrets: DeviceSecrets }
  | { kind: "employee-create"; data: z.output<typeof employeeSchema> }
  | { kind: "employee-update"; id: number; before: Record<string, unknown>; data: z.output<typeof employeeSchema> }
  | { kind: "location-create"; data: z.output<typeof locationSchema> }
  | { kind: "location-update"; id: number; before: Record<string, unknown>; data: z.output<typeof locationSchema> };

type Planned = RowResult & { plan?: Plan };

/** 自動登録するマスタ。社員の部署・拠点は、既存または同じ取り込みで登録するものを参照する */
type NewMasters = {
  departments: { key: string; code: string; name: string }[];
  locations: { key: string; code: string; name: string }[];
  employees: { key: string; number: string; name: string; departmentRef: Ref | null; locationRef: Ref }[];
};

type PlanResult = { rows: Planned[]; newMasters?: NewMasters };

// ---------------------------------------------------------------------------
// 共通
// ---------------------------------------------------------------------------

/** 行から項目値を取り出す。列が対応付けられていない項目は undefined */
function reader(req: ImportRequest, row: string[]) {
  return (key: string): string | undefined => {
    const index = req.mapping[key];
    if (index === null || index === undefined) return undefined;
    return stripFormulaGuard((row[index] ?? "").trim());
  };
}

const isMapped = (req: ImportRequest, key: string) => req.mapping[key] !== null && req.mapping[key] !== undefined;

/** zod のエラーを「項目名: メッセージ」に変換する */
function zodMessages(target: ImportTarget, issues: z.core.$ZodIssue[]): string[] {
  const alias: Record<string, string> = { categoryId: "category", currentLocationId: "location", departmentId: "department", homeLocationId: "homeLocation" };
  return issues.map((issue) => {
    const key = String(issue.path[0] ?? "");
    const label = IMPORT_TARGETS[target].fields.find((f) => f.key === (alias[key] ?? key))?.label;
    return label ? `${label}: ${issue.message}` : issue.message;
  });
}

/** コードまたは名称でマスタを引くための索引 (全角/半角・空白の違いは無視) */
function masterIndex<T extends { id: number; name: string; isActive: boolean }>(items: T[], code: (item: T) => string) {
  const map = new Map<string, T>();
  for (const item of items) {
    map.set(matchKey(item.name), item);
    map.set(matchKey(code(item)), item);
  }
  return (value: string) => map.get(matchKey(value));
}

const str = (v: unknown) => (v === null || v === undefined ? "" : v instanceof Date ? toDateInput(v) : String(v));

/** 更新の場合: CSV が空欄・未対応付けの項目は既存の値を使う (CSV で値を消すことはしない) */
const pick = (value: string | undefined, existing: unknown) => (value === undefined || value === "" ? str(existing) : value);

function changedKeys(before: Record<string, unknown>, after: Record<string, unknown>) {
  return Object.keys(after).filter((k) => str(before[k]) !== str(after[k]));
}

const EMPLOYMENT_STATUS_INPUT: Record<string, EmploymentStatus> = {
  在籍: "ACTIVE", active: "ACTIVE",
  休職: "ON_LEAVE", on_leave: "ON_LEAVE",
  退職: "RETIRED", retired: "RETIRED",
};

/** 既存のコードと重ならない連番のコードを発行する (AUTO-0001 など) */
function codeIssuer(prefix: string, digits: number, existing: Iterable<string>) {
  const used = new Set([...existing].map((c) => c.toUpperCase()));
  let n = 0;
  return () => {
    let code: string;
    do code = `${prefix}-${String(++n).padStart(digits, "0")}`;
    while (used.has(code));
    used.add(code);
    return code;
  };
}

// ---------------------------------------------------------------------------
// 端末
// ---------------------------------------------------------------------------

const SECRET_KEYS = ["initialPassword", "loginPassword"] as const;

const DEVICE_FIELD_LABELS: Record<string, string> = {
  categoryId: "資産種別",
  initialUser: "初期ユーザ",
  loginUser: "ユーザー名",
  initialPasswordEnc: "初期ユーザのパスワード",
  loginPasswordEnc: "ユーザーのパスワード",
};
const deviceFieldLabel = (key: string) => DEVICE_FIELD_LABELS[key] ?? IMPORT_TARGETS.devices.fields.find((f) => f.key === key)?.label ?? key;

async function planDevices(req: ImportRequest): Promise<PlanResult> {
  const { defaultCategoryId, autoCreate } = req.options;
  const passwordsMapped = SECRET_KEYS.some((k) => isMapped(req, k));
  if (passwordsMapped && !hasSecretKey()) {
    const anyPassword = req.rows.some((row) => SECRET_KEYS.some((k) => (reader(req, row)(k) ?? "") !== ""));
    if (anyPassword) {
      throw new SecretKeyError(
        "パスワードの列が含まれていますが、暗号鍵 (環境変数 DEVICE_SECRET_KEY) が設定されていないため保存できません。鍵を設定するか、パスワードの列を「対応付けない」にしてください。",
      );
    }
  }

  const [categories, locations, departments, employees, devices] = await Promise.all([
    db.deviceCategory.findMany(),
    db.location.findMany(),
    db.department.findMany(),
    db.employee.findMany({ select: { id: true, employeeNumber: true, name: true, employmentStatus: true } }),
    // 更新時にパスワードの変更有無を判定するため、暗号化したパスワードも取得する
    db.device.findMany({ omit: { initialPasswordEnc: false, loginPasswordEnc: false } }),
  ]);
  const findCategory = masterIndex(categories, (c) => c.categoryCode);
  const findLocation = masterIndex(locations, (l) => l.locationCode);
  const findDepartment = masterIndex(departments, (d) => d.departmentCode);
  const defaultCategory = defaultCategoryId ? categories.find((c) => c.id === defaultCategoryId) : undefined;
  if (defaultCategoryId && !defaultCategory) throw new BusinessRuleError("指定した資産種別が見つかりません。");
  if (defaultCategory && !defaultCategory.isActive) throw new BusinessRuleError(`資産種別「${defaultCategory.name}」は使用停止中です。`);

  const employeeByNumber = new Map(employees.map((e) => [e.employeeNumber.toLowerCase(), e]));
  const employeesByName = new Map<string, typeof employees>();
  for (const e of employees) employeesByName.set(matchKey(e.name), [...(employeesByName.get(matchKey(e.name)) ?? []), e]);
  const deviceByNumber = new Map(devices.map((d) => [d.assetNumber, d]));
  const seen = new Map<string, number>();
  const today = todayJst();

  // 自動登録するマスタ (同じ名前は 1 件にまとめる)
  const newMasters: NewMasters = { departments: [], locations: [], employees: [] };
  const nextDepartmentCode = codeIssuer("DEPT", 3, departments.map((d) => d.departmentCode));
  const nextLocationCode = codeIssuer("LOC", 3, locations.map((l) => l.locationCode));
  const nextEmployeeNumber = codeIssuer("AUTO", 4, employees.map((e) => e.employeeNumber));
  const newLocation = (name: string): Ref => {
    const key = matchKey(name);
    if (!newMasters.locations.some((l) => l.key === key)) newMasters.locations.push({ key, code: nextLocationCode(), name: name.trim() });
    return { newKey: key };
  };
  const newDepartment = (name: string): Ref => {
    const key = matchKey(name);
    if (!newMasters.departments.some((d) => d.key === key)) newMasters.departments.push({ key, code: nextDepartmentCode(), name: name.trim() });
    return { newKey: key };
  };

  const rows = req.rows.map((row, i): Planned => {
    const line = i + 2; // 1 行目は見出し
    const get = reader(req, row);
    const key = (get("assetNumber") ?? "").normalize("NFKC").toUpperCase();
    const errors: string[] = [];
    const notices: string[] = [];

    /** 日付項目を YYYY-MM-DD にそろえる。読み取れない値はエラー */
    const date = (field: string): string | undefined => {
      const raw = get(field);
      if (raw === undefined) return undefined;
      const value = normalizeDateText(raw);
      if (value !== null) return value;
      errors.push(`${deviceFieldLabel(field)}: 「${raw}」を日付として読み取れません。`);
      return "";
    };
    const amount = (field: string) => {
      const raw = get(field);
      return raw === undefined ? undefined : normalizeAmountText(raw);
    };

    // 保証期限 (サポート) が日付でない場合 (「あり」「3年保守」等) は備考に残す
    const supportRaw = get("warrantyExpiry");
    const supportDate = supportRaw === undefined ? undefined : normalizeDateText(supportRaw);
    const warrantyExpiry = supportDate === null ? "" : supportDate;
    const notesText = [get("notes"), get("notes2"), supportDate === null ? `サポート: ${supportRaw}` : undefined].filter(Boolean).join("\n");

    // 資産名称が空欄なら機種名 → ホスト名を名称にする
    const name = get("name") || get("model") || get("hostname") || "";
    const result: Planned = { line, key: key || "(自動採番)", name, action: "error", messages: errors };

    if (key) {
      if (seen.has(key)) return { ...result, messages: [`資産管理番号が ${seen.get(key)} 行目と重複しています。`] };
      seen.set(key, line);
    }

    const categoryText = get("category") ?? "";
    const category = categoryText ? findCategory(categoryText) : defaultCategory;
    if (categoryText && !category) errors.push(`資産種別「${categoryText}」が見つかりません (種別コードまたは種別名を指定してください)。`);

    const spec = {
      manufacturer: get("manufacturer"),
      model: get("model"),
      serialNumber: get("serialNumber"),
      osName: get("osName"),
      osVersion: get("osVersion"),
      purchaseDate: date("purchaseDate"),
      purchasePrice: amount("purchasePrice"),
      purchaseVendor: get("purchaseVendor"),
      warrantyExpiry,
      hostname: get("hostname"),
      purpose: get("purpose"),
      cpu: get("cpu"),
      memory: get("memory"),
      disk: get("disk"),
      homeLoanedAt: date("homeLoanedAt"),
      recovery: get("recovery"),
    };
    const initialUser = get("initialUser");
    const loginUser = get("loginUser");
    if ((initialUser ?? "").length > 100) errors.push("初期ユーザ: 100文字以内で入力してください。");
    if ((loginUser ?? "").length > 100) errors.push("ユーザー名: 100文字以内で入力してください。");
    const passwords = { initialPassword: get("initialPassword") ?? "", loginPassword: get("loginPassword") ?? "" };
    for (const k of SECRET_KEYS) if (passwords[k].length > 200) errors.push(`${deviceFieldLabel(k)}: 200文字以内で入力してください。`);

    // ---- 既存の端末 ----
    const existing = key ? deviceByNumber.get(key) : undefined;
    if (existing) {
      if (existing.deletedAt) return { ...result, messages: ["この資産管理番号は削除済みの端末で使用されているため登録できません。"] };
      if (req.mode === "skip") return { ...result, action: "skip", messages: ["登録済みのためスキップします。"] };
      if (existing.status === "DISPOSED") return { ...result, action: "skip", messages: ["廃棄済みの端末は更新しません。"] };
      if (errors.length) return result;

      const input = {
        id: existing.id,
        assetNumber: existing.assetNumber,
        name: pick(get("name") || undefined, existing.name),
        categoryId: String(category && categoryText ? category.id : existing.categoryId),
        notes: notesText ? notesText : str(existing.notes),
        ...Object.fromEntries(Object.entries(spec).map(([k, v]) => [k, pick(v, existing[k as keyof typeof existing])])),
      };
      const parsed = deviceUpdateSchema.safeParse(input);
      if (!parsed.success) return { ...result, messages: zodMessages("devices", parsed.error.issues) };
      if (category && categoryText && !category.isActive && category.id !== existing.categoryId) {
        return { ...result, messages: [`資産種別「${category.name}」は使用停止中です。`] };
      }
      const { id: deviceId, ...data } = parsed.data;

      const secrets: DeviceSecrets = {};
      if (initialUser && initialUser !== existing.initialUser) secrets.initialUser = initialUser;
      if (loginUser && loginUser !== existing.loginUser) secrets.loginUser = loginUser;
      // パスワードは現在の値と異なる場合のみ更新する
      const current = { initialPassword: existing.initialPasswordEnc, loginPassword: existing.loginPasswordEnc };
      for (const k of SECRET_KEYS) {
        if (passwords[k] && (!current[k] || decryptSecret(current[k]) !== passwords[k])) {
          secrets[k === "initialPassword" ? "initialPasswordEnc" : "loginPasswordEnc"] = encryptSecret(passwords[k]);
        }
      }

      const changed = [...changedKeys(existing, data), ...Object.keys(secrets)];
      if (changed.length === 0) return { ...result, name: existing.name, action: "skip", messages: ["変更がないためスキップします。"] };
      const ignored = get("location") || get("status") || get("assigneeNumber") || get("assigneeName");
      return {
        ...result,
        name: data.name,
        action: "update",
        messages: [
          `更新項目: ${changed.map(deviceFieldLabel).join("、")}`,
          ...(ignored ? ["拠点・状態・利用者は CSV では更新しません (拠点間移動・状態変更・貸出返却で変更してください)。"] : []),
        ],
        plan: { kind: "device-update", id: deviceId, before: existing, data, secrets },
      };
    }

    // ---- 新規登録 ----
    if (!category) {
      if (!categoryText) errors.push("資産種別: 資産種別を入力するか、取り込み画面でまとめて指定してください。");
    } else if (!category.isActive) errors.push(`資産種別「${category.name}」は使用停止中です。`);
    if (!name) errors.push("資産名称: 資産名称・機種名・ホスト名のいずれかを入力してください。");

    // 現在拠点
    const locationText = get("location") ?? "";
    let locationRef: Ref | null = null;
    if (!locationText) errors.push("現在拠点: 現在拠点を入力してください。");
    else {
      const location = findLocation(locationText);
      if (location && !location.isActive) errors.push(`拠点「${location.name}」は使用停止中です。`);
      else if (location) locationRef = { id: location.id };
      else if (autoCreate) {
        locationRef = newLocation(locationText);
        notices.push(`拠点「${locationText}」を新規登録します。`);
      } else errors.push(`拠点「${locationText}」が見つかりません (拠点コードまたは拠点名を指定するか、自動登録を選んでください)。`);
    }

    // 端末状態
    const statusText = get("status") ?? "";
    const statusWord = normalizeDeviceStatus(statusText);
    if (statusWord === undefined) errors.push(`ステータス「${statusText}」は判別できません (使用中・保管中・修理中・紛失 など)。`);
    if (statusWord === "DISPOSED") return { ...result, action: "skip", messages: ["廃棄済みの端末は取り込みません (廃棄の記録は廃棄管理で行ってください)。"] };

    // 利用者 (社員番号、なければ氏名で照合)
    const assigneeNumber = get("assigneeNumber") ?? "";
    const assigneeName = (get("assigneeName") ?? "").trim();
    let employeeRef: Ref | null = null;
    let employeeLabel = "";
    if (assigneeNumber) {
      const employee = employeeByNumber.get(assigneeNumber.toLowerCase());
      if (!employee) errors.push(`利用者の社員番号「${assigneeNumber}」が見つかりません。`);
      else if (employee.employmentStatus === "RETIRED") errors.push(`利用者 ${employee.name} さんは退職済みです。`);
      else {
        employeeRef = { id: employee.id };
        employeeLabel = `${employee.name} (${employee.employeeNumber})`;
      }
    } else if (assigneeName) {
      const matches = employeesByName.get(matchKey(assigneeName)) ?? [];
      const active = matches.filter((e) => e.employmentStatus !== "RETIRED");
      if (active.length > 1) {
        errors.push(`「${assigneeName}」という社員が ${active.length} 人います。利用者社員番号の列で指定してください。`);
      } else if (active.length === 1) {
        employeeRef = { id: active[0].id };
        employeeLabel = `${active[0].name} (${active[0].employeeNumber})`;
      } else if (matches.length > 0) {
        errors.push(`利用者 ${assigneeName} さんは退職済みです。`);
      } else if (autoCreate && locationRef) {
        const empKey = matchKey(assigneeName);
        let planned = newMasters.employees.find((e) => e.key === empKey);
        if (!planned) {
          const deptText = (get("assigneeDepartment") ?? "").trim();
          const dept = deptText ? findDepartment(deptText) : undefined;
          const departmentRef: Ref | null = !deptText ? null : dept ? { id: dept.id } : newDepartment(deptText);
          if (deptText && !dept) notices.push(`部署「${deptText}」を新規登録します。`);
          planned = { key: empKey, number: nextEmployeeNumber(), name: assigneeName, departmentRef, locationRef };
          newMasters.employees.push(planned);
        }
        employeeRef = { newKey: empKey };
        employeeLabel = `${planned.name} (${planned.number})`;
        notices.push(`社員「${assigneeName}」を新規登録します (仮の社員番号 ${planned.number}。あとで社員編集から変更できます)。`);
      } else if (!autoCreate) {
        errors.push(`社員「${assigneeName}」が見つかりません。社員を先に登録するか、「見つからない社員・部署・拠点を自動登録する」を選んでください。`);
      }
    }

    // 貸出・返却の日付
    const assignedAtText = date("assignedAt");
    const expectedText = date("expectedReturnAt");
    const returnedText = date("returnedAt");
    const assignedAt = assignedAtText ? parseDateOnly(assignedAtText) : null;
    const expectedReturnAt = expectedText ? parseDateOnly(expectedText) : null;
    const returnedAt = returnedText ? parseDateOnly(returnedText) : null;

    let status: DeviceStatus = statusWord ?? "IN_STOCK";
    let assignment: DeviceAssignmentPlan | null = null;
    if (returnedAt) {
      // 返却済み: 貸出日がある場合のみ、返却済みの貸出履歴として登録する
      if (statusWord === "IN_USE") errors.push("返却日が入力されていますが、ステータスが使用中です。どちらかを修正してください。");
      if (returnedAt > today) errors.push("返却日: 未来の日付は指定できません。");
      if (assignedAt && returnedAt < assignedAt) errors.push("返却日: 貸出日以降の日付にしてください。");
      if (employeeRef && assignedAt) {
        assignment = { employeeRef, employeeLabel, assignedAt, expectedReturnAt, returnedAt };
        notices.push(`返却済みの貸出履歴 (${employeeLabel}) を登録します。`);
      } else if (employeeRef) {
        notices.push("貸出日がないため、返却済みの貸出履歴は登録しません。");
      }
    } else if (employeeRef) {
      if (statusWord === "IN_STOCK") {
        notices.push("ステータスが保管中のため、利用者 (貸出) は登録しません。");
      } else {
        const start = assignedAt ?? today;
        if (start > today) errors.push("貸出日: 未来の日付は指定できません。");
        if (expectedReturnAt && expectedReturnAt < start) errors.push("返却予定日: 貸出日以降の日付にしてください。");
        status = statusWord ?? "IN_USE";
        assignment = { employeeRef, employeeLabel, assignedAt: start, expectedReturnAt, returnedAt: null };
        notices.push(`${employeeLabel} さんに貸出中として登録します${assignedAt ? "" : " (貸出日は本日)"}。`);
      }
    } else if (statusWord === "IN_USE" && !assigneeName) {
      errors.push("使用中として登録するには、利用者 (氏名または社員番号) を指定してください。");
    }

    const parsed = deviceCreateSchema.safeParse({
      assetNumberMode: key ? "manual" : "auto",
      assetNumber: key,
      name,
      categoryId: String(category?.id ?? ""),
      // 新規登録する拠点は登録時に ID が決まるため、検証では仮の値を使う
      currentLocationId: locationRef && "id" in locationRef ? String(locationRef.id) : "1",
      status: status === "IN_USE" ? "IN_STOCK" : status,
      notes: notesText,
      ...Object.fromEntries(Object.entries(spec).map(([k, v]) => [k, v ?? ""])),
    });
    if (!parsed.success) {
      // マスタ未指定のエラーは上で出しているため重複させない
      errors.push(...zodMessages("devices", parsed.error.issues).filter((m) => !m.startsWith("資産種別") && !m.startsWith("現在拠点") && !m.startsWith("資産名称")));
    }
    if (errors.length || !parsed.success || !locationRef) return result;

    const secrets: DeviceSecrets = { initialUser: initialUser || null, loginUser: loginUser || null };
    if (passwords.initialPassword) secrets.initialPasswordEnc = encryptSecret(passwords.initialPassword);
    if (passwords.loginPassword) secrets.loginPasswordEnc = encryptSecret(passwords.loginPassword);
    if (secrets.initialPasswordEnc || secrets.loginPasswordEnc) notices.push("パスワードを暗号化して保存します。");

    return {
      ...result,
      action: "create",
      messages: [...(status !== "IN_STOCK" && !assignment ? [`状態: ${DEVICE_STATUS_LABELS[status]}`] : []), ...notices],
      plan: { kind: "device-create", data: parsed.data, locationRef, status, secrets, assignment },
    };
  });

  return { rows, newMasters };
}

type Resolver = { location: (ref: Ref) => number; employee: (ref: Ref) => number };

async function applyDevice(tx: Tx, plan: Plan, ctx: OperationContext, resolve: Resolver) {
  if (plan.kind === "device-create") {
    const { assetNumberMode, assetNumber, ...fields } = plan.data;
    const number = assetNumberMode === "auto" ? await issueAssetNumber(tx, fields.categoryId) : assetNumber;
    const employeeId = plan.assignment ? resolve.employee(plan.assignment.employeeRef) : null;
    const open = plan.assignment && !plan.assignment.returnedAt;
    const device = await tx.device.create({
      data: {
        ...fields,
        ...plan.secrets,
        assetNumber: number,
        currentLocationId: resolve.location(plan.locationRef),
        status: plan.status,
        currentEmployeeId: open ? employeeId : null,
      },
    });
    await recordAudit(tx, { userId: ctx.user.id, action: "CREATE", entityType: "Device", entityId: device.id, after: { ...device, source: "CSV" }, ipAddress: ctx.ipAddress });
    if (plan.assignment && employeeId) {
      const a = plan.assignment;
      await tx.deviceAssignment.create({
        data: {
          deviceId: device.id,
          employeeId,
          assignedAt: a.assignedAt,
          expectedReturnAt: a.expectedReturnAt,
          returnedAt: a.returnedAt,
          assignedById: ctx.user.id,
          returnedById: a.returnedAt ? ctx.user.id : null,
          notes: "CSV インポートで登録",
        },
      });
      await recordAudit(tx, {
        userId: ctx.user.id,
        action: a.returnedAt ? "RETURN" : "ASSIGN",
        entityType: "Device",
        entityId: device.id,
        after: {
          employee: a.employeeLabel,
          assignedAt: a.assignedAt,
          expectedReturnAt: a.expectedReturnAt,
          returnedAt: a.returnedAt,
          source: "CSV",
        },
        ipAddress: ctx.ipAddress,
      });
    }
  } else if (plan.kind === "device-update") {
    const updated = await tx.device.update({ where: { id: plan.id }, data: { ...plan.data, ...plan.secrets } });
    const passwordNote = {
      ...(plan.secrets.initialPasswordEnc ? { initialPasswordChanged: "変更" } : {}),
      ...(plan.secrets.loginPasswordEnc ? { loginPasswordChanged: "変更" } : {}),
    };
    await recordAudit(tx, {
      userId: ctx.user.id,
      action: "UPDATE",
      entityType: "Device",
      entityId: plan.id,
      before: plan.before,
      after: { ...updated, ...passwordNote, source: "CSV" },
      ipAddress: ctx.ipAddress,
    });
  }
}

/** 自動登録するマスタを登録し、キーから ID を引けるようにする */
async function createNewMasters(tx: Tx, masters: NewMasters, ctx: OperationContext) {
  const ids = { department: new Map<string, number>(), location: new Map<string, number>(), employee: new Map<string, number>() };
  const audit = (entityType: string, after: { id: number }) =>
    recordAudit(tx, { userId: ctx.user.id, action: "CREATE", entityType, entityId: after.id, after: { ...after, source: "CSV (自動登録)" }, ipAddress: ctx.ipAddress });

  for (const d of masters.departments) {
    const created = await tx.department.create({ data: { departmentCode: d.code, name: d.name } });
    ids.department.set(d.key, created.id);
    await audit("Department", created);
  }
  for (const l of masters.locations) {
    const created = await tx.location.create({ data: { locationCode: l.code, name: l.name } });
    ids.location.set(l.key, created.id);
    await audit("Location", created);
  }
  const resolveIn = (map: Map<string, number>) => (ref: Ref) => {
    if ("id" in ref) return ref.id;
    const id = map.get(ref.newKey);
    if (id === undefined) throw new Error(`自動登録したデータが見つかりません: ${ref.newKey}`);
    return id;
  };
  for (const e of masters.employees) {
    const created = await tx.employee.create({
      data: {
        employeeNumber: e.number,
        name: e.name,
        departmentId: e.departmentRef ? resolveIn(ids.department)(e.departmentRef) : null,
        homeLocationId: resolveIn(ids.location)(e.locationRef),
      },
    });
    ids.employee.set(e.key, created.id);
    await audit("Employee", created);
  }
  return { location: resolveIn(ids.location), employee: resolveIn(ids.employee) };
}

// ---------------------------------------------------------------------------
// 社員
// ---------------------------------------------------------------------------

async function planEmployees(req: ImportRequest): Promise<PlanResult> {
  const [departments, locations, employees] = await Promise.all([db.department.findMany(), db.location.findMany(), db.employee.findMany()]);
  const findDepartment = masterIndex(departments, (d) => d.departmentCode);
  const findLocation = masterIndex(locations, (l) => l.locationCode);
  const byNumber = new Map(employees.map((e) => [e.employeeNumber, e]));
  const byEmail = new Map(employees.filter((e) => e.email).map((e) => [e.email!, e]));
  const seen = new Map<string, number>();
  const seenEmail = new Map<string, number>();

  const rows = req.rows.map((row, i): Planned => {
    const line = i + 2;
    const get = reader(req, row);
    const key = get("employeeNumber") ?? "";
    const result: Planned = { line, key, name: get("name") ?? "", action: "error", messages: [] };
    const errors = result.messages;
    if (key && seen.has(key)) return { ...result, messages: [`社員番号が ${seen.get(key)} 行目と重複しています。`] };
    if (key) seen.set(key, line);

    const existing = key ? byNumber.get(key) : undefined;
    if (existing && req.mode === "skip") return { ...result, action: "skip", messages: ["登録済みのためスキップします。"] };

    const deptText = get("department");
    const dept = deptText ? findDepartment(deptText) : undefined;
    if (deptText && !dept) errors.push(`部署「${deptText}」が見つかりません。`);
    else if (dept && !dept.isActive && dept.id !== existing?.departmentId) errors.push(`部署「${dept.name}」は使用停止中です。`);
    const locText = get("homeLocation");
    const loc = locText ? findLocation(locText) : undefined;
    if (locText && !loc) errors.push(`拠点「${locText}」が見つかりません。`);
    else if (loc && !loc.isActive && loc.id !== existing?.homeLocationId) errors.push(`拠点「${loc.name}」は使用停止中です。`);

    const statusText = get("employmentStatus") ?? "";
    let status: EmploymentStatus | undefined;
    if (statusText) {
      status = EMPLOYMENT_STATUS_INPUT[statusText.toLowerCase()] ?? EMPLOYMENT_STATUS_INPUT[statusText];
      if (!status) errors.push(`在籍状態「${statusText}」は指定できません (在籍・休職)。`);
      else if (status === "RETIRED" && existing?.employmentStatus !== "RETIRED") errors.push("退職への変更は CSV では行えません。社員詳細画面の退職処理を使用してください。");
      else if (existing?.employmentStatus === "RETIRED" && status !== "RETIRED") errors.push("退職者の在籍状態は CSV では変更できません。社員編集画面で変更してください。");
    }

    const input = {
      employeeNumber: key,
      name: existing ? pick(get("name"), existing.name) : (get("name") ?? ""),
      email: existing ? pick(get("email"), existing.email) : (get("email") ?? ""),
      departmentId: dept ? String(dept.id) : existing ? str(existing.departmentId) : "",
      homeLocationId: loc ? String(loc.id) : existing ? str(existing.homeLocationId) : "",
      employmentStatus: status ?? existing?.employmentStatus ?? "ACTIVE",
      joinedAt: existing ? pick(get("joinedAt"), existing.joinedAt) : (get("joinedAt") ?? ""),
    };
    const parsed = employeeSchema.safeParse(input);
    if (!parsed.success) errors.push(...zodMessages("employees", parsed.error.issues));
    if (errors.length || !parsed.success) return result;

    const email = parsed.data.email;
    if (email) {
      const owner = byEmail.get(email);
      if (owner && owner.id !== existing?.id) return { ...result, messages: [`メールアドレス ${email} は社員 ${owner.employeeNumber} が使用しています。`] };
      if (seenEmail.has(email)) return { ...result, messages: [`メールアドレスが ${seenEmail.get(email)} 行目と重複しています。`] };
      seenEmail.set(email, line);
    }

    if (existing) {
      const changed = changedKeys(existing, parsed.data);
      if (changed.length === 0) return { ...result, action: "skip", messages: ["変更がないためスキップします。"] };
      return {
        ...result,
        name: parsed.data.name,
        action: "update",
        messages: [`更新項目: ${changed.map((k) => IMPORT_TARGETS.employees.fields.find((f) => f.key === k || f.key === k.replace(/Id$/, ""))?.label ?? k).join("、")}`],
        plan: { kind: "employee-update", id: existing.id, before: existing, data: parsed.data },
      };
    }
    return { ...result, action: "create", plan: { kind: "employee-create", data: parsed.data } };
  });
  return { rows };
}

async function applyEmployee(tx: Tx, plan: Plan, ctx: OperationContext) {
  if (plan.kind === "employee-create") {
    const created = await tx.employee.create({ data: plan.data });
    await recordAudit(tx, { userId: ctx.user.id, action: "CREATE", entityType: "Employee", entityId: created.id, after: { ...created, source: "CSV" }, ipAddress: ctx.ipAddress });
  } else if (plan.kind === "employee-update") {
    const updated = await tx.employee.update({ where: { id: plan.id }, data: plan.data });
    await recordAudit(tx, { userId: ctx.user.id, action: "UPDATE", entityType: "Employee", entityId: plan.id, before: plan.before, after: { ...updated, source: "CSV" }, ipAddress: ctx.ipAddress });
  }
}

// ---------------------------------------------------------------------------
// 拠点
// ---------------------------------------------------------------------------

async function planLocations(req: ImportRequest): Promise<PlanResult> {
  const locations = await db.location.findMany();
  const byCode = new Map(locations.map((l) => [l.locationCode, l]));
  const seen = new Map<string, number>();

  const rows = req.rows.map((row, i): Planned => {
    const line = i + 2;
    const get = reader(req, row);
    const key = get("locationCode") ?? "";
    const result: Planned = { line, key, name: get("name") ?? "", action: "error", messages: [] };
    if (key && seen.has(key)) return { ...result, messages: [`拠点コードが ${seen.get(key)} 行目と重複しています。`] };
    if (key) seen.set(key, line);

    const existing = key ? byCode.get(key) : undefined;
    if (existing && req.mode === "skip") return { ...result, action: "skip", messages: ["登録済みのためスキップします。"] };
    const parsed = locationSchema.safeParse({
      locationCode: key,
      name: existing ? pick(get("name"), existing.name) : (get("name") ?? ""),
      address: existing ? pick(get("address"), existing.address) : (get("address") ?? ""),
      managerName: existing ? pick(get("managerName"), existing.managerName) : (get("managerName") ?? ""),
      phone: existing ? pick(get("phone"), existing.phone) : (get("phone") ?? ""),
      isActive: existing?.isActive ?? true,
    });
    if (!parsed.success) return { ...result, messages: zodMessages("locations", parsed.error.issues) };

    if (existing) {
      const changed = changedKeys(existing, parsed.data);
      if (changed.length === 0) return { ...result, action: "skip", messages: ["変更がないためスキップします。"] };
      return {
        ...result,
        name: parsed.data.name,
        action: "update",
        messages: [`更新項目: ${changed.map((k) => IMPORT_TARGETS.locations.fields.find((f) => f.key === k)?.label ?? k).join("、")}`],
        plan: { kind: "location-update", id: existing.id, before: existing, data: parsed.data },
      };
    }
    return { ...result, action: "create", plan: { kind: "location-create", data: parsed.data } };
  });
  return { rows };
}

async function applyLocation(tx: Tx, plan: Plan, ctx: OperationContext) {
  if (plan.kind === "location-create") {
    const created = await tx.location.create({ data: plan.data });
    await recordAudit(tx, { userId: ctx.user.id, action: "CREATE", entityType: "Location", entityId: created.id, after: { ...created, source: "CSV" }, ipAddress: ctx.ipAddress });
  } else if (plan.kind === "location-update") {
    const updated = await tx.location.update({ where: { id: plan.id }, data: plan.data });
    await recordAudit(tx, { userId: ctx.user.id, action: "UPDATE", entityType: "Location", entityId: plan.id, before: plan.before, after: { ...updated, source: "CSV" }, ipAddress: ctx.ipAddress });
  }
}

// ---------------------------------------------------------------------------
// 公開関数
// ---------------------------------------------------------------------------

const PLANNERS: Record<ImportTarget, (req: ImportRequest) => Promise<PlanResult>> = {
  devices: planDevices,
  employees: planEmployees,
  locations: planLocations,
};

const APPLIERS: Record<ImportTarget, (tx: Tx, plan: Plan, ctx: OperationContext, resolve: Resolver) => Promise<void>> = {
  devices: applyDevice,
  employees: applyEmployee,
  locations: applyLocation,
};

const toResult = ({ line, key, name, action, messages }: Planned): RowResult => ({ line, key, name, action, messages });

function summarize(rows: RowResult[]): ImportSummary {
  const summary: ImportSummary = { total: rows.length, create: 0, update: 0, skip: 0, error: 0 };
  for (const r of rows) summary[r.action]++;
  return summary;
}

/**
 * 自動登録するマスタのうち、登録される行 (エラーにならない行) から参照されるものだけを残す。
 * エラーの行がある場合は登録自体を行わないが、プレビューでは実際に登録される内容を表示する。
 */
function usedMasters(rows: Planned[], masters: NewMasters | undefined): NewMasters {
  const empty: NewMasters = { departments: [], locations: [], employees: [] };
  if (!masters) return empty;
  const keyOf = (ref: Ref | null | undefined) => (ref && "newKey" in ref ? ref.newKey : null);
  const employeeKeys = new Set<string>();
  const locationKeys = new Set<string>();
  for (const row of rows) {
    if (row.plan?.kind !== "device-create") continue;
    const loc = keyOf(row.plan.locationRef);
    if (loc) locationKeys.add(loc);
    const emp = keyOf(row.plan.assignment?.employeeRef);
    if (emp) employeeKeys.add(emp);
  }
  const employees = masters.employees.filter((e) => employeeKeys.has(e.key));
  for (const e of employees) {
    const loc = keyOf(e.locationRef);
    if (loc) locationKeys.add(loc);
  }
  const departmentKeys = new Set(employees.map((e) => keyOf(e.departmentRef)).filter((k): k is string => k !== null));
  return {
    departments: masters.departments.filter((d) => departmentKeys.has(d.key)),
    locations: masters.locations.filter((l) => locationKeys.has(l.key)),
    employees,
  };
}

function describeMasters(masters: NewMasters): AutoCreated {
  return {
    departments: masters.departments.map((d) => `${d.name} (${d.code})`),
    locations: masters.locations.map((l) => `${l.name} (${l.code})`),
    employees: masters.employees.map((e) => `${e.name} (${e.number})`),
  };
}

function assertRequiredMapped(req: ImportRequest) {
  const missing = requiredMappingFields(req.target, req.mode, req.options).filter((f) => !isMapped(req, f.key));
  if (missing.length) throw new BusinessRuleError(`必須項目の列が対応付けられていません: ${missing.map((f) => f.label).join("、")}`);
}

/** プレビュー: DB は変更せず、行ごとに 登録・更新・スキップ・エラー を判定する */
export async function previewImport(req: ImportRequest) {
  assertRequiredMapped(req);
  const { rows, newMasters } = await PLANNERS[req.target](req);
  const results = rows.map(toResult);
  return { summary: summarize(results), rows: results, autoCreated: describeMasters(usedMasters(rows, newMasters)) };
}

/**
 * 登録実行: プレビューと同じ判定をやり直し、エラーが 1 件でもあれば何も登録しない。
 * 自動登録するマスタと各行の登録・更新は、すべて 1 つのトランザクションで行い、途中で失敗した場合は全件取り消す。
 */
export async function executeImport(req: ImportRequest, ctx: OperationContext) {
  assertRequiredMapped(req);
  const { rows, newMasters } = await PLANNERS[req.target](req);
  const results = rows.map(toResult);
  const summary = summarize(results);
  const masters = usedMasters(rows, newMasters);
  const autoCreated = describeMasters(masters);
  if (summary.error > 0) return { ok: false as const, summary, rows: results, autoCreated };

  await db.$transaction(
    async (tx) => {
      const resolve = await createNewMasters(tx, masters, ctx);
      for (const row of rows) if (row.plan) await APPLIERS[req.target](tx, row.plan, ctx, resolve);
      await recordAudit(tx, {
        userId: ctx.user.id,
        action: "CSV_IMPORT",
        entityType: "Csv",
        entityId: req.target,
        after: {
          target: IMPORT_TARGETS[req.target].label,
          mode: req.mode,
          ...summary,
          autoCreated: masters.employees.length + masters.locations.length + masters.departments.length,
        },
        ipAddress: ctx.ipAddress,
      });
    },
    { timeout: 120_000, maxWait: 10_000 },
  );
  return { ok: true as const, summary, rows: results, autoCreated };
}
