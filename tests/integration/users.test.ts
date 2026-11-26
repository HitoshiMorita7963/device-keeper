import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => import("../helpers/request").then((m) => m.nextHeadersMock));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { db } from "@/lib/db";
import { createUserAction, resetPasswordAction, updateUserAction } from "@/app/(app)/settings/users/actions";
import { changePasswordAction } from "@/app/(app)/account/password/actions";
import { authenticate, findUserBySessionToken } from "@/lib/auth/login";
import type { UserCreateInput } from "@/lib/validation/users";
import { createEmployee, createUser, resetDb, TEST_PASSWORD } from "../helpers/db";
import { loginAs, logout } from "../helpers/request";

const meta = { ipAddress: null, userAgent: null };
const NEW_PASSWORD = "brand-new-passphrase";

const input = (overrides: Partial<UserCreateInput> = {}): UserCreateInput => ({
  email: "new@example.com",
  displayName: "新しい利用者",
  role: "ASSET_MANAGER",
  employeeId: "",
  isActive: true,
  password: "initial-password-1",
  ...overrides,
});

describe("利用者管理", () => {
  let adminId: number;

  beforeEach(async () => {
    await resetDb();
    logout();
    adminId = (await createUser("ADMIN", { email: "admin@example.com" })).id;
    await createUser("ASSET_MANAGER", { email: "manager@example.com" });
    await loginAs("admin@example.com");
  });

  it("管理者は利用者を登録でき、登録した利用者でログインできる。操作履歴にパスワードは残らない", async () => {
    const result = await createUserAction(input({ email: "New@Example.com" }));
    expect(result.ok).toBe(true);
    expect((await authenticate("new@example.com", "initial-password-1", meta)).ok).toBe(true);
    const log = await db.auditLog.findFirstOrThrow({ where: { entityType: "User", action: "CREATE", userId: adminId } });
    expect(JSON.stringify(log.afterData)).not.toMatch(/password|initial-password/i);
  });

  it("短いパスワード・メールアドレスと同じパスワード・重複メールアドレスは登録できない", async () => {
    expect((await createUserAction(input({ password: "short" }))).ok).toBe(false);
    expect((await createUserAction(input({ password: "new@example.com" }))).ok).toBe(false);
    const dup = await createUserAction(input({ email: "manager@example.com" }));
    expect(dup).toMatchObject({ ok: false, error: "メールアドレスが既に登録されています。" });
  });

  it("一般社員は社員との紐付けが必須で、1 人の社員に複数の利用者は紐付けられない", async () => {
    expect((await createUserAction(input({ role: "EMPLOYEE" }))).ok).toBe(false);
    const emp = await createEmployee("E1");
    expect((await createUserAction(input({ role: "EMPLOYEE", employeeId: String(emp.id) }))).ok).toBe(true);
    const second = await createUserAction(input({ email: "other@example.com", role: "EMPLOYEE", employeeId: String(emp.id) }));
    expect(second.ok).toBe(false);
  });

  it("自分自身の権限変更・無効化はできず、最後の管理者を降格できない", async () => {
    const self = await updateUserAction({ id: adminId, email: "admin@example.com", displayName: "管理者", role: "ASSET_MANAGER", employeeId: "", isActive: true });
    expect(self.ok).toBe(false);

    const other = await createUser("ADMIN", { email: "admin2@example.com" });
    await loginAs("admin2@example.com");
    // admin2 が admin を降格 → 管理者は admin2 のみになるので可
    expect((await updateUserAction({ id: adminId, email: "admin@example.com", displayName: "元管理者", role: "ASSET_MANAGER", employeeId: "", isActive: true })).ok).toBe(true);
    // admin (降格済み) は管理画面を使えない
    await loginAs("admin@example.com");
    expect((await updateUserAction({ id: other.id, email: "admin2@example.com", displayName: "x", role: "EMPLOYEE", employeeId: "", isActive: true })).ok).toBe(false);
  });

  it("権限変更・無効化するとログイン中のセッションが無効になる", async () => {
    const manager = await db.user.findUniqueOrThrow({ where: { email: "manager@example.com" } });
    const login = await authenticate("manager@example.com", TEST_PASSWORD, meta);
    if (!login.ok) throw new Error("login failed");
    await updateUserAction({ id: manager.id, email: manager.email, displayName: manager.displayName, role: "ASSET_MANAGER", employeeId: "", isActive: false });
    expect(await findUserBySessionToken(login.token)).toBeNull();
    expect((await authenticate("manager@example.com", TEST_PASSWORD, meta)).ok).toBe(false);
  });

  it("パスワード再設定でロックを解除し、新しいパスワードでログインできる", async () => {
    const manager = await db.user.findUniqueOrThrow({ where: { email: "manager@example.com" } });
    await db.user.update({ where: { id: manager.id }, data: { lockedUntil: new Date(Date.now() + 600_000) } });
    expect((await resetPasswordAction({ id: manager.id, password: NEW_PASSWORD })).ok).toBe(true);
    expect((await authenticate("manager@example.com", NEW_PASSWORD, meta)).ok).toBe(true);
  });

  it("IT資産管理担当者は利用者管理を操作できない", async () => {
    await loginAs("manager@example.com");
    expect(await createUserAction(input())).toMatchObject({ ok: false, error: "この操作を行う権限がありません。" });
  });

  it("本人のパスワード変更: 現在のパスワードが必要で、変更後は新しいパスワードでログインする", async () => {
    await loginAs("manager@example.com");
    const wrong = await changePasswordAction({ currentPassword: "wrong", newPassword: NEW_PASSWORD, confirmPassword: NEW_PASSWORD });
    expect(wrong).toMatchObject({ ok: false, error: "現在のパスワードが正しくありません。" });
    const mismatch = await changePasswordAction({ currentPassword: TEST_PASSWORD, newPassword: NEW_PASSWORD, confirmPassword: "different-password" });
    expect(mismatch.ok).toBe(false);

    const other = await authenticate("manager@example.com", TEST_PASSWORD, meta);
    if (!other.ok) throw new Error("login failed");
    expect((await changePasswordAction({ currentPassword: TEST_PASSWORD, newPassword: NEW_PASSWORD, confirmPassword: NEW_PASSWORD })).ok).toBe(true);
    // 別の端末のセッションは無効になる
    expect(await findUserBySessionToken(other.token)).toBeNull();
    expect((await authenticate("manager@example.com", TEST_PASSWORD, meta)).ok).toBe(false);
    expect((await authenticate("manager@example.com", NEW_PASSWORD, meta)).ok).toBe(true);
  });
});
