import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { requirePermission } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { idParam } from "@/lib/validation/common";
import { EmployeeForm } from "../../employee-form";
import { toEmployeeInput } from "../../form-values";
import { employeeFormOptions } from "../../options";

export const metadata: Metadata = { title: "社員編集" };

export default async function EditEmployeePage({ params }: PageProps<"/employees/[id]/edit">) {
  await requirePermission("employee:write");
  const id = idParam.safeParse((await params).id);
  const employee = id.success ? await db.employee.findUnique({ where: { id: id.data } }) : null;
  if (!employee) notFound();
  const options = await employeeFormOptions(employee);

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader title="社員編集" description={`${employee.employeeNumber} ${employee.name}`} />
      <EmployeeForm id={employee.id} defaultValues={toEmployeeInput(employee)} {...options} />
    </div>
  );
}
