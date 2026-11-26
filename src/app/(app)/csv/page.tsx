import type { Metadata } from "next";
import Link from "next/link";
import { FileUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CsvExportButton } from "@/components/csv-export-button";
import { PageHeader } from "@/components/page-header";
import { can } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/session";

export const metadata: Metadata = { title: "CSV管理" };

const EXPORTS = [
  { type: "devices", title: "端末一覧", description: "廃棄済みを除く全端末。インポートと同じ見出しのため、編集して再取り込みできます。" },
  { type: "devices-by-location", title: "拠点別端末一覧", description: "拠点コード順に並べた端末一覧 (拠点コード列付き)。" },
  { type: "employees", title: "社員一覧", description: "在籍・休職中の社員と貸与端末数。" },
  { type: "assignments", title: "貸出履歴", description: "すべての貸出・返却の履歴。" },
];

export default async function CsvPage() {
  const user = await requirePermission("csv:export");
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="CSV管理" />

      {can(user.role, "csv:import") ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">CSVインポート</CardTitle>
            <CardDescription>
              Excel・スプレッドシートの台帳から端末・社員・拠点を一括登録します。項目の対応付け・プレビュー・エラー確認を行ってから登録します。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href="/csv/import">
                <FileUp aria-hidden />
                インポートを開始
              </Link>
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold">CSVエクスポート</h2>
        <p className="text-sm text-muted-foreground">
          条件を指定して出力する場合は、各一覧画面で検索してから「CSV出力」を押してください。出力した操作は操作履歴に記録されます。
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          {EXPORTS.map((e) => (
            <Card key={e.type}>
              <CardHeader>
                <CardTitle className="text-base">{e.title}</CardTitle>
                <CardDescription>{e.description}</CardDescription>
              </CardHeader>
              <CardContent>
                <CsvExportButton type={e.type} label="ダウンロード" />
              </CardContent>
            </Card>
          ))}
        </div>
      </section>
    </div>
  );
}
