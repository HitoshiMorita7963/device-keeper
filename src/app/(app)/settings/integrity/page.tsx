import type { Metadata } from "next";
import Link from "next/link";
import { CircleCheck } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/page-header";
import { requirePermission } from "@/lib/auth/session";
import { formatDateTime } from "@/lib/dates";
import { checkIntegrity } from "@/server/integrity";

export const metadata: Metadata = { title: "データ整合性チェック" };

export default async function IntegrityPage() {
  await requirePermission("settings:manage");
  const issues = await checkIntegrity();
  const errors = issues.filter((i) => i.severity === "error").length;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="データ整合性チェック"
        description={
          <span>
            <Link href="/settings" className="hover:underline">
              システム設定
            </Link>{" "}
            / {formatDateTime(new Date())} 時点 (画面を再読み込みすると再チェックします)
          </span>
        }
      />
      {issues.length === 0 ? (
        <Alert>
          <CircleCheck aria-hidden />
          <AlertTitle>問題は見つかりませんでした</AlertTitle>
          <AlertDescription>端末状態・貸与履歴・修理記録・廃棄記録・拠点移動履歴の間に矛盾はありません。</AlertDescription>
        </Alert>
      ) : (
        <>
          <Alert variant={errors > 0 ? "destructive" : "default"}>
            <AlertTitle>
              エラー {errors} 件・警告 {issues.length - errors} 件
            </AlertTitle>
            <AlertDescription>
              エラーは通常の操作では発生しない矛盾です (DB の直接編集・復元の失敗など)。内容を確認し、必要に応じてシステム管理者に相談してください。
            </AlertDescription>
          </Alert>
          <Card>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-20">重要度</TableHead>
                    <TableHead className="w-24">分類</TableHead>
                    <TableHead className="w-36">端末</TableHead>
                    <TableHead>内容</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {issues.map((i, n) => (
                    <TableRow key={n}>
                      <TableCell>{i.severity === "error" ? <Badge variant="destructive">エラー</Badge> : <Badge variant="outline">警告</Badge>}</TableCell>
                      <TableCell>{i.check}</TableCell>
                      <TableCell className="font-mono">
                        {i.deviceId ? (
                          <Link href={`/devices/${i.deviceId}`} className="text-primary hover:underline">
                            {i.assetNumber}
                          </Link>
                        ) : (
                          "-"
                        )}
                      </TableCell>
                      <TableCell className="whitespace-normal">{i.message}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
