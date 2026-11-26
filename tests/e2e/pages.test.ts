import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { can, type Permission } from "@/lib/auth/permissions";
import { generateSessionToken, hashSessionToken } from "@/lib/auth/token";
import { todayJst } from "@/lib/dates";
import type { Role } from "@/generated/prisma/enums";
import { createDevice, createEmployee, createLocation, createUser, resetDb } from "../helpers/db";
import { E2E_PORT } from "./server";

const BASE = `http://localhost:${E2E_PORT}`;
const ROLES: Role[] = ["ADMIN", "ASSET_MANAGER", "EMPLOYEE"];

const tokens = {} as Record<Role, string>;
const ids = { device: 0, employee: 0, location: 0, maintenance: 0, user: 0 };
const assets = { own: "", others: "" };

function get(path: string, role?: Role) {
  return fetch(`${BASE}${path}`, {
    redirect: "manual",
    headers: role ? { cookie: `dk_session=${tokens[role]}` } : {},
  });
}

/** 画面と、表示に必要な権限 (null はログインのみ) */
function routes(): { path: string; permission: Permission | null }[] {
  return [
    { path: "/my", permission: "self:read" },
    { path: "/account/password", permission: null },
    { path: "/devices", permission: "device:read" },
    { path: "/devices?status=IN_USE&warranty=soon&overdue=1", permission: "device:read" },
    { path: "/devices/new", permission: "device:write" },
    { path: `/devices/${ids.device}`, permission: "device:read" },
    { path: `/devices/${ids.device}/edit`, permission: "device:write" },
    { path: "/employees", permission: "employee:read" },
    { path: "/employees/new", permission: "employee:write" },
    { path: `/employees/${ids.employee}`, permission: "employee:read" },
    { path: `/employees/${ids.employee}/edit`, permission: "employee:write" },
    { path: "/locations", permission: "location:read" },
    { path: "/locations/new", permission: "location:write" },
    { path: `/locations/${ids.location}`, permission: "location:read" },
    { path: `/locations/${ids.location}/edit`, permission: "location:write" },
    { path: "/assignments", permission: "assignment:write" },
    { path: "/assignments?state=overdue", permission: "assignment:write" },
    { path: "/assignments/new", permission: "assignment:write" },
    { path: "/assignments/return", permission: "assignment:write" },
    { path: "/assignments/history", permission: "assignment:write" },
    { path: "/moves", permission: "move:write" },
    { path: "/moves/new", permission: "move:write" },
    { path: "/maintenance", permission: "maintenance:write" },
    { path: "/maintenance/new", permission: "maintenance:write" },
    { path: `/maintenance/${ids.maintenance}`, permission: "maintenance:write" },
    { path: "/disposals", permission: "disposal:write" },
    { path: "/disposals/new", permission: "disposal:write" },
    { path: "/csv", permission: "csv:export" },
    { path: "/csv/import", permission: "csv:import" },
    { path: "/audit-logs", permission: "audit:read" },
    { path: "/settings", permission: "settings:manage" },
    { path: "/settings/users", permission: "user:manage" },
    { path: "/settings/users/new", permission: "user:manage" },
    { path: `/settings/users/${ids.user}`, permission: "user:manage" },
    { path: "/settings/departments", permission: "master:write" },
    { path: "/settings/categories", permission: "master:write" },
    { path: "/settings/integrity", permission: "settings:manage" },
  ];
}

beforeAll(async () => {
  await resetDb();
  const hq = await createLocation("HQ");
  const osaka = await createLocation("OSK");
  ids.location = hq.id;

  // 一般社員 (社員A) と別の社員 (社員B) にそれぞれ 1 台ずつ貸出中
  const empA = await createEmployee("A001");
  const empB = await createEmployee("B001");
  ids.employee = empA.id;
  const users = {
    ADMIN: await createUser("ADMIN", { email: "admin@example.com" }),
    ASSET_MANAGER: await createUser("ASSET_MANAGER", { email: "manager@example.com" }),
    EMPLOYEE: await createUser("EMPLOYEE", { email: "staff@example.com", employeeId: empA.id }),
  };
  ids.user = users.ASSET_MANAGER.id;

  const own = await createDevice(hq.id, { assetNumber: "PC-OWN-1", status: "IN_USE" });
  const others = await createDevice(osaka.id, { assetNumber: "PC-OTHER-9", status: "IN_USE" });
  assets.own = own.assetNumber;
  assets.others = others.assetNumber;
  ids.device = own.id;
  for (const [device, emp] of [[own, empA], [others, empB]] as const) {
    await db.deviceAssignment.create({ data: { deviceId: device.id, employeeId: emp.id, assignedAt: todayJst(), assignedById: users.ADMIN.id } });
    await db.device.update({ where: { id: device.id }, data: { currentEmployeeId: emp.id } });
  }
  const repairing = await createDevice(hq.id, { assetNumber: "PC-REPAIR", status: "REPAIR" });
  ids.maintenance = (await db.maintenanceRecord.create({ data: { deviceId: repairing.id, reportedAt: todayJst(), problemDescription: "故障", previousDeviceStatus: "IN_STOCK" } })).id;
  await createDevice(hq.id, { assetNumber: "PC-STOCK" });

  for (const role of ROLES) {
    const token = generateSessionToken();
    await db.session.create({ data: { id: hashSessionToken(token), userId: users[role].id, expiresAt: new Date(Date.now() + 3_600_000) } });
    tokens[role] = token;
  }
});

describe("画面表示と権限 (本番ビルド)", () => {
  it("未ログインでは、すべての画面がログイン画面へ転送される", async () => {
    for (const { path } of [{ path: "/" }, ...routes()]) {
      const res = await get(path);
      expect(res.status, path).toBe(307);
      expect(res.headers.get("location"), path).toMatch(/\/login/);
    }
  });

  for (const role of ROLES) {
    it(`${role}: 権限のある画面は正常に表示され、権限のない画面は 403 画面へ転送される`, async () => {
      const failures: string[] = [];
      for (const { path, permission } of routes()) {
        const res = await get(path, role);
        const allowed = permission === null || can(role, permission);
        if (allowed) {
          const body = await res.text();
          if (res.status !== 200) failures.push(`${path}: 表示できるはずが ${res.status}`);
          else if (/Application error|Internal Server Error/.test(body)) failures.push(`${path}: エラー表示を含む`);
        } else if (res.status !== 307 || !res.headers.get("location")?.includes("/forbidden")) {
          failures.push(`${path}: 拒否されるはずが ${res.status} ${res.headers.get("location") ?? ""}`);
        }
      }
      expect(failures).toEqual([]);
    });
  }

  it("ダッシュボードは管理者・担当者に表示し、一般社員はマイ端末へ転送する", async () => {
    expect((await get("/", "ADMIN")).status).toBe(200);
    expect((await get("/", "ASSET_MANAGER")).status).toBe(200);
    const res = await get("/", "EMPLOYEE");
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/my");
  });

  it("権限設計の要点 (担当者は社員・拠点の編集・廃棄・システム設定不可、一般社員は台帳閲覧不可)", () => {
    const denied = (role: Role, path: string) => routes().some((r) => r.path === path && r.permission !== null && !can(role, r.permission));
    expect(denied("ASSET_MANAGER", "/employees/new")).toBe(true);
    expect(denied("ASSET_MANAGER", "/disposals")).toBe(true);
    expect(denied("ASSET_MANAGER", "/settings")).toBe(true);
    expect(denied("EMPLOYEE", "/devices")).toBe(true);
    expect(denied("EMPLOYEE", "/employees")).toBe(true);
  });

  it("一般社員のマイ端末には自分の端末だけが表示される", async () => {
    const body = await (await get("/my", "EMPLOYEE")).text();
    expect(body).toContain(assets.own);
    expect(body).not.toContain(assets.others);
  });

  it("存在しない端末は 404", async () => {
    expect((await get("/devices/999999", "ADMIN")).status).toBe(404);
    expect((await get("/devices/abc", "ADMIN")).status).toBe(404);
  });

  it("CSV 出力は権限のある利用者のみ", async () => {
    expect((await get("/api/csv/export/devices", "ASSET_MANAGER")).status).toBe(200);
    expect((await get("/api/csv/export/devices", "EMPLOYEE")).status).toBe(403);
    expect((await get("/api/csv/export/devices")).status).toBe(307);
  });

  it("セキュリティヘッダーを付与する", async () => {
    const res = await get("/login");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("strict-transport-security")).toContain("max-age");
    expect(res.headers.get("x-powered-by")).toBeNull();
  });
});

describe("PC名・管理用端末名 (本番ビルド)", () => {
  it("PC名送信 API はログイン画面へ転送せず、端末連携キーなしでは 401 を返す", async () => {
    const res = await fetch(`${BASE}/api/devices/${ids.device}/computer-name`, {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ computerName: "DESKTOP-E2E" }),
    });
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toContain("Bearer");
    // ログイン Cookie があっても、端末連携キーがなければ更新できない
    const withCookie = await fetch(`${BASE}/api/devices/${ids.device}/computer-name`, {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/json", cookie: `dk_session=${tokens.ADMIN}` },
      body: JSON.stringify({ computerName: "DESKTOP-E2E" }),
    });
    expect(withCookie.status).toBe(401);
  });

  it("端末一覧・詳細で、未取得の PC 名と未設定の管理用端末名を区別して表示する", async () => {
    const list = await (await get("/devices", "ASSET_MANAGER")).text();
    for (const text of ["PC名", "管理用端末名", "未取得", "未設定"]) expect(list).toContain(text);
    const detail = await (await get(`/devices/${ids.device}`, "ASSET_MANAGER")).text();
    for (const text of ["自動取得", "手動設定", "管理用端末名を編集"]) expect(detail).toContain(text);
    // 端末連携キーの発行は管理者のみ表示
    expect(detail).not.toContain("端末連携キーを発行");
    expect(await (await get(`/devices/${ids.device}`, "ADMIN")).text()).toContain("端末連携キーを発行");
  });
});
