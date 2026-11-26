import "server-only";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { AuthenticationError, BusinessRuleError, ForbiddenError } from "@/lib/auth/errors";
import { assertPermission, getClientMeta, type CurrentUser } from "@/lib/auth/session";
import type { Permission } from "@/lib/auth/permissions";
import type { ActionResult } from "@/lib/action-result";

export type { ActionResult };

export type ActionContext = { user: CurrentUser; ipAddress: string | null };

/** 一意制約違反時に表示する項目名 (DB カラム名 → 画面上の名称) */
const UNIQUE_LABELS: Record<string, string> = {
  asset_number: "資産管理番号",
  employee_number: "社員番号",
  location_code: "拠点コード",
  department_code: "部署コード",
  category_code: "種別コード",
  prefix: "採番プレフィックス",
  email: "メールアドレス",
  device_id: "端末",
};

function uniqueViolationMessage(error: Prisma.PrismaClientKnownRequestError): string {
  const meta = JSON.stringify(error.meta ?? {});
  if (meta.includes("maintenance_records_one_open_per_device")) return "この端末には対応中の修理が既に存在します。";
  if (meta.includes("one_open_per_device")) return "この端末には未返却の貸出が既に存在します。";
  const field = Object.keys(UNIQUE_LABELS).find((key) => meta.includes(key));
  return field ? `${UNIQUE_LABELS[field]}が既に登録されています。` : "同じ値が既に登録されています。";
}

/** 例外を画面表示用の結果に変換する。想定外のエラーはサーバーログに記録する */
export function toActionError(error: unknown): { ok: false; error: string; fieldErrors?: Record<string, string[]> } {
  if (error instanceof AuthenticationError || error instanceof ForbiddenError || error instanceof BusinessRuleError) {
    return { ok: false, error: error.message };
  }
  if (error instanceof z.ZodError) {
    return { ok: false, error: "入力内容に誤りがあります。", fieldErrors: flattenZod(error) };
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") return { ok: false, error: uniqueViolationMessage(error) };
    if (error.code === "P2025") return { ok: false, error: "対象のデータが見つかりません。削除された可能性があります。" };
    if (error.code === "P2003") return { ok: false, error: "関連するデータが存在するため、この操作は実行できません。" };
  }
  console.error("[action] 想定外のエラー", error);
  return { ok: false, error: "処理中にエラーが発生しました。時間をおいて再度お試しください。解決しない場合は管理者に連絡してください。" };
}

export function flattenZod(error: z.ZodError): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_";
    (result[key] ??= []).push(issue.message);
  }
  return result;
}

/**
 * 権限チェック・入力検証・エラー変換をまとめた Server Action の実装ヘルパー。
 * 権限チェックは必ずサーバー側で行う (画面のボタン非表示だけに頼らない)。
 */
export async function runAction<S extends z.ZodType, T>(
  permission: Permission,
  schema: S,
  input: unknown,
  handler: (data: z.output<S>, ctx: ActionContext) => Promise<ActionResult<T>>,
): Promise<ActionResult<T>> {
  try {
    const user = await assertPermission(permission);
    const parsed = schema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: "入力内容に誤りがあります。", fieldErrors: flattenZod(parsed.error) };
    }
    const { ipAddress } = await getClientMeta();
    return await handler(parsed.data, { user, ipAddress });
  } catch (error) {
    return toActionError(error);
  }
}
