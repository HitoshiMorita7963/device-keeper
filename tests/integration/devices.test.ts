import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => import("../helpers/request").then((m) => m.nextHeadersMock));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { db } from "@/lib/db";
import { changeDeviceStatusAction, createDeviceAction, deleteDeviceAction, updateDeviceAction } from "@/app/(app)/devices/actions";
import { searchDevices } from "@/server/devices";
import { addDays, todayJst, toDateInput } from "@/lib/dates";
import type { DeviceCreateInput } from "@/lib/validation/devices";
import { createDevice, createEmployee, createLocation, createUser, resetDb } from "../helpers/db";
import { loginAs, logout } from "../helpers/request";

let locationId: number;
let pcCategoryId: number;
let spCategoryId: number;

function input(overrides: Partial<DeviceCreateInput> = {}): DeviceCreateInput {
  return {
    name: "ノートPC",
    categoryId: String(pcCategoryId),
    assetNumberMode: "auto",
    assetNumber: "",
    currentLocationId: String(locationId),
    status: "IN_STOCK",
    manufacturer: "",
    model: "",
    serialNumber: "",
    osName: "",
    osVersion: "",
    purchaseDate: "",
    purchasePrice: "",
    purchaseVendor: "",
    warrantyExpiry: "",
    notes: "",
    ...overrides,
  };
}

async function create(overrides: Partial<DeviceCreateInput> = {}) {
  const result = await createDeviceAction(input(overrides));
  if (!result.ok) throw new Error(result.error);
  return db.device.findUniqueOrThrow({ where: { id: result.data.id } });
}

describe("端末管理", () => {
  beforeEach(async () => {
    await resetDb();
    logout();
    await createUser("ASSET_MANAGER", { email: "manager@example.com" });
    await createUser("EMPLOYEE", { email: "staff@example.com" });
    locationId = (await createLocation("HQ")).id;
    pcCategoryId = (await db.deviceCategory.findUniqueOrThrow({ where: { categoryCode: "PC" } })).id;
    spCategoryId = (await db.deviceCategory.findUniqueOrThrow({ where: { categoryCode: "SP" } })).id;
    await loginAs("manager@example.com");
  });

  describe("資産管理番号の自動採番", () => {
    it("資産種別ごとに連番を振る", async () => {
      expect((await create()).assetNumber).toBe("PC-000001");
      expect((await create()).assetNumber).toBe("PC-000002");
      expect((await create({ categoryId: String(spCategoryId) })).assetNumber).toBe("SP-000001");
    });

    it("手入力で使われている番号は飛ばす", async () => {
      await create({ assetNumberMode: "manual", assetNumber: "pc-000001" });
      expect((await create()).assetNumber).toBe("PC-000002");
    });

    it("同時に登録しても番号が重複しない", async () => {
      const results = await Promise.all(Array.from({ length: 8 }, () => createDeviceAction(input())));
      expect(results.every((r) => r.ok)).toBe(true);
      const numbers = (await db.device.findMany({ select: { assetNumber: true } })).map((d) => d.assetNumber).sort();
      expect(numbers).toEqual(Array.from({ length: 8 }, (_, i) => `PC-00000${i + 1}`));
    });

    it("手入力の番号が重複する場合はエラー", async () => {
      await create({ assetNumberMode: "manual", assetNumber: "OLD-1" });
      const dup = await createDeviceAction(input({ assetNumberMode: "manual", assetNumber: "old-1" }));
      expect(dup).toMatchObject({ ok: false, error: "資産管理番号が既に登録されています。" });
    });

    it("手入力を選んで番号が空欄なら入力エラー", async () => {
      const result = await createDeviceAction(input({ assetNumberMode: "manual", assetNumber: "" }));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.fieldErrors?.assetNumber).toBeDefined();
    });
  });

  describe("登録・編集", () => {
    it("登録時に使用中・廃棄済みは指定できない", async () => {
      const result = await createDeviceAction({ ...input(), status: "IN_USE" as never });
      expect(result.ok).toBe(false);
    });

    it("購入金額・日付を変換して保存し、編集内容を操作履歴に残す", async () => {
      const device = await create({ purchasePrice: "128,000", purchaseDate: "2026/04/01", warrantyExpiry: "2029-03-31" });
      expect(device.purchasePrice).toBe(128000);
      expect(toDateInput(device.purchaseDate)).toBe("2026-04-01");

      const result = await updateDeviceAction({
        id: String(device.id),
        assetNumber: device.assetNumber,
        name: "営業部ノートPC",
        categoryId: String(pcCategoryId),
        manufacturer: "",
        model: "",
        serialNumber: "SN-1",
        osName: "",
        osVersion: "",
        purchaseDate: "2026-04-01",
        purchasePrice: "128000",
        purchaseVendor: "",
        warrantyExpiry: "2029-03-31",
        notes: "",
      });
      expect(result.ok).toBe(true);
      const log = await db.auditLog.findFirstOrThrow({ where: { entityType: "Device", action: "UPDATE" } });
      expect(log.beforeData).toMatchObject({ name: "ノートPC", serialNumber: null });
      expect(log.afterData).toMatchObject({ name: "営業部ノートPC", serialNumber: "SN-1" });
    });

    it("廃棄済みの端末は編集・状態変更できない", async () => {
      const device = await createDevice(locationId, { status: "DISPOSED" });
      const update = await updateDeviceAction({
        id: String(device.id), assetNumber: device.assetNumber, name: "x", categoryId: String(pcCategoryId),
        manufacturer: "", model: "", serialNumber: "", osName: "", osVersion: "", purchaseDate: "", purchasePrice: "",
        purchaseVendor: "", warrantyExpiry: "", notes: "",
      });
      expect(update).toMatchObject({ ok: false, error: "廃棄済みの端末は編集できません。" });
      const status = await changeDeviceStatusAction({ id: device.id, status: "IN_STOCK", reason: "x" });
      expect(status.ok).toBe(false);
    });

    it("一般社員は端末を登録できない", async () => {
      await loginAs("staff@example.com");
      expect((await createDeviceAction(input())).ok).toBe(false);
      expect(await db.device.count()).toBe(0);
    });
  });

  describe("状態変更", () => {
    it("保管中 → 紛失 → 保管中 (発見) を理由付きで記録する", async () => {
      const device = await create();
      expect((await changeDeviceStatusAction({ id: device.id, status: "LOST", reason: "社外で紛失" })).ok).toBe(true);
      expect((await changeDeviceStatusAction({ id: device.id, status: "IN_STOCK", reason: "発見" })).ok).toBe(true);
      const logs = await db.auditLog.findMany({ where: { action: "STATUS_CHANGE" }, orderBy: { id: "asc" } });
      expect(logs.map((l) => (l.afterData as { status: string }).status)).toEqual(["LOST", "IN_STOCK"]);
      expect(logs[0].afterData).toMatchObject({ reason: "社外で紛失" });
    });

    it("貸出中でない端末は使用中にできず、貸出中の端末は保管中にできない", async () => {
      const device = await create();
      expect((await changeDeviceStatusAction({ id: device.id, status: "IN_USE", reason: "x" })).ok).toBe(false);

      const emp = await createEmployee();
      await db.deviceAssignment.create({ data: { deviceId: device.id, employeeId: emp.id, assignedAt: todayJst() } });
      await db.device.update({ where: { id: device.id }, data: { status: "IN_USE", currentEmployeeId: emp.id } });
      expect((await changeDeviceStatusAction({ id: device.id, status: "IN_STOCK", reason: "x" })).ok).toBe(false);
      expect((await changeDeviceStatusAction({ id: device.id, status: "LOST", reason: "貸与先で紛失" })).ok).toBe(true);
      expect((await changeDeviceStatusAction({ id: device.id, status: "IN_USE", reason: "発見" })).ok).toBe(true);
    });

    it("理由は必須", async () => {
      const device = await create();
      const result = await changeDeviceStatusAction({ id: device.id, status: "LOST", reason: " " });
      expect(result.ok).toBe(false);
    });
  });

  describe("削除", () => {
    it("履歴のない端末は論理削除され一覧から消えるが、番号は再利用されない", async () => {
      const device = await create();
      expect((await deleteDeviceAction({ id: device.id, reason: "誤登録" })).ok).toBe(true);
      expect((await db.device.findUniqueOrThrow({ where: { id: device.id } })).deletedAt).not.toBeNull();
      expect((await searchDevices({})).total).toBe(0);
      expect((await create()).assetNumber).toBe("PC-000002");
    });

    it("貸与履歴がある端末は削除できない", async () => {
      const device = await create();
      const emp = await createEmployee();
      await db.deviceAssignment.create({ data: { deviceId: device.id, employeeId: emp.id, assignedAt: todayJst(), returnedAt: todayJst() } });
      expect((await deleteDeviceAction({ id: device.id, reason: "x" })).ok).toBe(false);
    });
  });

  describe("検索", () => {
    it("複数条件を組み合わせて絞り込める", async () => {
      const osaka = await createLocation("OSK");
      const dept = await db.department.create({ data: { departmentCode: "D1", name: "営業部" } });
      const emp = await db.employee.create({ data: { employeeNumber: "E1", name: "鈴木 一郎", departmentId: dept.id } });
      const today = todayJst();

      const a = await create({ name: "営業用PC", manufacturer: "Lenovo", serialNumber: "ABC123", warrantyExpiry: toDateInput(addDays(today, 10)) });
      await create({ name: "開発用PC", manufacturer: "Dell", warrantyExpiry: toDateInput(addDays(today, -1)) });
      await create({ name: "大阪PC", manufacturer: "Lenovo", currentLocationId: String(osaka.id) });
      await create({ name: "社用スマホ", categoryId: String(spCategoryId) });
      await createDevice(locationId, { status: "DISPOSED", assetNumber: "PC-OLD" });

      await db.deviceAssignment.create({ data: { deviceId: a.id, employeeId: emp.id, assignedAt: today, expectedReturnAt: addDays(today, -3) } });
      await db.device.update({ where: { id: a.id }, data: { status: "IN_USE", currentEmployeeId: emp.id } });

      const names = async (q: Parameters<typeof searchDevices>[0]) => (await searchDevices(q)).rows.map((r) => r.name).sort();

      expect((await searchDevices({})).total).toBe(4); // 廃棄済みは既定で除外
      expect((await searchDevices({ status: "all" })).total).toBe(5);
      expect(await names({ manufacturer: "lenovo" })).toEqual(["営業用PC", "大阪PC"]);
      expect(await names({ manufacturer: "lenovo", location: String(locationId) })).toEqual(["営業用PC"]);
      expect(await names({ serial: "abc" })).toEqual(["営業用PC"]);
      expect(await names({ category: String(spCategoryId) })).toEqual(["社用スマホ"]);
      expect(await names({ user: "鈴木" })).toEqual(["営業用PC"]);
      expect(await names({ department: String(dept.id), status: "IN_USE" })).toEqual(["営業用PC"]);
      expect(await names({ warranty: "soon" })).toEqual(["営業用PC"]);
      expect(await names({ warranty: "expired" })).toEqual(["開発用PC"]);
      expect(await names({ overdue: "1" })).toEqual(["営業用PC"]);
      expect(await names({ assetNumber: "PC-00000", name: "大阪" })).toEqual(["大阪PC"]);
    });
  });
});
