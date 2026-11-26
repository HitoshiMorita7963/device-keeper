"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { authenticate } from "@/lib/auth/login";
import { destroySession, getClientMeta, setSessionCookie } from "@/lib/auth/session";

export type LoginState = { error?: string; email?: string };

const schema = z.object({
  email: z.email("メールアドレスの形式が正しくありません。"),
  password: z.string().min(1, "パスワードを入力してください。"),
});

/** ログイン後の遷移先。外部サイトへのリダイレクトを防ぐため、サイト内の相対パスのみ許可する */
function safeNext(value: FormDataEntryValue | null): string {
  const next = typeof value === "string" ? value : "";
  return next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/";
}

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "");
  const parsed = schema.safeParse({ email, password: formData.get("password") });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "入力内容に誤りがあります。", email };
  }

  let result;
  try {
    result = await authenticate(parsed.data.email, parsed.data.password, await getClientMeta());
  } catch (error) {
    console.error("[login] 認証処理でエラーが発生しました", error);
    return { error: "ログイン処理中にエラーが発生しました。時間をおいて再度お試しください。", email };
  }
  if (!result.ok) return { error: result.error, email };

  await setSessionCookie(result.token, result.expiresAt);
  redirect(safeNext(formData.get("next")));
}

export async function logoutAction(): Promise<void> {
  await destroySession();
  redirect("/login");
}
