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
import { CategoryDialog } from "./category-dialog";

export const metadata: Metadata = { title: "資産種別管理" };

export default async function CategoriesPage() {
  await requirePermission("master:write");
  const categories = await db.deviceCategory.findMany({
    orderBy: { categoryCode: "asc" },
    include: {
      sequence: { select: { lastNumber: true } },
      _count: { select: { devices: { where: { deletedAt: null, status: { not: "DISPOSED" } } } } },
    },
  });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="資産種別管理"
        description={<Link href="/settings" className="hover:underline">システム設定</Link>}
        actions={
          <CategoryDialog
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
          {categories.length === 0 ? (
            <EmptyState>資産種別が登録されていません。</EmptyState>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>種別コード</TableHead>
                  <TableHead>種別名</TableHead>
                  <TableHead>採番形式</TableHead>
                  <TableHead>次の番号</TableHead>
                  <TableHead className="text-right">端末数</TableHead>
                  <TableHead>状態</TableHead>
                  <TableHead className="w-20" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {categories.map(({ sequence, _count, ...c }) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-mono">{c.categoryCode}</TableCell>
                    <TableCell>{c.name}</TableCell>
                    <TableCell className="font-mono">{`${c.prefix}-${"0".repeat(c.numberDigits)}`}</TableCell>
                    <TableCell className="font-mono">
                      {`${c.prefix}-${String((sequence?.lastNumber ?? 0) + 1).padStart(c.numberDigits, "0")}`}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{_count.devices}</TableCell>
                    <TableCell>
                      <ActiveBadge active={c.isActive} />
                    </TableCell>
                    <TableCell>
                      <CategoryDialog
                        category={{ id: c.id, categoryCode: c.categoryCode, name: c.name, prefix: c.prefix, numberDigits: c.numberDigits, isActive: c.isActive }}
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
