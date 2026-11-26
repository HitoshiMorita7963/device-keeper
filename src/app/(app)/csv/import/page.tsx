import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { can } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/session";
import type { ImportTarget } from "@/lib/csv/fields";
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

  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <PageHeader title="CSVインポート" description={<Link href="/csv" className="hover:underline">CSV管理</Link>} />
      <ImportWizard targets={targets} />
    </div>
  );
}
