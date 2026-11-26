"use client";

import { useRouter } from "next/navigation";
import { useForm, useFormContext, useWatch } from "react-hook-form";
import { SelectField, TextareaField, TextField, type Option } from "@/components/form/fields";
import { FormRow, PageForm } from "@/components/form/page-form";
import { formResolver } from "@/components/form/resolver";
import { applyActionResult } from "@/components/form/submit-result";
import { Field, FieldDescription, FieldError, FieldLabel, FieldSeparator } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { DEVICE_STATUS_LABELS } from "@/lib/labels";
import {
  deviceCreateSchema,
  deviceUpdateSchema,
  INITIAL_DEVICE_STATUSES,
  type DeviceCreateInput,
  type DeviceUpdateInput,
} from "@/lib/validation/devices";
import { createDeviceAction, updateDeviceAction } from "./actions";

export type CategoryOption = Option & { nextNumber: string };

/** 資産管理番号: 自動採番か手入力かを選ぶ */
function AssetNumberField({ categories }: { categories: CategoryOption[] }) {
  const { register, control, getFieldState, formState } = useFormContext<DeviceCreateInput>();
  const [mode, categoryId] = useWatch({ control, name: ["assetNumberMode", "categoryId"] });
  const next = categories.find((c) => String(c.value) === String(categoryId))?.nextNumber;
  const error = getFieldState("assetNumber", formState).error;

  return (
    <Field data-invalid={!!error}>
      <FieldLabel htmlFor="f-assetNumber">
        資産管理番号
        <span className="text-xs font-normal text-destructive" aria-hidden>
          必須
        </span>
      </FieldLabel>
      <div className="flex flex-wrap gap-4 text-sm" role="radiogroup" aria-label="資産管理番号の付け方">
        <label className="flex items-center gap-2">
          <input type="radio" value="auto" {...register("assetNumberMode")} className="accent-primary" />
          自動採番
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" value="manual" {...register("assetNumberMode")} className="accent-primary" />
          既存の番号を入力
        </label>
      </div>
      {mode === "manual" ? (
        <Input id="f-assetNumber" maxLength={30} className="font-mono" aria-invalid={!!error} placeholder="例: PC-000123" {...register("assetNumber")} />
      ) : (
        <FieldDescription>
          {next ? (
            <>
              登録時に <span className="font-mono font-medium text-foreground">{next}</span> を採番します (同時に登録された場合は次の番号になります)。
            </>
          ) : (
            "資産種別を選ぶと、種別ごとの形式で自動採番します。"
          )}
        </FieldDescription>
      )}
      <FieldError errors={[error]} />
    </Field>
  );
}

function SpecFields() {
  return (
    <>
      <FormRow>
        <TextField name="manufacturer" label="メーカー" maxLength={100} />
        <TextField name="model" label="型番" maxLength={100} />
      </FormRow>
      <FormRow cols={3}>
        <TextField name="serialNumber" label="シリアル番号" maxLength={100} className="sm:col-span-1" />
        <TextField name="osName" label="OS" maxLength={50} />
        <TextField name="osVersion" label="OSバージョン" maxLength={50} />
      </FormRow>
      <FieldSeparator />
      <FormRow cols={3}>
        <TextField name="purchaseDate" label="購入日" type="date" />
        <TextField name="purchasePrice" label="購入金額 (円)" inputMode="numeric" maxLength={13} />
        <TextField name="purchaseVendor" label="購入先" maxLength={100} />
      </FormRow>
      <FormRow cols={3}>
        <TextField name="warrantyExpiry" label="保証期限" type="date" />
      </FormRow>
      <TextareaField name="notes" label="備考" />
    </>
  );
}

export function DeviceCreateForm({
  defaultValues,
  categories,
  locations,
}: {
  defaultValues: DeviceCreateInput;
  categories: CategoryOption[];
  locations: Option[];
}) {
  const router = useRouter();
  const form = useForm<DeviceCreateInput>({ resolver: formResolver(deviceCreateSchema), defaultValues });

  return (
    <PageForm
      form={form}
      cancelHref="/devices"
      submitLabel="登録する"
      onSubmit={async (values) => {
        const result = await createDeviceAction(values);
        if (applyActionResult(result, form.setError)) router.push(`/devices/${result.data.id}`);
      }}
    >
      <FormRow>
        <SelectField<DeviceCreateInput> name="categoryId" label="資産種別" required options={categories} />
        <TextField<DeviceCreateInput> name="name" label="資産名称" required maxLength={100} placeholder="例: 営業用ノートPC" />
      </FormRow>
      <AssetNumberField categories={categories} />
      <FormRow>
        <SelectField<DeviceCreateInput> name="currentLocationId" label="現在拠点" required options={locations} />
        <SelectField<DeviceCreateInput>
          name="status"
          label="端末状態"
          required
          placeholder={false}
          options={INITIAL_DEVICE_STATUSES.map((s) => ({ value: s, label: DEVICE_STATUS_LABELS[s] }))}
          description="使用中にするには、登録後に貸出処理を行ってください。"
        />
      </FormRow>
      <SpecFields />
    </PageForm>
  );
}

export function DeviceEditForm({
  defaultValues,
  categories,
  locationName,
  statusLabel,
}: {
  defaultValues: DeviceUpdateInput;
  categories: Option[];
  locationName: string;
  statusLabel: string;
}) {
  const router = useRouter();
  const form = useForm<DeviceUpdateInput>({ resolver: formResolver(deviceUpdateSchema), defaultValues });
  const id = Number(defaultValues.id);

  return (
    <PageForm
      form={form}
      cancelHref={`/devices/${id}`}
      submitLabel="更新する"
      onSubmit={async (values) => {
        const result = await updateDeviceAction(values);
        if (applyActionResult(result, form.setError)) router.push(`/devices/${id}`);
      }}
    >
      <FormRow>
        <TextField<DeviceUpdateInput> name="assetNumber" label="資産管理番号" required maxLength={30} className="font-mono" />
        <SelectField<DeviceUpdateInput> name="categoryId" label="資産種別" required options={categories} />
      </FormRow>
      <TextField<DeviceUpdateInput> name="name" label="資産名称" required maxLength={100} />
      <FormRow>
        <Field>
          <FieldLabel>現在拠点</FieldLabel>
          <Input value={locationName} disabled readOnly />
          <FieldDescription>拠点の変更は「拠点間移動」から行います (移動履歴を残すため)。</FieldDescription>
        </Field>
        <Field>
          <FieldLabel>端末状態</FieldLabel>
          <Input value={statusLabel} disabled readOnly />
          <FieldDescription>状態の変更は端末詳細画面の「状態変更」・貸出・返却・廃棄から行います。</FieldDescription>
        </Field>
      </FormRow>
      <SpecFields />
    </PageForm>
  );
}
