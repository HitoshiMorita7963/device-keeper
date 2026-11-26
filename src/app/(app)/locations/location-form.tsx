"use client";

import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { CheckboxField, TextField } from "@/components/form/fields";
import { FormRow, PageForm } from "@/components/form/page-form";
import { formResolver } from "@/components/form/resolver";
import { applyActionResult } from "@/components/form/submit-result";
import { locationSchema, type LocationInput } from "@/lib/validation/masters";
import { createLocationAction, updateLocationAction } from "./actions";

export function LocationForm({ id, defaultValues }: { id?: number; defaultValues: LocationInput }) {
  const router = useRouter();
  const form = useForm<LocationInput>({ resolver: formResolver(locationSchema), defaultValues });

  return (
    <PageForm
      form={form}
      cancelHref={id ? `/locations/${id}` : "/locations"}
      submitLabel={id ? "更新する" : "登録する"}
      onSubmit={async (values) => {
        const result = id ? await updateLocationAction({ ...values, id }) : await createLocationAction(values);
        if (applyActionResult(result, form.setError)) router.push(`/locations/${result.data.id}`);
      }}
    >
      <FormRow>
        <TextField<LocationInput> name="locationCode" label="拠点コード" required maxLength={30} />
        <TextField<LocationInput> name="name" label="拠点名" required maxLength={100} />
      </FormRow>
      <TextField<LocationInput> name="address" label="住所" maxLength={200} />
      <FormRow>
        <TextField<LocationInput> name="managerName" label="拠点責任者" maxLength={50} />
        <TextField<LocationInput> name="phone" label="電話番号" type="tel" maxLength={30} />
      </FormRow>
      <CheckboxField<LocationInput>
        name="isActive"
        label="使用中"
        description="端末が残っている拠点は使用停止にできません。"
      />
    </PageForm>
  );
}
