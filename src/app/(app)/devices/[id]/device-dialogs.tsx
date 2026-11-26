"use client";

import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { RefreshCw, Trash2 } from "lucide-react";
import { SelectField, TextareaField } from "@/components/form/fields";
import { FormDialog } from "@/components/form/form-dialog";
import { formResolver } from "@/components/form/resolver";
import { applyActionResult } from "@/components/form/submit-result";
import { Button } from "@/components/ui/button";
import type { DeviceStatus } from "@/generated/prisma/enums";
import { DEVICE_STATUS_LABELS } from "@/lib/labels";
import {
  deviceDeleteSchema,
  deviceStatusChangeSchema,
  MANUAL_DEVICE_STATUSES,
  type DeviceStatusChangeInput,
} from "@/lib/validation/devices";
import type { z } from "zod";
import { changeDeviceStatusAction, deleteDeviceAction } from "../actions";

/**
 * 状態変更 (紛失・修理中、発見・修理完了による復帰)。
 * 貸出中の端末は「使用中」へ、貸出中でない端末は「保管中」へのみ戻せる。
 */
export function StatusChangeDialog({
  deviceId,
  status,
  hasOpenAssignment,
  hasOpenMaintenance,
}: {
  deviceId: number;
  status: DeviceStatus;
  hasOpenAssignment: boolean;
  hasOpenMaintenance: boolean;
}) {
  const router = useRouter();
  // 修理対応中は修理記録の完了で状態を戻すため、ここでは紛失への変更のみ受け付ける
  const options = MANUAL_DEVICE_STATUSES.filter(
    (s) =>
      s !== status &&
      (hasOpenMaintenance ? s === "LOST" : s === "IN_USE" ? hasOpenAssignment : s === "IN_STOCK" ? !hasOpenAssignment : true),
  ).map((s) => ({ value: s, label: DEVICE_STATUS_LABELS[s] }));
  const defaultValues = { id: String(deviceId), status: "" as DeviceStatusChangeInput["status"], reason: "" };
  const form = useForm<DeviceStatusChangeInput>({ resolver: formResolver(deviceStatusChangeSchema), defaultValues });

  return (
    <FormDialog
      trigger={
        <Button variant="outline">
          <RefreshCw aria-hidden />
          状態変更
        </Button>
      }
      title="端末状態の変更"
      description={`現在の状態: ${DEVICE_STATUS_LABELS[status]}。貸出・返却・拠点移動・廃棄はそれぞれの画面から行ってください。`}
      form={form}
      defaultValues={defaultValues}
      submitLabel="変更する"
      onSubmit={async (values) => {
        const ok = applyActionResult(await changeDeviceStatusAction(values), form.setError);
        if (ok) router.refresh();
        return ok;
      }}
    >
      <SelectField<DeviceStatusChangeInput> name="status" label="変更後の状態" required options={options} />
      <TextareaField<DeviceStatusChangeInput> name="reason" label="変更理由" required description="操作履歴に記録されます。" />
    </FormDialog>
  );
}

type DeleteInput = z.input<typeof deviceDeleteSchema>;

/** 誤登録した端末の削除 (履歴がない場合のみ)。論理削除で操作履歴は残る */
export function DeleteDeviceDialog({ deviceId, assetNumber }: { deviceId: number; assetNumber: string }) {
  const router = useRouter();
  const defaultValues: DeleteInput = { id: String(deviceId), reason: "" };
  const form = useForm<DeleteInput>({ resolver: formResolver(deviceDeleteSchema), defaultValues });

  return (
    <FormDialog
      trigger={
        <Button variant="destructive">
          <Trash2 aria-hidden />
          削除
        </Button>
      }
      title={`端末 ${assetNumber} を削除しますか？`}
      description="誤って登録した端末を台帳から削除します。使用していた端末を処分する場合は、削除ではなく廃棄処理を行ってください。"
      form={form}
      defaultValues={defaultValues}
      submitLabel="削除する"
      onSubmit={async (values) => {
        const result = await deleteDeviceAction({ id: deviceId, reason: String(values.reason) });
        const ok = applyActionResult(result, form.setError);
        if (ok) router.push("/devices");
        return ok;
      }}
    >
      <TextareaField<DeleteInput> name="reason" label="削除理由" required />
    </FormDialog>
  );
}
