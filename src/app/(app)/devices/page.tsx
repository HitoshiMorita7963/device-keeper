import type { Metadata } from "next";
import Link from "next/link";
import { Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DeviceStatusBadge, EmptyState, Pager } from "@/components/list";
import { CsvExportButton } from "@/components/csv-export-button";
import { PageHeader } from "@/components/page-header";
import { SearchBar, SearchSelect, SearchText } from "@/components/search-bar";
import { can } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/session";
import { WARRANTY_WARNING_DAYS } from "@/lib/dashboard";
import { addDays, formatDate, formatDateTime, todayJst } from "@/lib/dates";
import { db } from "@/lib/db";
import { DEVICE_STATUS_LABELS } from "@/lib/labels";
import { currentPage, pickParams } from "@/lib/pagination";
import { cn } from "@/lib/utils";
import { DEVICE_SEARCH_KEYS, searchDevices } from "@/server/devices";
import { ManagementName } from "@/components/management-name";
import { ManagementNameDialog } from "./device-name-dialogs";

export const metadata: Metadata = { title: "端末一覧" };

export default async function DevicesPage({ searchParams }: PageProps<"/devices">) {
  const user = await requirePermission("device:read");
  const params = pickParams(await searchParams, DEVICE_SEARCH_KEYS);
  const [{ total, rows }, categories, departments, locations] = await Promise.all([
    searchDevices(params),
    db.deviceCategory.findMany({ orderBy: { categoryCode: "asc" }, select: { id: true, name: true } }),
    db.department.findMany({ orderBy: { departmentCode: "asc" }, select: { id: true, name: true } }),
    db.location.findMany({ orderBy: { locationCode: "asc" }, select: { id: true, name: true } }),
  ]);
  const today = todayJst();
  const warningLimit = addDays(today, WARRANTY_WARNING_DAYS);
  const canAssign = can(user.role, "assignment:write");
  const canEditName = can(user.role, "device:write");
  const canMove = can(user.role, "move:write");

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="端末一覧"
        actions={
          <>
            {can(user.role, "csv:export") ? <CsvExportButton type="devices" params={params} /> : null}
            {can(user.role, "device:write") ? (
              <Button asChild>
                <Link href="/devices/new">
                  <Plus aria-hidden />
                  新規登録
                </Link>
              </Button>
            ) : null}
          </>
        }
      />

      <SearchBar action="/devices">
        <SearchText name="assetNumber" label="資産管理番号" defaultValue={params.assetNumber} className="w-full sm:w-40" />
        <SearchText name="name" label="資産名称" defaultValue={params.name} className="w-full sm:w-44" />
        <SearchText name="serial" label="シリアル番号" defaultValue={params.serial} className="w-full sm:w-40" />
        <SearchText name="hostname" label="ホスト名" defaultValue={params.hostname} className="w-full sm:w-36" />
        <SearchText name="pcName" label="PC名・管理用端末名" defaultValue={params.pcName} className="w-full sm:w-44" />
        <SearchSelect name="category" label="資産種別" defaultValue={params.category} options={categories.map((c) => ({ value: c.id, label: c.name }))} />
        <SearchText name="manufacturer" label="メーカー" defaultValue={params.manufacturer} className="w-full sm:w-36" />
        <SearchText name="user" label="利用者 (氏名・社員番号)" defaultValue={params.user} className="w-full sm:w-44" />
        <SearchSelect name="department" label="利用者の部署" defaultValue={params.department} options={departments.map((d) => ({ value: d.id, label: d.name }))} />
        <SearchSelect name="location" label="現在拠点" defaultValue={params.location} options={locations.map((l) => ({ value: l.id, label: l.name }))} />
        <SearchSelect
          name="status"
          label="状態"
          defaultValue={params.status}
          emptyLabel="すべて (廃棄済みを除く)"
          options={[
            ...(["IN_USE", "IN_STOCK", "REPAIR", "LOST", "DISPOSED"] as const).map((s) => ({ value: s, label: DEVICE_STATUS_LABELS[s] })),
            { value: "all", label: "すべて (廃棄済みを含む)" },
          ]}
        />
        <SearchSelect
          name="warranty"
          label="保証期限"
          defaultValue={params.warranty}
          options={[
            { value: "soon", label: `間近 (${WARRANTY_WARNING_DAYS}日以内)` },
            { value: "expired", label: "期限切れ" },
            { value: "none", label: "未設定" },
          ]}
        />
        <SearchSelect name="overdue" label="返却期限" defaultValue={params.overdue} options={[{ value: "1", label: "期限超過のみ" }]} />
      </SearchBar>

      <Card>
        <CardContent className="flex flex-col gap-3">
          {rows.length === 0 ? (
            <EmptyState>条件に一致する端末はありません。</EmptyState>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>資産管理番号</TableHead>
                  <TableHead>PC名</TableHead>
                  <TableHead>管理用端末名</TableHead>
                  <TableHead>PC名の最終取得</TableHead>
                  <TableHead>資産名称</TableHead>
                  <TableHead>資産種別</TableHead>
                  <TableHead>メーカー</TableHead>
                  <TableHead>型番</TableHead>
                  <TableHead>利用者</TableHead>
                  <TableHead>所属部署</TableHead>
                  <TableHead>現在拠点</TableHead>
                  <TableHead>状態</TableHead>
                  <TableHead>保証期限</TableHead>
                  {canAssign || canMove ? <TableHead className="w-32">操作</TableHead> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((d) => {
                  const warranty = d.warrantyExpiry;
                  const warrantyClass =
                    warranty && d.status !== "DISPOSED"
                      ? warranty < today
                        ? "text-destructive"
                        : warranty <= warningLimit
                          ? "font-medium text-amber-700 dark:text-amber-400"
                          : ""
                      : "";
                  return (
                    <TableRow key={d.id}>
                      <TableCell className="font-mono">
                        <Link href={`/devices/${d.id}`} className="text-primary hover:underline">
                          {d.assetNumber}
                        </Link>
                      </TableCell>
                      <TableCell className="font-mono">
                        {d.computerName ?? <span className="font-sans text-muted-foreground">未取得</span>}
                      </TableCell>
                      <TableCell className="max-w-56">
                        <span className="flex items-center gap-1">
                          <span className="truncate">
                            <ManagementName managementName={d.managementName} computerName={d.computerName} />
                          </span>
                          {canEditName && d.status !== "DISPOSED" ? (
                            <ManagementNameDialog
                              deviceId={d.id}
                              assetNumber={d.assetNumber}
                              computerName={d.computerName}
                              managementName={d.managementName}
                              trigger={
                                <Button variant="ghost" size="icon-sm" aria-label={`${d.assetNumber} の管理用端末名を編集`}>
                                  <Pencil aria-hidden />
                                </Button>
                              }
                            />
                          ) : null}
                        </span>
                      </TableCell>
                      <TableCell className="text-xs tabular-nums text-muted-foreground">
                        {d.computerNameUpdatedAt ? formatDateTime(d.computerNameUpdatedAt) : "-"}
                      </TableCell>
                      <TableCell className="max-w-56 truncate">
                        <Link href={`/devices/${d.id}`} className="hover:underline">
                          {d.name}
                        </Link>
                      </TableCell>
                      <TableCell>{d.category.name}</TableCell>
                      <TableCell>{d.manufacturer ?? "-"}</TableCell>
                      <TableCell>{d.model ?? "-"}</TableCell>
                      <TableCell>
                        {d.currentEmployee ? (
                          <Link href={`/employees/${d.currentEmployee.id}`} className="hover:underline">
                            {d.currentEmployee.name}
                          </Link>
                        ) : (
                          "-"
                        )}
                      </TableCell>
                      <TableCell>{d.currentEmployee?.department?.name ?? "-"}</TableCell>
                      <TableCell>{d.currentLocation.name}</TableCell>
                      <TableCell>
                        <DeviceStatusBadge status={d.status} />
                      </TableCell>
                      <TableCell className={cn("tabular-nums", warrantyClass)}>{formatDate(warranty)}</TableCell>
                      {canAssign || canMove ? (
                        <TableCell className="space-x-1">
                          {!canAssign ? null : d.status === "IN_STOCK" ? (
                            <Button asChild size="sm" variant="outline">
                              <Link href={`/assignments/new?device=${d.id}`}>貸出</Link>
                            </Button>
                          ) : d.currentEmployee ? (
                            <Button asChild size="sm" variant="outline">
                              <Link href={`/assignments/return?device=${d.id}`}>返却</Link>
                            </Button>
                          ) : null}
                          {canMove && d.status !== "DISPOSED" && d.status !== "LOST" ? (
                            <Button asChild size="sm" variant="ghost">
                              <Link href={`/moves/new?device=${d.id}`}>移動</Link>
                            </Button>
                          ) : null}
                        </TableCell>
                      ) : null}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
          <Pager basePath="/devices" params={params} page={currentPage(params)} total={total} />
        </CardContent>
      </Card>
    </div>
  );
}
