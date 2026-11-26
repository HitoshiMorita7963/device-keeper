import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";

/** 一覧画面の現在の検索条件で CSV を出力するボタン */
export function CsvExportButton({ type, params, label = "CSV出力" }: { type: string; params?: Record<string, string | undefined>; label?: string }) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params ?? {})) if (v && k !== "page") sp.set(k, v);
  const qs = sp.toString();
  return (
    <Button asChild variant="outline">
      {/* ファイルのダウンロードのため、クライアント遷移ではなく通常のリンクにする */}
      <a href={`/api/csv/export/${type}${qs ? `?${qs}` : ""}`} download>
        <Download aria-hidden />
        {label}
      </a>
    </Button>
  );
}
