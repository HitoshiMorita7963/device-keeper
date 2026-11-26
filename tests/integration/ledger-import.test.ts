import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => import("../helpers/request").then((m) => m.nextHeadersMock));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { db } from "@/lib/db";
import { executeImportAction, previewImportAction } from "@/app/(app)/csv/actions";
import { revealDeviceSecretAction, updateDeviceCredentialsAction } from "@/app/(app)/devices/actions";
import { guessMapping } from "@/lib/csv/fields";
import { decryptSecret } from "@/lib/crypto/secret";
import { toDateInput } from "@/lib/dates";
import { checkIntegrity } from "@/server/integrity";
import type { ImportRequestInput } from "@/lib/validation/csv";
import { createUser, resetDb } from "../helpers/db";
import { loginAs, logout } from "../helpers/request";
import { LEDGER_HEADERS } from "../helpers/ledger";

type LedgerRow = Partial<Record<(typeof LEDGER_HEADERS)[number], string>>;

/** Excel 台帳と同じ列構成の行を作る */
const toRow = (r: LedgerRow) => LEDGER_HEADERS.map((h) => r[h] ?? "");

let pcCategoryId: number;

function ledgerRequest(rows: LedgerRow[], overrides: Partial<ImportRequestInput> = {}): ImportRequestInput {
  return {
    target: "devices",
    mode: "skip",
    headers: [...LEDGER_HEADERS],
    rows: rows.map(toRow),
    mapping: guessMapping("devices", LEDGER_HEADERS),
    options: { defaultCategoryId: pcCategoryId, autoCreate: true },
    ...overrides,
  };
}

const YAMADA: LedgerRow = {
  氏名: "山田 太郎",
  所属: "営業部",
  拠点: "本社",
  用途: "営業用",
  端末番号: "PC-L001",
  ホスト名: "EIGYO-01",
  初期ユーザ: "admin",
  PW: "Init#Pass1",
  ユーザー名: "yamada",
  PW2: "User#Pass2",
  購入日: "2024年4月1日",
  "購入価格（税抜）": "¥128,000",
  貸出日: "R6.4.10",
  自宅貸出日: "2024/5/1",
  ステータス: "貸出中",
  リカバリ: "済",
  メーカー: "Dell",
  機種名: "Latitude 5440",
  OS: "Windows 11",
  CPU: "Core i5-1345U",
  メモリ: "16GB",
  ディスク: "SSD 256GB",
  サポート: "2027/3/31",
  "備考①": "メモ1",
  "備考②": "メモ2",
};

describe("Excel 台帳の取り込み", () => {
  beforeEach(async () => {
    await resetDb();
    logout();
    await createUser("ADMIN", { email: "admin@example.com" });
    await createUser("ASSET_MANAGER", { email: "manager@example.com" });
    await db.location.create({ data: { locationCode: "HQ", name: "本社" } });
    pcCategoryId = (await db.deviceCategory.findUniqueOrThrow({ where: { categoryCode: "PC" } })).id;
    await loginAs("admin@example.com");
  });

  it("台帳の列をすべて取り込み、社員・部署・拠点を自動登録し、パスワードは暗号化して保存する", async () => {
    await db.employee.create({ data: { employeeNumber: "E100", name: "鈴木 一郎" } });
    const rows: LedgerRow[] = [
      YAMADA,
      // 同じ人 (全角スペース) の 2 台目 → 同じ社員に貸出
      { 氏名: "山田　太郎", 所属: "営業部", 拠点: "本社", 端末番号: "SP-L002", 機種名: "iPhone 15", ステータス: "使用中" },
      // 既存の社員・新しい拠点・在庫 → 貸出は登録しない
      { 氏名: "鈴木一郎", 拠点: "札幌営業所", 端末番号: "PC-L003", 機種名: "ThinkPad X1", ステータス: "在庫", サポート: "あり" },
      // 返却済み → 返却済みの貸出履歴として登録
      { 氏名: "佐藤 花子", 所属: "総務部", 拠点: "本社", 端末番号: "PC-L004", 機種名: "Surface", 貸出日: "2024/1/10", 返却日: "2024/3/31" },
      // 廃棄済み → スキップ (他の行の登録は止めない)
      { 拠点: "本社", 端末番号: "PC-OLD", 機種名: "古いPC", ステータス: "廃棄" },
    ];

    const preview = await previewImportAction(ledgerRequest(rows));
    expect(preview.ok, preview.ok ? "" : preview.error).toBe(true);
    if (!preview.ok) return;
    expect(preview.data.summary).toMatchObject({ total: 5, create: 4, skip: 1, error: 0 });
    expect(preview.data.autoCreated).toEqual({
      employees: ["山田 太郎 (AUTO-0001)", "佐藤 花子 (AUTO-0002)"],
      departments: ["営業部 (DEPT-001)", "総務部 (DEPT-002)"],
      locations: ["札幌営業所 (LOC-001)"],
    });
    expect(await db.device.count()).toBe(0); // プレビューでは登録しない

    const result = await executeImportAction(ledgerRequest(rows));
    expect(result.ok, result.ok ? "" : result.error).toBe(true);

    // 1 台目: すべての項目
    const pc = await db.device.findUniqueOrThrow({
      where: { assetNumber: "PC-L001" },
      omit: { initialPasswordEnc: false, loginPasswordEnc: false },
      include: { currentEmployee: { include: { department: true } }, category: true, currentLocation: true },
    });
    expect(pc).toMatchObject({
      name: "Latitude 5440",
      model: "Latitude 5440",
      hostname: "EIGYO-01",
      purpose: "営業用",
      manufacturer: "Dell",
      osName: "Windows 11",
      cpu: "Core i5-1345U",
      memory: "16GB",
      disk: "SSD 256GB",
      recovery: "済",
      purchasePrice: 128000,
      status: "IN_USE",
      initialUser: "admin",
      loginUser: "yamada",
      notes: "メモ1\nメモ2",
    });
    expect(pc.category.categoryCode).toBe("PC");
    expect(pc.currentLocation.name).toBe("本社");
    expect(toDateInput(pc.purchaseDate)).toBe("2024-04-01");
    expect(toDateInput(pc.warrantyExpiry)).toBe("2027-03-31");
    expect(toDateInput(pc.homeLoanedAt)).toBe("2024-05-01");
    expect(pc.currentEmployee).toMatchObject({ name: "山田 太郎", employeeNumber: "AUTO-0001", department: { name: "営業部" } });
    // パスワードは暗号化されている
    expect(pc.initialPasswordEnc).not.toContain("Init#Pass1");
    expect(decryptSecret(pc.initialPasswordEnc!)).toBe("Init#Pass1");
    expect(decryptSecret(pc.loginPasswordEnc!)).toBe("User#Pass2");
    const assignment = await db.deviceAssignment.findFirstOrThrow({ where: { deviceId: pc.id } });
    expect(toDateInput(assignment.assignedAt)).toBe("2024-04-10");

    // 2 台目は同じ社員
    const sp = await db.device.findUniqueOrThrow({ where: { assetNumber: "SP-L002" } });
    expect(sp.currentEmployeeId).toBe(pc.currentEmployeeId);
    expect(await db.employee.count({ where: { name: { startsWith: "山田" } } })).toBe(1);

    // 3 台目: 在庫なので貸出なし、日付でないサポートは備考へ
    const stock = await db.device.findUniqueOrThrow({ where: { assetNumber: "PC-L003" }, include: { currentLocation: true } });
    expect(stock).toMatchObject({ status: "IN_STOCK", currentEmployeeId: null, notes: "サポート: あり" });
    expect(stock.currentLocation).toMatchObject({ name: "札幌営業所", locationCode: "LOC-001" });
    expect(await db.deviceAssignment.count({ where: { deviceId: stock.id } })).toBe(0);

    // 4 台目: 返却済みの貸出履歴
    const returned = await db.device.findUniqueOrThrow({ where: { assetNumber: "PC-L004" }, include: { assignments: true } });
    expect(returned).toMatchObject({ status: "IN_STOCK", currentEmployeeId: null });
    expect(returned.assignments).toHaveLength(1);
    expect(toDateInput(returned.assignments[0].returnedAt)).toBe("2024-03-31");

    // 廃棄済みは登録しない
    expect(await db.device.count({ where: { assetNumber: "PC-OLD" } })).toBe(0);

    // 操作履歴に平文のパスワードを残さない
    const logs = JSON.stringify(await db.auditLog.findMany());
    for (const secret of ["Init#Pass1", "User#Pass2"]) expect(logs).not.toContain(secret);
    // データの整合性が保たれている
    expect((await checkIntegrity()).filter((i) => i.severity === "error")).toEqual([]);
  });

  it("自動登録しない場合、見つからない社員・拠点はエラー", async () => {
    const result = await previewImportAction(ledgerRequest([{ ...YAMADA, 拠点: "名古屋支店" }], { options: { defaultCategoryId: pcCategoryId, autoCreate: false } }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const messages = result.data.rows[0].messages.join(" / ");
    expect(result.data.rows[0].action).toBe("error");
    expect(messages).toContain("名古屋支店");
  });

  it("同姓同名の社員がいる場合は社員番号での指定を求める", async () => {
    await db.employee.create({ data: { employeeNumber: "E1", name: "山田 太郎" } });
    await db.employee.create({ data: { employeeNumber: "E2", name: "山田太郎" } });
    const result = await previewImportAction(ledgerRequest([YAMADA]));
    if (!result.ok) throw new Error(result.error);
    expect(result.data.rows[0].messages.join()).toContain("2 人います");
  });

  it("資産種別をまとめて指定しない場合、種別の列がないと取り込めない", async () => {
    const result = await previewImportAction(ledgerRequest([YAMADA], { options: { defaultCategoryId: null, autoCreate: true } }));
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.error).toContain("資産種別");
  });

  it("日付として読めない値は行ごとのエラーになる", async () => {
    const result = await previewImportAction(ledgerRequest([{ ...YAMADA, 購入日: "去年の春" }]));
    if (!result.ok) throw new Error(result.error);
    expect(result.data.rows[0].messages.join()).toContain("「去年の春」を日付として読み取れません");
  });

  it("IT資産管理担当者はパスワードの取り込みと自動登録ができない", async () => {
    await loginAs("manager@example.com");
    const withPasswords = await previewImportAction(ledgerRequest([YAMADA], { options: { defaultCategoryId: pcCategoryId, autoCreate: false } }));
    expect(withPasswords).toMatchObject({ ok: false });
    if (!withPasswords.ok) expect(withPasswords.error).toContain("パスワード");

    const mapping = { ...guessMapping("devices", LEDGER_HEADERS), initialPassword: null, loginPassword: null };
    const withAutoCreate = await previewImportAction(ledgerRequest([YAMADA], { mapping }));
    expect(withAutoCreate).toMatchObject({ ok: false });
    if (!withAutoCreate.ok) expect(withAutoCreate.error).toContain("自動登録");
  });

  it("暗号鍵が設定されていない場合、パスワードの列は取り込めない", async () => {
    const original = process.env.DEVICE_SECRET_KEY;
    delete process.env.DEVICE_SECRET_KEY;
    try {
      const result = await previewImportAction(ledgerRequest([YAMADA]));
      expect(result).toMatchObject({ ok: false });
      if (!result.ok) expect(result.error).toContain("DEVICE_SECRET_KEY");
    } finally {
      process.env.DEVICE_SECRET_KEY = original;
    }
  });

  it("更新モードでは変更されたパスワードだけを更新する", async () => {
    await executeImportAction(ledgerRequest([YAMADA]));
    const same = await previewImportAction(ledgerRequest([YAMADA], { mode: "upsert" }));
    if (!same.ok) throw new Error(same.error);
    expect(same.data.rows[0]).toMatchObject({ action: "skip" });

    const changed = await executeImportAction(ledgerRequest([{ ...YAMADA, PW2: "New#Pass3", メモリ: "32GB" }], { mode: "upsert" }));
    if (!changed.ok) throw new Error(changed.error);
    expect(changed.data.rows[0].messages[0]).toContain("ユーザーのパスワード");
    const pc = await db.device.findUniqueOrThrow({ where: { assetNumber: "PC-L001" }, omit: { loginPasswordEnc: false } });
    expect(decryptSecret(pc.loginPasswordEnc!)).toBe("New#Pass3");
    expect(pc.memory).toBe("32GB");
  });
});

describe("端末のログイン情報", () => {
  beforeEach(async () => {
    await resetDb();
    logout();
    await createUser("ADMIN", { email: "admin@example.com" });
    await createUser("ASSET_MANAGER", { email: "manager@example.com" });
    await db.location.create({ data: { locationCode: "HQ", name: "本社" } });
    pcCategoryId = (await db.deviceCategory.findUniqueOrThrow({ where: { categoryCode: "PC" } })).id;
    await loginAs("admin@example.com");
    await executeImportAction(ledgerRequest([YAMADA]));
  });

  it("管理者はパスワードを表示でき、表示したことが操作履歴に残る", async () => {
    const device = await db.device.findUniqueOrThrow({ where: { assetNumber: "PC-L001" } });
    const result = await revealDeviceSecretAction({ id: device.id, field: "initialPassword" });
    expect(result).toMatchObject({ ok: true, data: { value: "Init#Pass1" } });
    const log = await db.auditLog.findFirstOrThrow({ where: { action: "SECRET_VIEW" } });
    expect(JSON.stringify(log)).not.toContain("Init#Pass1");
  });

  it("IT資産管理担当者はパスワードを表示・変更できない", async () => {
    const device = await db.device.findUniqueOrThrow({ where: { assetNumber: "PC-L001" } });
    await loginAs("manager@example.com");
    expect((await revealDeviceSecretAction({ id: device.id, field: "loginPassword" })).ok).toBe(false);
    const update = await updateDeviceCredentialsAction({
      id: device.id, initialUser: "x", loginUser: "y", initialPassword: "z", loginPassword: "", clearInitialPassword: false, clearLoginPassword: false,
    });
    expect(update.ok).toBe(false);
  });

  it("ログイン情報の変更: 空欄のパスワードは変更せず、削除を選ぶと消える", async () => {
    const device = await db.device.findUniqueOrThrow({ where: { assetNumber: "PC-L001" } });
    const result = await updateDeviceCredentialsAction({
      id: device.id, initialUser: "admin2", loginUser: "yamada", initialPassword: "", loginPassword: "", clearInitialPassword: false, clearLoginPassword: true,
    });
    expect(result.ok).toBe(true);
    const after = await db.device.findUniqueOrThrow({ where: { id: device.id }, omit: { initialPasswordEnc: false, loginPasswordEnc: false } });
    expect(after.initialUser).toBe("admin2");
    expect(decryptSecret(after.initialPasswordEnc!)).toBe("Init#Pass1");
    expect(after.loginPasswordEnc).toBeNull();
  });
});
