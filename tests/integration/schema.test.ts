import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { createDevice, createEmployee, createLocation, resetDb } from "../helpers/db";

describe("データベース制約 (データ整合性ルール)", () => {
  beforeEach(resetDb);

  it("資産管理番号・社員番号・拠点コード・部署コードは一意", async () => {
    const loc = await createLocation("HQ");
    await createDevice(loc.id, { assetNumber: "PC-000001" });
    await expect(createDevice(loc.id, { assetNumber: "PC-000001" })).rejects.toMatchObject({ code: "P2002" });

    await createEmployee("E0001");
    await expect(createEmployee("E0001")).rejects.toMatchObject({ code: "P2002" });

    await expect(createLocation("HQ")).rejects.toMatchObject({ code: "P2002" });

    await db.department.create({ data: { departmentCode: "D01", name: "総務部" } });
    await expect(db.department.create({ data: { departmentCode: "D01", name: "重複" } })).rejects.toMatchObject({
      code: "P2002",
    });
  });

  it("同一端末に未返却の貸与を複数作成できない (返却済みは複数可)", async () => {
    const loc = await createLocation();
    const device = await createDevice(loc.id);
    const emp = await createEmployee();
    const day = new Date("2026-04-01");

    await db.deviceAssignment.create({ data: { deviceId: device.id, employeeId: emp.id, assignedAt: day, returnedAt: day } });
    await db.deviceAssignment.create({ data: { deviceId: device.id, employeeId: emp.id, assignedAt: day, returnedAt: day } });
    await db.deviceAssignment.create({ data: { deviceId: device.id, employeeId: emp.id, assignedAt: day } });
    await expect(
      db.deviceAssignment.create({ data: { deviceId: device.id, employeeId: emp.id, assignedAt: day } }),
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("履歴が存在する端末は物理削除できない", async () => {
    const loc = await createLocation();
    const device = await createDevice(loc.id);
    const emp = await createEmployee();
    await db.deviceAssignment.create({ data: { deviceId: device.id, employeeId: emp.id, assignedAt: new Date() } });
    await expect(db.device.delete({ where: { id: device.id } })).rejects.toThrow();
  });
});
