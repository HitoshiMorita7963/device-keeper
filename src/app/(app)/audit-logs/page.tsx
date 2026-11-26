import type { Metadata } from "next";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AuditChanges } from "@/components/audit-changes";
import { EmptyState, Pager } from "@/components/list";
import { PageHeader } from "@/components/page-header";
import { SearchBar, SearchSelect, SearchText } from "@/components/search-bar";
import { requirePermission } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { formatDateTime } from "@/lib/dates";
import { actionLabel, AUDIT_ACTION_OPTIONS, AUDIT_ENTITY_OPTIONS, entityHref, entityLabel } from "@/lib/labels";
import { currentPage, pickParams } from "@/lib/pagination";
import { AUDIT_SEARCH_KEYS, searchAuditLogs } from "@/server/audit-logs";

export const metadata: Metadata = { title: "操作履歴" };

/** 操作履歴 (監査ログ)。閲覧のみで、変更・削除する手段は用意しない */
export default async function AuditLogsPage({ searchParams }: PageProps<"/audit-logs">) {
  await requirePermission("audit:read");
  const params = pickParams(await searchParams, AUDIT_SEARCH_KEYS);
  const [{ total, rows }, users] = await Promise.all([
    searchAuditLogs(params),
    db.user.findMany({ orderBy: { displayName: "asc" }, select: { id: true, displayName: true, email: true } }),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="操作履歴" description="登録・更新・貸出・返却・移動・廃棄・ログインなどの記録です。記録は変更・削除できません。" />

      <SearchBar action="/audit-logs">
        <div className="flex flex-col gap-1">
          <Label htmlFor="s-since" className="text-xs">
            日付 (から)
          </Label>
          <Input id="s-since" name="since" type="date" defaultValue={params.since} className="h-8 w-40" />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="s-until" className="text-xs">
            日付 (まで)
          </Label>
          <Input id="s-until" name="until" type="date" defaultValue={params.until} className="h-8 w-40" />
        </div>
        <SearchSelect name="user" label="操作者" defaultValue={params.user} options={users.map((u) => ({ value: u.id, label: u.displayName }))} />
        <SearchSelect name="action" label="操作" defaultValue={params.action} options={AUDIT_ACTION_OPTIONS} />
        <SearchSelect name="entity" label="対象" defaultValue={params.entity} options={AUDIT_ENTITY_OPTIONS} />
        <SearchText name="entityId" label="対象ID" defaultValue={params.entityId} className="w-full sm:w-28" />
      </SearchBar>

      <Card>
        <CardContent className="flex flex-col gap-3">
          {rows.length === 0 ? (
            <EmptyState>条件に一致する操作履歴はありません。</EmptyState>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-40">日時</TableHead>
                  <TableHead className="w-32">操作者</TableHead>
                  <TableHead className="w-28">操作</TableHead>
                  <TableHead className="w-32">対象</TableHead>
                  <TableHead>内容</TableHead>
                  <TableHead className="w-32">IPアドレス</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((log) => {
                  const href = entityHref(log.entityType, log.entityId);
                  return (
                    <TableRow key={log.id} className="align-top">
                      <TableCell className="tabular-nums">{formatDateTime(log.createdAt)}</TableCell>
                      <TableCell>{log.user?.displayName ?? "システム"}</TableCell>
                      <TableCell>{actionLabel(log.action)}</TableCell>
                      <TableCell>
                        {entityLabel(log.entityType)}
                        {log.entityId ? (
                          href ? (
                            <Link href={href} className="ml-1 text-primary hover:underline">
                              #{log.entityId}
                            </Link>
                          ) : (
                            <span className="ml-1 text-muted-foreground">#{log.entityId}</span>
                          )
                        ) : null}
                      </TableCell>
                      <TableCell className="whitespace-normal">
                        <AuditChanges before={log.beforeData} after={log.afterData} compact />
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">{log.ipAddress ?? "-"}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
          <Pager basePath="/audit-logs" params={params} page={currentPage(params)} total={total} />
        </CardContent>
      </Card>
    </div>
  );
}
