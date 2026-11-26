"use client";

import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { KeyRound } from "lucide-react";
import { CheckboxField, SelectField, TextField, type Option } from "@/components/form/fields";
import { FormDialog } from "@/components/form/form-dialog";
import { FormRow, PageForm } from "@/components/form/page-form";
import { formResolver } from "@/components/form/resolver";
import { applyActionResult } from "@/components/form/submit-result";
import { Button } from "@/components/ui/button";
import { ROLE_LABELS } from "@/lib/auth/permissions";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth/password-policy";
import {
  passwordResetSchema,
  userCreateSchema,
  userUpdateSchema,
  type PasswordResetInput,
  type UserCreateInput,
  type UserUpdateInput,
} from "@/lib/validation/users";
import { createUserAction, resetPasswordAction, updateUserAction } from "./actions";

const ROLE_OPTIONS = (["ADMIN", "ASSET_MANAGER", "EMPLOYEE"] as const).map((r) => ({ value: r, label: ROLE_LABELS[r] }));
const PASSWORD_HINT = `${MIN_PASSWORD_LENGTH} 文字以上。推測されにくい長めの文字列にしてください。`;

/** 登録・編集で共通の項目 (項目名は登録・編集のスキーマで共通) */
function CommonFields({ employees, self }: { employees: Option[]; self?: boolean }) {
  return (
    <>
      <FormRow>
        <TextField<UserUpdateInput> name="email" label="メールアドレス (ログインID)" required type="email" maxLength={254} autoComplete="off" />
        <TextField<UserUpdateInput> name="displayName" label="表示名" required maxLength={50} />
      </FormRow>
      <FormRow>
        <SelectField<UserUpdateInput>
          name="role"
          label="権限"
          required
          placeholder={false}
          options={self ? ROLE_OPTIONS.filter((o) => o.value === "ADMIN") : ROLE_OPTIONS}
          description={self ? "自分自身の権限は変更できません。" : "一般社員は自分の貸与端末のみ閲覧できます。"}
        />
        <SelectField<UserUpdateInput> name="employeeId" label="社員" options={employees} placeholder="紐付けない" description="一般社員の場合は必須です。" />
      </FormRow>
      {self ? null : <CheckboxField<UserUpdateInput> name="isActive" label="有効" description="無効にするとログインできなくなります。" />}
    </>
  );
}

export function UserCreateForm({ employees }: { employees: Option[] }) {
  const router = useRouter();
  const form = useForm<UserCreateInput>({
    resolver: formResolver(userCreateSchema),
    defaultValues: { email: "", displayName: "", role: "EMPLOYEE", employeeId: "", isActive: true, password: "" },
  });
  return (
    <PageForm
      form={form}
      cancelHref="/settings/users"
      submitLabel="登録する"
      onSubmit={async (values) => {
        const result = await createUserAction(values);
        if (applyActionResult(result, form.setError)) router.push(`/settings/users/${result.data.id}`);
      }}
    >
      <CommonFields employees={employees} />
      <TextField<UserCreateInput> name="password" label="初期パスワード" required type="password" autoComplete="new-password" description={PASSWORD_HINT} />
    </PageForm>
  );
}

export function UserEditForm({ defaultValues, employees, self }: { defaultValues: UserUpdateInput; employees: Option[]; self: boolean }) {
  const router = useRouter();
  const form = useForm<UserUpdateInput>({ resolver: formResolver(userUpdateSchema), defaultValues });
  return (
    <PageForm
      form={form}
      cancelHref="/settings/users"
      submitLabel="更新する"
      onSubmit={async (values) => {
        if (applyActionResult(await updateUserAction(values), form.setError)) router.refresh();
      }}
    >
      <CommonFields employees={employees} self={self} />
    </PageForm>
  );
}

export function PasswordResetDialog({ userId, email }: { userId: number; email: string }) {
  const defaultValues: PasswordResetInput = { id: userId, password: "" };
  const form = useForm<PasswordResetInput>({ resolver: formResolver(passwordResetSchema), defaultValues });
  return (
    <FormDialog
      trigger={
        <Button variant="outline">
          <KeyRound aria-hidden />
          パスワード再設定
        </Button>
      }
      title="パスワードの再設定"
      description={`${email} のパスワードを再設定します。ログイン中のセッションは無効になり、ログイン試行のロックも解除されます。`}
      form={form}
      defaultValues={defaultValues}
      submitLabel="再設定する"
      onSubmit={async (values) => applyActionResult(await resetPasswordAction(values), form.setError)}
    >
      <TextField<PasswordResetInput> name="password" label="新しいパスワード" required type="password" autoComplete="new-password" description={PASSWORD_HINT} />
    </FormDialog>
  );
}
