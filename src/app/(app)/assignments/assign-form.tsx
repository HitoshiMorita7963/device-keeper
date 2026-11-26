"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { ConfirmDialog } from "@/components/form/confirm-dialog";
import { SelectField, TextareaField, TextField, type Option } from "@/components/form/fields";
import { FormRow, PageForm } from "@/components/form/page-form";
import { formResolver } from "@/components/form/resolver";
import { returnPath } from "@/components/form/return-path";
import { applyActionResult } from "@/components/form/submit-result";
import { assignSchema, type AssignInput } from "@/lib/validation/assignments";
import { assignDeviceAction } from "./actions";

const labelOf = (options: Option[], value: unknown) => options.find((o) => String(o.value) === String(value))?.label;

export function AssignForm({
  defaultValues,
  devices,
  employees,
  handlers,
  returnTo,
}: {
  defaultValues: AssignInput;
  devices: Option[];
  employees: Option[];
  handlers: Option[];
  returnTo?: string;
}) {
  const router = useRouter();
  const form = useForm<AssignInput>({ resolver: formResolver(assignSchema), defaultValues });
  const [confirming, setConfirming] = useState<AssignInput | null>(null);
  const [pending, setPending] = useState(false);

  async function execute() {
    if (!confirming) return;
    setPending(true);
    const result = await assignDeviceAction(confirming);
    setPending(false);
    setConfirming(null);
    if (applyActionResult(result, form.setError)) router.push(returnPath(returnTo, `/devices/${result.data.deviceId}`, result.data));
  }

  return (
    <>
      <PageForm form={form} cancelHref={returnTo ?? "/assignments"} submitLabel="確認へ進む" onSubmit={async (values) => setConfirming(values)}>
        <SelectField<AssignInput>
          name="deviceId"
          label="貸出対象端末"
          required
          options={devices}
          description="選択できるのは保管中の端末のみです。"
        />
        <SelectField<AssignInput> name="employeeId" label="貸出先社員" required options={employees} />
        <FormRow cols={3}>
          <TextField<AssignInput> name="assignedAt" label="貸出日" required type="date" />
          <TextField<AssignInput> name="expectedReturnAt" label="返却予定日" type="date" description="長期貸与の場合は空欄" />
          <SelectField<AssignInput> name="assignedById" label="貸出担当者" required options={handlers} placeholder={false} />
        </FormRow>
        <TextareaField<AssignInput> name="notes" label="備考" description="付属品 (充電器・ケース等) の貸出内容などを記録できます。" />
      </PageForm>

      <ConfirmDialog
        open={!!confirming}
        onOpenChange={(open) => !open && !pending && setConfirming(null)}
        title="この内容で貸出しますか？"
        description="端末の状態が「使用中」になり、利用者が更新されます。"
        confirmLabel="貸出する"
        pending={pending}
        onConfirm={execute}
        items={
          confirming
            ? [
                { label: "端末", value: labelOf(devices, confirming.deviceId) },
                { label: "貸出先", value: labelOf(employees, confirming.employeeId) },
                { label: "貸出日", value: String(confirming.assignedAt) },
                { label: "返却予定日", value: String(confirming.expectedReturnAt) || "なし" },
                { label: "貸出担当者", value: labelOf(handlers, confirming.assignedById) },
                { label: "備考", value: String(confirming.notes ?? "") },
              ]
            : []
        }
      />
    </>
  );
}
