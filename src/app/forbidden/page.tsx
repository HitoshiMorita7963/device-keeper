import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "アクセス権限がありません" };

export default function ForbiddenPage() {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="text-2xl font-semibold">アクセス権限がありません</h1>
      <p className="text-sm text-muted-foreground">
        この画面を表示する権限がありません。必要な場合はシステム管理者に権限の付与を依頼してください。
      </p>
      <Button asChild variant="outline">
        <Link href="/">トップへ戻る</Link>
      </Button>
    </main>
  );
}
