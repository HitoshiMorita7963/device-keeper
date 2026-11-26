import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { requirePermission } from "@/lib/auth/session";
import { todayJst, toDateInput } from "@/lib/dates";
import { EMPLOYMENT_STATUS_LABELS } from "@/lib/labels";
import { pickParams } from "@/lib/pagination";
import { assignableDevices, assignableEmployees, handlerUsers } from "@/server/assignments";
import { AssignForm } from "../assign-form";

export const metadata: Metadata = { title: "貸出登録" };

/** ?device= / ?employee= で端末詳細・社員詳細から対象を引き継ぐ */
export default async function NewAssignmentPage({ searchParams }: PageProps<"/assignments/new">) {
  const user = await requirePermission("assignment:write");
  const params = pickParams(await searchParams, ["device", "employee", "from"] as const);
  const [devices, employees, handlers] = await Promise.all([assignableDevices(), assignableEmployees(), handlerUsers()]);

  const deviceOk = devices.some((d) => String(d.id) === params.device);
  const employeeOk = employees.some((e) => String(e.id) === params.employee);
  // 戻り先: 端末詳細・社員詳細から来た場合はその画面へ戻す
  const returnTo =
    params.from === "device" && deviceOk ? `/devices/${params.device}` : params.from === "employee" && employeeOk ? `/employees/${params.employee}` : undefined;

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader title="貸出登録" description={<Link href="/assignments" className="hover:underline">貸出・返却管理</Link>} />
      {params.device && !deviceOk ? (
        <p className="text-sm text-destructive">指定された端末は保管中ではないため貸出できません。</p>
      ) : null}
      {devices.length === 0 ? (
        <p className="text-sm text-muted-foreground">貸出できる (保管中の) 端末がありません。</p>
      ) : (
        <AssignForm
          returnTo={returnTo}
          defaultValues={{
            deviceId: deviceOk ? params.device! : "",
            employeeId: employeeOk ? params.employee! : "",
            assignedAt: toDateInput(todayJst()),
            expectedReturnAt: "",
            assignedById: handlers.some((h) => h.id === user.id) ? String(user.id) : String(handlers[0]?.id ?? ""),
            notes: "",
          }}
          devices={devices.map((d) => ({ value: d.id, label: `${d.assetNumber} ${d.name} (${d.currentLocation.name})` }))}
          employees={employees.map((e) => ({
            value: e.id,
            label: `${e.employeeNumber} ${e.name}${e.department ? ` / ${e.department.name}` : ""}${e.employmentStatus === "ON_LEAVE" ? ` (${EMPLOYMENT_STATUS_LABELS.ON_LEAVE})` : ""}`,
          }))}
          handlers={handlers.map((h) => ({ value: h.id, label: h.displayName }))}
        />
      )}
    </div>
  );
}
