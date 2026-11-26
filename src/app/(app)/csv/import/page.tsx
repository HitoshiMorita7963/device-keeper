import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { can } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/session";
import type { ImportTarget } from "@/lib/csv/fields";
import { categoryOptions } from "@/server/masters";
import { ImportWizard } from "./import-wizard";

export const metadata: Metadata = { title: "CSVインポート" };

export default async function CsvImportPage() {
  const user = await requirePermission("csv:import");
  const targets = (
    [
      ["devices", "device:write"],
      ["employees", "employee:write"],
      ["locations", "location:write"],
    ] as const
  )
    .filter(([, permission]) => can(user.role, permission))
    .map(([target]) => target as ImportTarget);

  const categories = await categoryOptions();

  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <PageHeader title="CSVインポート" description={<Link href="/csv" className="hover:underline">CSV管理</Link>} />
      <ImportWizard
        targets={targets}
        categories={categories.map((c) => ({ id: c.id, name: c.name }))}
        canAutoCreate={(["employee:write", "location:write", "master:write"] as const).every((p) => can(user.role, p))}
        canImportSecrets={can(user.role, "device:secret")}
      />
    </div>
  );
}
