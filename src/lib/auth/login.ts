import { db } from "@/lib/db";
import { recordAudit } from "@/lib/audit";
import { dummyVerify, verifyPassword } from "./password";
import { generateSessionToken, hashSessionToken } from "./token";

export const MAX_FAILED_LOGINS = 5;
export const LOCK_MINUTES = 15;

export function sessionTtlMs(): number {
  const hours = Number(process.env.SESSION_TTL_HOURS ?? 12);
  return (Number.isFinite(hours) && hours > 0 ? hours : 12) * 60 * 60 * 1000;
}

export type ClientMeta = { ipAddress: string | null; userAgent: string | null };

export type LoginResult =
  | { ok: true; token: string; expiresAt: Date; userId: number }
  | { ok: false; error: string };

const INVALID = "メールアドレスまたはパスワードが正しくありません。";

/**
 * メールアドレスとパスワードを検証し、成功した場合はセッションを発行する。
 * 連続して失敗した場合は一定時間アカウントをロックする。
 */
export async function authenticate(email: string, password: string, meta: ClientMeta): Promise<LoginResult> {
  const normalized = email.trim().toLowerCase();
  const user = await db.user.findUnique({ where: { email: normalized } });

  if (!user || !user.passwordHash || !user.isActive) {
    await dummyVerify(password);
    await recordAudit(db, {
      userId: user?.id ?? null,
      action: "LOGIN_FAILED",
      entityType: "User",
      entityId: user?.id,
      after: { email: normalized, reason: user ? "inactive" : "unknown_user" },
      ipAddress: meta.ipAddress,
    });
    return { ok: false, error: INVALID };
  }

  const now = new Date();
  if (user.lockedUntil && user.lockedUntil > now) {
    return {
      ok: false,
      error: `ログイン失敗が続いたため、アカウントを一時的にロックしています。${LOCK_MINUTES}分ほど待ってから再度お試しください。`,
    };
  }

  if (!(await verifyPassword(password, user.passwordHash))) {
    const failed = user.failedLoginCount + 1;
    const lock = failed >= MAX_FAILED_LOGINS;
    await db.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: {
          failedLoginCount: lock ? 0 : failed,
          lockedUntil: lock ? new Date(now.getTime() + LOCK_MINUTES * 60_000) : user.lockedUntil,
        },
      });
      await recordAudit(tx, {
        userId: user.id,
        action: lock ? "ACCOUNT_LOCKED" : "LOGIN_FAILED",
        entityType: "User",
        entityId: user.id,
        after: { failedLoginCount: failed },
        ipAddress: meta.ipAddress,
      });
    });
    return { ok: false, error: INVALID };
  }

  const token = generateSessionToken();
  const expiresAt = new Date(now.getTime() + sessionTtlMs());
  await db.$transaction(async (tx) => {
    await tx.session.deleteMany({ where: { userId: user.id, expiresAt: { lt: now } } });
    await tx.session.create({
      data: {
        id: hashSessionToken(token),
        userId: user.id,
        expiresAt,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent?.slice(0, 500) ?? null,
      },
    });
    await tx.user.update({
      where: { id: user.id },
      data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: now },
    });
    await recordAudit(tx, {
      userId: user.id,
      action: "LOGIN",
      entityType: "User",
      entityId: user.id,
      ipAddress: meta.ipAddress,
    });
  });

  return { ok: true, token, expiresAt, userId: user.id };
}

/** セッショントークンから有効な利用者を取得する。期限切れ・無効化済みなら null */
export async function findUserBySessionToken(token: string) {
  const session = await db.session.findUnique({
    where: { id: hashSessionToken(token) },
    include: {
      user: {
        select: { id: true, email: true, displayName: true, role: true, employeeId: true, isActive: true },
      },
    },
  });
  if (!session || session.expiresAt <= new Date() || !session.user.isActive) return null;
  const { id, email, displayName, role, employeeId } = session.user;
  return { id, email, displayName, role, employeeId };
}

export async function revokeSessionToken(token: string): Promise<void> {
  await db.session.deleteMany({ where: { id: hashSessionToken(token) } });
}
