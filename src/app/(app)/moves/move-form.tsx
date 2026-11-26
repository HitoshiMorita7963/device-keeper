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
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { moveSchema, type MoveInput } from "@/lib/validation/moves";
import { moveDeviceAction } from "./actions";

export type MovableDevice = Option & { locationId: number; locationName: string };

const labelOf = (options: Option[], value: unknown) => options.find((o) => String(o.value) === String(value))?.label;

/** 移動元: 選択した端末の現在拠点を自動表示する (入力不可) */
function FromLocation({ form, devices }: { form: ReturnType<typeof useForm<MoveInput>>; devices: MovableDevice[] }) {
  const deviceId = useWatch({ control: form.control, name: "deviceId" });
  const device = devices.find((d) => String(d.value) === String(deviceId));
  return (
    <Field>
      <FieldLabel htmlFor="f-from">移動元拠点</FieldLabel>
      <Input id="f-from" value={device?.locationName ?? ""} placeholder="端末を選択すると表示されます" disabled readOnly />
      <FieldDescription>端末の現在拠点が自動で設定されます。</FieldDescription>
    </Field>
  );
}

export function MoveForm({
  defaultValues,
  devices,
  locations,
  handlers,
  returnTo,
}: {
  defaultValues: MoveInput;
  devices: MovableDevice[];
  locations: Option[];
  handlers: Option[];
  returnTo?: string;
}) {
  const router = useRouter();
  const form = useForm<MoveInput>({ resolver: formResolver(moveSchema), defaultValues });
  const [confirming, setConfirming] = useState<MoveInput | null>(null);
  const [pending, setPending] = useState(false);
  const deviceId = useWatch({ control: form.control, name: "deviceId" });
  const currentLocationId = devices.find((d) => String(d.value) === String(deviceId))?.locationId;

  async function execute() {
    if (!confirming) return;
    setPending(true);
    const result = await moveDeviceAction(confirming);
    setPending(false);
    setConfirming(null);
    if (applyActionResult(result, form.setError)) router.push(returnPath(returnTo, "/moves", result.data));
  }

  const device = confirming ? devices.find((d) => String(d.value) === String(confirming.deviceId)) : undefined;

  return (
    <>
      <PageForm form={form} cancelHref={returnTo ?? "/moves"} submitLabel="確認へ進む" onSubmit={async (values) => setConfirming(values)}>
        <SelectField<MoveInput> name="deviceId" label="対象端末" required options={devices} description="廃棄済み・紛失中の端末は選択できません。" />
        <FormRow>
          <FromLocation form={form} devices={devices} />
          <SelectField<MoveInput>
            name="toLocationId"
            label="移動先拠点"
            required
            options={locations.filter((l) => l.value !== currentLocationId)}
          />
        </FormRow>
        <FormRow>
          <TextField<MoveInput> name="movedAt" label="移動日" required type="date" />
          <SelectField<MoveInput> name="movedById" label="担当者" required options={handlers} placeholder={false} />
        </FormRow>
        <TextareaField<MoveInput> name="reason" label="移動理由" required description="例: 大阪支店の増員に伴う配置換え" />
      </PageForm>

      <ConfirmDialog
        open={!!confirming}
        onOpenChange={(open) => !open && !pending && setConfirming(null)}
        title="この内容で移動しますか？"
        description="端末の現在拠点が移動先に更新され、移動履歴が記録されます。"
        confirmLabel="移動する"
        pending={pending}
        onConfirm={execute}
        items={
          confirming
            ? [
                { label: "端末", value: device?.label },
                { label: "移動元", value: device?.locationName },
                { label: "移動先", value: labelOf(locations, confirming.toLocationId) },
                { label: "移動日", value: String(confirming.movedAt) },
                { label: "担当者", value: labelOf(handlers, confirming.movedById) },
                { label: "移動理由", value: String(confirming.reason) },
              ]
            : []
        }
      />
    </>
  );
}
