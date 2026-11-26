"use client";

import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { SelectField, TextField, type Option } from "@/components/form/fields";
import { FormRow, PageForm } from "@/components/form/page-form";
import { formResolver } from "@/components/form/resolver";
import { applyActionResult } from "@/components/form/submit-result";
import { EMPLOYMENT_STATUS_LABELS } from "@/lib/labels";
import { employeeSchema, type EmployeeInput } from "@/lib/validation/masters";
import { createEmployeeAction, updateEmployeeAction } from "./actions";

export function EmployeeForm({
  id,
  defaultValues,
  departments,
  locations,
}: {
  id?: number;
  defaultValues: EmployeeInput;
  departments: Option[];
  locations: Option[];
}) {
  const router = useRouter();
  const form = useForm<EmployeeInput>({ resolver: formResolver(employeeSchema), defaultValues });
  const isRetired = defaultValues.employmentStatus === "RETIRED";
  // 退職への変更は詳細画面の退職処理から行う。退職済みの社員のみ「退職」を選択肢に残す
  const statusOptions = (isRetired ? (["ACTIVE", "ON_LEAVE", "RETIRED"] as const) : (["ACTIVE", "ON_LEAVE"] as const)).map(
    (s) => ({ value: s, label: EMPLOYMENT_STATUS_LABELS[s] }),
  );

  return (
    <PageForm
      form={form}
      cancelHref={id ? `/employees/${id}` : "/employees"}
      submitLabel={id ? "更新する" : "登録する"}
      onSubmit={async (values) => {
        const result = id ? await updateEmployeeAction({ ...values, id }) : await createEmployeeAction(values);
        if (applyActionResult(result, form.setError)) router.push(`/employees/${result.data.id}`);
      }}
    >
      <FormRow>
        <TextField<EmployeeInput> name="employeeNumber" label="社員番号" required maxLength={30} />
        <TextField<EmployeeInput> name="name" label="氏名" required maxLength={50} />
      </FormRow>
      <TextField<EmployeeInput> name="email" label="メールアドレス" type="email" maxLength={254} />
      <FormRow>
        <SelectField<EmployeeInput> name="departmentId" label="部署" options={departments} placeholder="未設定" />
        <SelectField<EmployeeInput> name="homeLocationId" label="所属拠点" options={locations} placeholder="未設定" />
      </FormRow>
      <FormRow>
        <SelectField<EmployeeInput>
          name="employmentStatus"
          label="在籍状態"
          required
          options={statusOptions}
          placeholder={false}
          description={isRetired ? "在籍・休職に変更すると再入社として扱い、退職日を消去します。" : "退職は社員詳細画面の「退職処理」から行います。"}
        />
        <TextField<EmployeeInput> name="joinedAt" label="入社日" type="date" />
      </FormRow>
    </PageForm>
  );
}
