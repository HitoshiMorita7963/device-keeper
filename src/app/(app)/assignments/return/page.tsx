import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { requirePermission } from "@/lib/auth/session";
import { formatDate, todayJst, toDateInput } from "@/lib/dates";
import { pickParams } from "@/lib/pagination";
import { handlerUsers, returnableDevices } from "@/server/assignments";
import { ReturnForm } from "../return-form";

export const metadata: Metadata = { title: "返却処理" };

export default async function ReturnPage({ searchParams }: PageProps<"/assignments/return">) {
  const user = await requirePermission("assignment:write");
  const params = pickParams(await searchParams, ["device", "from"] as const);
  const [open, handlers] = await Promise.all([returnableDevices(), handlerUsers()]);
  const today = todayJst();
  const deviceOk = open.some((a) => String(a.device.id) === params.device);
  const returnTo = params.from === "device" && deviceOk ? `/devices/${params.device}` : undefined;

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader title="返却処理" description={<Link href="/assignments" className="hover:underline">貸出・返却管理</Link>} />
      {params.device && !deviceOk ? <p className="text-sm text-destructive">指定された端末は貸出中ではありません。</p> : null}
      {open.length === 0 ? (
        <p className="text-sm text-muted-foreground">貸出中の端末はありません。</p>
      ) : (
        <ReturnForm
          returnTo={returnTo}
          defaultValues={{
            deviceId: deviceOk ? params.device! : "",
            returnedAt: toDateInput(today),
            conditionOnReturn: "良好",
            accessoriesChecked: false,
            returnedById: handlers.some((h) => h.id === user.id) ? String(user.id) : String(handlers[0]?.id ?? ""),
            notes: "",
          }}
          devices={open.map((a) => ({
            value: a.device.id,
            label: `${a.device.assetNumber} ${a.device.name} (${a.employee.name})`,
            employee: `${a.employee.name} (${a.employee.employeeNumber})`,
            assignedAt: formatDate(a.assignedAt),
            expectedReturnAt: a.expectedReturnAt ? formatDate(a.expectedReturnAt) : "",
            overdue: !!a.expectedReturnAt && a.expectedReturnAt < today,
            notes: a.notes,
          }))}
          handlers={handlers.map((h) => ({ value: h.id, label: h.displayName }))}
        />
      )}
    </div>
  );
}
