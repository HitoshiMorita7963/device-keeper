import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmploymentStatusBadge, EmptyState, Pager } from "@/components/list";
import { CsvExportButton } from "@/components/csv-export-button";
import { PageHeader } from "@/components/page-header";
import { SearchBar, SearchSelect, SearchText } from "@/components/search-bar";
import { can } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { EMPLOYMENT_STATUS_LABELS } from "@/lib/labels";
import { currentPage, pickParams } from "@/lib/pagination";
import { searchEmployees } from "@/server/employees";

export const metadata: Metadata = { title: "社員一覧" };

export default async function EmployeesPage({ searchParams }: PageProps<"/employees">) {
  const user = await requirePermission("employee:read");
  const params = pickParams(await searchParams, ["q", "department", "location", "status", "page"] as const);
  const [{ total, rows }, departments, locations] = await Promise.all([
    searchEmployees(params),
    db.department.findMany({ orderBy: { departmentCode: "asc" }, select: { id: true, name: true } }),
    db.location.findMany({ orderBy: { locationCode: "asc" }, select: { id: true, name: true } }),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="社員一覧"
        actions={
          <>
            {can(user.role, "csv:export") ? <CsvExportButton type="employees" params={params} /> : null}
            {can(user.role, "employee:write") ? (
              <Button asChild>
                <Link href="/employees/new">
                  <Plus aria-hidden />
                  新規登録
                </Link>
              </Button>
            ) : null}
          </>
        }
      />

      <SearchBar action="/employees">
        <SearchText name="q" label="社員番号・氏名・メールアドレス" defaultValue={params.q} />
        <SearchSelect name="department" label="部署" defaultValue={params.department} options={departments.map((d) => ({ value: d.id, label: d.name }))} />
        <SearchSelect name="location" label="所属拠点" defaultValue={params.location} options={locations.map((l) => ({ value: l.id, label: l.name }))} />
        <SearchSelect
          name="status"
          label="在籍状態"
          defaultValue={params.status}
          emptyLabel="在籍・休職"
          options={[
            { value: "ACTIVE", label: EMPLOYMENT_STATUS_LABELS.ACTIVE },
            { value: "ON_LEAVE", label: EMPLOYMENT_STATUS_LABELS.ON_LEAVE },
            { value: "RETIRED", label: EMPLOYMENT_STATUS_LABELS.RETIRED },
            { value: "all", label: "すべて (退職者を含む)" },
          ]}
        />
      </SearchBar>

      <Card>
        <CardContent className="flex flex-col gap-3">
          {rows.length === 0 ? (
            <EmptyState>条件に一致する社員はいません。</EmptyState>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>社員番号</TableHead>
                  <TableHead>氏名</TableHead>
                  <TableHead>メールアドレス</TableHead>
                  <TableHead>部署</TableHead>
                  <TableHead>所属拠点</TableHead>
                  <TableHead>在籍状態</TableHead>
                  <TableHead className="text-right">貸与端末数</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="font-mono">
                      <Link href={`/employees/${e.id}`} className="text-primary hover:underline">
                        {e.employeeNumber}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Link href={`/employees/${e.id}`} className="hover:underline">
                        {e.name}
                      </Link>
                    </TableCell>
                    <TableCell>{e.email ?? "-"}</TableCell>
                    <TableCell>{e.department?.name ?? "-"}</TableCell>
                    <TableCell>{e.homeLocation?.name ?? "-"}</TableCell>
                    <TableCell>
                      <EmploymentStatusBadge status={e.employmentStatus} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{e._count.assignments}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <Pager basePath="/employees" params={params} page={currentPage(params)} total={total} />
        </CardContent>
      </Card>
    </div>
  );
}
