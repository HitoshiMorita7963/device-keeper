import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { authenticate, findUserBySessionToken, MAX_FAILED_LOGINS, revokeSessionToken } from "@/lib/auth/login";
import { hashSessionToken } from "@/lib/auth/token";
import { createUser, resetDb, TEST_PASSWORD } from "../helpers/db";

const meta = { ipAddress: "192.0.2.1", userAgent: "vitest" };

describe("ログイン認証", () => {
  beforeEach(resetDb);

  it("正しいパスワードでセッションが発行され、トークンから利用者を取得できる", async () => {
    const user = await createUser("ASSET_MANAGER", { email: "manager@example.com" });
    const result = await authenticate(" Manager@Example.com ", TEST_PASSWORD, meta);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // DB にはトークンそのものではなくハッシュのみ保存される
    const session = await db.session.findFirstOrThrow({ where: { userId: user.id } });
    expect(session.id).toBe(hashSessionToken(result.token));
    expect(session.id).not.toBe(result.token);

    const current = await findUserBySessionToken(result.token);
    expect(current).toMatchObject({ id: user.id, role: "ASSET_MANAGER" });

    const log = await db.auditLog.findFirst({ where: { action: "LOGIN", userId: user.id } });
    expect(log?.ipAddress).toBe("192.0.2.1");
  });

  it("誤ったパスワード・存在しないユーザーは同じメッセージで拒否する", async () => {
    await createUser("ADMIN", { email: "admin@example.com" });
    const wrong = await authenticate("admin@example.com", "wrong-password", meta);
    const unknown = await authenticate("nobody@example.com", TEST_PASSWORD, meta);
    expect(wrong).toEqual(unknown);
    expect(wrong.ok).toBe(false);
    expect(await db.auditLog.count({ where: { action: "LOGIN_FAILED" } })).toBe(2);
  });

  it(`${MAX_FAILED_LOGINS}回連続で失敗するとロックされ、正しいパスワードでもログインできない`, async () => {
    await createUser("ADMIN", { email: "admin@example.com" });
    for (let i = 0; i < MAX_FAILED_LOGINS; i++) {
      await authenticate("admin@example.com", "wrong-password", meta);
    }
    const result = await authenticate("admin@example.com", TEST_PASSWORD, meta);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("ロック");
    expect(await db.auditLog.count({ where: { action: "ACCOUNT_LOCKED" } })).toBe(1);
  });

  it("無効化された利用者はログインできず、既存セッションも使えない", async () => {
    const user = await createUser("ADMIN", { email: "admin@example.com" });
    const result = await authenticate("admin@example.com", TEST_PASSWORD, meta);
    if (!result.ok) throw new Error("login failed");

    await db.user.update({ where: { id: user.id }, data: { isActive: false } });
    expect(await findUserBySessionToken(result.token)).toBeNull();
    expect((await authenticate("admin@example.com", TEST_PASSWORD, meta)).ok).toBe(false);
  });

  it("期限切れ・ログアウト済みのセッションは無効", async () => {
    await createUser("ADMIN", { email: "admin@example.com" });
    const a = await authenticate("admin@example.com", TEST_PASSWORD, meta);
    const b = await authenticate("admin@example.com", TEST_PASSWORD, meta);
    if (!a.ok || !b.ok) throw new Error("login failed");

    await db.session.update({ where: { id: hashSessionToken(a.token) }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await findUserBySessionToken(a.token)).toBeNull();

    await revokeSessionToken(b.token);
    expect(await findUserBySessionToken(b.token)).toBeNull();
    expect(await findUserBySessionToken("forged-token")).toBeNull();
  });

  it("監査ログにパスワードハッシュを残さない", async () => {
    const { recordAudit } = await import("@/lib/audit");
    const user = await createUser("ADMIN");
    await recordAudit(db, { userId: user.id, action: "UPDATE", entityType: "User", entityId: user.id, after: user });
    const log = await db.auditLog.findFirstOrThrow({ where: { action: "UPDATE" } });
    expect(JSON.stringify(log.afterData)).not.toContain("passwordHash");
    expect(log.afterData).toMatchObject({ email: user.email });
  });
});
