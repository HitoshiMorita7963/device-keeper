import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { requirePermission } from "@/lib/auth/session";
import { EmployeeForm } from "../employee-form";
import { toEmployeeInput } from "../form-values";
import { employeeFormOptions } from "../options";

export const metadata: Metadata = { title: "社員登録" };

export default async function NewEmployeePage() {
  await requirePermission("employee:write");
  const options = await employeeFormOptions();
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader title="社員登録" />
      <EmployeeForm defaultValues={toEmployeeInput()} {...options} />
    </div>
  );
}
