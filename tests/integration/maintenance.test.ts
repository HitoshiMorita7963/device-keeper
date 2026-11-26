import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => import("../helpers/request").then((m) => m.nextHeadersMock));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { db } from "@/lib/db";
import { createMaintenanceAction, updateMaintenanceAction } from "@/app/(app)/maintenance/actions";
import { disposeDeviceAction } from "@/app/(app)/disposals/actions";
import { assignDeviceAction, returnDeviceAction } from "@/app/(app)/assignments/actions";
import { changeDeviceStatusAction } from "@/app/(app)/devices/actions";
import { moveDeviceAction } from "@/app/(app)/moves/actions";
import { addDays, todayJst, toDateInput } from "@/lib/dates";
import { searchMaintenance } from "@/server/maintenance";
import type { DisposalInput, MaintenanceCreateInput, MaintenanceUpdateInput } from "@/lib/validation/maintenance";
import { createDevice, createEmployee, createLocation, createUser, resetDb } from "../helpers/db";
import { loginAs, logout } from "../helpers/request";

const daysFromToday = (n: number) => toDateInput(addDays(todayJst(), n));

let managerId: number;
let locationId: number;

const createInput = (deviceId: number, overrides: Partial<MaintenanceCreateInput> = {}): MaintenanceCreateInput => ({
  deviceId,
  reportedAt: daysFromToday(-3),
  problemDescription: "画面が映らない",
  repairVendor: "",
  repairCost: "",
  status: "REPORTED",
  notes: "",
  ...overrides,
});

const updateInput = (id: number, overrides: Partial<MaintenanceUpdateInput> = {}): MaintenanceUpdateInput => ({
  id,
  problemDescription: "画面が映らない",
  repairVendor: "メーカー修理センター",
  repairCost: "15,000",
  status: "IN_PROGRESS",
  repairedAt: "",
  notes: "",
  ...overrides,
});

const disposalInput = (deviceId: number, overrides: Partial<DisposalInput> = {}): DisposalInput => ({
  deviceId,
  disposedAt: daysFromToday(0),
  disposalReason: "耐用年数経過",
  disposalMethod: "産業廃棄物処理業者へ引き渡し",
  disposalVendor: "",
  dataErasure: "confirmed",
  notes: "",
  ...overrides,
});

async function openRecord(deviceId: number) {
  const result = await createMaintenanceAction(createInput(deviceId));
  if (!result.ok) throw new Error(result.error);
  return result.data.id;
}

async function lend(deviceId: number) {
  const emp = await createEmployee(`E${deviceId}`);
  const r = await assignDeviceAction({ deviceId, employeeId: emp.id, assignedAt: daysFromToday(-10), expectedReturnAt: "", assignedById: managerId, notes: "" });
  if (!r.ok) throw new Error(r.error);
}

const statusOf = async (id: number) => (await db.device.findUniqueOrThrow({ where: { id } })).status;

describe("修理・故障管理", () => {
  beforeEach(async () => {
    await resetDb();
    logout();
    managerId = (await createUser("ASSET_MANAGER", { email: "manager@example.com" })).id;
    await createUser("ADMIN", { email: "admin@example.com" });
    await createUser("EMPLOYEE", { email: "staff@example.com" });
    locationId = (await createLocation()).id;
    await loginAs("manager@example.com");
  });

  it("修理受付で端末を修理中にし、受付前の状態と操作履歴を記録する", async () => {
    const device = await createDevice(locationId);
    const id = await openRecord(device.id);
    expect(await statusOf(device.id)).toBe("REPAIR");
    expect(await db.maintenanceRecord.findUniqueOrThrow({ where: { id } })).toMatchObject({ previousDeviceStatus: "IN_STOCK", status: "REPORTED" });
    expect(await db.auditLog.count({ where: { action: "MAINTENANCE_CREATE", entityId: String(device.id) } })).toBe(1);
  });

  it("修理中の端末は貸出できず、完了すると保管中に戻って貸出できる", async () => {
    const device = await createDevice(locationId);
    const id = await openRecord(device.id);
    const emp = await createEmployee();
    const assign = () => assignDeviceAction({ deviceId: device.id, employeeId: emp.id, assignedAt: daysFromToday(0), expectedReturnAt: "", assignedById: managerId, notes: "" });
    expect((await assign()).ok).toBe(false);

    expect((await updateMaintenanceAction(updateInput(id))).ok).toBe(true);
    expect(await statusOf(device.id)).toBe("REPAIR");
    const done = await updateMaintenanceAction(updateInput(id, { status: "COMPLETED", repairedAt: daysFromToday(0) }));
    expect(done.ok).toBe(true);
    expect(await db.maintenanceRecord.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: "COMPLETED", repairCost: 15000 });
    expect(await statusOf(device.id)).toBe("IN_STOCK");
    expect((await assign()).ok).toBe(true);
  });

  it("貸出中の端末の修理を完了すると使用中に戻る。修理中に返却された場合は保管中に戻る", async () => {
    const a = await createDevice(locationId, { assetNumber: "PC-A" });
    const b = await createDevice(locationId, { assetNumber: "PC-B" });
    await lend(a.id);
    await lend(b.id);
    const ra = await openRecord(a.id);
    const rb = await openRecord(b.id);
    expect(await db.maintenanceRecord.findUniqueOrThrow({ where: { id: ra } })).toMatchObject({ previousDeviceStatus: "IN_USE" });

    await returnDeviceAction({ deviceId: b.id, returnedAt: daysFromToday(0), conditionOnReturn: "破損・故障あり", accessoriesChecked: true, returnedById: managerId, notes: "" });
    expect(await statusOf(b.id)).toBe("REPAIR");

    await updateMaintenanceAction(updateInput(ra, { status: "COMPLETED", repairedAt: daysFromToday(0) }));
    await updateMaintenanceAction(updateInput(rb, { status: "CANCELLED" }));
    expect(await statusOf(a.id)).toBe("IN_USE");
    expect(await statusOf(b.id)).toBe("IN_STOCK");
  });

  it("対応中の修理は 1 端末 1 件まで。廃棄済み・紛失の端末は修理登録できない", async () => {
    const device = await createDevice(locationId);
    await openRecord(device.id);
    expect((await createMaintenanceAction(createInput(device.id))).ok).toBe(false);
    for (const status of ["DISPOSED", "LOST"] as const) {
      const d = await createDevice(locationId, { status });
      expect((await createMaintenanceAction(createInput(d.id))).ok).toBe(false);
    }
  });

  it("同じ端末に同時に修理登録しても 1 件しか作成されない", async () => {
    const device = await createDevice(locationId);
    const results = await Promise.all([createMaintenanceAction(createInput(device.id)), createMaintenanceAction(createInput(device.id))]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(await db.maintenanceRecord.count()).toBe(1);
  });

  it("完了には修理完了日が必要で、受付日より前・未来日は不可。完了後は状況を変更できない", async () => {
    const device = await createDevice(locationId);
    const id = await openRecord(device.id);
    const noDate = await updateMaintenanceAction(updateInput(id, { status: "COMPLETED" }));
    expect(noDate.ok).toBe(false);
    if (!noDate.ok) expect(noDate.fieldErrors?.repairedAt).toBeDefined();
    expect((await updateMaintenanceAction(updateInput(id, { status: "COMPLETED", repairedAt: daysFromToday(-5) }))).ok).toBe(false);
    expect((await updateMaintenanceAction(updateInput(id, { status: "COMPLETED", repairedAt: daysFromToday(1) }))).ok).toBe(false);

    expect((await updateMaintenanceAction(updateInput(id, { status: "COMPLETED", repairedAt: daysFromToday(0) }))).ok).toBe(true);
    expect((await updateMaintenanceAction(updateInput(id, { status: "IN_PROGRESS" }))).ok).toBe(false);
    // 完了後も費用などの訂正はできる
    const fix = await updateMaintenanceAction(updateInput(id, { status: "COMPLETED", repairedAt: daysFromToday(0), repairCost: "18000" }));
    expect(fix.ok).toBe(true);
    expect((await db.maintenanceRecord.findUniqueOrThrow({ where: { id } })).repairCost).toBe(18000);
  });

  it("修理対応中は手動の状態変更で保管中に戻せない (紛失のみ可)", async () => {
    const device = await createDevice(locationId);
    await openRecord(device.id);
    expect((await changeDeviceStatusAction({ id: device.id, status: "IN_STOCK", reason: "x" })).ok).toBe(false);
    expect((await changeDeviceStatusAction({ id: device.id, status: "LOST", reason: "修理先で紛失" })).ok).toBe(true);
  });

  it("修理履歴を状況・業者で検索し、費用を合計する", async () => {
    const d1 = await createDevice(locationId, { assetNumber: "PC-1" });
    const d2 = await createDevice(locationId, { assetNumber: "PC-2" });
    const r1 = await openRecord(d1.id);
    await openRecord(d2.id);
    await updateMaintenanceAction(updateInput(r1, { status: "COMPLETED", repairedAt: daysFromToday(0), repairCost: "10000" }));
    expect((await searchMaintenance({})).total).toBe(1);
    const all = await searchMaintenance({ status: "all", vendor: "修理センター" });
    expect(all.total).toBe(1);
    expect(all.totalCost).toBe(10000);
  });

  it("一般社員は修理登録できない", async () => {
    const device = await createDevice(locationId);
    await loginAs("staff@example.com");
    expect((await createMaintenanceAction(createInput(device.id))).ok).toBe(false);
  });
});

describe("廃棄管理", () => {
  beforeEach(async () => {
    await resetDb();
    logout();
    managerId = (await createUser("ASSET_MANAGER", { email: "manager@example.com" })).id;
    await createUser("ADMIN", { email: "admin@example.com" });
    locationId = (await createLocation()).id;
    await loginAs("admin@example.com");
  });

  it("廃棄済みにし、廃棄履歴と操作履歴を記録する。過去の履歴は保持され、以後は貸出・移動・編集できない", async () => {
    const device = await createDevice(locationId);
    await lend(device.id);
    await returnDeviceAction({ deviceId: device.id, returnedAt: daysFromToday(0), conditionOnReturn: "良好", accessoriesChecked: true, returnedById: managerId, notes: "" });

    const result = await disposeDeviceAction(disposalInput(device.id, { disposalVendor: "〇〇リサイクル" }));
    expect(result.ok).toBe(true);
    expect(await statusOf(device.id)).toBe("DISPOSED");
    expect(await db.disposalRecord.findUniqueOrThrow({ where: { deviceId: device.id } })).toMatchObject({ dataErasureConfirmed: true, disposalVendor: "〇〇リサイクル" });
    expect(await db.deviceAssignment.count({ where: { deviceId: device.id } })).toBe(1);
    expect(await db.auditLog.count({ where: { action: "DISPOSE", entityId: String(device.id) } })).toBe(1);

    const emp = await createEmployee("E99");
    expect((await assignDeviceAction({ deviceId: device.id, employeeId: emp.id, assignedAt: daysFromToday(0), expectedReturnAt: "", assignedById: managerId, notes: "" })).ok).toBe(false);
    const other = await createLocation("OSK");
    expect((await moveDeviceAction({ deviceId: device.id, toLocationId: other.id, movedAt: daysFromToday(0), movedById: managerId, reason: "x" })).ok).toBe(false);
    expect((await disposeDeviceAction(disposalInput(device.id))).ok).toBe(false);
  });

  it("貸出中・修理対応中の端末は廃棄できない", async () => {
    const lent = await createDevice(locationId, { assetNumber: "PC-L" });
    await lend(lent.id);
    const result = await disposeDeviceAction(disposalInput(lent.id));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("返却処理");

    const repairing = await createDevice(locationId, { assetNumber: "PC-R" });
    await openRecord(repairing.id);
    expect((await disposeDeviceAction(disposalInput(repairing.id))).ok).toBe(false);
  });

  it("紛失した端末は廃棄 (除却) できる。データ消去の確認は必須", async () => {
    const device = await createDevice(locationId, { status: "LOST" });
    const noErasure = await disposeDeviceAction(disposalInput(device.id, { dataErasure: "" as DisposalInput["dataErasure"] }));
    expect(noErasure.ok).toBe(false);
    if (!noErasure.ok) expect(noErasure.fieldErrors?.dataErasure).toBeDefined();
    expect((await disposeDeviceAction(disposalInput(device.id, { dataErasure: "not_required", disposalReason: "紛失のため除却" }))).ok).toBe(true);
  });

  it("IT資産管理担当者は廃棄できない (管理者のみ)", async () => {
    const device = await createDevice(locationId);
    await loginAs("manager@example.com");
    expect(await disposeDeviceAction(disposalInput(device.id))).toMatchObject({ ok: false, error: "この操作を行う権限がありません。" });
    expect(await statusOf(device.id)).toBe("IN_STOCK");
  });
});
