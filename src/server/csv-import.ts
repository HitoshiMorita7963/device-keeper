import type { z } from "zod";
import { db } from "@/lib/db";
import { recordAudit } from "@/lib/audit";
import { BusinessRuleError } from "@/lib/auth/errors";
import { stripFormulaGuard } from "@/lib/csv/format";
import { IMPORT_TARGETS, requiredMappingFields, type ImportTarget } from "@/lib/csv/fields";
import { parseDateOnly, todayJst, toDateInput } from "@/lib/dates";
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

/** 登録・更新の実行内容 (サーバー内部でのみ使用) */
type Plan =
  | { kind: "device-create"; data: z.output<typeof deviceCreateSchema>; assign: { employeeId: number; employeeLabel: string; assignedAt: Date; expectedReturnAt: Date | null } | null }
  | { kind: "device-update"; id: number; before: Record<string, unknown>; data: Omit<z.output<typeof deviceUpdateSchema>, "id"> }
  | { kind: "employee-create"; data: z.output<typeof employeeSchema> }
  | { kind: "employee-update"; id: number; before: Record<string, unknown>; data: z.output<typeof employeeSchema> }
  | { kind: "location-create"; data: z.output<typeof locationSchema> }
  | { kind: "location-update"; id: number; before: Record<string, unknown>; data: z.output<typeof locationSchema> };

type Planned = RowResult & { plan?: Plan };

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

/** zod のエラーを「項目名: メッセージ」に変換する */
function zodMessages(target: ImportTarget, issues: z.core.$ZodIssue[]): string[] {
  const alias: Record<string, string> = { categoryId: "category", currentLocationId: "location", departmentId: "department", homeLocationId: "homeLocation" };
  return issues.map((issue) => {
    const key = String(issue.path[0] ?? "");
    const label = IMPORT_TARGETS[target].fields.find((f) => f.key === (alias[key] ?? key))?.label;
    return label ? `${label}: ${issue.message}` : issue.message;
  });
}

/** コードまたは名称でマスタを引くための索引 */
function masterIndex<T extends { id: number; name: string; isActive: boolean }>(items: T[], code: (item: T) => string) {
  const map = new Map<string, T>();
  for (const item of items) {
    map.set(item.name.toLowerCase(), item);
    map.set(code(item).toLowerCase(), item);
  }
  return (value: string) => map.get(value.toLowerCase());
}

const str = (v: unknown) => (v === null || v === undefined ? "" : v instanceof Date ? toDateInput(v) : String(v));

/** 更新の場合: CSV が空欄・未対応付けの項目は既存の値を使う (CSV で値を消すことはしない) */
const pick = (value: string | undefined, existing: unknown) => (value === undefined || value === "" ? str(existing) : value);

function changedKeys(before: Record<string, unknown>, after: Record<string, unknown>) {
  return Object.keys(after).filter((k) => str(before[k]) !== str(after[k]));
}

const DEVICE_STATUS_INPUT: Record<string, DeviceStatus> = {
  保管中: "IN_STOCK", in_stock: "IN_STOCK",
  使用中: "IN_USE", in_use: "IN_USE",
  修理中: "REPAIR", repair: "REPAIR",
  紛失: "LOST", lost: "LOST",
  廃棄済み: "DISPOSED", disposed: "DISPOSED",
};

const EMPLOYMENT_STATUS_INPUT: Record<string, EmploymentStatus> = {
  在籍: "ACTIVE", active: "ACTIVE",
  休職: "ON_LEAVE", on_leave: "ON_LEAVE",
  退職: "RETIRED", retired: "RETIRED",
};

// ---------------------------------------------------------------------------
// 端末
// ---------------------------------------------------------------------------

async function planDevices(req: ImportRequest): Promise<Planned[]> {
  const [categories, locations, employees, devices] = await Promise.all([
    db.deviceCategory.findMany(),
    db.location.findMany(),
    db.employee.findMany({ select: { id: true, employeeNumber: true, name: true, employmentStatus: true } }),
    db.device.findMany(),
  ]);
  const findCategory = masterIndex(categories, (c) => c.categoryCode);
  const findLocation = masterIndex(locations, (l) => l.locationCode);
  const employeeByNumber = new Map(employees.map((e) => [e.employeeNumber.toLowerCase(), e]));
  const deviceByNumber = new Map(devices.map((d) => [d.assetNumber, d]));
  const seen = new Map<string, number>();
  const today = todayJst();

  return req.rows.map((row, i): Planned => {
    const line = i + 2; // 1 行目は見出し
    const get = reader(req, row);
    const key = (get("assetNumber") ?? "").toUpperCase();
    const name = get("name") ?? "";
    const result: Planned = { line, key: key || "(自動採番)", name, action: "error", messages: [] };
    const errors = result.messages;

    if (key) {
      if (seen.has(key)) return { ...result, messages: [`資産管理番号が ${seen.get(key)} 行目と重複しています。`] };
      seen.set(key, line);
    }

    const categoryText = get("category");
    const category = categoryText ? findCategory(categoryText) : undefined;
    if (categoryText && !category) errors.push(`資産種別「${categoryText}」が見つかりません (種別コードまたは種別名を指定してください)。`);

    const existing = key ? deviceByNumber.get(key) : undefined;
    if (existing) {
      if (existing.deletedAt) return { ...result, messages: ["この資産管理番号は削除済みの端末で使用されているため登録できません。"] };
      if (req.mode === "skip") return { ...result, action: "skip", messages: ["登録済みのためスキップします。"] };
      if (existing.status === "DISPOSED") return { ...result, action: "skip", messages: ["廃棄済みの端末は更新しません。"] };
      if (errors.length) return result;

      const input = {
        id: existing.id,
        assetNumber: existing.assetNumber,
        name: pick(get("name"), existing.name),
        categoryId: String(category?.id ?? existing.categoryId),
        manufacturer: pick(get("manufacturer"), existing.manufacturer),
        model: pick(get("model"), existing.model),
        serialNumber: pick(get("serialNumber"), existing.serialNumber),
        osName: pick(get("osName"), existing.osName),
        osVersion: pick(get("osVersion"), existing.osVersion),
        purchaseDate: pick(get("purchaseDate"), existing.purchaseDate),
        purchasePrice: pick(get("purchasePrice"), existing.purchasePrice),
        purchaseVendor: pick(get("purchaseVendor"), existing.purchaseVendor),
        warrantyExpiry: pick(get("warrantyExpiry"), existing.warrantyExpiry),
        notes: pick(get("notes"), existing.notes),
      };
      const parsed = deviceUpdateSchema.safeParse(input);
      if (!parsed.success) return { ...result, messages: zodMessages("devices", parsed.error.issues) };
      if (category && !category.isActive && category.id !== existing.categoryId) {
        return { ...result, messages: [`資産種別「${category.name}」は使用停止中です。`] };
      }
      const { id: deviceId, ...data } = parsed.data;
      const changed = changedKeys(existing, data);
      const notes = ["拠点・状態・利用者は CSV では更新しません (拠点間移動・状態変更・貸出返却で変更してください)。"];
      if (changed.length === 0) return { ...result, name: existing.name, action: "skip", messages: ["変更がないためスキップします。"] };
      return {
        ...result,
        name: data.name,
        action: "update",
        messages: [`更新項目: ${changed.map((k) => IMPORT_TARGETS.devices.fields.find((f) => f.key === k)?.label ?? (k === "categoryId" ? "資産種別" : k)).join("、")}`, ...(get("location") || get("status") || get("assigneeNumber") ? notes : [])],
        plan: { kind: "device-update", id: deviceId, before: existing, data },
      };
    }

    // ---- 新規登録 ----
    if (!categoryText) errors.push("資産種別: 資産種別を入力してください。");
    else if (category && !category.isActive) errors.push(`資産種別「${category.name}」は使用停止中です。`);

    const locationText = get("location");
    const location = locationText ? findLocation(locationText) : undefined;
    if (!locationText) errors.push("現在拠点: 現在拠点を入力してください。");
    else if (!location) errors.push(`拠点「${locationText}」が見つかりません (拠点コードまたは拠点名を指定してください)。`);
    else if (!location.isActive) errors.push(`拠点「${location.name}」は使用停止中です。`);

    const statusText = get("status") ?? "";
    let status: DeviceStatus = "IN_STOCK";
    if (statusText) {
      const s = DEVICE_STATUS_INPUT[statusText.toLowerCase()] ?? DEVICE_STATUS_INPUT[statusText];
      if (!s) errors.push(`端末状態「${statusText}」は指定できません (保管中・修理中・紛失)。`);
      else if (s === "DISPOSED") errors.push("廃棄済みの端末は CSV では登録できません。");
      else status = s;
    }

    let assign: Extract<Plan, { kind: "device-create" }>["assign"] = null;
    const assigneeNumber = get("assigneeNumber") ?? "";
    if (assigneeNumber) {
      const employee = employeeByNumber.get(assigneeNumber.toLowerCase());
      if (!employee) errors.push(`利用者の社員番号「${assigneeNumber}」が見つかりません。`);
      else if (employee.employmentStatus === "RETIRED") errors.push(`利用者 ${employee.name} さんは退職済みです。`);
      if (status !== "IN_STOCK" && status !== "IN_USE") errors.push("利用者を指定する場合、端末状態は空欄・保管中・使用中のいずれかにしてください。");
      const assignedAtText = get("assignedAt") ?? "";
      const assignedAt = assignedAtText ? parseDateOnly(assignedAtText) : today;
      const expectedText = get("expectedReturnAt") ?? "";
      const expectedReturnAt = expectedText ? parseDateOnly(expectedText) : null;
      if (!assignedAt) errors.push("貸出日: 日付は YYYY-MM-DD 形式で入力してください。");
      else if (assignedAt > today) errors.push("貸出日: 未来の日付は指定できません。");
      if (expectedText && !expectedReturnAt) errors.push("返却予定日: 日付は YYYY-MM-DD 形式で入力してください。");
      if (assignedAt && expectedReturnAt && expectedReturnAt < assignedAt) errors.push("返却予定日: 貸出日以降の日付にしてください。");
      if (employee && assignedAt && employee.employmentStatus !== "RETIRED") {
        assign = { employeeId: employee.id, employeeLabel: `${employee.name} (${employee.employeeNumber})`, assignedAt, expectedReturnAt };
      }
      status = "IN_STOCK";
    } else if (status === "IN_USE") {
      errors.push("使用中として登録するには、利用者社員番号を指定してください。");
    }

    const parsed = deviceCreateSchema.safeParse({
      assetNumberMode: key ? "manual" : "auto",
      assetNumber: key,
      name,
      categoryId: String(category?.id ?? ""),
      currentLocationId: String(location?.id ?? ""),
      status: status === "IN_USE" ? "IN_STOCK" : status,
      manufacturer: get("manufacturer") ?? "",
      model: get("model") ?? "",
      serialNumber: get("serialNumber") ?? "",
      osName: get("osName") ?? "",
      osVersion: get("osVersion") ?? "",
      purchaseDate: get("purchaseDate") ?? "",
      purchasePrice: get("purchasePrice") ?? "",
      purchaseVendor: get("purchaseVendor") ?? "",
      warrantyExpiry: get("warrantyExpiry") ?? "",
      notes: get("notes") ?? "",
    });
    if (!parsed.success) {
      // マスタ未指定のエラーは上で出しているため重複させない
      errors.push(...zodMessages("devices", parsed.error.issues).filter((m) => !m.startsWith("資産種別") && !m.startsWith("現在拠点")));
    }
    if (errors.length || !parsed.success) return result;
    return {
      ...result,
      action: "create",
      messages: assign ? ["貸出中 (使用中) として登録します。"] : [],
      plan: { kind: "device-create", data: parsed.data, assign },
    };
  });
}

async function applyDevice(tx: Tx, plan: Plan, ctx: OperationContext) {
  if (plan.kind === "device-create") {
    const { assetNumberMode, assetNumber, ...fields } = plan.data;
    const number = assetNumberMode === "auto" ? await issueAssetNumber(tx, fields.categoryId) : assetNumber;
    const device = await tx.device.create({ data: { ...fields, assetNumber: number } });
    await recordAudit(tx, { userId: ctx.user.id, action: "CREATE", entityType: "Device", entityId: device.id, after: { ...device, source: "CSV" }, ipAddress: ctx.ipAddress });
    if (plan.assign) {
      await tx.deviceAssignment.create({
        data: { deviceId: device.id, employeeId: plan.assign.employeeId, assignedAt: plan.assign.assignedAt, expectedReturnAt: plan.assign.expectedReturnAt, assignedById: ctx.user.id, notes: "CSV インポートで登録" },
      });
      await tx.device.update({ where: { id: device.id }, data: { status: "IN_USE", currentEmployeeId: plan.assign.employeeId } });
      await recordAudit(tx, {
        userId: ctx.user.id,
        action: "ASSIGN",
        entityType: "Device",
        entityId: device.id,
        before: { status: device.status },
        after: { status: "IN_USE", currentEmployeeId: plan.assign.employeeId, employee: plan.assign.employeeLabel, assignedAt: plan.assign.assignedAt, source: "CSV" },
        ipAddress: ctx.ipAddress,
      });
    }
  } else if (plan.kind === "device-update") {
    const updated = await tx.device.update({ where: { id: plan.id }, data: plan.data });
    await recordAudit(tx, { userId: ctx.user.id, action: "UPDATE", entityType: "Device", entityId: plan.id, before: plan.before, after: { ...updated, source: "CSV" }, ipAddress: ctx.ipAddress });
  }
}

// ---------------------------------------------------------------------------
// 社員
// ---------------------------------------------------------------------------

async function planEmployees(req: ImportRequest): Promise<Planned[]> {
  const [departments, locations, employees] = await Promise.all([db.department.findMany(), db.location.findMany(), db.employee.findMany()]);
  const findDepartment = masterIndex(departments, (d) => d.departmentCode);
  const findLocation = masterIndex(locations, (l) => l.locationCode);
  const byNumber = new Map(employees.map((e) => [e.employeeNumber, e]));
  const byEmail = new Map(employees.filter((e) => e.email).map((e) => [e.email!, e]));
  const seen = new Map<string, number>();
  const seenEmail = new Map<string, number>();

  return req.rows.map((row, i): Planned => {
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

async function planLocations(req: ImportRequest): Promise<Planned[]> {
  const locations = await db.location.findMany();
  const byCode = new Map(locations.map((l) => [l.locationCode, l]));
  const seen = new Map<string, number>();

  return req.rows.map((row, i): Planned => {
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

const PLANNERS: Record<ImportTarget, (req: ImportRequest) => Promise<Planned[]>> = {
  devices: planDevices,
  employees: planEmployees,
  locations: planLocations,
};

const APPLIERS: Record<ImportTarget, (tx: Tx, plan: Plan, ctx: OperationContext) => Promise<void>> = {
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

function assertRequiredMapped(req: ImportRequest) {
  const missing = requiredMappingFields(req.target, req.mode).filter((f) => req.mapping[f.key] === null || req.mapping[f.key] === undefined);
  if (missing.length) throw new BusinessRuleError(`必須項目の列が対応付けられていません: ${missing.map((f) => f.label).join("、")}`);
}

/** プレビュー: DB は変更せず、行ごとに 登録・更新・スキップ・エラー を判定する */
export async function previewImport(req: ImportRequest) {
  assertRequiredMapped(req);
  const rows = await PLANNERS[req.target](req);
  const results = rows.map(toResult);
  return { summary: summarize(results), rows: results };
}

/**
 * 登録実行: プレビューと同じ判定をやり直し、エラーが 1 件でもあれば何も登録しない。
 * 登録・更新はすべて 1 つのトランザクションで行い、途中で失敗した場合は全件取り消す。
 */
export async function executeImport(req: ImportRequest, ctx: OperationContext) {
  assertRequiredMapped(req);
  const rows = await PLANNERS[req.target](req);
  const results = rows.map(toResult);
  const summary = summarize(results);
  if (summary.error > 0) return { ok: false as const, summary, rows: results };

  await db.$transaction(
    async (tx) => {
      for (const row of rows) if (row.plan) await APPLIERS[req.target](tx, row.plan, ctx);
      await recordAudit(tx, {
        userId: ctx.user.id,
        action: "CSV_IMPORT",
        entityType: "Csv",
        entityId: req.target,
        after: { target: IMPORT_TARGETS[req.target].label, mode: req.mode, ...summary },
        ipAddress: ctx.ipAddress,
      });
    },
    { timeout: 120_000, maxWait: 10_000 },
  );
  return { ok: true as const, summary, rows: results };
}
