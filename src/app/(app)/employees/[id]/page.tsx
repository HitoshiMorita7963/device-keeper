import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowUpFromLine, Pencil } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DetailList, EmploymentStatusBadge, EmptyState } from "@/components/list";
import { PageHeader } from "@/components/page-header";
import { can, ROLE_LABELS } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/session";
import { formatDate, todayJst, toDateInput } from "@/lib/dates";
import { idParam } from "@/lib/validation/common";
import { getEmployeeDetail } from "@/server/employees";
import { RetireDialog } from "./retire-dialog";

export const metadata: Metadata = { title: "社員詳細" };

export default async function EmployeeDetailPage({ params }: PageProps<"/employees/[id]">) {
  const user = await requirePermission("employee:read");
  const id = idParam.safeParse((await params).id);
  const detail = id.success ? await getEmployeeDetail(id.data) : null;
  if (!detail) notFound();
  const { employee, current, past, upcomingReturns } = detail;
  const today = todayJst();
  const canWrite = can(user.role, "employee:write");
  const deviceLink = (d: { id: number; assetNumber: string }) =>
    can(user.role, "device:read") ? (
      <Link href={`/devices/${d.id}`} className="font-mono text-primary hover:underline">
        {d.assetNumber}
      </Link>
    ) : (
      <span className="font-mono">{d.assetNumber}</span>
    );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={employee.name}
        description={<Link href="/employees" className="hover:underline">社員一覧</Link>}
        actions={
          <>
            {can(user.role, "assignment:write") && employee.employmentStatus !== "RETIRED" ? (
              <Button asChild>
                <Link href={`/assignments/new?employee=${employee.id}&from=employee`}>
                  <ArrowUpFromLine aria-hidden />
                  端末を貸出
                </Link>
              </Button>
            ) : null}
            {canWrite ? (
              <>
                <Button asChild variant="outline">
                  <Link href={`/employees/${employee.id}/edit`}>
                    <Pencil aria-hidden />
                    編集
                  </Link>
                </Button>
                {employee.employmentStatus !== "RETIRED" ? (
                  <RetireDialog
                    employeeId={employee.id}
                    employeeName={employee.name}
                    today={toDateInput(today)}
                    assignedDevices={current.map((a) => ({ assetNumber: a.device.assetNumber, name: a.device.name }))}
                    hasUserAccount={Boolean(employee.user?.isActive)}
                  />
                ) : null}
              </>
            ) : null}
          </>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">社員基本情報</CardTitle>
        </CardHeader>
        <CardContent>
          <DetailList
            items={[
              { label: "社員番号", value: <span className="font-mono">{employee.employeeNumber}</span> },
              { label: "氏名", value: employee.name },
              { label: "メールアドレス", value: employee.email },
              { label: "部署", value: employee.department?.name },
              { label: "所属拠点", value: employee.homeLocation?.name },
              { label: "在籍状態", value: <EmploymentStatusBadge status={employee.employmentStatus} /> },
              { label: "入社日", value: formatDate(employee.joinedAt) },
              { label: "退職日", value: formatDate(employee.retiredAt) },
              {
                label: "システム利用者",
                value: employee.user
                  ? `${ROLE_LABELS[employee.user.role]}${employee.user.isActive ? "" : " (無効)"}`
                  : "なし",
              },
            ]}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">現在貸与されている端末 ({current.length}台)</CardTitle>
        </CardHeader>
        <CardContent>
          {current.length === 0 ? (
            <EmptyState>貸与中の端末はありません。</EmptyState>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>資産管理番号</TableHead>
                  <TableHead>資産名称</TableHead>
                  <TableHead>種別</TableHead>
                  <TableHead>貸出日</TableHead>
                  <TableHead>返却予定日</TableHead>
                  <TableHead>貸出担当者</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {current.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell>{deviceLink(a.device)}</TableCell>
                    <TableCell>{a.device.name}</TableCell>
                    <TableCell>{a.device.category.name}</TableCell>
                    <TableCell>{formatDate(a.assignedAt)}</TableCell>
                    <TableCell>{formatDate(a.expectedReturnAt)}</TableCell>
                    <TableCell>{a.assignedBy?.displayName ?? "-"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">返却予定端末</CardTitle>
        </CardHeader>
        <CardContent>
          {upcomingReturns.length === 0 ? (
            <EmptyState>返却予定日が設定された貸与中端末はありません。</EmptyState>
          ) : (
            <ul className="divide-y">
              {upcomingReturns.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                  <span>
                    {deviceLink(a.device)} {a.device.name}
                  </span>
                  <span className="flex items-center gap-2">
                    {formatDate(a.expectedReturnAt)}
                    {a.expectedReturnAt! < today ? <Badge variant="destructive">期限超過</Badge> : null}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">過去の貸与履歴</CardTitle>
        </CardHeader>
        <CardContent>
          {past.length === 0 ? (
            <EmptyState>過去の貸与履歴はありません。</EmptyState>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>資産管理番号</TableHead>
                  <TableHead>資産名称</TableHead>
                  <TableHead>貸出日</TableHead>
                  <TableHead>返却日</TableHead>
                  <TableHead>返却時状態</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {past.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell>{deviceLink(a.device)}</TableCell>
                    <TableCell>{a.device.name}</TableCell>
                    <TableCell>{formatDate(a.assignedAt)}</TableCell>
                    <TableCell>{formatDate(a.returnedAt)}</TableCell>
                    <TableCell>{a.conditionOnReturn ?? "-"}</TableCell>
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
