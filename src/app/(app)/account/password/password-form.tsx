"use client";

import { useForm } from "react-hook-form";
import { TextField } from "@/components/form/fields";
import { PageForm } from "@/components/form/page-form";
import { formResolver } from "@/components/form/resolver";
import { applyActionResult } from "@/components/form/submit-result";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth/password-policy";
import { passwordChangeSchema, type PasswordChangeInput } from "@/lib/validation/users";
import { changePasswordAction } from "./actions";

const EMPTY: PasswordChangeInput = { currentPassword: "", newPassword: "", confirmPassword: "" };

export function PasswordChangeForm() {
  const form = useForm<PasswordChangeInput>({ resolver: formResolver(passwordChangeSchema), defaultValues: EMPTY });
  return (
    <PageForm
      form={form}
      cancelHref="/"
      submitLabel="変更する"
      onSubmit={async (values) => {
        if (applyActionResult(await changePasswordAction(values), form.setError)) form.reset(EMPTY);
      }}
    >
      <TextField<PasswordChangeInput> name="currentPassword" label="現在のパスワード" required type="password" autoComplete="current-password" />
      <TextField<PasswordChangeInput>
        name="newPassword"
        label="新しいパスワード"
        required
        type="password"
        autoComplete="new-password"
        description={`${MIN_PASSWORD_LENGTH} 文字以上。推測されにくい長めの文字列にしてください。`}
      />
      <TextField<PasswordChangeInput> name="confirmPassword" label="新しいパスワード (確認)" required type="password" autoComplete="new-password" />
    </PageForm>
  );
}
