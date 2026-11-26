import type { Metadata } from "next";
import Link from "next/link";
import { ArrowDownToLine, ArrowUpFromLine, History } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Pager } from "@/components/list";
import { PageHeader } from "@/components/page-header";
import { requirePermission } from "@/lib/auth/session";
import { currentPage, pickParams } from "@/lib/pagination";
import { cn } from "@/lib/utils";
import { assignmentSummary, DUE_SOON_DAYS, searchAssignments } from "@/server/assignments";
import { AssignmentTable } from "./assignment-table";

export const metadata: Metadata = { title: "貸出・返却管理" };

const FILTERS = [
  { state: "open", label: "貸出中" },
  { state: "overdue", label: "返却期限超過" },
  { state: "due", label: `返却予定 (${DUE_SOON_DAYS}日以内)` },
] as const;

export default async function AssignmentsPage({ searchParams }: PageProps<"/assignments">) {
  await requirePermission("assignment:write");
  const params = pickParams(await searchParams, ["state", "page"] as const);
  const state = FILTERS.some((f) => f.state === params.state) ? params.state! : "open";
  const [summary, { total, rows }] = await Promise.all([assignmentSummary(), searchAssignments({ ...params, state })]);
  const counts: Record<string, number> = { open: summary.open, overdue: summary.overdue, due: summary.due };

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="貸出・返却管理"
        actions={
          <>
            <Button asChild>
              <Link href="/assignments/new">
                <ArrowUpFromLine aria-hidden />
                貸出登録
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/assignments/return">
                <ArrowDownToLine aria-hidden />
                返却処理
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/assignments/history">
                <History aria-hidden />
                貸出履歴
              </Link>
            </Button>
          </>
        }
      />

      <nav className="grid gap-3 sm:grid-cols-3" aria-label="表示切り替え">
        {FILTERS.map((f) => (
          <Link key={f.state} href={f.state === "open" ? "/assignments" : `/assignments?state=${f.state}`} aria-current={state === f.state ? "page" : undefined}>
            <Card className={cn("transition-colors hover:bg-muted/50", state === f.state && "ring-2 ring-primary")}>
              <CardHeader className="pb-1">
                <CardTitle className="text-xs font-medium text-muted-foreground">{f.label}</CardTitle>
              </CardHeader>
              <CardContent>
                <span className={cn("text-2xl font-semibold tabular-nums", f.state === "overdue" && counts[f.state] > 0 && "text-destructive")}>
                  {counts[f.state]}
                </span>
                <span className="ml-1 text-sm text-muted-foreground">件</span>
              </CardContent>
            </Card>
          </Link>
        ))}
      </nav>

      <Card>
        <CardContent className="flex flex-col gap-3">
          <AssignmentTable rows={rows} showReturnButton />
          <Pager basePath="/assignments" params={{ ...params, state: state === "open" ? undefined : state }} page={currentPage(params)} total={total} />
        </CardContent>
      </Card>
    </div>
  );
}
