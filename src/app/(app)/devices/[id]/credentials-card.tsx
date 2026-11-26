"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { Copy, Eye, EyeOff, KeyRound } from "lucide-react";
import { toast } from "sonner";
import { CheckboxField, TextField } from "@/components/form/fields";
import { FormDialog } from "@/components/form/form-dialog";
import { FormRow } from "@/components/form/page-form";
import { formResolver } from "@/components/form/resolver";
import { applyActionResult } from "@/components/form/submit-result";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { deviceCredentialsSchema, type DeviceCredentialsInput } from "@/lib/validation/devices";
import { revealDeviceSecretAction, updateDeviceCredentialsAction } from "../actions";

type Field = "initialPassword" | "loginPassword";

/** 表示したパスワードは一定時間で自動的に隠す */
const HIDE_AFTER_MS = 30_000;

function PasswordValue({ deviceId, field, registered, canReveal }: { deviceId: number; field: Field; registered: boolean; canReveal: boolean }) {
  const [value, setValue] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (value === null) return;
    const timer = setTimeout(() => setValue(null), HIDE_AFTER_MS);
    return () => clearTimeout(timer);
  }, [value]);

  if (!registered) return <span className="text-muted-foreground">未登録</span>;
  return (
    <span className="flex flex-wrap items-center gap-2">
      <span className="font-mono">{value ?? "●●●●●●●●"}</span>
      {canReveal ? (
        value === null ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={pending}
            onClick={async () => {
              setPending(true);
              const result = await revealDeviceSecretAction({ id: deviceId, field });
              setPending(false);
              if (result.ok) setValue(result.data.value);
              else toast.error(result.error);
            }}
          >
            <Eye aria-hidden />
            表示
          </Button>
        ) : (
          <>
            <Button type="button" variant="ghost" size="sm" onClick={() => setValue(null)}>
              <EyeOff aria-hidden />
              隠す
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={async () => {
                await navigator.clipboard.writeText(value);
                toast.success("コピーしました。");
              }}
            >
              <Copy aria-hidden />
              コピー
            </Button>
          </>
        )
      ) : null}
    </span>
  );
}

function CredentialsDialog({ deviceId, initialUser, loginUser }: { deviceId: number; initialUser: string | null; loginUser: string | null }) {
  const router = useRouter();
  const defaultValues: DeviceCredentialsInput = {
    id: deviceId,
    initialUser: initialUser ?? "",
    loginUser: loginUser ?? "",
    initialPassword: "",
    loginPassword: "",
    clearInitialPassword: false,
    clearLoginPassword: false,
  };
  const form = useForm<DeviceCredentialsInput>({ resolver: formResolver(deviceCredentialsSchema), defaultValues });
  return (
    <FormDialog
      trigger={
        <Button variant="outline" size="sm">
          <KeyRound aria-hidden />
          変更
        </Button>
      }
      title="ログイン情報の変更"
      description="パスワード欄は空欄のままにすると変更しません。パスワードは暗号化して保存され、変更内容は操作履歴に記録されます (パスワード自体は記録しません)。"
      form={form}
      defaultValues={defaultValues}
      onSubmit={async (values) => {
        const ok = applyActionResult(await updateDeviceCredentialsAction(values), form.setError);
        if (ok) router.refresh();
        return ok;
      }}
    >
      <FormRow>
        <TextField<DeviceCredentialsInput> name="initialUser" label="初期ユーザ" maxLength={100} autoComplete="off" />
        <TextField<DeviceCredentialsInput> name="initialPassword" label="初期ユーザのパスワード" type="password" maxLength={200} autoComplete="new-password" />
      </FormRow>
      <CheckboxField<DeviceCredentialsInput> name="clearInitialPassword" label="初期ユーザのパスワードを削除する" />
      <FormRow>
        <TextField<DeviceCredentialsInput> name="loginUser" label="ユーザー名" maxLength={100} autoComplete="off" />
        <TextField<DeviceCredentialsInput> name="loginPassword" label="ユーザーのパスワード" type="password" maxLength={200} autoComplete="new-password" />
      </FormRow>
      <CheckboxField<DeviceCredentialsInput> name="clearLoginPassword" label="ユーザーのパスワードを削除する" />
    </FormDialog>
  );
}

/** 端末のログイン情報。ユーザー名は閲覧可能な利用者全員、パスワードの表示・変更は管理者のみ */
export function CredentialsCard({
  deviceId,
  initialUser,
  loginUser,
  registered,
  canManage,
  editable,
}: {
  deviceId: number;
  initialUser: string | null;
  loginUser: string | null;
  registered: Record<Field, boolean>;
  canManage: boolean;
  editable: boolean;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">ログイン情報</CardTitle>
        {canManage && editable ? <CredentialsDialog deviceId={deviceId} initialUser={initialUser} loginUser={loginUser} /> : null}
      </CardHeader>
      <CardContent>
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
          <div>
            <dt className="text-xs text-muted-foreground">初期ユーザ</dt>
            <dd className="mt-0.5 font-mono text-sm">{initialUser ?? "-"}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">初期ユーザのパスワード</dt>
            <dd className="mt-0.5 text-sm">
              <PasswordValue deviceId={deviceId} field="initialPassword" registered={registered.initialPassword} canReveal={canManage} />
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">ユーザー名</dt>
            <dd className="mt-0.5 font-mono text-sm">{loginUser ?? "-"}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">ユーザーのパスワード</dt>
            <dd className="mt-0.5 text-sm">
              <PasswordValue deviceId={deviceId} field="loginPassword" registered={registered.loginPassword} canReveal={canManage} />
            </dd>
          </div>
        </dl>
        {canManage ? (
          <p className="mt-3 text-xs text-muted-foreground">パスワードを表示すると操作履歴に記録され、{HIDE_AFTER_MS / 1000} 秒後に自動で隠れます。</p>
        ) : null}
      </CardContent>
    </Card>
  );
}
