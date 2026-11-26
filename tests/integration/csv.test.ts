import Papa from "papaparse";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => import("../helpers/request").then((m) => m.nextHeadersMock));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { executeImportAction, previewImportAction } from "@/app/(app)/csv/actions";
import { GET as exportRoute } from "@/app/api/csv/export/[type]/route";
import { guessMapping, type ImportTarget } from "@/lib/csv/fields";
import { todayJst, toDateInput } from "@/lib/dates";
import { buildExport } from "@/server/csv-export";
import type { ImportRequestInput as ImportRequest } from "@/lib/validation/csv";
import { createDevice, createUser, resetDb } from "../helpers/db";
import { loginAs, logout } from "../helpers/request";

function request(target: ImportTarget, csvRows: string[][], mode: "skip" | "upsert" = "skip"): ImportRequest {
  const [headers, ...rows] = csvRows;
  return { target, mode, headers, rows, mapping: guessMapping(target, headers) };
}

/** エクスポートした CSV をインポート用の行データに変換する */
function parseCsv(csv: string): string[][] {
  return Papa.parse<string[]>(csv.replace(/^﻿/, ""), { skipEmptyLines: "greedy" }).data;
}

describe("CSV管理", () => {
  beforeEach(async () => {
    await resetDb();
    logout();
    await createUser("ADMIN", { email: "admin@example.com" });
    await createUser("ASSET_MANAGER", { email: "manager@example.com" });
    await createUser("EMPLOYEE", { email: "staff@example.com" });
    await db.location.create({ data: { locationCode: "HQ", name: "本社" } });
    await db.location.create({ data: { locationCode: "OSK", name: "大阪支店" } });
    await loginAs("manager@example.com");
  });

  describe("端末のインポート", () => {
    const header = ["資産管理番号", "資産名称", "資産種別", "現在拠点", "購入日", "購入金額", "端末状態", "利用者社員番号"];

    it("プレビューでは DB を変更せず、登録・スキップ・エラーを行ごとに判定する", async () => {
      await createDevice((await db.location.findUniqueOrThrow({ where: { locationCode: "HQ" } })).id, { assetNumber: "PC-000100" });
      const result = await previewImportAction(
        request("devices", [
          header,
          ["", "ノートPC A", "PC", "本社", "2026/04/01", "120,000", "", ""],
          ["PC-000100", "既存", "PC", "HQ", "", "", "", ""],
          ["", "", "存在しない種別", "札幌", "2026-13-01", "abc", "不明な状態", ""],
          ["X-1", "重複1", "SP", "OSK", "", "", "", ""],
          ["x-1", "重複2", "SP", "OSK", "", "", "", ""],
          ["", "廃棄した端末", "PC", "本社", "", "", "廃棄済み", ""],
        ]),
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.summary).toMatchObject({ total: 6, create: 2, skip: 2, error: 2 });
      expect(result.data.rows.map((r) => r.action)).toEqual(["create", "skip", "error", "create", "error", "skip"]);
      const errors = result.data.rows[2].messages.join(" / ");
      for (const text of ["資産名称", "存在しない種別", "札幌", "購入日", "購入金額", "不明な状態"]) expect(errors).toContain(text);
      expect(result.data.rows[4].messages[0]).toContain("5 行目と重複");
      // 廃棄済みの行は全体を止めずにスキップする
      expect(result.data.rows[5].messages[0]).toContain("廃棄済み");
      expect(await db.device.count()).toBe(1);
    });

    it("エラーが 1 件でもあれば何も登録しない", async () => {
      const result = await executeImportAction(
        request("devices", [header, ["", "正常な行", "PC", "本社", "", "", "", ""], ["", "誤った行", "PC", "存在しない拠点", "", "", "", ""]]),
      );
      expect(result.ok).toBe(false);
      expect(await db.device.count()).toBe(0);
    });

    it("自動採番・利用者指定 (貸出中として登録)・操作履歴の記録を行う", async () => {
      const emp = await db.employee.create({ data: { employeeNumber: "E001", name: "山田" } });
      const result = await executeImportAction(
        request("devices", [
          header,
          ["", "ノートPC A", "PC", "本社", "2026/04/01", "120,000", "", "E001"],
          ["", "ノートPC B", "pc", "hq", "", "", "修理中", ""],
          ["SP-LEGACY-9", "旧スマホ", "スマートフォン", "大阪支店", "", "", "紛失", ""],
        ]),
      );
      expect(result.ok).toBe(true);
      const devices = await db.device.findMany({ orderBy: { id: "asc" } });
      expect(devices.map((d) => [d.assetNumber, d.status])).toEqual([
        ["PC-000001", "IN_USE"],
        ["PC-000002", "REPAIR"],
        ["SP-LEGACY-9", "LOST"],
      ]);
      expect(devices[0]).toMatchObject({ currentEmployeeId: emp.id, purchasePrice: 120000 });
      const assignment = await db.deviceAssignment.findFirstOrThrow();
      expect(assignment).toMatchObject({ employeeId: emp.id, returnedAt: null });
      expect(toDateInput(assignment.assignedAt)).toBe(toDateInput(todayJst()));
      expect(await db.auditLog.count({ where: { entityType: "Device", action: "CREATE" } })).toBe(3);
      expect(await db.auditLog.findFirstOrThrow({ where: { action: "CSV_IMPORT" } })).toMatchObject({ entityId: "devices" });
    });

    it("更新モード: 値のある項目だけ上書きし、空欄は既存値を残す。変更がない行はスキップ", async () => {
      const hq = await db.location.findUniqueOrThrow({ where: { locationCode: "HQ" } });
      const device = await createDevice(hq.id, { assetNumber: "PC-000001" });
      await db.device.update({ where: { id: device.id }, data: { manufacturer: "Dell", serialNumber: "SN-1" } });

      const cols = ["資産管理番号", "資産名称", "メーカー", "シリアル番号"];
      const result = await executeImportAction(
        request("devices", [cols, ["PC-000001", "", "Lenovo", ""]], "upsert"),
      );
      expect(result.ok).toBe(true);
      expect(await db.device.findUniqueOrThrow({ where: { id: device.id } })).toMatchObject({ name: "テストPC", manufacturer: "Lenovo", serialNumber: "SN-1" });

      const again = await previewImportAction(request("devices", [cols, ["PC-000001", "", "Lenovo", ""]], "upsert"));
      if (again.ok) expect(again.data.rows[0]).toMatchObject({ action: "skip", messages: ["変更がないためスキップします。"] });
    });

    it("スキップモードでは既存の端末を変更しない", async () => {
      const hq = await db.location.findUniqueOrThrow({ where: { locationCode: "HQ" } });
      await createDevice(hq.id, { assetNumber: "PC-000001" });
      const result = await executeImportAction(request("devices", [["資産管理番号", "資産名称", "資産種別", "現在拠点"], ["PC-000001", "変更後", "PC", "本社"]]));
      expect(result.ok).toBe(true);
      expect((await db.device.findUniqueOrThrow({ where: { assetNumber: "PC-000001" } })).name).toBe("テストPC");
    });

    it("エクスポートした CSV をそのまま取り込むと、すべて変更なしになる", async () => {
      const emp = await db.employee.create({ data: { employeeNumber: "E001", name: "山田" } });
      await executeImportAction(
        request("devices", [
          ["資産名称", "資産種別", "現在拠点", "購入日", "購入金額", "保証期限", "備考", "利用者社員番号"],
          ["ノートPC", "PC", "本社", "2026-04-01", "99800", "2029-03-31", "=SUM(A1) を含む備考", emp.employeeNumber],
          ["モニター", "TAB", "大阪支店", "", "", "", "", ""],
        ]),
      );
      const { csv } = await buildExport("devices", {});
      const result = await previewImportAction(request("devices", parseCsv(csv), "upsert"));
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.data.summary).toMatchObject({ total: 2, skip: 2, update: 0, error: 0 });
    });

    it("必須項目の列が対応付けられていない場合はエラー (更新モードではキー項目のみ必須)", async () => {
      const result = await previewImportAction(request("devices", [["資産名称"], ["PC"]]));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain("資産種別");
      const upsert = await previewImportAction(request("devices", [["資産名称"], ["PC"]], "upsert"));
      expect(upsert.ok).toBe(false);
      if (!upsert.ok) expect(upsert.error).toContain("資産管理番号");
    });
  });

  describe("社員・拠点のインポートと権限", () => {
    it("IT資産管理担当者は社員・拠点を取り込めない (端末のみ)", async () => {
      const result = await executeImportAction(request("employees", [["社員番号", "氏名"], ["E1", "山田"]]));
      expect(result).toMatchObject({ ok: false, error: "この取り込み対象を登録する権限がありません。" });
      expect(await db.employee.count()).toBe(0);
    });

    it("一般社員は CSV を取り込めない", async () => {
      await loginAs("staff@example.com");
      expect((await previewImportAction(request("locations", [["拠点コード", "拠点名"], ["FUK", "福岡"]]))).ok).toBe(false);
    });

    it("管理者は社員を取り込め、部署は名称・コードで指定でき、退職は指定できない", async () => {
      await loginAs("admin@example.com");
      await db.department.create({ data: { departmentCode: "D01", name: "総務部" } });
      const result = await previewImportAction(
        request("employees", [
          ["社員番号", "氏名", "メール", "部署", "所属拠点", "在籍状態", "入社日"],
          ["E1", "山田", "Yamada@example.com", "総務部", "本社", "", "2020/04/01"],
          ["E2", "鈴木", "yamada@example.com", "D01", "OSK", "休職", ""],
          ["E3", "佐藤", "", "", "", "退職", ""],
        ]),
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.rows.map((r) => r.action)).toEqual(["create", "error", "error"]);
      expect(result.data.rows[1].messages[0]).toContain("2 行目と重複");
      expect(result.data.rows[2].messages[0]).toContain("退職処理");
    });

    it("管理者は拠点を取り込め、既存拠点は更新モードで更新される", async () => {
      await loginAs("admin@example.com");
      const result = await executeImportAction(
        request("locations", [["拠点コード", "拠点名", "電話番号"], ["HQ", "東京本社", "03-1111-2222"], ["FUK", "福岡営業所", ""]], "upsert"),
      );
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.data.summary).toMatchObject({ create: 1, update: 1 });
      expect(await db.location.findUniqueOrThrow({ where: { locationCode: "HQ" } })).toMatchObject({ name: "東京本社", phone: "03-1111-2222" });
    });
  });

  describe("エクスポート", () => {
    it("検索条件で絞り込んだ CSV を BOM 付きで返し、操作履歴に記録する", async () => {
      const hq = await db.location.findUniqueOrThrow({ where: { locationCode: "HQ" } });
      const osaka = await db.location.findUniqueOrThrow({ where: { locationCode: "OSK" } });
      await createDevice(hq.id, { assetNumber: "PC-1" });
      await createDevice(osaka.id, { assetNumber: "PC-2" });

      const res = await exportRoute(new NextRequest(`http://localhost/api/csv/export/devices?location=${osaka.id}&page=3`), {
        params: Promise.resolve({ type: "devices" }),
      });
      expect(res.status).toBe(200);
      expect(res.headers.get("content-disposition")).toContain("devices_");
      const bytes = new Uint8Array(await res.arrayBuffer());
      expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]); // UTF-8 BOM
      const body = new TextDecoder().decode(bytes);
      const rows = parseCsv(body);
      expect(rows.map((r) => r[0])).toEqual(["資産管理番号", "PC-2"]);
      expect(await db.auditLog.findFirstOrThrow({ where: { action: "CSV_EXPORT" } })).toMatchObject({ entityId: "devices" });
    });

    it("一般社員はエクスポートできない", async () => {
      await loginAs("staff@example.com");
      const res = await exportRoute(new NextRequest("http://localhost/api/csv/export/employees"), {
        params: Promise.resolve({ type: "employees" }),
      });
      expect(res.status).toBe(403);
    });
  });
});
