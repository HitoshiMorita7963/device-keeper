import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => import("../helpers/request").then((m) => m.nextHeadersMock));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { db } from "@/lib/db";
import { assignDeviceAction, returnDeviceAction } from "@/app/(app)/assignments/actions";
import { getDashboardSummary } from "@/lib/dashboard";
import { addDays, todayJst, toDateInput } from "@/lib/dates";
import { searchAssignments } from "@/server/assignments";
import type { AssignInput, ReturnInput } from "@/lib/validation/assignments";
import { createDevice, createEmployee, createLocation, createUser, resetDb } from "../helpers/db";
import { loginAs, logout } from "../helpers/request";

const today = () => toDateInput(todayJst());
const daysFromToday = (n: number) => toDateInput(addDays(todayJst(), n));

let managerId: number;
let locationId: number;

function assignInput(deviceId: number, employeeId: number, overrides: Partial<AssignInput> = {}): AssignInput {
  return { deviceId, employeeId, assignedAt: today(), expectedReturnAt: "", assignedById: managerId, notes: "", ...overrides };
}

function returnInput(deviceId: number, overrides: Partial<ReturnInput> = {}): ReturnInput {
  return { deviceId, returnedAt: today(), conditionOnReturn: "良好", accessoriesChecked: true, returnedById: managerId, notes: "", ...overrides };
}

describe("貸出・返却", () => {
  beforeEach(async () => {
    await resetDb();
    logout();
    managerId = (await createUser("ASSET_MANAGER", { email: "manager@example.com" })).id;
    await createUser("EMPLOYEE", { email: "staff@example.com" });
    locationId = (await createLocation()).id;
    await loginAs("manager@example.com");
  });

  describe("貸出", () => {
    it("貸与履歴の登録・使用中への変更・現在利用者の更新・操作履歴の記録を行う", async () => {
      const device = await createDevice(locationId);
      const emp = await createEmployee("E1");
      const result = await assignDeviceAction(assignInput(device.id, emp.id, { expectedReturnAt: daysFromToday(30), notes: "充電器付き" }));
      expect(result.ok).toBe(true);

      const after = await db.device.findUniqueOrThrow({ where: { id: device.id } });
      expect(after).toMatchObject({ status: "IN_USE", currentEmployeeId: emp.id });
      const assignment = await db.deviceAssignment.findFirstOrThrow({ where: { deviceId: device.id } });
      expect(assignment).toMatchObject({ employeeId: emp.id, assignedById: managerId, returnedAt: null, notes: "充電器付き" });
      const log = await db.auditLog.findFirstOrThrow({ where: { action: "ASSIGN" } });
      expect(log).toMatchObject({ entityType: "Device", entityId: String(device.id), userId: managerId });
      expect(log.afterData).toMatchObject({ status: "IN_USE", employee: "社員E1 (E1)" });
    });

    it.each(["REPAIR", "LOST", "DISPOSED", "IN_USE"] as const)("%s の端末は貸出できない", async (status) => {
      const device = await createDevice(locationId, { status });
      const emp = await createEmployee();
      const result = await assignDeviceAction(assignInput(device.id, emp.id));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain("貸出できません");
      expect(await db.deviceAssignment.count()).toBe(0);
    });

    it("同じ端末を同時に貸出しても、未返却の貸出は 1 件しかできない", async () => {
      const device = await createDevice(locationId);
      const [a, b] = [await createEmployee("E1"), await createEmployee("E2")];
      const results = await Promise.all([
        assignDeviceAction(assignInput(device.id, a.id)),
        assignDeviceAction(assignInput(device.id, b.id)),
        assignDeviceAction(assignInput(device.id, a.id)),
      ]);
      expect(results.filter((r) => r.ok)).toHaveLength(1);
      expect(await db.deviceAssignment.count({ where: { deviceId: device.id, returnedAt: null } })).toBe(1);
    });

    it("退職者には貸出できない", async () => {
      const device = await createDevice(locationId);
      const emp = await db.employee.create({ data: { employeeNumber: "R1", name: "退職者", employmentStatus: "RETIRED" } });
      expect((await assignDeviceAction(assignInput(device.id, emp.id))).ok).toBe(false);
    });

    it("返却予定日は貸出日以降、貸出日は未来日不可", async () => {
      const device = await createDevice(locationId);
      const emp = await createEmployee();
      const early = await assignDeviceAction(assignInput(device.id, emp.id, { expectedReturnAt: daysFromToday(-1) }));
      expect(early.ok).toBe(false);
      if (!early.ok) expect(early.fieldErrors?.expectedReturnAt).toBeDefined();
      const future = await assignDeviceAction(assignInput(device.id, emp.id, { assignedAt: daysFromToday(1), expectedReturnAt: daysFromToday(2) }));
      expect(future).toMatchObject({ ok: false, error: "貸出日に未来の日付は指定できません。" });
    });

    it("担当者に一般社員は指定できず、一般社員は貸出操作自体ができない", async () => {
      const device = await createDevice(locationId);
      const emp = await createEmployee();
      const staff = await db.user.findUniqueOrThrow({ where: { email: "staff@example.com" } });
      expect((await assignDeviceAction(assignInput(device.id, emp.id, { assignedById: staff.id }))).ok).toBe(false);

      await loginAs("staff@example.com");
      expect(await assignDeviceAction(assignInput(device.id, emp.id))).toMatchObject({ ok: false, error: "この操作を行う権限がありません。" });
      expect(await db.deviceAssignment.count()).toBe(0);
    });
  });

  describe("返却", () => {
    it("返却日の登録・保管中への変更・現在利用者の解除・操作履歴の記録を行い、再度貸出できる", async () => {
      const device = await createDevice(locationId);
      const [a, b] = [await createEmployee("E1"), await createEmployee("E2")];
      await assignDeviceAction(assignInput(device.id, a.id, { assignedAt: daysFromToday(-10) }));

      const result = await returnDeviceAction(returnInput(device.id, { conditionOnReturn: "軽微な傷・汚れあり", accessoriesChecked: false, notes: "ACアダプタ欠品" }));
      expect(result.ok).toBe(true);
      expect(await db.device.findUniqueOrThrow({ where: { id: device.id } })).toMatchObject({ status: "IN_STOCK", currentEmployeeId: null });
      const closed = await db.deviceAssignment.findFirstOrThrow({ where: { deviceId: device.id } });
      expect(closed).toMatchObject({ returnedById: managerId, conditionOnReturn: "軽微な傷・汚れあり", accessoriesChecked: false });
      expect(closed.notes).toContain("ACアダプタ欠品");
      expect(await db.auditLog.count({ where: { action: "RETURN", entityId: String(device.id) } })).toBe(1);

      expect((await assignDeviceAction(assignInput(device.id, b.id))).ok).toBe(true);
      expect(await db.deviceAssignment.count({ where: { deviceId: device.id } })).toBe(2);
    });

    it("貸出中でない端末・貸出日より前の返却日はエラー", async () => {
      const device = await createDevice(locationId);
      expect((await returnDeviceAction(returnInput(device.id))).ok).toBe(false);

      const emp = await createEmployee();
      await assignDeviceAction(assignInput(device.id, emp.id, { assignedAt: daysFromToday(-2) }));
      const early = await returnDeviceAction(returnInput(device.id, { returnedAt: daysFromToday(-3) }));
      expect(early.ok).toBe(false);
      if (!early.ok) expect(early.error).toContain("貸出日");
    });

    it("修理中の端末を返却した場合は修理中のまま利用者だけ解除する", async () => {
      const device = await createDevice(locationId);
      const emp = await createEmployee();
      await assignDeviceAction(assignInput(device.id, emp.id));
      await db.device.update({ where: { id: device.id }, data: { status: "REPAIR" } });
      expect((await returnDeviceAction(returnInput(device.id))).ok).toBe(true);
      expect(await db.device.findUniqueOrThrow({ where: { id: device.id } })).toMatchObject({ status: "REPAIR", currentEmployeeId: null });
    });

    it("同時に返却しても返却は 1 回だけ記録される", async () => {
      const device = await createDevice(locationId);
      const emp = await createEmployee();
      await assignDeviceAction(assignInput(device.id, emp.id));
      const results = await Promise.all([returnDeviceAction(returnInput(device.id)), returnDeviceAction(returnInput(device.id))]);
      expect(results.filter((r) => r.ok)).toHaveLength(1);
      expect(await db.auditLog.count({ where: { action: "RETURN" } })).toBe(1);
    });
  });

  describe("返却予定・期限超過", () => {
    it("期限超過・返却予定が近い貸出を抽出し、ダッシュボードにも反映する", async () => {
      const emp = await createEmployee();
      const [overdue, due, later, none, returned] = await Promise.all(
        ["PC-1", "PC-2", "PC-3", "PC-4", "PC-5"].map((n) => createDevice(locationId, { assetNumber: n })),
      );
      await assignDeviceAction(assignInput(overdue.id, emp.id, { assignedAt: daysFromToday(-20), expectedReturnAt: daysFromToday(-1) }));
      await assignDeviceAction(assignInput(due.id, emp.id, { expectedReturnAt: daysFromToday(3) }));
      await assignDeviceAction(assignInput(later.id, emp.id, { expectedReturnAt: daysFromToday(30) }));
      await assignDeviceAction(assignInput(none.id, emp.id));
      await assignDeviceAction(assignInput(returned.id, emp.id, { assignedAt: daysFromToday(-20), expectedReturnAt: daysFromToday(-5) }));
      await returnDeviceAction(returnInput(returned.id));

      const numbers = async (state: string) => (await searchAssignments({ state })).rows.map((r) => r.device.assetNumber).sort();
      expect(await numbers("overdue")).toEqual(["PC-1"]);
      expect(await numbers("due")).toEqual(["PC-2"]);
      expect(await numbers("open")).toEqual(["PC-1", "PC-2", "PC-3", "PC-4"]);
      expect(await numbers("returned")).toEqual(["PC-5"]);
      expect((await getDashboardSummary()).overdue).toBe(1);
    });
  });
});
