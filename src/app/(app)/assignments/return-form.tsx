"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { ConfirmDialog } from "@/components/form/confirm-dialog";
import { CheckboxField, SelectField, TextareaField, TextField, type Option } from "@/components/form/fields";
import { FormRow, PageForm } from "@/components/form/page-form";
import { formResolver } from "@/components/form/resolver";
import { returnPath } from "@/components/form/return-path";
import { applyActionResult } from "@/components/form/submit-result";
import { RETURN_CONDITIONS, returnSchema, type ReturnInput } from "@/lib/validation/assignments";
import { returnDeviceAction } from "./actions";

export type ReturnableDevice = Option & {
  employee: string;
  assignedAt: string;
  expectedReturnAt: string;
  overdue: boolean;
  notes: string | null;
};

const labelOf = (options: Option[], value: unknown) => options.find((o) => String(o.value) === String(value))?.label;

/** 選択中の端末の貸出内容 */
function CurrentAssignment({ form, devices }: { form: ReturnType<typeof useForm<ReturnInput>>; devices: ReturnableDevice[] }) {
  const deviceId = useWatch({ control: form.control, name: "deviceId" });
  const d = devices.find((x) => String(x.value) === String(deviceId));
  if (!d) return null;
  return (
    <div className="rounded-lg border bg-muted/40 p-3 text-sm">
      <div>
        利用者: <span className="font-medium">{d.employee}</span>
      </div>
      <div>
        貸出日: {d.assignedAt} / 返却予定日: {d.expectedReturnAt || "なし"}
        {d.overdue ? <span className="ml-2 font-medium text-destructive">返却期限超過</span> : null}
      </div>
      {d.notes ? <div className="mt-1 whitespace-pre-wrap text-muted-foreground">貸出時の備考: {d.notes}</div> : null}
    </div>
  );
}

export function ReturnForm({
  defaultValues,
  devices,
  handlers,
  returnTo,
}: {
  defaultValues: ReturnInput;
  devices: ReturnableDevice[];
  handlers: Option[];
  returnTo?: string;
}) {
  const router = useRouter();
  const form = useForm<ReturnInput>({ resolver: formResolver(returnSchema), defaultValues });
  const [confirming, setConfirming] = useState<ReturnInput | null>(null);
  const [pending, setPending] = useState(false);

  async function execute() {
    if (!confirming) return;
    setPending(true);
    const result = await returnDeviceAction(confirming);
    setPending(false);
    setConfirming(null);
    if (applyActionResult(result, form.setError)) router.push(returnPath(returnTo, `/devices/${result.data.deviceId}`, result.data));
  }

  const device = confirming ? devices.find((d) => String(d.value) === String(confirming.deviceId)) : undefined;

  return (
    <>
      <PageForm form={form} cancelHref={returnTo ?? "/assignments"} submitLabel="確認へ進む" onSubmit={async (values) => setConfirming(values)}>
        <SelectField<ReturnInput> name="deviceId" label="対象端末" required options={devices} description="貸出中の端末から選択します。" />
        <CurrentAssignment form={form} devices={devices} />
        <FormRow cols={3}>
          <TextField<ReturnInput> name="returnedAt" label="返却日" required type="date" />
          <SelectField<ReturnInput>
            name="conditionOnReturn"
            label="返却時状態"
            required
            options={RETURN_CONDITIONS.map((c) => ({ value: c, label: c }))}
          />
          <SelectField<ReturnInput> name="returnedById" label="返却担当者" required options={handlers} placeholder={false} />
        </FormRow>
        <CheckboxField<ReturnInput> name="accessoriesChecked" label="付属品 (充電器・ケース等) がそろっていることを確認した" />
        <TextareaField<ReturnInput> name="notes" label="備考" description="破損や付属品の不足がある場合は内容を記録してください。" />
      </PageForm>

      <ConfirmDialog
        open={!!confirming}
        onOpenChange={(open) => !open && !pending && setConfirming(null)}
        title="この内容で返却しますか？"
        description="端末の状態が「保管中」になり、利用者が解除されます。"
        confirmLabel="返却する"
        pending={pending}
        onConfirm={execute}
        items={
          confirming
            ? [
                { label: "端末", value: device?.label },
                { label: "利用者", value: device?.employee },
                { label: "返却日", value: String(confirming.returnedAt) },
                { label: "返却時状態", value: String(confirming.conditionOnReturn) },
                { label: "付属品確認", value: confirming.accessoriesChecked ? "確認済み" : "未確認" },
                { label: "返却担当者", value: labelOf(handlers, confirming.returnedById) },
                { label: "備考", value: String(confirming.notes ?? "") },
              ]
            : []
        }
      >
        {confirming?.conditionOnReturn === "破損・故障あり" ? (
          <p className="text-sm text-amber-700 dark:text-amber-400">
            返却後、必要に応じて修理・故障管理から修理登録を行ってください。
          </p>
        ) : null}
      </ConfirmDialog>
    </>
  );
}
