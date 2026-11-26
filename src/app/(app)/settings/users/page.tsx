import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/list";
import { PageHeader } from "@/components/page-header";
import { ROLE_LABELS } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/session";
import { formatDateTime } from "@/lib/dates";
import { listUsers } from "@/server/users";

export const metadata: Metadata = { title: "利用者管理" };

export default async function UsersPage() {
  await requirePermission("user:manage");
  const users = await listUsers();
  const now = new Date();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="利用者管理"
        description={<Link href="/settings" className="hover:underline">システム設定</Link>}
        actions={
          <Button asChild>
            <Link href="/settings/users/new">
              <Plus aria-hidden />
              新規登録
            </Link>
          </Button>
        }
      />
      <Card>
        <CardContent>
          {users.length === 0 ? (
            <EmptyState>利用者が登録されていません。</EmptyState>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>表示名</TableHead>
                  <TableHead>メールアドレス</TableHead>
                  <TableHead>権限</TableHead>
                  <TableHead>社員</TableHead>
                  <TableHead>状態</TableHead>
                  <TableHead>最終ログイン</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell>
                      <Link href={`/settings/users/${u.id}`} className="text-primary hover:underline">
                        {u.displayName}
                      </Link>
                    </TableCell>
                    <TableCell>{u.email}</TableCell>
                    <TableCell>{ROLE_LABELS[u.role]}</TableCell>
                    <TableCell>{u.employee ? `${u.employee.employeeNumber} ${u.employee.name}` : "-"}</TableCell>
                    <TableCell className="space-x-1">
                      {u.isActive ? <Badge variant="secondary">有効</Badge> : <Badge variant="outline">無効</Badge>}
                      {u.lockedUntil && u.lockedUntil > now ? <Badge variant="destructive">ロック中</Badge> : null}
                    </TableCell>
                    <TableCell className="tabular-nums">{formatDateTime(u.lastLoginAt)}</TableCell>
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
