"use server";

import { runAction } from "@/lib/action";
import { getCurrentSessionId } from "@/lib/auth/session";
import { passwordChangeSchema, type PasswordChangeInput } from "@/lib/validation/users";
import { changeOwnPassword } from "@/server/users";

export async function changePasswordAction(input: PasswordChangeInput) {
  return runAction("self:read", passwordChangeSchema, input, async (data, ctx) => {
    await changeOwnPassword(data, { ...ctx, currentSessionId: await getCurrentSessionId() });
    return { ok: true, data: undefined, message: "パスワードを変更しました。他の端末でのログインは無効になりました。" };
  });
}
