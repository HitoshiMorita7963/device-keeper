"use server";

import { revalidatePath } from "next/cache";
import { runAction } from "@/lib/action";
import {
  passwordResetSchema,
  userCreateSchema,
  userUpdateSchema,
  type PasswordResetInput,
  type UserCreateInput,
  type UserUpdateInput,
} from "@/lib/validation/users";
import { createUser, resetPassword, updateUser } from "@/server/users";

export async function createUserAction(input: UserCreateInput) {
  return runAction("user:manage", userCreateSchema, input, async (data, ctx) => {
    const created = await createUser(data, ctx);
    revalidatePath("/settings/users");
    return { ok: true, data: { id: created.id }, message: `利用者 ${created.email} を登録しました。初期パスワードを本人に安全な方法で伝えてください。` };
  });
}

export async function updateUserAction(input: UserUpdateInput) {
  return runAction("user:manage", userUpdateSchema, input, async (data, ctx) => {
    const updated = await updateUser(data, ctx);
    revalidatePath("/settings/users");
    revalidatePath(`/settings/users/${updated.id}`);
    return { ok: true, data: { id: updated.id }, message: `利用者 ${updated.email} を更新しました。` };
  });
}

export async function resetPasswordAction(input: PasswordResetInput) {
  return runAction("user:manage", passwordResetSchema, input, async (data, ctx) => {
    const user = await resetPassword(data, ctx);
    revalidatePath(`/settings/users/${user.id}`);
    return { ok: true, data: { id: user.id }, message: `${user.email} のパスワードを再設定しました (ログイン中のセッションは無効になりました)。` };
  });
}
