import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { requirePermission } from "@/lib/auth/session";
import { todayJst, toDateInput } from "@/lib/dates";
import { DEVICE_STATUS_LABELS } from "@/lib/labels";
import { pickParams } from "@/lib/pagination";
import { maintainableDevices } from "@/server/maintenance";
import { MaintenanceCreateForm } from "../maintenance-forms";

export const metadata: Metadata = { title: "修理登録" };

export default async function NewMaintenancePage({ searchParams }: PageProps<"/maintenance/new">) {
  await requirePermission("maintenance:write");
  const params = pickParams(await searchParams, ["device", "from"] as const);
  const devices = await maintainableDevices();
  const deviceOk = devices.some((d) => String(d.id) === params.device);
  const returnTo = params.from === "device" && deviceOk ? `/devices/${params.device}` : undefined;

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader title="修理登録" description={<Link href="/maintenance" className="hover:underline">修理・故障管理</Link>} />
      {params.device && !deviceOk ? <p className="text-sm text-destructive">指定された端末は修理登録できない状態です。</p> : null}
      <MaintenanceCreateForm
        returnTo={returnTo}
        defaultValues={{
          deviceId: deviceOk ? params.device! : "",
          reportedAt: toDateInput(todayJst()),
          problemDescription: "",
          repairVendor: "",
          repairCost: "",
          status: "REPORTED",
          notes: "",
        }}
        devices={devices.map((d) => ({ value: d.id, label: `${d.assetNumber} ${d.name} (${DEVICE_STATUS_LABELS[d.status]})` }))}
      />
    </div>
  );
}
