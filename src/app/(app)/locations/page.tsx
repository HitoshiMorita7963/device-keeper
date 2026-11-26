import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ActiveBadge, EmptyState, Pager } from "@/components/list";
import { PageHeader } from "@/components/page-header";
import { SearchBar, SearchSelect, SearchText } from "@/components/search-bar";
import { can } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/session";
import { currentPage, pickParams } from "@/lib/pagination";
import { searchLocations, type LocationSearch } from "@/server/locations";
import { locationCategoryMatrix } from "@/server/moves";
import { LocationMatrix } from "./location-matrix";

export const metadata: Metadata = { title: "拠点一覧" };

export default async function LocationsPage({ searchParams }: PageProps<"/locations">) {
  const user = await requirePermission("location:read");
  const params = pickParams(await searchParams, ["q", "active", "page"] as const);
  const [{ total, rows }, matrix] = await Promise.all([searchLocations(params as LocationSearch), locationCategoryMatrix()]);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="拠点一覧"
        actions={
          can(user.role, "location:write") ? (
            <Button asChild>
              <Link href="/locations/new">
                <Plus aria-hidden />
                新規登録
              </Link>
            </Button>
          ) : null
        }
      />

      <SearchBar action="/locations">
        <SearchText name="q" label="拠点コード・拠点名・住所" defaultValue={params.q} />
        <SearchSelect
          name="active"
          label="使用状態"
          defaultValue={params.active}
          options={[
            { value: "1", label: "使用中" },
            { value: "0", label: "使用停止" },
          ]}
        />
      </SearchBar>

      <Card>
        <CardContent className="flex flex-col gap-3">
          {rows.length === 0 ? (
            <EmptyState>条件に一致する拠点はありません。</EmptyState>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>拠点コード</TableHead>
                  <TableHead>拠点名</TableHead>
                  <TableHead>住所</TableHead>
                  <TableHead>拠点責任者</TableHead>
                  <TableHead>電話番号</TableHead>
                  <TableHead className="text-right">登録端末数</TableHead>
                  <TableHead>使用状態</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="font-mono">
                      <Link href={`/locations/${l.id}`} className="text-primary hover:underline">
                        {l.locationCode}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Link href={`/locations/${l.id}`} className="hover:underline">
                        {l.name}
                      </Link>
                    </TableCell>
                    <TableCell className="max-w-64 truncate">{l.address ?? "-"}</TableCell>
                    <TableCell>{l.managerName ?? "-"}</TableCell>
                    <TableCell>{l.phone ?? "-"}</TableCell>
                    <TableCell className="text-right tabular-nums">{l._count.devices}</TableCell>
                    <TableCell>
                      <ActiveBadge active={l.isActive} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <Pager basePath="/locations" params={params} page={currentPage(params)} total={total} />
        </CardContent>
      </Card>

      <LocationMatrix data={matrix} linkDevices={can(user.role, "device:read")} />
    </div>
  );
}
