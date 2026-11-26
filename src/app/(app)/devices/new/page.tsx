import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { requirePermission } from "@/lib/auth/session";
import { locationOptions } from "@/server/masters";
import { DeviceCreateForm } from "../device-form";
import { categoryOptionsWithNextNumber, emptyDeviceInput } from "../form-values";

export const metadata: Metadata = { title: "端末登録" };

export default async function NewDevicePage({ searchParams }: PageProps<"/devices/new">) {
  await requirePermission("device:write");
  const { location } = await searchParams;
  const [categories, locations] = await Promise.all([categoryOptionsWithNextNumber(), locationOptions()]);
  const initialLocation = locations.find((l) => String(l.id) === location)?.id ?? (locations.length === 1 ? locations[0].id : null);

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <PageHeader title="端末登録" />
      {locations.length === 0 || categories.length === 0 ? (
        <p className="text-sm text-destructive">
          端末を登録するには、先に{locations.length === 0 ? "拠点" : "資産種別"}を登録してください。
        </p>
      ) : (
        <DeviceCreateForm
          defaultValues={emptyDeviceInput(initialLocation)}
          categories={categories}
          locations={locations.map((l) => ({ value: l.id, label: l.name }))}
        />
      )}
    </div>
  );
}
