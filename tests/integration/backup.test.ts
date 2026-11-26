import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { recordAudit } from "@/lib/audit";
import { todayJst } from "@/lib/dates";
import { createDevice, createEmployee, createLocation, createUser, resetDb } from "../helpers/db";

const backupDir = mkdtempSync(path.join(os.tmpdir(), "dk-backup-test-"));

/** バックアップスクリプトをテスト用 DB に対して実行する */
function runScript(...args: string[]) {
  return spawnSync(process.execPath, [path.resolve("scripts/db-backup.mjs"), ...args], {
    env: { ...process.env, BACKUP_DIR: backupDir, DATABASE_URL: process.env.DATABASE_URL },
    encoding: "utf8",
  });
}

/** 全テーブルの内容 (比較用) */
async function snapshot() {
  const tables = ["departments", "locations", "device_categories", "asset_number_sequences", "employees", "users", "devices", "device_assignments", "device_location_history", "maintenance_records", "disposal_records", "audit_logs"];
  const result: Record<string, unknown[]> = {};
  for (const t of tables) {
    result[t] = await db.$queryRawUnsafe(`SELECT row_to_json(x) AS r FROM (SELECT * FROM "${t}" ORDER BY 1) x`);
  }
  return result;
}

afterAll(() => rmSync(backupDir, { recursive: true, force: true }));

describe("バックアップ・復元", () => {
  it("バックアップから復元すると全テーブルの内容が完全に元に戻り、採番も続きから行われる", async () => {
    await resetDb();
    const admin = await createUser("ADMIN", { email: "admin@example.com" });
    const loc = await createLocation("HQ");
    await db.department.create({ data: { departmentCode: "D1", name: "総務部", isActive: false } });
    const emp = await createEmployee("E1");
    await db.employee.update({ where: { id: emp.id }, data: { name: "山田 \"太郎\"\n改行あり", joinedAt: new Date("2020-04-01") } });
    const device = await createDevice(loc.id, { assetNumber: "PC-000001", status: "IN_USE" });
    await db.device.update({ where: { id: device.id }, data: { purchasePrice: 158000, warrantyExpiry: new Date("2029-03-31"), currentEmployeeId: emp.id, notes: "備考, カンマ" } });
    await db.deviceAssignment.create({ data: { deviceId: device.id, employeeId: emp.id, assignedAt: todayJst(), assignedById: admin.id } });
    await createDevice(loc.id, { assetNumber: "PC-000002", status: "DISPOSED" });
    await recordAudit(db, { userId: admin.id, action: "UPDATE", entityType: "Device", entityId: device.id, before: { a: [1, 2] }, after: { nested: { x: null } } });
    await db.session.create({ data: { id: "dummy-session", userId: admin.id, expiresAt: new Date(Date.now() + 60_000) } });
    const before = await snapshot();

    const backup = runScript("backup");
    expect(backup.status, backup.stderr).toBe(0);
    const [file] = readdirSync(backupDir).filter((f) => f.endsWith(".jsonl.gz"));
    expect(file).toBeDefined();

    // バックアップ後にデータを変更・削除する
    await db.auditLog.deleteMany();
    await db.deviceAssignment.deleteMany();
    await db.device.updateMany({ data: { name: "変更後" } });
    await createDevice(loc.id, { assetNumber: "PC-AFTER" });

    // --yes がない場合は何もしない
    const refused = runScript("restore", path.join(backupDir, file));
    expect(refused.status).not.toBe(0);
    expect(await db.auditLog.count()).toBe(0);

    const restored = runScript("restore", path.join(backupDir, file), "--yes");
    expect(restored.status, restored.stderr).toBe(0);
    expect(await snapshot()).toEqual(before);
    // セッションは復元しない (全員が再ログイン)
    expect(await db.session.count()).toBe(0);

    // 採番が復元後の最大値の続きから行われる (主キー重複が起きない)
    const next = await createDevice(loc.id, { assetNumber: "PC-NEXT" });
    expect(next.id).toBeGreaterThan(Math.max(...(before.devices as { r: { id: number } }[]).map((d) => d.r.id)));
  });

  it("バックアップでないファイル・存在しないファイルは復元しない", () => {
    expect(runScript("restore", path.join(backupDir, "missing.jsonl.gz"), "--yes").status).not.toBe(0);
  });
});
