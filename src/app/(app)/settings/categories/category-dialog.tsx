"use client";

import type { ReactNode } from "react";
import { useForm, useWatch } from "react-hook-form";
import { CheckboxField, TextField } from "@/components/form/fields";
import { FormDialog } from "@/components/form/form-dialog";
import { formResolver } from "@/components/form/resolver";
import { applyActionResult } from "@/components/form/submit-result";
import { categorySchema, type CategoryInput } from "@/lib/validation/masters";
import { createCategoryAction, updateCategoryAction } from "./actions";

type Category = { id: number; categoryCode: string; name: string; prefix: string; numberDigits: number; isActive: boolean };

function NumberPreview({ form }: { form: ReturnType<typeof useForm<CategoryInput>> }) {
  const [prefix, digits] = useWatch({ control: form.control, name: ["prefix", "numberDigits"] });
  const n = Number(digits);
  if (!prefix || !Number.isInteger(n) || n < 3 || n > 10) return null;
  return (
    <p className="text-sm text-muted-foreground">
      採番例: <span className="font-mono">{`${String(prefix).toUpperCase()}-${"1".padStart(n, "0")}`}</span>
    </p>
  );
}

export function CategoryDialog({ category, trigger }: { category?: Category; trigger: ReactNode }) {
  const defaultValues: CategoryInput = category
    ? { ...category, numberDigits: String(category.numberDigits) }
    : { categoryCode: "", name: "", prefix: "", numberDigits: "6", isActive: true };
  const form = useForm<CategoryInput>({ resolver: formResolver(categorySchema), defaultValues });

  return (
    <FormDialog
      trigger={trigger}
      title={category ? "資産種別の編集" : "資産種別の登録"}
      form={form}
      defaultValues={defaultValues}
      onSubmit={async (values) => {
        const result = category
          ? await updateCategoryAction({ ...values, id: category.id })
          : await createCategoryAction(values);
        return applyActionResult(result, form.setError);
      }}
    >
      <TextField<CategoryInput> name="categoryCode" label="種別コード" required maxLength={20} />
      <TextField<CategoryInput> name="name" label="種別名" required maxLength={50} />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField<CategoryInput> name="prefix" label="採番プレフィックス" required maxLength={10} className="font-mono" />
        <TextField<CategoryInput> name="numberDigits" label="番号の桁数" required type="number" min={3} max={10} />
      </div>
      <NumberPreview form={form} />
      {category ? (
        <p className="text-xs text-muted-foreground">
          プレフィックスを変更しても、登録済み端末の資産管理番号は変わりません。以降の自動採番にのみ反映されます。
        </p>
      ) : null}
      <CheckboxField<CategoryInput> name="isActive" label="使用中" description="使用停止にすると、端末登録時の選択肢に表示されなくなります。" />
    </FormDialog>
  );
}
