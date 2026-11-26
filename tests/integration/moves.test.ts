import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => import("../helpers/request").then((m) => m.nextHeadersMock));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { db } from "@/lib/db";
import { moveDeviceAction } from "@/app/(app)/moves/actions";
import { addDays, todayJst, toDateInput } from "@/lib/dates";
import { locationCategoryMatrix, searchMoves } from "@/server/moves";
import type { MoveInput } from "@/lib/validation/moves";
import { createDevice, createEmployee, createLocation, createUser, resetDb } from "../helpers/db";
import { loginAs, logout } from "../helpers/request";

const daysFromToday = (n: number) => toDateInput(addDays(todayJst(), n));

let managerId: number;
let hq: number;
let osaka: number;
let fukuoka: number;

function input(deviceId: number, toLocationId: number, overrides: Partial<MoveInput> = {}): MoveInput {
  return { deviceId, toLocationId, movedAt: daysFromToday(0), movedById: managerId, reason: "配置換え", ...overrides };
}

describe("拠点間移動", () => {
  beforeEach(async () => {
    await resetDb();
    logout();
    managerId = (await createUser("ASSET_MANAGER", { email: "manager@example.com" })).id;
    await createUser("EMPLOYEE", { email: "staff@example.com" });
    hq = (await createLocation("HQ")).id;
    osaka = (await createLocation("OSK")).id;
    fukuoka = (await createLocation("FUK")).id;
    await loginAs("manager@example.com");
  });

  it("移動元を現在拠点から自動設定し、移動履歴登録・現在拠点更新・操作履歴記録を行う", async () => {
    const device = await createDevice(hq);
    const result = await moveDeviceAction(input(device.id, osaka, { reason: "大阪支店へ配備" }));
    expect(result.ok).toBe(true);

    expect((await db.device.findUniqueOrThrow({ where: { id: device.id } })).currentLocationId).toBe(osaka);
    const history = await db.deviceLocationHistory.findFirstOrThrow({ where: { deviceId: device.id } });
    expect(history).toMatchObject({ fromLocationId: hq, toLocationId: osaka, movedById: managerId, reason: "大阪支店へ配備" });
    const log = await db.auditLog.findFirstOrThrow({ where: { action: "MOVE" } });
    expect(log.beforeData).toMatchObject({ location: "HQ拠点" });
    expect(log.afterData).toMatchObject({ location: "OSK拠点", reason: "大阪支店へ配備" });
  });

  it("連続して移動すると、前回の移動先が次の移動元になる", async () => {
    const device = await createDevice(hq);
    await moveDeviceAction(input(device.id, osaka, { movedAt: daysFromToday(-5) }));
    await moveDeviceAction(input(device.id, fukuoka));
    const rows = (await searchMoves({})).rows;
    expect(rows.map((r) => [r.fromLocation?.name, r.toLocation.name])).toEqual([
      ["OSK拠点", "FUK拠点"],
      ["HQ拠点", "OSK拠点"],
    ]);
  });

  it("貸出中の端末も移動でき、利用者・状態は変わらない", async () => {
    const device = await createDevice(hq);
    const emp = await createEmployee();
    await db.deviceAssignment.create({ data: { deviceId: device.id, employeeId: emp.id, assignedAt: todayJst() } });
    await db.device.update({ where: { id: device.id }, data: { status: "IN_USE", currentEmployeeId: emp.id } });
    expect((await moveDeviceAction(input(device.id, osaka))).ok).toBe(true);
    expect(await db.device.findUniqueOrThrow({ where: { id: device.id } })).toMatchObject({ status: "IN_USE", currentEmployeeId: emp.id, currentLocationId: osaka });
  });

  it.each(["DISPOSED", "LOST"] as const)("%s の端末は移動できない", async (status) => {
    const device = await createDevice(hq, { status });
    expect((await moveDeviceAction(input(device.id, osaka))).ok).toBe(false);
    expect(await db.deviceLocationHistory.count()).toBe(0);
  });

  it("同じ拠点・使用停止中の拠点への移動はできない", async () => {
    const device = await createDevice(hq);
    expect((await moveDeviceAction(input(device.id, hq))).ok).toBe(false);
    await db.location.update({ where: { id: osaka }, data: { isActive: false } });
    const result = await moveDeviceAction(input(device.id, osaka));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("使用停止中");
  });

  it("未来日・前回の移動日より前の日付・理由なしは受け付けない", async () => {
    const device = await createDevice(hq);
    expect((await moveDeviceAction(input(device.id, osaka, { movedAt: daysFromToday(1) }))).ok).toBe(false);
    expect((await moveDeviceAction(input(device.id, osaka, { reason: "" }))).ok).toBe(false);
    await moveDeviceAction(input(device.id, osaka, { movedAt: daysFromToday(-1) }));
    const older = await moveDeviceAction(input(device.id, fukuoka, { movedAt: daysFromToday(-3) }));
    expect(older.ok).toBe(false);
    if (!older.ok) expect(older.error).toContain("前回の移動日");
  });

  it("同じ端末を同時に別拠点へ移動しても、履歴と現在拠点が矛盾しない", async () => {
    const device = await createDevice(hq);
    const results = await Promise.all([moveDeviceAction(input(device.id, osaka)), moveDeviceAction(input(device.id, fukuoka))]);
    expect(results.every((r) => r.ok)).toBe(true);
    const history = await db.deviceLocationHistory.findMany({ where: { deviceId: device.id }, orderBy: { id: "asc" } });
    // 2 件目の移動元は 1 件目の移動先になっていること (ロックにより順に処理される)
    expect(history[1].fromLocationId).toBe(history[0].toLocationId);
    expect((await db.device.findUniqueOrThrow({ where: { id: device.id } })).currentLocationId).toBe(history[1].toLocationId);
  });

  it("一般社員は移動できない", async () => {
    const device = await createDevice(hq);
    await loginAs("staff@example.com");
    expect((await moveDeviceAction(input(device.id, osaka))).ok).toBe(false);
  });

  it("拠点別・種別別の端末数を集計する (廃棄済みを除く)", async () => {
    await createDevice(hq);
    await createDevice(hq);
    await createDevice(osaka);
    await createDevice(osaka, { status: "DISPOSED" });
    const matrix = await locationCategoryMatrix();
    expect(matrix.categories.map((c) => c.name)).toEqual(["PC"]);
    expect(matrix.rows.map((r) => [r.location.name, r.total])).toEqual([
      ["FUK拠点", 0],
      ["HQ拠点", 2],
      ["OSK拠点", 1],
    ]);
    expect(matrix.grandTotal).toBe(3);
  });
});
