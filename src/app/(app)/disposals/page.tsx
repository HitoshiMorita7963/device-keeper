import type { Metadata } from "next";
import Link from "next/link";
import { Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState, Pager } from "@/components/list";
import { PageHeader } from "@/components/page-header";
import { SearchBar, SearchText } from "@/components/search-bar";
import { requirePermission } from "@/lib/auth/session";
import { formatDate } from "@/lib/dates";
import { currentPage, pickParams } from "@/lib/pagination";
import { DISPOSAL_SEARCH_KEYS, searchDisposals } from "@/server/maintenance";

export const metadata: Metadata = { title: "廃棄管理" };

export default async function DisposalsPage({ searchParams }: PageProps<"/disposals">) {
  await requirePermission("disposal:write");
  const params = pickParams(await searchParams, DISPOSAL_SEARCH_KEYS);
  const { total, rows } = await searchDisposals(params);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="廃棄管理"
        description="廃棄履歴"
        actions={
          <Button asChild variant="destructive">
            <Link href="/disposals/new">
              <Trash2 aria-hidden />
              廃棄処理
            </Link>
          </Button>
        }
      />

      <SearchBar action="/disposals">
        <SearchText name="device" label="端末 (資産管理番号・名称)" defaultValue={params.device} />
        <div className="flex flex-col gap-1">
          <Label htmlFor="s-since" className="text-xs">
            廃棄日 (から)
          </Label>
          <Input id="s-since" name="since" type="date" defaultValue={params.since} className="h-8 w-40" />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="s-until" className="text-xs">
            廃棄日 (まで)
          </Label>
          <Input id="s-until" name="until" type="date" defaultValue={params.until} className="h-8 w-40" />
        </div>
      </SearchBar>

      <Card>
        <CardContent className="flex flex-col gap-3">
          {rows.length === 0 ? (
            <EmptyState>廃棄履歴はありません。</EmptyState>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>廃棄日</TableHead>
                  <TableHead>資産管理番号</TableHead>
                  <TableHead>資産名称</TableHead>
                  <TableHead>種別</TableHead>
                  <TableHead>廃棄理由</TableHead>
                  <TableHead>廃棄方法</TableHead>
                  <TableHead>廃棄業者</TableHead>
                  <TableHead>データ消去</TableHead>
                  <TableHead>処理者</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>{formatDate(r.disposedAt)}</TableCell>
                    <TableCell className="font-mono">
                      <Link href={`/devices/${r.device.id}`} className="text-primary hover:underline">
                        {r.device.assetNumber}
                      </Link>
                    </TableCell>
                    <TableCell className="max-w-40 truncate">{r.device.name}</TableCell>
                    <TableCell>{r.device.category.name}</TableCell>
                    <TableCell className="max-w-64 whitespace-normal">{r.disposalReason}</TableCell>
                    <TableCell>{r.disposalMethod ?? "-"}</TableCell>
                    <TableCell>{r.disposalVendor ?? "-"}</TableCell>
                    <TableCell>
                      {r.dataErasureConfirmed ? <Badge variant="secondary">消去済み</Badge> : <Badge variant="outline">不要</Badge>}
                    </TableCell>
                    <TableCell>{r.disposedBy?.displayName ?? "-"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <Pager basePath="/disposals" params={params} page={currentPage(params)} total={total} />
        </CardContent>
      </Card>
    </div>
  );
}
