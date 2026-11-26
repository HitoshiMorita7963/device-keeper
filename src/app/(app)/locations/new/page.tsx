import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { requirePermission } from "@/lib/auth/session";
import { LocationForm } from "../location-form";
import { toLocationInput } from "../form-values";

export const metadata: Metadata = { title: "拠点登録" };

export default async function NewLocationPage() {
  await requirePermission("location:write");
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader title="拠点登録" />
      <LocationForm defaultValues={toLocationInput()} />
    </div>
  );
}
