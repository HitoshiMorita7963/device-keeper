import type { Metadata } from "next";
import Link from "next/link";
import { Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ActiveBadge, EmptyState } from "@/components/list";
import { PageHeader } from "@/components/page-header";
import { requirePermission } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { DepartmentDialog } from "./department-dialog";

export const metadata: Metadata = { title: "部署管理" };

export default async function DepartmentsPage() {
  await requirePermission("master:write");
  const departments = await db.department.findMany({
    orderBy: { departmentCode: "asc" },
    include: { _count: { select: { employees: { where: { employmentStatus: { not: "RETIRED" } } } } } },
  });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="部署管理"
        description={<Link href="/settings" className="hover:underline">システム設定</Link>}
        actions={
          <DepartmentDialog
            trigger={
              <Button>
                <Plus aria-hidden />
                新規登録
              </Button>
            }
          />
        }
      />
      <Card>
        <CardContent>
          {departments.length === 0 ? (
            <EmptyState>部署が登録されていません。</EmptyState>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>部署コード</TableHead>
                  <TableHead>部署名</TableHead>
                  <TableHead className="text-right">在籍社員数</TableHead>
                  <TableHead>状態</TableHead>
                  <TableHead className="w-20" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {departments.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell className="font-mono">{d.departmentCode}</TableCell>
                    <TableCell>{d.name}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      <Link href={`/employees?department=${d.id}`} className="hover:underline">
                        {d._count.employees}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <ActiveBadge active={d.isActive} />
                    </TableCell>
                    <TableCell>
                      <DepartmentDialog
                        department={d}
                        trigger={
                          <Button variant="ghost" size="sm">
                            <Pencil aria-hidden />
                            編集
                          </Button>
                        }
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
