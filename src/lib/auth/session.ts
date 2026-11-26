import "server-only";
import { cookies, headers } from "next/headers";
import { cache } from "react";
import { redirect } from "next/navigation";
import type { Role } from "@/generated/prisma/enums";
import { can, type Permission } from "./permissions";
import { AuthenticationError, ForbiddenError } from "./errors";
import { findUserBySessionToken, revokeSessionToken, type ClientMeta } from "./login";
import { hashSessionToken } from "./token";

export const SESSION_COOKIE = "dk_session";

export type CurrentUser = {
  id: number;
  email: string;
  displayName: string;
  role: Role;
  employeeId: number | null;
};

function secureCookie(): boolean {
  const flag = process.env.SESSION_COOKIE_SECURE;
  if (flag === "true") return true;
  if (flag === "false") return false;
  return process.env.NODE_ENV === "production";
}

export async function setSessionCookie(token: string, expiresAt: Date): Promise<void> {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: secureCookie(),
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) await revokeSessionToken(token);
  store.delete(SESSION_COOKIE);
}

/** 現在ログインしている利用者 (1 リクエスト内ではキャッシュされる) */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return findUserBySessionToken(token);
});

export async function getClientMeta(): Promise<ClientMeta> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  return {
    ipAddress: forwarded || h.get("x-real-ip") || null,
    userAgent: h.get("user-agent"),
  };
}

// ---- 画面 (Server Component) 用: 未ログインはログイン画面、権限不足は 403 画面へ ----

export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

export async function requirePermission(permission: Permission): Promise<CurrentUser> {
  const user = await requireUser();
  if (!can(user.role, permission)) redirect("/forbidden");
  return user;
}

// ---- Server Action / Route Handler 用: 例外を投げ、呼び出し側でエラー表示する ----

export async function assertPermission(permission: Permission): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) throw new AuthenticationError();
  if (!can(user.role, permission)) throw new ForbiddenError();
  return user;
}

/** 現在のセッションの ID (トークンのハッシュ)。パスワード変更時に自分以外のセッションを破棄するために使う */
export async function getCurrentSessionId(): Promise<string | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return token ? hashSessionToken(token) : null;
}
