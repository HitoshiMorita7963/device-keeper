import { z } from "zod";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth/password-policy";
import { optionalId, requiredId, requiredText } from "./common";

/** パスワードは長さを重視し (12 文字以上)、文字種の組み合わせは強制しない */
export const passwordText = z
  .string()
  .min(MIN_PASSWORD_LENGTH, `パスワードは ${MIN_PASSWORD_LENGTH} 文字以上にしてください。`)
  .max(128, "パスワードは 128 文字以内にしてください。");

const email = z.string().trim().toLowerCase().pipe(z.email("メールアドレスの形式が正しくありません。"));
const role = z.enum(["ADMIN", "ASSET_MANAGER", "EMPLOYEE"], { error: "権限を選択してください。" });

const userFields = {
  email,
  displayName: requiredText("表示名", 50),
  role,
  employeeId: optionalId,
  isActive: z.boolean(),
};

/** 一般社員は自分の貸与端末を表示するため、社員情報との紐付けを必須にする */
function requireEmployeeForStaff(v: { role: string; employeeId: number | null }, ctx: z.RefinementCtx) {
  if (v.role === "EMPLOYEE" && !v.employeeId) {
    ctx.addIssue({ code: "custom", path: ["employeeId"], message: "一般社員の場合は社員を選択してください。" });
  }
}

export const userCreateSchema = z
  .object({ ...userFields, password: passwordText })
  .superRefine((v, ctx) => {
    requireEmployeeForStaff(v, ctx);
    if (v.password.toLowerCase() === v.email) ctx.addIssue({ code: "custom", path: ["password"], message: "メールアドレスと同じパスワードは使用できません。" });
  });

export const userUpdateSchema = z.object({ ...userFields, id: requiredId("利用者") }).superRefine(requireEmployeeForStaff);

export const passwordResetSchema = z.object({ id: requiredId("利用者"), password: passwordText });

export const passwordChangeSchema = z
  .object({
    currentPassword: z.string().min(1, "現在のパスワードを入力してください。"),
    newPassword: passwordText,
    confirmPassword: z.string(),
  })
  .superRefine((v, ctx) => {
    if (v.newPassword !== v.confirmPassword) ctx.addIssue({ code: "custom", path: ["confirmPassword"], message: "確認用のパスワードが一致しません。" });
    if (v.newPassword === v.currentPassword) ctx.addIssue({ code: "custom", path: ["newPassword"], message: "現在と異なるパスワードを設定してください。" });
  });

export type UserCreateInput = z.input<typeof userCreateSchema>;
export type UserUpdateInput = z.input<typeof userUpdateSchema>;
export type PasswordResetInput = z.input<typeof passwordResetSchema>;
export type PasswordChangeInput = z.input<typeof passwordChangeSchema>;
