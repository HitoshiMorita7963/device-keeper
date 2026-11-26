"use client";

import type { FieldValues, Path, UseFormSetError } from "react-hook-form";
import { toast } from "sonner";
import type { ActionResult } from "@/lib/action-result";

/**
 * Server Action の結果を画面に反映する。
 * 項目ごとのエラーは各入力欄に、それ以外はトーストで表示する。成功時は true を返す。
 */
export function applyActionResult<T extends FieldValues, R>(
  result: ActionResult<R>,
  setError?: UseFormSetError<T>,
): result is { ok: true; data: R; message?: string } {
  if (result.ok) {
    if (result.message) toast.success(result.message);
    return true;
  }
  if (result.fieldErrors && setError) {
    for (const [key, messages] of Object.entries(result.fieldErrors)) {
      setError(key as Path<T>, { type: "server", message: messages[0] });
    }
  }
  toast.error(result.error);
  return false;
}
