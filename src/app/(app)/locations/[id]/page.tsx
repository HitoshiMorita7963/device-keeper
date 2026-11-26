import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Pencil, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ActiveBadge, DetailList, DeviceStatusBadge, EmptyState } from "@/components/list";
import { PageHeader } from "@/components/page-header";
import { can } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/session";
import { formatDate } from "@/lib/dates";
import { idParam } from "@/lib/validation/common";
import { getLocationDetail } from "@/server/locations";

export const metadata: Metadata = { title: "拠点詳細" };

export default async function LocationDetailPage({ params }: PageProps<"/locations/[id]">) {
  const user = await requirePermission("location:read");
  const id = idParam.safeParse((await params).id);
  const detail = id.success ? await getLocationDetail(id.data) : null;
  if (!detail) notFound();
  const { location, devices, categorySummary, moves } = detail;
  const showDeviceLinks = can(user.role, "device:read");
  const canMove = can(user.role, "move:write");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={location.name}
        description={<Link href="/locations" className="hover:underline">拠点一覧</Link>}
        actions={
          <>
            {can(user.role, "move:write") ? (
              <Button asChild variant="outline">
                <Link href={`/moves?from=${location.id}`}>
                  <Truck aria-hidden />
                  この拠点からの移動履歴
                </Link>
              </Button>
            ) : null}
            {can(user.role, "location:write") ? (
              <Button asChild variant="outline">
                <Link href={`/locations/${location.id}/edit`}>
                  <Pencil aria-hidden />
                  編集
                </Link>
              </Button>
            ) : null}
          </>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">拠点基本情報</CardTitle>
        </CardHeader>
        <CardContent>
          <DetailList
            items={[
              { label: "拠点コード", value: <span className="font-mono">{location.locationCode}</span> },
              { label: "拠点名", value: location.name },
              { label: "使用状態", value: <ActiveBadge active={location.isActive} /> },
              { label: "住所", value: location.address },
              { label: "拠点責任者", value: location.managerName },
              { label: "電話番号", value: location.phone },
            ]}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">端末種別集計</CardTitle>
        </CardHeader>
        <CardContent>
          {categorySummary.length === 0 ? (
            <EmptyState>この拠点に端末はありません。</EmptyState>
          ) : (
            <ul className="flex flex-wrap gap-3">
              {categorySummary.map((c) => (
                <li key={c.id} className="rounded-lg border px-4 py-2 text-sm">
                  {c.name}
                  <span className="ml-3 font-semibold tabular-nums">{c.count}</span> 台
                </li>
              ))}
              <li className="rounded-lg border bg-muted/50 px-4 py-2 text-sm">
                合計<span className="ml-3 font-semibold tabular-nums">{devices.length}</span> 台
              </li>
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">所属端末一覧 ({devices.length}台)</CardTitle>
        </CardHeader>
        <CardContent>
          {devices.length === 0 ? (
            <EmptyState>この拠点に端末はありません。</EmptyState>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>資産管理番号</TableHead>
                  <TableHead>資産名称</TableHead>
                  <TableHead>種別</TableHead>
                  <TableHead>利用者</TableHead>
                  <TableHead>状態</TableHead>
                  {canMove ? <TableHead className="w-20" /> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {devices.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell className="font-mono">
                      {showDeviceLinks ? (
                        <Link href={`/devices/${d.id}`} className="text-primary hover:underline">
                          {d.assetNumber}
                        </Link>
                      ) : (
                        d.assetNumber
                      )}
                    </TableCell>
                    <TableCell>{d.name}</TableCell>
                    <TableCell>{d.category.name}</TableCell>
                    <TableCell>{d.currentEmployee?.name ?? "-"}</TableCell>
                    <TableCell>
                      <DeviceStatusBadge status={d.status} />
                    </TableCell>
                    {canMove ? (
                      <TableCell>
                        {d.status !== "LOST" ? (
                          <Button asChild size="sm" variant="ghost">
                            <Link href={`/moves/new?device=${d.id}`}>移動</Link>
                          </Button>
                        ) : null}
                      </TableCell>
                    ) : null}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">拠点間移動履歴 (直近50件)</CardTitle>
        </CardHeader>
        <CardContent>
          {moves.length === 0 ? (
            <EmptyState>移動履歴はありません。</EmptyState>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>移動日</TableHead>
                  <TableHead>端末</TableHead>
                  <TableHead>移動元</TableHead>
                  <TableHead>移動先</TableHead>
                  <TableHead>理由</TableHead>
                  <TableHead>担当者</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {moves.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell>{formatDate(m.movedAt)}</TableCell>
                    <TableCell>
                      <span className="font-mono">{m.device.assetNumber}</span> {m.device.name}
                    </TableCell>
                    <TableCell>{m.fromLocation?.name ?? "-"}</TableCell>
                    <TableCell>{m.toLocation.name}</TableCell>
                    <TableCell className="max-w-64 truncate">{m.reason ?? "-"}</TableCell>
                    <TableCell>{m.movedBy?.displayName ?? "-"}</TableCell>
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
