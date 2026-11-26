"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { ConfirmDialog } from "@/components/form/confirm-dialog";
import { SelectField, TextareaField, TextField, type Option } from "@/components/form/fields";
import { FormRow, PageForm } from "@/components/form/page-form";
import { formResolver } from "@/components/form/resolver";
import { returnPath } from "@/components/form/return-path";
import { applyActionResult } from "@/components/form/submit-result";
import { MAINTENANCE_STATUS_LABELS } from "@/lib/labels";
import {
  maintenanceCreateSchema,
  maintenanceUpdateSchema,
  type MaintenanceCreateInput,
  type MaintenanceUpdateInput,
} from "@/lib/validation/maintenance";
import { createMaintenanceAction, updateMaintenanceAction } from "./actions";

const labelOf = (options: Option[], value: unknown) => options.find((o) => String(o.value) === String(value))?.label;

/** 修理受付。端末状態が「修理中」になるため確認画面を挟む */
export function MaintenanceCreateForm({ defaultValues, devices, returnTo }: { defaultValues: MaintenanceCreateInput; devices: Option[]; returnTo?: string }) {
  const router = useRouter();
  const form = useForm<MaintenanceCreateInput>({ resolver: formResolver(maintenanceCreateSchema), defaultValues });
  const [confirming, setConfirming] = useState<MaintenanceCreateInput | null>(null);
  const [pending, setPending] = useState(false);

  async function execute() {
    if (!confirming) return;
    setPending(true);
    const result = await createMaintenanceAction(confirming);
    setPending(false);
    setConfirming(null);
    if (applyActionResult(result, form.setError)) router.push(returnPath(returnTo, `/maintenance/${result.data.id}`, result.data));
  }

  return (
    <>
      <PageForm form={form} cancelHref={returnTo ?? "/maintenance"} submitLabel="確認へ進む" onSubmit={async (values) => setConfirming(values)}>
        <SelectField<MaintenanceCreateInput>
          name="deviceId"
          label="対象端末"
          required
          options={devices}
          description="廃棄済み・紛失中・対応中の修理がある端末は選択できません。"
        />
        <FormRow>
          <TextField<MaintenanceCreateInput> name="reportedAt" label="受付日" required type="date" />
          <SelectField<MaintenanceCreateInput>
            name="status"
            label="対応状況"
            required
            placeholder={false}
            options={(["REPORTED", "IN_PROGRESS"] as const).map((s) => ({ value: s, label: MAINTENANCE_STATUS_LABELS[s] }))}
          />
        </FormRow>
        <TextareaField<MaintenanceCreateInput> name="problemDescription" label="故障内容" required description="症状・発生状況などを記入してください。" />
        <FormRow>
          <TextField<MaintenanceCreateInput> name="repairVendor" label="修理業者" maxLength={100} />
          <TextField<MaintenanceCreateInput> name="repairCost" label="修理費用 (円・見積)" inputMode="numeric" maxLength={13} />
        </FormRow>
        <TextareaField<MaintenanceCreateInput> name="notes" label="備考" />
      </PageForm>

      <ConfirmDialog
        open={!!confirming}
        onOpenChange={(open) => !open && !pending && setConfirming(null)}
        title="この内容で修理を受け付けますか？"
        description="端末の状態が「修理中」になり、修理が完了するまで貸出できなくなります。"
        confirmLabel="受け付ける"
        pending={pending}
        onConfirm={execute}
        items={
          confirming
            ? [
                { label: "端末", value: labelOf(devices, confirming.deviceId) },
                { label: "受付日", value: String(confirming.reportedAt) },
                { label: "故障内容", value: String(confirming.problemDescription) },
                { label: "修理業者", value: String(confirming.repairVendor ?? "") },
                { label: "修理費用", value: confirming.repairCost ? `${confirming.repairCost} 円` : "" },
              ]
            : []
        }
      />
    </>
  );
}

/** 修理記録の更新・完了。完了 (取消) にすると端末状態が戻るため確認画面を挟む */
export function MaintenanceUpdateForm({ defaultValues, closed, deviceLabel }: { defaultValues: MaintenanceUpdateInput; closed: boolean; deviceLabel: string }) {
  const router = useRouter();
  const form = useForm<MaintenanceUpdateInput>({ resolver: formResolver(maintenanceUpdateSchema), defaultValues });
  const status = useWatch({ control: form.control, name: "status" });
  const [confirming, setConfirming] = useState<MaintenanceUpdateInput | null>(null);
  const [pending, setPending] = useState(false);
  const closing = !closed && (status === "COMPLETED" || status === "CANCELLED");

  async function save(values: MaintenanceUpdateInput) {
    setPending(true);
    const result = await updateMaintenanceAction(values);
    setPending(false);
    setConfirming(null);
    if (applyActionResult(result, form.setError)) router.refresh();
  }

  const statuses = closed
    ? ([defaultValues.status] as const)
    : (["REPORTED", "IN_PROGRESS", "COMPLETED", "CANCELLED"] as const);

  return (
    <>
      <PageForm
        form={form}
        cancelHref="/maintenance"
        submitLabel={closing ? "確認へ進む" : "保存"}
        onSubmit={async (values) => (closing ? setConfirming(values) : save(values))}
      >
        <FormRow>
          <SelectField<MaintenanceUpdateInput>
            name="status"
            label="対応状況"
            required
            placeholder={false}
            options={statuses.map((s) => ({ value: s, label: MAINTENANCE_STATUS_LABELS[s as keyof typeof MAINTENANCE_STATUS_LABELS] }))}
            description={closed ? "完了・取消済みの記録は対応状況を変更できません。" : "完了・取消にすると端末状態を元に戻します。"}
          />
          <TextField<MaintenanceUpdateInput> name="repairedAt" label="修理完了日" type="date" required={status === "COMPLETED"} />
        </FormRow>
        <TextareaField<MaintenanceUpdateInput> name="problemDescription" label="故障内容" required />
        <FormRow>
          <TextField<MaintenanceUpdateInput> name="repairVendor" label="修理業者" maxLength={100} />
          <TextField<MaintenanceUpdateInput> name="repairCost" label="修理費用 (円)" inputMode="numeric" maxLength={13} />
        </FormRow>
        <TextareaField<MaintenanceUpdateInput> name="notes" label="備考" />
      </PageForm>

      <ConfirmDialog
        open={!!confirming}
        onOpenChange={(open) => !open && !pending && setConfirming(null)}
        title={confirming?.status === "CANCELLED" ? "修理を取消にしますか？" : "修理を完了にしますか？"}
        description="端末状態を修理受付前の状態 (貸出中なら使用中、それ以外は保管中) に戻します。完了・取消後は対応状況を変更できません。"
        confirmLabel={confirming?.status === "CANCELLED" ? "取消にする" : "完了にする"}
        pending={pending}
        onConfirm={() => confirming && save(confirming)}
        items={
          confirming
            ? [
                { label: "端末", value: deviceLabel },
                { label: "対応状況", value: MAINTENANCE_STATUS_LABELS[confirming.status as keyof typeof MAINTENANCE_STATUS_LABELS] },
                { label: "修理完了日", value: String(confirming.repairedAt ?? "") },
                { label: "修理業者", value: String(confirming.repairVendor ?? "") },
                { label: "修理費用", value: confirming.repairCost ? `${confirming.repairCost} 円` : "" },
              ]
            : []
        }
      />
    </>
  );
}
