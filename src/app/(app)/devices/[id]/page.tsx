import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowDownToLine, ArrowUpFromLine, Pencil, Trash2, Truck, Wrench } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AuditChanges } from "@/components/audit-changes";
import { DetailList, DeviceStatusBadge, EmptyState } from "@/components/list";
import { PageHeader } from "@/components/page-header";
import { can } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/session";
import { formatDate, formatDateTime, todayJst } from "@/lib/dates";
import { actionLabel, MAINTENANCE_STATUS_LABELS } from "@/lib/labels";
import { idParam } from "@/lib/validation/common";
import { getDeviceDetail } from "@/server/devices";
import { OPEN_MAINTENANCE } from "@/server/maintenance";
import { DeleteDeviceDialog, StatusChangeDialog } from "./device-dialogs";

export const metadata: Metadata = { title: "端末詳細" };

const yen = (n: number | null) => (n === null ? "-" : `${n.toLocaleString("ja-JP")} 円`);

export default async function DeviceDetailPage({ params }: PageProps<"/devices/[id]">) {
  const user = await requirePermission("device:read");
  const id = idParam.safeParse((await params).id);
  const detail = id.success ? await getDeviceDetail(id.data) : null;
  if (!detail) notFound();
  const { device, currentAssignment, assignments, moves, maintenance, logs } = detail;
  const today = todayJst();
  const disposed = device.status === "DISPOSED";
  const canWrite = can(user.role, "device:write") && !disposed;
  const hasHistory = assignments.length + moves.length + maintenance.length > 0;
  const canAssign = can(user.role, "assignment:write") && !disposed;
  const openMaintenance = maintenance.find((m) => OPEN_MAINTENANCE.includes(m.status));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={device.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Link href="/devices" className="hover:underline">
              端末一覧
            </Link>
            <span aria-hidden>/</span>
            <span className="font-mono">{device.assetNumber}</span>
            <DeviceStatusBadge status={device.status} />
          </span>
        }
        actions={
          <>
            {canAssign && device.status === "IN_STOCK" ? (
              <Button asChild>
                <Link href={`/assignments/new?device=${device.id}&from=device`}>
                  <ArrowUpFromLine aria-hidden />
                  貸出
                </Link>
              </Button>
            ) : null}
            {canAssign && currentAssignment ? (
              <Button asChild>
                <Link href={`/assignments/return?device=${device.id}&from=device`}>
                  <ArrowDownToLine aria-hidden />
                  返却
                </Link>
              </Button>
            ) : null}
            {can(user.role, "move:write") && !disposed && device.status !== "LOST" ? (
              <Button asChild variant="outline">
                <Link href={`/moves/new?device=${device.id}&from=device`}>
                  <Truck aria-hidden />
                  拠点移動
                </Link>
              </Button>
            ) : null}
            {can(user.role, "maintenance:write") && openMaintenance ? (
              <Button asChild variant="outline">
                <Link href={`/maintenance/${openMaintenance.id}`}>
                  <Wrench aria-hidden />
                  修理対応中の記録
                </Link>
              </Button>
            ) : can(user.role, "maintenance:write") && !disposed && device.status !== "LOST" ? (
              <Button asChild variant="outline">
                <Link href={`/maintenance/new?device=${device.id}&from=device`}>
                  <Wrench aria-hidden />
                  修理登録
                </Link>
              </Button>
            ) : null}
            {canWrite ? (
              <>
                <Button asChild variant="outline">
                  <Link href={`/devices/${device.id}/edit`}>
                    <Pencil aria-hidden />
                    編集
                  </Link>
                </Button>
                <StatusChangeDialog
                  deviceId={device.id}
                  status={device.status}
                  hasOpenAssignment={!!currentAssignment}
                  hasOpenMaintenance={!!openMaintenance}
                />
                {!hasHistory ? <DeleteDeviceDialog deviceId={device.id} assetNumber={device.assetNumber} /> : null}
              </>
            ) : null}
            {can(user.role, "disposal:write") && !disposed && !currentAssignment && !openMaintenance ? (
              <Button asChild variant="destructive">
                <Link href={`/disposals/new?device=${device.id}&from=device`}>
                  <Trash2 aria-hidden />
                  廃棄
                </Link>
              </Button>
            ) : null}
          </>
        }
      />

      {disposed && device.disposal ? (
        <Alert>
          <AlertTitle>この端末は廃棄済みです</AlertTitle>
          <AlertDescription>
            {formatDate(device.disposal.disposedAt)} に廃棄 (理由: {device.disposal.disposalReason} / 方法: {device.disposal.disposalMethod ?? "-"} / データ消去: {device.disposal.dataErasureConfirmed ? "消去済み" : "不要"} / 処理者: {device.disposal.disposedBy?.displayName ?? "-"})。履歴の閲覧のみ可能です。
          </AlertDescription>
        </Alert>
      ) : null}

      <Tabs defaultValue="basic">
        <TabsList className="h-auto flex-wrap">
          <TabsTrigger value="basic">基本情報</TabsTrigger>
          <TabsTrigger value="assignment">貸与情報</TabsTrigger>
          <TabsTrigger value="assignments">貸出履歴 ({assignments.length})</TabsTrigger>
          <TabsTrigger value="moves">拠点移動履歴 ({moves.length})</TabsTrigger>
          <TabsTrigger value="maintenance">修理履歴 ({maintenance.length})</TabsTrigger>
          <TabsTrigger value="logs">操作履歴</TabsTrigger>
        </TabsList>

        <TabsContent value="basic">
          <Card>
            <CardContent>
              <DetailList
                items={[
                  { label: "資産管理番号", value: <span className="font-mono">{device.assetNumber}</span> },
                  { label: "資産名称", value: device.name },
                  { label: "資産種別", value: device.category.name },
                  { label: "メーカー", value: device.manufacturer },
                  { label: "型番", value: device.model },
                  { label: "シリアル番号", value: device.serialNumber && <span className="font-mono">{device.serialNumber}</span> },
                  { label: "OS", value: device.osName },
                  { label: "OSバージョン", value: device.osVersion },
                  { label: "現在拠点", value: <Link href={`/locations/${device.currentLocation.id}`} className="hover:underline">{device.currentLocation.name}</Link> },
                  { label: "端末状態", value: <DeviceStatusBadge status={device.status} /> },
                  { label: "購入日", value: formatDate(device.purchaseDate) },
                  { label: "購入金額", value: yen(device.purchasePrice) },
                  { label: "購入先", value: device.purchaseVendor },
                  {
                    label: "保証期限",
                    value: (
                      <span className="flex items-center gap-2">
                        {formatDate(device.warrantyExpiry)}
                        {device.warrantyExpiry && device.warrantyExpiry < today && !disposed ? <Badge variant="destructive">期限切れ</Badge> : null}
                      </span>
                    ),
                  },
                  { label: "登録日時", value: formatDateTime(device.createdAt) },
                  { label: "更新日時", value: formatDateTime(device.updatedAt) },
                ]}
              />
              {device.notes ? (
                <div className="mt-4 border-t pt-4">
                  <div className="text-xs text-muted-foreground">備考</div>
                  <p className="mt-1 whitespace-pre-wrap text-sm">{device.notes}</p>
                </div>
              ) : null}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="assignment">
          <Card>
            <CardContent>
              {currentAssignment ? (
                <DetailList
                  items={[
                    {
                      label: "現在の利用者",
                      value: (
                        <Link href={`/employees/${currentAssignment.employee.id}`} className="hover:underline">
                          {currentAssignment.employee.name} ({currentAssignment.employee.employeeNumber})
                        </Link>
                      ),
                    },
                    { label: "所属部署", value: device.currentEmployee?.department?.name },
                    { label: "貸出日", value: formatDate(currentAssignment.assignedAt) },
                    {
                      label: "返却予定日",
                      value: (
                        <span className="flex items-center gap-2">
                          {formatDate(currentAssignment.expectedReturnAt)}
                          {currentAssignment.expectedReturnAt && currentAssignment.expectedReturnAt < today ? (
                            <Badge variant="destructive">期限超過</Badge>
                          ) : null}
                        </span>
                      ),
                    },
                    { label: "貸出担当者", value: currentAssignment.assignedBy?.displayName },
                    { label: "備考", value: currentAssignment.notes },
                  ]}
                />
              ) : (
                <EmptyState>現在貸出されていません。</EmptyState>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="assignments">
          <Card>
            <CardContent>
              {assignments.length === 0 ? (
                <EmptyState>貸出履歴はありません。</EmptyState>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>利用者</TableHead>
                      <TableHead>貸出日</TableHead>
                      <TableHead>返却予定日</TableHead>
                      <TableHead>返却日</TableHead>
                      <TableHead>返却時状態</TableHead>
                      <TableHead>貸出担当</TableHead>
                      <TableHead>返却担当</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {assignments.map((a) => (
                      <TableRow key={a.id}>
                        <TableCell>
                          <Link href={`/employees/${a.employee.id}`} className="hover:underline">
                            {a.employee.name}
                          </Link>
                        </TableCell>
                        <TableCell>{formatDate(a.assignedAt)}</TableCell>
                        <TableCell>{formatDate(a.expectedReturnAt)}</TableCell>
                        <TableCell>{a.returnedAt ? formatDate(a.returnedAt) : <Badge variant="secondary">貸出中</Badge>}</TableCell>
                        <TableCell>{a.conditionOnReturn ?? "-"}</TableCell>
                        <TableCell>{a.assignedBy?.displayName ?? "-"}</TableCell>
                        <TableCell>{a.returnedBy?.displayName ?? "-"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="moves">
          <Card>
            <CardContent>
              {moves.length === 0 ? (
                <EmptyState>拠点移動履歴はありません。</EmptyState>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>移動日</TableHead>
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
                        <TableCell>{m.fromLocation?.name ?? "-"}</TableCell>
                        <TableCell>{m.toLocation.name}</TableCell>
                        <TableCell className="max-w-72 whitespace-normal">{m.reason ?? "-"}</TableCell>
                        <TableCell>{m.movedBy?.displayName ?? "-"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="maintenance">
          <Card>
            <CardContent>
              {maintenance.length === 0 ? (
                <EmptyState>修理履歴はありません。</EmptyState>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>受付日</TableHead>
                      <TableHead>故障内容</TableHead>
                      <TableHead>修理業者</TableHead>
                      <TableHead className="text-right">修理費用</TableHead>
                      <TableHead>修理完了日</TableHead>
                      <TableHead>状況</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {maintenance.map((m) => (
                      <TableRow key={m.id}>
                        <TableCell>
                          {can(user.role, "maintenance:write") ? (
                            <Link href={`/maintenance/${m.id}`} className="text-primary hover:underline">
                              {formatDate(m.reportedAt)}
                            </Link>
                          ) : (
                            formatDate(m.reportedAt)
                          )}
                        </TableCell>
                        <TableCell className="max-w-72 whitespace-normal">{m.problemDescription}</TableCell>
                        <TableCell>{m.repairVendor ?? "-"}</TableCell>
                        <TableCell className="text-right tabular-nums">{yen(m.repairCost)}</TableCell>
                        <TableCell>{formatDate(m.repairedAt)}</TableCell>
                        <TableCell>{MAINTENANCE_STATUS_LABELS[m.status]}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="logs">
          <Card>
            <CardContent>
              {logs.length === 0 ? (
                <EmptyState>操作履歴はありません。</EmptyState>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-40">日時</TableHead>
                      <TableHead className="w-28">操作</TableHead>
                      <TableHead className="w-32">操作者</TableHead>
                      <TableHead>内容</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {logs.map((log) => (
                      <TableRow key={log.id} className="align-top">
                        <TableCell className="tabular-nums">{formatDateTime(log.createdAt)}</TableCell>
                        <TableCell>{actionLabel(log.action)}</TableCell>
                        <TableCell>{log.user?.displayName ?? "システム"}</TableCell>
                        <TableCell className="whitespace-normal">
                          <AuditChanges before={log.beforeData} after={log.afterData} compact={log.action === "CREATE"} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
