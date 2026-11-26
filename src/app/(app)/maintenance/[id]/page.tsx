import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DetailList, DeviceStatusBadge } from "@/components/list";
import { PageHeader } from "@/components/page-header";
import { requirePermission } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { formatDate, formatDateTime, toDateInput } from "@/lib/dates";
import { DEVICE_STATUS_LABELS, MAINTENANCE_STATUS_LABELS } from "@/lib/labels";
import { idParam } from "@/lib/validation/common";
import { OPEN_MAINTENANCE } from "@/server/maintenance";
import { MaintenanceUpdateForm } from "../maintenance-forms";

export const metadata: Metadata = { title: "修理記録" };

export default async function MaintenanceDetailPage({ params }: PageProps<"/maintenance/[id]">) {
  await requirePermission("maintenance:write");
  const id = idParam.safeParse((await params).id);
  const record = id.success
    ? await db.maintenanceRecord.findUnique({ where: { id: id.data }, include: { device: { include: { category: true } } } })
    : null;
  if (!record) notFound();
  const closed = !OPEN_MAINTENANCE.includes(record.status);
  const deviceLabel = `${record.device.assetNumber} ${record.device.name}`;

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <PageHeader
        title={`修理記録: ${deviceLabel}`}
        description={<Link href="/maintenance" className="hover:underline">修理・故障管理</Link>}
      />
      <Card>
        <CardHeader>
          <CardTitle className="text-base">受付内容</CardTitle>
        </CardHeader>
        <CardContent>
          <DetailList
            items={[
              {
                label: "端末",
                value: (
                  <Link href={`/devices/${record.device.id}`} className="text-primary hover:underline">
                    {deviceLabel}
                  </Link>
                ),
              },
              { label: "資産種別", value: record.device.category.name },
              { label: "現在の端末状態", value: <DeviceStatusBadge status={record.device.status} /> },
              { label: "受付日", value: formatDate(record.reportedAt) },
              { label: "対応状況", value: MAINTENANCE_STATUS_LABELS[record.status] },
              { label: "受付前の端末状態", value: record.previousDeviceStatus ? DEVICE_STATUS_LABELS[record.previousDeviceStatus] : "-" },
              { label: "登録日時", value: formatDateTime(record.createdAt) },
              { label: "更新日時", value: formatDateTime(record.updatedAt) },
            ]}
          />
        </CardContent>
      </Card>
      <MaintenanceUpdateForm
        closed={closed}
        deviceLabel={deviceLabel}
        defaultValues={{
          id: String(record.id),
          status: record.status,
          repairedAt: toDateInput(record.repairedAt),
          problemDescription: record.problemDescription,
          repairVendor: record.repairVendor ?? "",
          repairCost: record.repairCost === null ? "" : String(record.repairCost),
          notes: record.notes ?? "",
        }}
      />
    </div>
  );
}
