import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => import("../helpers/request").then((m) => m.nextHeadersMock));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { db } from "@/lib/db";
import { createDepartmentAction, updateDepartmentAction } from "@/app/(app)/settings/departments/actions";
import { createCategoryAction } from "@/app/(app)/settings/categories/actions";
import { createLocationAction, updateLocationAction } from "@/app/(app)/locations/actions";
import { createEmployeeAction, retireEmployeeAction, updateEmployeeAction } from "@/app/(app)/employees/actions";
import { searchEmployees } from "@/server/employees";
import { createDevice, createEmployee, createLocation, createUser, resetDb } from "../helpers/db";
import { loginAs, logout } from "../helpers/request";

const location = { locationCode: "OSK", name: "大阪支店", address: "", managerName: "", phone: "06-1234-5678", isActive: true };
const employee = { employeeNumber: "E100", name: "山田 太郎", email: "Yamada@Example.com", departmentId: "", homeLocationId: "", employmentStatus: "ACTIVE" as const, joinedAt: "2024-04-01" };

describe("基本マスタ", () => {
  beforeEach(async () => {
    await resetDb();
    logout();
    await createUser("ADMIN", { email: "admin@example.com" });
    await createUser("ASSET_MANAGER", { email: "manager@example.com" });
    await createUser("EMPLOYEE", { email: "staff@example.com" });
  });

  describe("権限チェック (サーバー側)", () => {
    it("未ログインでは登録できない", async () => {
      const result = await createLocationAction(location);
      expect(result).toMatchObject({ ok: false, error: "ログインが必要です。" });
      expect(await db.location.count()).toBe(0);
    });

    it("IT資産管理担当者は拠点・社員・部署・資産種別を登録できない", async () => {
      await loginAs("manager@example.com");
      for (const result of [
        await createLocationAction(location),
        await createEmployeeAction(employee),
        await createDepartmentAction({ departmentCode: "D1", name: "総務部", isActive: true }),
        await createCategoryAction({ categoryCode: "NW", name: "ネットワーク機器", prefix: "NW", numberDigits: "6", isActive: true }),
      ]) {
        expect(result).toMatchObject({ ok: false, error: "この操作を行う権限がありません。" });
      }
      expect(await db.location.count()).toBe(0);
      expect(await db.employee.count()).toBe(0);
    });

    it("一般社員は登録できない", async () => {
      await loginAs("staff@example.com");
      expect((await createLocationAction(location)).ok).toBe(false);
    });
  });

  describe("拠点", () => {
    it("管理者は登録・更新でき、操作履歴が残る", async () => {
      await loginAs("admin@example.com");
      const created = await createLocationAction(location);
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const updated = await updateLocationAction({ ...location, id: created.data.id, name: "大阪営業所" });
      expect(updated.ok).toBe(true);

      const logs = await db.auditLog.findMany({ where: { entityType: "Location" }, orderBy: { id: "asc" } });
      expect(logs.map((l) => l.action)).toEqual(["CREATE", "UPDATE"]);
      expect(logs[1].beforeData).toMatchObject({ name: "大阪支店" });
      expect(logs[1].afterData).toMatchObject({ name: "大阪営業所" });
      expect(logs[1].ipAddress).toBe("198.51.100.7");
    });

    it("拠点コードの重複は分かりやすいエラーになる", async () => {
      await loginAs("admin@example.com");
      await createLocationAction(location);
      const dup = await createLocationAction({ ...location, name: "別拠点" });
      expect(dup).toMatchObject({ ok: false, error: "拠点コードが既に登録されています。" });
    });

    it("入力エラーは項目ごとに返す", async () => {
      await loginAs("admin@example.com");
      const result = await createLocationAction({ ...location, locationCode: "大阪", name: " ", phone: "abc" });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(Object.keys(result.fieldErrors ?? {}).sort()).toEqual(["locationCode", "name", "phone"]);
    });

    it("端末が残っている拠点は使用停止にできない", async () => {
      await loginAs("admin@example.com");
      const loc = await createLocation("HQ");
      await createDevice(loc.id);
      const result = await updateLocationAction({ ...location, locationCode: "HQ", id: loc.id, isActive: false });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain("端末が 1 台");
    });
  });

  describe("社員", () => {
    it("登録時にメールアドレスを小文字に正規化し、空欄は null で保存する", async () => {
      await loginAs("admin@example.com");
      const result = await createEmployeeAction(employee);
      expect(result.ok).toBe(true);
      const saved = await db.employee.findFirstOrThrow();
      expect(saved).toMatchObject({ email: "yamada@example.com", departmentId: null });
      expect(saved.joinedAt?.toISOString().slice(0, 10)).toBe("2024-04-01");
    });

    it("通常の編集では退職に変更できない", async () => {
      await loginAs("admin@example.com");
      const emp = await createEmployee("E200");
      const result = await updateEmployeeAction({ ...employee, employeeNumber: "E200", id: emp.id, employmentStatus: "RETIRED" });
      expect(result.ok).toBe(false);
      expect((await db.employee.findUniqueOrThrow({ where: { id: emp.id } })).employmentStatus).toBe("ACTIVE");
    });

    it("貸与中の端末がある社員の退職処理は、確認がない限り実行されない", async () => {
      await loginAs("admin@example.com");
      const loc = await createLocation();
      const device = await createDevice(loc.id, { status: "IN_USE" });
      const emp = await createEmployee("E300");
      await db.deviceAssignment.create({ data: { deviceId: device.id, employeeId: emp.id, assignedAt: new Date("2026-01-01") } });

      const blocked = await retireEmployeeAction({ employeeId: emp.id, retiredAt: "2026-03-31" });
      expect(blocked.ok).toBe(false);
      if (!blocked.ok) expect(blocked.error).toContain("貸与中の端末が 1 台");
      expect((await db.employee.findUniqueOrThrow({ where: { id: emp.id } })).employmentStatus).toBe("ACTIVE");

      const done = await retireEmployeeAction({ employeeId: emp.id, retiredAt: "2026-03-31", acknowledgeAssignedDevices: true });
      expect(done.ok).toBe(true);
      const retired = await db.employee.findUniqueOrThrow({ where: { id: emp.id } });
      expect(retired.employmentStatus).toBe("RETIRED");
      expect(await db.auditLog.count({ where: { action: "RETIRE", entityId: String(emp.id) } })).toBe(1);
    });

    it("退職処理で社員に紐づく利用者アカウントを無効化する", async () => {
      await loginAs("admin@example.com");
      const emp = await createEmployee("E400");
      const account = await createUser("EMPLOYEE", { email: "e400@example.com", employeeId: emp.id });
      const result = await retireEmployeeAction({ employeeId: emp.id, retiredAt: "2026-03-31" });
      expect(result.ok).toBe(true);
      expect((await db.user.findUniqueOrThrow({ where: { id: account.id } })).isActive).toBe(false);
    });

    it("退職者を在籍に戻すと退職日を消去する", async () => {
      await loginAs("admin@example.com");
      const emp = await createEmployee("E500");
      await retireEmployeeAction({ employeeId: emp.id, retiredAt: "2026-03-31" });
      const result = await updateEmployeeAction({ ...employee, employeeNumber: "E500", email: "", id: emp.id, employmentStatus: "ACTIVE" });
      expect(result.ok).toBe(true);
      expect((await db.employee.findUniqueOrThrow({ where: { id: emp.id } })).retiredAt).toBeNull();
    });

    it("一覧は既定で退職者を除外し、条件を組み合わせて検索できる", async () => {
      const dept = await db.department.create({ data: { departmentCode: "D1", name: "総務部" } });
      await db.employee.create({ data: { employeeNumber: "A1", name: "佐藤", departmentId: dept.id } });
      await db.employee.create({ data: { employeeNumber: "A2", name: "佐藤 次郎" } });
      await db.employee.create({ data: { employeeNumber: "A3", name: "佐藤 三郎", employmentStatus: "RETIRED" } });

      expect((await searchEmployees({ q: "佐藤" })).total).toBe(2);
      expect((await searchEmployees({ q: "佐藤", status: "all" })).total).toBe(3);
      expect((await searchEmployees({ q: "佐藤", department: String(dept.id) })).rows.map((r) => r.employeeNumber)).toEqual(["A1"]);
    });
  });

  describe("部署・資産種別", () => {
    it("在籍社員がいる部署は使用停止にできない", async () => {
      await loginAs("admin@example.com");
      const created = await createDepartmentAction({ departmentCode: "D1", name: "総務部", isActive: true });
      if (!created.ok) throw new Error(created.error);
      await db.employee.create({ data: { employeeNumber: "B1", name: "社員", departmentId: created.data.id } });
      const result = await updateDepartmentAction({ id: created.data.id, departmentCode: "D1", name: "総務部", isActive: false });
      expect(result.ok).toBe(false);
    });

    it("資産種別の登録時に採番カウンタを作成し、プレフィックスを大文字にする", async () => {
      await loginAs("admin@example.com");
      const result = await createCategoryAction({ categoryCode: "NW", name: "ネットワーク機器", prefix: "nw", numberDigits: "5", isActive: true });
      expect(result.ok).toBe(true);
      const category = await db.deviceCategory.findUniqueOrThrow({ where: { categoryCode: "NW" }, include: { sequence: true } });
      expect(category.prefix).toBe("NW");
      expect(category.sequence?.lastNumber).toBe(0);
    });
  });
});
