"use client";

import type { ReactNode } from "react";
import { useForm } from "react-hook-form";
import { formResolver } from "@/components/form/resolver";
import { CheckboxField, TextField } from "@/components/form/fields";
import { FormDialog } from "@/components/form/form-dialog";
import { applyActionResult } from "@/components/form/submit-result";
import { departmentSchema, type DepartmentInput } from "@/lib/validation/masters";
import { createDepartmentAction, updateDepartmentAction } from "./actions";

type Department = { id: number; departmentCode: string; name: string; isActive: boolean };

export function DepartmentDialog({ department, trigger }: { department?: Department; trigger: ReactNode }) {
  const defaultValues: DepartmentInput = department
    ? { departmentCode: department.departmentCode, name: department.name, isActive: department.isActive }
    : { departmentCode: "", name: "", isActive: true };
  const form = useForm<DepartmentInput>({ resolver: formResolver(departmentSchema), defaultValues });

  return (
    <FormDialog
      trigger={trigger}
      title={department ? "部署の編集" : "部署の登録"}
      form={form}
      defaultValues={defaultValues}
      onSubmit={async (values) => {
        const result = department
          ? await updateDepartmentAction({ ...values, id: department.id })
          : await createDepartmentAction(values);
        return applyActionResult(result, form.setError);
      }}
    >
      <TextField<DepartmentInput> name="departmentCode" label="部署コード" required maxLength={30} />
      <TextField<DepartmentInput> name="name" label="部署名" required maxLength={100} />
      <CheckboxField<DepartmentInput>
        name="isActive"
        label="使用中"
        description="使用停止にすると、社員登録時の選択肢に表示されなくなります。"
      />
    </FormDialog>
  );
}
