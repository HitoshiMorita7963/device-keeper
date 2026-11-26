import type { Metadata } from "next";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/page-header";
import { requirePermission } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { formatDate, todayJst } from "@/lib/dates";

export const metadata: Metadata = { title: "マイ端末" };

/** 一般社員向け: 自分に貸与されている端末と貸与履歴のみを表示する */
export default async function MyDevicesPage() {
  const user = await requirePermission("self:read");

  if (!user.employeeId) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="マイ端末" />
        <p className="text-sm text-muted-foreground">
          このアカウントは社員情報と紐付いていないため、貸与端末を表示できません。管理者に連絡してください。
        </p>
      </div>
    );
  }

  // 他の社員の情報を取得しないよう、必ずログイン利用者の社員IDで絞り込む
  const assignments = await db.deviceAssignment.findMany({
    where: { employeeId: user.employeeId },
    orderBy: [{ returnedAt: { sort: "desc", nulls: "first" } }, { assignedAt: "desc" }],
    include: {
      device: {
        select: { assetNumber: true, name: true, manufacturer: true, model: true, category: { select: { name: true } } },
      },
    },
  });
  const current = assignments.filter((a) => !a.returnedAt);
  const past = assignments.filter((a) => a.returnedAt);
  const today = todayJst();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="マイ端末" description="あなたに貸与されている端末と貸与履歴です。" />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">現在貸与中の端末 ({current.length}台)</CardTitle>
        </CardHeader>
        <CardContent>
          {current.length === 0 ? (
            <p className="text-sm text-muted-foreground">現在貸与中の端末はありません。</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>資産管理番号</TableHead>
                  <TableHead>資産名称</TableHead>
                  <TableHead>種別</TableHead>
                  <TableHead>メーカー / 型番</TableHead>
                  <TableHead>貸出日</TableHead>
                  <TableHead>返却予定日</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {current.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell className="font-mono">{a.device.assetNumber}</TableCell>
                    <TableCell>{a.device.name}</TableCell>
                    <TableCell>{a.device.category.name}</TableCell>
                    <TableCell>{[a.device.manufacturer, a.device.model].filter(Boolean).join(" / ") || "-"}</TableCell>
                    <TableCell>{formatDate(a.assignedAt)}</TableCell>
                    <TableCell>
                      {formatDate(a.expectedReturnAt)}
                      {a.expectedReturnAt && a.expectedReturnAt < today ? (
                        <Badge variant="destructive" className="ml-2">
                          期限超過
                        </Badge>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">過去の貸与履歴</CardTitle>
        </CardHeader>
        <CardContent>
          {past.length === 0 ? (
            <p className="text-sm text-muted-foreground">過去の貸与履歴はありません。</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>資産管理番号</TableHead>
                  <TableHead>資産名称</TableHead>
                  <TableHead>貸出日</TableHead>
                  <TableHead>返却日</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {past.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell className="font-mono">{a.device.assetNumber}</TableCell>
                    <TableCell>{a.device.name}</TableCell>
                    <TableCell>{formatDate(a.assignedAt)}</TableCell>
                    <TableCell>{formatDate(a.returnedAt)}</TableCell>
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
