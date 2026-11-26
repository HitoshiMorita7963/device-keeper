import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => import("../helpers/request").then((m) => m.nextHeadersMock));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { db } from "@/lib/db";
import { assignDeviceAction, returnDeviceAction } from "@/app/(app)/assignments/actions";
import { changeDeviceStatusAction } from "@/app/(app)/devices/actions";
import { disposeDeviceAction } from "@/app/(app)/disposals/actions";
import { createMaintenanceAction, updateMaintenanceAction } from "@/app/(app)/maintenance/actions";
import { moveDeviceAction } from "@/app/(app)/moves/actions";
import { retireEmployeeAction } from "@/app/(app)/employees/actions";
import { todayJst, toDateInput } from "@/lib/dates";
import { checkIntegrity } from "@/server/integrity";
import { createDevice, createEmployee, createLocation, createUser, resetDb } from "../helpers/db";
import { loginAs, logout } from "../helpers/request";

/** 再現性のある疑似乱数 (失敗時に同じ操作列で再現できるよう固定シードを使う) */
function prng(seed: number) {
  return () => {
    seed = (seed * 1103515245 + 12345) % 2 ** 31;
    return seed / 2 ** 31;
  };
}

describe("データ整合性", () => {
  beforeEach(async () => {
    await resetDb();
    logout();
  });

  it("貸出・返却・移動・修理・状態変更・廃棄・退職をランダムに 300 回行っても矛盾が生じない", async () => {
    const admin = await createUser("ADMIN", { email: "admin@example.com" });
    await loginAs("admin@example.com");
    const locations = [await createLocation("HQ"), await createLocation("OSK"), await createLocation("FUK")];
    const devices = await Promise.all(Array.from({ length: 12 }, (_, i) => createDevice(locations[i % 3].id, { assetNumber: `PC-${i}` })));
    const employees = await Promise.all(Array.from({ length: 6 }, (_, i) => createEmployee(`E${i}`)));
    const rand = prng(20261126);
    const pick = <T,>(list: T[]) => list[Math.floor(rand() * list.length)];
    const today = toDateInput(todayJst());
    const outcomes = { ok: 0, rejected: 0 };

    for (let step = 0; step < 300; step++) {
      const device = pick(devices);
      const op = Math.floor(rand() * 9);
      let result: { ok: boolean };
      switch (op) {
        case 0:
        case 1:
          result = await assignDeviceAction({ deviceId: device.id, employeeId: pick(employees).id, assignedAt: today, expectedReturnAt: "", assignedById: admin.id, notes: "" });
          break;
        case 2:
          result = await returnDeviceAction({ deviceId: device.id, returnedAt: today, conditionOnReturn: "良好", accessoriesChecked: true, returnedById: admin.id, notes: "" });
          break;
        case 3:
          result = await moveDeviceAction({ deviceId: device.id, toLocationId: pick(locations).id, movedAt: today, movedById: admin.id, reason: "テスト" });
          break;
        case 4:
          result = await createMaintenanceAction({ deviceId: device.id, reportedAt: today, problemDescription: "故障", repairVendor: "", repairCost: "", status: "REPORTED", notes: "" });
          break;
        case 5: {
          const open = await db.maintenanceRecord.findFirst({ where: { deviceId: device.id, status: { in: ["REPORTED", "IN_PROGRESS"] } } });
          result = open
            ? await updateMaintenanceAction({ id: open.id, problemDescription: "故障", repairVendor: "", repairCost: "", status: rand() < 0.7 ? "COMPLETED" : "CANCELLED", repairedAt: today, notes: "" })
            : { ok: false };
          break;
        }
        case 6:
          result = await changeDeviceStatusAction({ id: device.id, status: pick(["IN_STOCK", "IN_USE", "REPAIR", "LOST"] as const), reason: "テスト" });
          break;
        case 7:
          result = rand() < 0.15
            ? await disposeDeviceAction({ deviceId: device.id, disposedAt: today, disposalReason: "テスト", disposalMethod: "その他", disposalVendor: "", dataErasure: "confirmed", notes: "" })
            : { ok: false };
          break;
        default:
          result = rand() < 0.1
            ? await retireEmployeeAction({ employeeId: pick(employees).id, retiredAt: today, acknowledgeAssignedDevices: rand() < 0.5 })
            : { ok: false };
      }
      outcomes[result.ok ? "ok" : "rejected"]++;
    }

    // 業務ルールで拒否された操作も含め、どの順序で操作しても DB に矛盾が残らないこと
    const errors = (await checkIntegrity()).filter((i) => i.severity === "error");
    expect(errors).toEqual([]);
    expect(outcomes.ok).toBeGreaterThan(50);
  }, 240_000);

  it("DB を直接書き換えて生じた矛盾を検出する", async () => {
    const loc = await createLocation();
    const other = await createLocation("OSK");
    const inUse = await createDevice(loc.id, { assetNumber: "PC-1", status: "IN_USE" });
    const disposed = await createDevice(loc.id, { assetNumber: "PC-2", status: "DISPOSED" });
    const moved = await createDevice(loc.id, { assetNumber: "PC-3" });
    await db.deviceLocationHistory.create({ data: { deviceId: moved.id, fromLocationId: loc.id, toLocationId: other.id, movedAt: todayJst() } });
    const repair = await createDevice(loc.id, { assetNumber: "PC-4", status: "REPAIR" });

    const issues = await checkIntegrity();
    const byDevice = (id: number) => issues.filter((i) => i.deviceId === id).map((i) => `${i.severity}:${i.check}`);
    expect(byDevice(inUse.id)).toContain("error:貸与");
    expect(byDevice(disposed.id)).toContain("error:廃棄");
    expect(byDevice(moved.id)).toContain("error:拠点");
    expect(byDevice(repair.id)).toEqual(["warning:修理"]);
  });
});
