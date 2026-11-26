"use client";

import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { useForm } from "react-hook-form";
import { Copy, KeyRound, Pencil } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/form/confirm-dialog";
import { TextField } from "@/components/form/fields";
import { FormDialog } from "@/components/form/form-dialog";
import { formResolver } from "@/components/form/resolver";
import { applyActionResult } from "@/components/form/submit-result";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { managementNameSchema, type ManagementNameInput } from "@/lib/validation/device-names";
import { issueAgentTokenAction, revokeAgentTokenAction, updateManagementNameAction } from "./actions";

/**
 * 管理用端末名の編集。PC 名 (自動取得) は参考として表示するだけで、ここでは変更できない。
 * 保存は Server Action の成功を確認してから通知し、画面を最新の内容に更新する。
 */
export function ManagementNameDialog({
  deviceId,
  assetNumber,
  computerName,
  managementName,
  trigger,
}: {
  deviceId: number;
  assetNumber: string;
  computerName: string | null;
  managementName: string | null;
  trigger?: ReactNode;
}) {
  const router = useRouter();
  const defaultValues: ManagementNameInput = { id: deviceId, managementName: managementName ?? "" };
  const form = useForm<ManagementNameInput>({ resolver: formResolver(managementNameSchema), defaultValues });

  return (
    <FormDialog
      trigger={
        trigger ?? (
          <Button variant="outline" size="sm">
            <Pencil aria-hidden />
            管理用端末名を編集
          </Button>
        )
      }
      title="管理用端末名の編集"
      description="管理用端末名は、管理者が自由に付けられる名前です。Windows の PC 名とは別に管理されます。"
      form={form}
      defaultValues={defaultValues}
      onSubmit={async (values) => {
        const ok = applyActionResult(await updateManagementNameAction(values), form.setError);
        if (ok) router.refresh();
        return ok;
      }}
    >
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 rounded-lg border bg-muted/40 p-3 text-sm">
        <dt className="text-muted-foreground">端末番号</dt>
        <dd className="font-mono">{assetNumber}</dd>
        <dt className="text-muted-foreground">PC名</dt>
        <dd>
          {computerName ? <span className="font-mono">{computerName}</span> : <span className="text-muted-foreground">未取得</span>}
          <span className="block text-xs text-muted-foreground">Windows から自動取得した名前です。ここでは変更できません。</span>
        </dd>
      </dl>
      <TextField<ManagementNameInput>
        name="managementName"
        label="管理用端末名"
        maxLength={100}
        placeholder="例: 営業部 山田さん用ノートPC"
        description="100 文字以内。空欄で保存すると未設定に戻ります。"
        autoComplete="off"
      />
    </FormDialog>
  );
}

/**
 * 端末連携キー (PC 名取得スクリプト用) の発行・無効化。管理者のみ。
 * キーは発行直後に 1 度だけ表示する (DB にはハッシュのみ保存しているため、あとから表示できない)。
 */
export function AgentTokenControls({ deviceId, issuedAt }: { deviceId: number; issuedAt: string | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const setupCommand = `powershell -NoProfile -ExecutionPolicy Bypass -File .\\Send-ComputerName.ps1 -Setup -ServerUrl ${origin} -DeviceId ${deviceId}`;

  async function issue() {
    setPending(true);
    const result = await issueAgentTokenAction({ id: deviceId });
    setPending(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    setToken(result.data.token);
    toast.success(issuedAt ? "端末連携キーを再発行しました。以前のキーは使えなくなりました。" : "端末連携キーを発行しました。");
    router.refresh();
  }

  async function copy(text: string) {
    await navigator.clipboard.writeText(text);
    toast.success("コピーしました。");
  }

  return (
    <div className="flex flex-wrap gap-2">
      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setToken(null);
        }}
      >
        <DialogTrigger asChild>
          <Button variant="outline" size="sm">
            <KeyRound aria-hidden />
            {issuedAt ? "端末連携キーを再発行" : "端末連携キーを発行"}
          </Button>
        </DialogTrigger>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>端末連携キー</DialogTitle>
            <DialogDescription>
              Windows 端末の PC 名取得スクリプトが、この端末の PC 名を送信するためのキーです。キーはこの端末専用で、他の端末の更新には使えません。
            </DialogDescription>
          </DialogHeader>
          {token ? (
            <div className="flex flex-col gap-4">
              <Alert>
                <AlertTitle>キーはこの画面を閉じると二度と表示できません</AlertTitle>
                <AlertDescription>メールやチャットに貼り付けず、端末の設定作業にだけ使ってください。</AlertDescription>
              </Alert>
              <div className="flex flex-col gap-1">
                <span className="text-sm font-medium">端末連携キー</span>
                <div className="flex items-center gap-2">
                  <code className="min-w-0 flex-1 break-all rounded-md border bg-muted px-2 py-1.5 text-xs">{token}</code>
                  <Button type="button" variant="outline" size="sm" onClick={() => copy(token)}>
                    <Copy aria-hidden />
                    コピー
                  </Button>
                </div>
              </div>
              <div className="flex flex-col gap-1 text-sm">
                <span className="font-medium">端末での設定方法 (管理者として PowerShell を開いて実行)</span>
                <div className="flex items-center gap-2">
                  <code className="min-w-0 flex-1 break-all rounded-md border bg-muted px-2 py-1.5 text-xs">{setupCommand}</code>
                  <Button type="button" variant="outline" size="sm" onClick={() => copy(setupCommand)}>
                    <Copy aria-hidden />
                    コピー
                  </Button>
                </div>
                <span className="text-xs text-muted-foreground">
                  実行するとキーの入力を求められます。キーは端末内で暗号化して保存され、スクリプトには書き込まれません。
                </span>
              </div>
            </div>
          ) : (
            <p className="text-sm">
              {issuedAt
                ? "再発行すると、現在のキーは使えなくなります。端末側で設定をやり直す必要があります。"
                : "キーを発行したら、表示される手順で端末に設定してください。"}
            </p>
          )}
          <DialogFooter>
            {token ? (
              <Button onClick={() => setOpen(false)}>閉じる</Button>
            ) : (
              <>
                <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
                  キャンセル
                </Button>
                <Button onClick={issue} disabled={pending}>
                  {pending ? "発行中…" : issuedAt ? "再発行する" : "発行する"}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {issuedAt ? (
        <>
          <Button variant="ghost" size="sm" onClick={() => setRevoking(true)}>
            無効にする
          </Button>
          <ConfirmDialog
            open={revoking}
            onOpenChange={(next) => !pending && setRevoking(next)}
            title="端末連携キーを無効にしますか？"
            description="この端末からの PC 名の送信は受け付けられなくなります。再び使う場合はキーを発行し直してください。"
            confirmLabel="無効にする"
            pending={pending}
            items={[]}
            onConfirm={async () => {
              setPending(true);
              const result = await revokeAgentTokenAction({ id: deviceId });
              setPending(false);
              setRevoking(false);
              if (applyActionResult(result)) router.refresh();
            }}
          />
        </>
      ) : null}
    </div>
  );
}
