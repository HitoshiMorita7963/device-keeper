import type { Metadata } from "next";
import Link from "next/link";
import { Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState, Pager } from "@/components/list";
import { PageHeader } from "@/components/page-header";
import { SearchBar, SearchSelect, SearchText } from "@/components/search-bar";
import { requirePermission } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { formatDate } from "@/lib/dates";
import { currentPage, pickParams } from "@/lib/pagination";
import { MOVE_SEARCH_KEYS, searchMoves } from "@/server/moves";

export const metadata: Metadata = { title: "拠点間移動" };

export default async function MovesPage({ searchParams }: PageProps<"/moves">) {
  await requirePermission("move:write");
  const params = pickParams(await searchParams, MOVE_SEARCH_KEYS);
  const [{ total, rows }, locations] = await Promise.all([
    searchMoves(params),
    db.location.findMany({ orderBy: { locationCode: "asc" }, select: { id: true, name: true } }),
  ]);
  const locationOptions = locations.map((l) => ({ value: l.id, label: l.name }));

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="拠点間移動"
        description="移動履歴"
        actions={
          <Button asChild>
            <Link href="/moves/new">
              <Truck aria-hidden />
              移動登録
            </Link>
          </Button>
        }
      />

      <SearchBar action="/moves">
        <SearchText name="device" label="端末 (資産管理番号・名称)" defaultValue={params.device} />
        <SearchSelect name="from" label="移動元" defaultValue={params.from} options={locationOptions} />
        <SearchSelect name="to" label="移動先" defaultValue={params.to} options={locationOptions} />
        <div className="flex flex-col gap-1">
          <Label htmlFor="s-since" className="text-xs">
            移動日 (から)
          </Label>
          <Input id="s-since" name="since" type="date" defaultValue={params.since} className="h-8 w-40" />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="s-until" className="text-xs">
            移動日 (まで)
          </Label>
          <Input id="s-until" name="until" type="date" defaultValue={params.until} className="h-8 w-40" />
        </div>
      </SearchBar>

      <Card>
        <CardContent className="flex flex-col gap-3">
          {rows.length === 0 ? (
            <EmptyState>該当する移動履歴はありません。</EmptyState>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>移動日</TableHead>
                  <TableHead>資産管理番号</TableHead>
                  <TableHead>資産名称</TableHead>
                  <TableHead>移動元</TableHead>
                  <TableHead>移動先</TableHead>
                  <TableHead>移動理由</TableHead>
                  <TableHead>担当者</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell>{formatDate(m.movedAt)}</TableCell>
                    <TableCell className="font-mono">
                      <Link href={`/devices/${m.device.id}`} className="text-primary hover:underline">
                        {m.device.assetNumber}
                      </Link>
                    </TableCell>
                    <TableCell className="max-w-48 truncate">{m.device.name}</TableCell>
                    <TableCell>
                      {m.fromLocation ? (
                        <Link href={`/locations/${m.fromLocation.id}`} className="hover:underline">
                          {m.fromLocation.name}
                        </Link>
                      ) : (
                        "-"
                      )}
                    </TableCell>
                    <TableCell>
                      <Link href={`/locations/${m.toLocation.id}`} className="hover:underline">
                        {m.toLocation.name}
                      </Link>
                    </TableCell>
                    <TableCell className="max-w-72 whitespace-normal">{m.reason ?? "-"}</TableCell>
                    <TableCell>{m.movedBy?.displayName ?? "-"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <Pager basePath="/moves" params={params} page={currentPage(params)} total={total} />
        </CardContent>
      </Card>
    </div>
  );
}
