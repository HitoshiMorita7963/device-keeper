import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { requirePermission } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { DEVICE_STATUS_LABELS } from "@/lib/labels";
import { idParam } from "@/lib/validation/common";
import { DeviceEditForm } from "../../device-form";
import { categoryOptionsWithNextNumber, toDeviceUpdateInput } from "../../form-values";

export const metadata: Metadata = { title: "端末編集" };

export default async function EditDevicePage({ params }: PageProps<"/devices/[id]/edit">) {
  await requirePermission("device:write");
  const id = idParam.safeParse((await params).id);
  const device = id.success
    ? await db.device.findFirst({ where: { id: id.data, deletedAt: null }, include: { currentLocation: true } })
    : null;
  if (!device) notFound();
  // 廃棄済み端末は通常の編集対象から除外する (データ整合性ルール7)
  if (device.status === "DISPOSED") redirect(`/devices/${device.id}`);

  const categories = await categoryOptionsWithNextNumber(device.categoryId);
  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <PageHeader title="端末編集" description={`${device.assetNumber} ${device.name}`} />
      <DeviceEditForm
        defaultValues={toDeviceUpdateInput(device)}
        categories={categories}
        locationName={device.currentLocation.name}
        statusLabel={DEVICE_STATUS_LABELS[device.status]}
      />
    </div>
  );
}
