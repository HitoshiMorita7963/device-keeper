import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => import("../helpers/request").then((m) => m.nextHeadersMock));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { POST } from "@/app/api/devices/[id]/computer-name/route";
import { issueAgentTokenAction, revokeAgentTokenAction, updateManagementNameAction } from "@/app/(app)/devices/actions";
import { disposeDeviceAction } from "@/app/(app)/disposals/actions";
import { computerNameSchema } from "@/lib/validation/device-names";
import { todayJst, toDateInput } from "@/lib/dates";
import { getDeviceDetail, searchDevices } from "@/server/devices";
import { createDevice, createLocation, createUser, resetDb } from "../helpers/db";
import { loginAs, logout } from "../helpers/request";

let locationId: number;

/** PC 名送信 API を呼ぶ (端末の取得スクリプトと同じ形式) */
async function send(deviceId: number | string, body: unknown, token?: string | null) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await POST(
    new NextRequest(`http://localhost/api/devices/${deviceId}/computer-name`, {
      method: "POST",
      headers,
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: String(deviceId) }) },
  );
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

async function issueToken(deviceId: number) {
  const result = await issueAgentTokenAction({ id: deviceId });
  if (!result.ok) throw new Error(result.error);
  return result.data.token;
}

const reload = (id: number) => db.device.findUniqueOrThrow({ where: { id } });

describe("PC名の自動取得", () => {
  beforeEach(async () => {
    await resetDb();
    logout();
    await createUser("ADMIN", { email: "admin@example.com" });
    await createUser("ASSET_MANAGER", { email: "manager@example.com" });
    await createUser("EMPLOYEE", { email: "staff@example.com" });
    locationId = (await createLocation()).id;
    await loginAs("admin@example.com");
  });

  it("既存の端末は PC名・管理用端末名が未取得・未設定のまま (互換性)", async () => {
    const device = await createDevice(locationId);
    expect(device).toMatchObject({ computerName: null, computerNameUpdatedAt: null, managementName: null, agentTokenIssuedAt: null });
  });

  it("端末連携キーで PC 名を保存し、取得日時と操作履歴を記録する", async () => {
    const device = await createDevice(locationId);
    const token = await issueToken(device.id);
    expect(token).toMatch(/^dkdev_[A-Za-z0-9_-]{40,}$/);
    // キー本体は保存しない (ハッシュのみ)
    const stored = await db.device.findUniqueOrThrow({ where: { id: device.id }, omit: { agentTokenHash: false } });
    expect(stored.agentTokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(stored.agentTokenHash).not.toContain(token);

    const res = await send(device.id, { computerName: "DESKTOP-A8F3K2" }, token);
    expect(res).toMatchObject({ status: 200, json: { ok: true, computerName: "DESKTOP-A8F3K2", changed: true, assetNumber: device.assetNumber } });
    const saved = await reload(device.id);
    expect(saved.computerName).toBe("DESKTOP-A8F3K2");
    expect(saved.computerNameUpdatedAt).not.toBeNull();
    const log = await db.auditLog.findFirstOrThrow({ where: { action: "COMPUTER_NAME_UPDATE" } });
    expect(log).toMatchObject({ userId: null, entityId: String(device.id), ipAddress: "198.51.100.7" });
    expect(log.afterData).toMatchObject({ computerName: "DESKTOP-A8F3K2" });
    expect(JSON.stringify(await db.auditLog.findMany())).not.toContain(token);
  });

  it("同じ PC 名の再送信は取得日時だけ更新し、PC 名が変わった場合のみ履歴に残す", async () => {
    const device = await createDevice(locationId);
    const token = await issueToken(device.id);
    await send(device.id, { computerName: "PC-01" }, token);
    const first = (await reload(device.id)).computerNameUpdatedAt!;
    await new Promise((r) => setTimeout(r, 20));
    const again = await send(device.id, { computerName: "PC-01" }, token);
    expect(again.json.changed).toBe(false);
    expect((await reload(device.id)).computerNameUpdatedAt!.getTime()).toBeGreaterThan(first.getTime());
    await send(device.id, { computerName: "PC-02" }, token);
    expect(await db.auditLog.count({ where: { action: "COMPUTER_NAME_UPDATE" } })).toBe(2);
  });

  it("認証情報なし・不正なキーは 401 で拒否し、失敗を記録する", async () => {
    const device = await createDevice(locationId);
    await issueToken(device.id);
    expect((await send(device.id, { computerName: "X" }, null)).status).toBe(401);
    const forged = await send(device.id, { computerName: "X" }, "dkdev_forged-token-value-1234567890");
    expect(forged.status).toBe(401);
    expect((await reload(device.id)).computerName).toBeNull();
    expect(await db.auditLog.count({ where: { action: "AGENT_AUTH_FAILED" } })).toBe(2);
    expect(JSON.stringify(await db.auditLog.findMany())).not.toContain("forged-token");
  });

  it("別の端末のキーでは更新できない (存在しない端末 ID も同様)", async () => {
    const a = await createDevice(locationId, { assetNumber: "PC-A" });
    const b = await createDevice(locationId, { assetNumber: "PC-B" });
    const tokenA = await issueToken(a.id);
    expect((await send(b.id, { computerName: "HACKED" }, tokenA)).status).toBe(403);
    expect((await send(999999, { computerName: "HACKED" }, tokenA)).status).toBe(403);
    expect((await send("abc", { computerName: "HACKED" }, tokenA)).status).toBe(404);
    expect((await reload(b.id)).computerName).toBeNull();
  });

  it.each([
    ["空", { computerName: "" }],
    ["空白", { computerName: "   " }],
    ["空白を含む", { computerName: "MY PC" }],
    ["記号", { computerName: "PC';DROP TABLE devices;--" }],
    ["64 文字", { computerName: "A".repeat(64) }],
    ["文字列でない", { computerName: 123 }],
    ["項目なし", {}],
  ])("不正な PC 名 (%s) は 400", async (_label, body) => {
    const device = await createDevice(locationId);
    const token = await issueToken(device.id);
    const res = await send(device.id, body, token);
    expect(res.status).toBe(400);
    expect((await reload(device.id)).computerName).toBeNull();
  });

  it("JSON の形式誤り・大きすぎる本文は拒否する", async () => {
    const device = await createDevice(locationId);
    const token = await issueToken(device.id);
    expect((await send(device.id, "{not json", token)).status).toBe(400);
    expect((await send(device.id, JSON.stringify({ computerName: "A", pad: "x".repeat(2000) }), token)).status).toBe(413);
  });

  it("再発行・無効化・廃棄すると以前のキーは使えなくなる", async () => {
    const device = await createDevice(locationId);
    const oldToken = await issueToken(device.id);
    const newToken = await issueToken(device.id);
    expect((await send(device.id, { computerName: "PC-1" }, oldToken)).status).toBe(401);
    expect((await send(device.id, { computerName: "PC-1" }, newToken)).status).toBe(200);

    expect((await revokeAgentTokenAction({ id: device.id })).ok).toBe(true);
    expect((await send(device.id, { computerName: "PC-2" }, newToken)).status).toBe(401);

    const token = await issueToken(device.id);
    await disposeDeviceAction({
      deviceId: device.id, disposedAt: toDateInput(todayJst()), disposalReason: "テスト", disposalMethod: "その他", disposalVendor: "", dataErasure: "confirmed", notes: "",
    });
    expect((await send(device.id, { computerName: "PC-3" }, token)).status).toBe(401);
    expect((await reload(device.id)).computerName).toBe("PC-1");
  });

  it("端末連携キーの発行は管理者のみ", async () => {
    const device = await createDevice(locationId);
    await loginAs("manager@example.com");
    expect(await issueAgentTokenAction({ id: device.id })).toMatchObject({ ok: false, error: "この操作を行う権限がありません。" });
  });

  it("PC 名の形式チェック (英数字・ハイフン・アンダースコア、63 文字まで)", () => {
    for (const ok of ["DESKTOP-A8F3K2", "pc_01", "A", "営業PC01", "A".repeat(63)]) expect(computerNameSchema.safeParse({ computerName: ok }).success, ok).toBe(true);
    for (const ng of ["-PC", "PC.local", "PC/01", "A".repeat(64)]) expect(computerNameSchema.safeParse({ computerName: ng }).success, ng).toBe(false);
  });
});

describe("管理用端末名", () => {
  beforeEach(async () => {
    await resetDb();
    logout();
    await createUser("ADMIN", { email: "admin@example.com" });
    await createUser("ASSET_MANAGER", { email: "manager@example.com" });
    await createUser("EMPLOYEE", { email: "staff@example.com" });
    locationId = (await createLocation()).id;
    await loginAs("manager@example.com");
  });

  it("新規設定・編集・未設定に戻すことができ、更新日時・更新者・操作履歴を記録する", async () => {
    const device = await createDevice(locationId);
    const manager = await db.user.findUniqueOrThrow({ where: { email: "manager@example.com" } });

    const set = await updateManagementNameAction({ id: device.id, managementName: "  営業部 山田さん用  " });
    expect(set).toMatchObject({ ok: true, data: { managementName: "営業部 山田さん用" } });
    // 保存後に再表示すると新しい値になっている
    const detail = await getDeviceDetail(device.id);
    expect(detail?.device).toMatchObject({ managementName: "営業部 山田さん用", managementNameUpdatedById: manager.id });
    expect(detail?.device.managementNameUpdatedBy?.displayName).toBe(manager.displayName);
    expect(detail?.device.managementNameUpdatedAt).not.toBeNull();

    expect((await updateManagementNameAction({ id: device.id, managementName: "会議室用" })).ok).toBe(true);
    expect((await updateManagementNameAction({ id: device.id, managementName: "" })).ok).toBe(true);
    expect((await reload(device.id)).managementName).toBeNull();

    const logs = await db.auditLog.findMany({ where: { action: "MANAGEMENT_NAME_UPDATE" }, orderBy: { id: "asc" } });
    expect(logs.map((l) => (l.afterData as { managementName: string | null }).managementName)).toEqual(["営業部 山田さん用", "会議室用", null]);
    expect(logs.every((l) => l.userId === manager.id)).toBe(true);
  });

  it("PC 名とは独立して管理する (PC 名を受信しても管理用端末名は変わらない)", async () => {
    const device = await createDevice(locationId);
    await updateManagementNameAction({ id: device.id, managementName: "受付用PC" });
    await loginAs("admin@example.com");
    const token = await issueToken(device.id);
    await send(device.id, { computerName: "DESKTOP-ZZZ" }, token);
    expect(await reload(device.id)).toMatchObject({ managementName: "受付用PC", computerName: "DESKTOP-ZZZ" });
  });

  it("不正な入力・存在しない端末・廃棄済み・変更なしはエラー", async () => {
    const device = await createDevice(locationId);
    const tooLong = await updateManagementNameAction({ id: device.id, managementName: "あ".repeat(101) });
    expect(tooLong.ok).toBe(false);
    if (!tooLong.ok) expect(tooLong.fieldErrors?.managementName).toBeDefined();
    expect(await updateManagementNameAction({ id: 999999, managementName: "x" })).toMatchObject({ ok: false, error: "対象の端末が見つかりません。" });
    await updateManagementNameAction({ id: device.id, managementName: "同じ名前" });
    expect(await updateManagementNameAction({ id: device.id, managementName: "同じ名前" })).toMatchObject({ ok: false, error: "管理用端末名は変更されていません。" });
    const disposed = await createDevice(locationId, { status: "DISPOSED" });
    expect(await updateManagementNameAction({ id: disposed.id, managementName: "x" })).toMatchObject({ ok: false, error: "廃棄済みの端末は編集できません。" });
  });

  it("一般社員は編集できない", async () => {
    const device = await createDevice(locationId);
    await loginAs("staff@example.com");
    expect(await updateManagementNameAction({ id: device.id, managementName: "x" })).toMatchObject({ ok: false, error: "この操作を行う権限がありません。" });
    expect((await reload(device.id)).managementName).toBeNull();
  });

  it("端末一覧で PC 名・管理用端末名の両方を検索できる", async () => {
    const a = await createDevice(locationId, { assetNumber: "PC-1" });
    const b = await createDevice(locationId, { assetNumber: "PC-2" });
    await createDevice(locationId, { assetNumber: "PC-3" });
    await db.device.update({ where: { id: a.id }, data: { computerName: "DESKTOP-SALES01" } });
    await updateManagementNameAction({ id: b.id, managementName: "sales 予備機" });
    const numbers = async (pcName: string) => (await searchDevices({ pcName })).rows.map((r) => r.assetNumber).sort();
    expect(await numbers("sales")).toEqual(["PC-1", "PC-2"]);
    expect(await numbers("desktop")).toEqual(["PC-1"]);
    expect(await numbers("予備")).toEqual(["PC-2"]);
  });
});
