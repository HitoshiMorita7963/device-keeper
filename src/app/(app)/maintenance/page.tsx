import type { Metadata } from "next";
import Link from "next/link";
import { Wrench } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState, Pager } from "@/components/list";
import { PageHeader } from "@/components/page-header";
import { SearchBar, SearchSelect, SearchText } from "@/components/search-bar";
import { requirePermission } from "@/lib/auth/session";
import { formatDate } from "@/lib/dates";
import { MAINTENANCE_STATUS_LABELS } from "@/lib/labels";
import { currentPage, pickParams } from "@/lib/pagination";
import { MAINTENANCE_SEARCH_KEYS, OPEN_MAINTENANCE, searchMaintenance } from "@/server/maintenance";

export const metadata: Metadata = { title: "修理・故障管理" };

const yen = (n: number | null) => (n === null ? "-" : `${n.toLocaleString("ja-JP")} 円`);

export default async function MaintenancePage({ searchParams }: PageProps<"/maintenance">) {
  await requirePermission("maintenance:write");
  const params = pickParams(await searchParams, MAINTENANCE_SEARCH_KEYS);
  const { total, rows, totalCost } = await searchMaintenance(params);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="修理・故障管理"
        description={params.status === "all" ? "修理履歴 (すべて)" : params.status ? `修理履歴 (${MAINTENANCE_STATUS_LABELS[params.status as keyof typeof MAINTENANCE_STATUS_LABELS] ?? ""})` : "対応中の修理"}
        actions={
          <Button asChild>
            <Link href="/maintenance/new">
              <Wrench aria-hidden />
              修理登録
            </Link>
          </Button>
        }
      />

      <SearchBar action="/maintenance">
        <SearchText name="device" label="端末 (資産管理番号・名称)" defaultValue={params.device} />
        <SearchText name="vendor" label="修理業者" defaultValue={params.vendor} className="w-full sm:w-40" />
        <SearchSelect
          name="status"
          label="対応状況"
          defaultValue={params.status}
          emptyLabel="対応中 (受付・修理中)"
          options={[
            ...(["REPORTED", "IN_PROGRESS", "COMPLETED", "CANCELLED"] as const).map((s) => ({ value: s, label: MAINTENANCE_STATUS_LABELS[s] })),
            { value: "all", label: "すべて" },
          ]}
        />
        <div className="flex flex-col gap-1">
          <Label htmlFor="s-since" className="text-xs">
            受付日 (から)
          </Label>
          <Input id="s-since" name="since" type="date" defaultValue={params.since} className="h-8 w-40" />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="s-until" className="text-xs">
            受付日 (まで)
          </Label>
          <Input id="s-until" name="until" type="date" defaultValue={params.until} className="h-8 w-40" />
        </div>
      </SearchBar>

      <Card>
        <CardContent className="flex flex-col gap-3">
          {rows.length === 0 ? (
            <EmptyState>該当する修理記録はありません。</EmptyState>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>受付日</TableHead>
                  <TableHead>資産管理番号</TableHead>
                  <TableHead>資産名称</TableHead>
                  <TableHead>故障内容</TableHead>
                  <TableHead>修理業者</TableHead>
                  <TableHead className="text-right">修理費用</TableHead>
                  <TableHead>修理完了日</TableHead>
                  <TableHead>対応状況</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell>
                      <Link href={`/maintenance/${m.id}`} className="text-primary hover:underline">
                        {formatDate(m.reportedAt)}
                      </Link>
                    </TableCell>
                    <TableCell className="font-mono">
                      <Link href={`/devices/${m.device.id}`} className="hover:underline">
                        {m.device.assetNumber}
                      </Link>
                    </TableCell>
                    <TableCell className="max-w-40 truncate">{m.device.name}</TableCell>
                    <TableCell className="max-w-72 truncate">
                      <Link href={`/maintenance/${m.id}`} className="hover:underline">
                        {m.problemDescription}
                      </Link>
                    </TableCell>
                    <TableCell>{m.repairVendor ?? "-"}</TableCell>
                    <TableCell className="text-right tabular-nums">{yen(m.repairCost)}</TableCell>
                    <TableCell>{formatDate(m.repairedAt)}</TableCell>
                    <TableCell>
                      <Badge variant={OPEN_MAINTENANCE.includes(m.status) ? "default" : m.status === "COMPLETED" ? "secondary" : "outline"}>
                        {MAINTENANCE_STATUS_LABELS[m.status]}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm text-muted-foreground">
              修理費用の合計 (条件に一致するすべての記録): <span className="font-medium text-foreground tabular-nums">{yen(totalCost)}</span>
            </span>
          </div>
          <Pager basePath="/maintenance" params={params} page={currentPage(params)} total={total} />
        </CardContent>
      </Card>
    </div>
  );
}
