import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { requirePermission } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { idParam } from "@/lib/validation/common";
import { LocationForm } from "../../location-form";
import { toLocationInput } from "../../form-values";

export const metadata: Metadata = { title: "拠点編集" };

export default async function EditLocationPage({ params }: PageProps<"/locations/[id]/edit">) {
  await requirePermission("location:write");
  const id = idParam.safeParse((await params).id);
  const location = id.success ? await db.location.findUnique({ where: { id: id.data } }) : null;
  if (!location) notFound();

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader title="拠点編集" description={`${location.locationCode} ${location.name}`} />
      <LocationForm id={location.id} defaultValues={toLocationInput(location)} />
    </div>
  );
}
