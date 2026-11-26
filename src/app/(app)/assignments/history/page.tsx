import type { Metadata } from "next";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Pager } from "@/components/list";
import { CsvExportButton } from "@/components/csv-export-button";
import { PageHeader } from "@/components/page-header";
import { SearchBar, SearchSelect, SearchText } from "@/components/search-bar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { can } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/session";
import { currentPage, pickParams } from "@/lib/pagination";
import { ASSIGNMENT_SEARCH_KEYS, DUE_SOON_DAYS, searchAssignments } from "@/server/assignments";
import { AssignmentTable } from "../assignment-table";

export const metadata: Metadata = { title: "貸出履歴" };

export default async function AssignmentHistoryPage({ searchParams }: PageProps<"/assignments/history">) {
  const user = await requirePermission("assignment:write");
  const params = pickParams(await searchParams, ASSIGNMENT_SEARCH_KEYS);
  const { total, rows } = await searchAssignments(params);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="貸出履歴"
        description={<Link href="/assignments" className="hover:underline">貸出・返却管理</Link>}
        actions={can(user.role, "csv:export") ? <CsvExportButton type="assignments" params={params} /> : null}
      />

      <SearchBar action="/assignments/history">
        <SearchText name="device" label="端末 (資産管理番号・名称)" defaultValue={params.device} />
        <SearchText name="employee" label="利用者 (氏名・社員番号)" defaultValue={params.employee} />
        <SearchSelect
          name="state"
          label="状態"
          defaultValue={params.state}
          options={[
            { value: "open", label: "貸出中" },
            { value: "overdue", label: "返却期限超過" },
            { value: "due", label: `返却予定 (${DUE_SOON_DAYS}日以内)` },
            { value: "returned", label: "返却済み" },
          ]}
        />
        <div className="flex flex-col gap-1">
          <Label htmlFor="s-from" className="text-xs">
            貸出日 (から)
          </Label>
          <Input id="s-from" name="from" type="date" defaultValue={params.from} className="h-8 w-40" />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="s-to" className="text-xs">
            貸出日 (まで)
          </Label>
          <Input id="s-to" name="to" type="date" defaultValue={params.to} className="h-8 w-40" />
        </div>
      </SearchBar>

      <Card>
        <CardContent className="flex flex-col gap-3">
          <AssignmentTable rows={rows} />
          <Pager basePath="/assignments/history" params={params} page={currentPage(params)} total={total} />
        </CardContent>
      </Card>
    </div>
  );
}
