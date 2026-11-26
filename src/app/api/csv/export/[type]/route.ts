import type { NextRequest } from "next/server";
import { recordAudit } from "@/lib/audit";
import { can } from "@/lib/auth/permissions";
import { getClientMeta, getCurrentUser } from "@/lib/auth/session";
import { csvResponse } from "@/lib/csv/response";
import { db } from "@/lib/db";
import { buildExport, EXPORT_TYPES, type ExportType } from "@/server/csv-export";

/** CSV エクスポート。クエリ文字列は各一覧画面の検索条件と同じ形式で、絞り込んだ結果を出力する */
export async function GET(request: NextRequest, ctx: RouteContext<"/api/csv/export/[type]">) {
  const user = await getCurrentUser();
  if (!user) return new Response("ログインが必要です。", { status: 401 });
  if (!can(user.role, "csv:export")) return new Response("この操作を行う権限がありません。", { status: 403 });

  const { type } = await ctx.params;
  if (!(type in EXPORT_TYPES)) return new Response("出力対象が正しくありません。", { status: 404 });

  const query = Object.fromEntries(
    [...request.nextUrl.searchParams.entries()].filter(([key, value]) => key !== "page" && value !== ""),
  );
  try {
    const { csv, count } = await buildExport(type as ExportType, query);
    await recordAudit(db, {
      userId: user.id,
      action: "CSV_EXPORT",
      entityType: "Csv",
      entityId: type,
      after: { type: EXPORT_TYPES[type as ExportType].label, count, conditions: query },
      ipAddress: (await getClientMeta()).ipAddress,
    });
    return csvResponse(csv, EXPORT_TYPES[type as ExportType].filename);
  } catch (error) {
    console.error("[csv-export] 出力に失敗しました", error);
    return new Response("CSV の出力中にエラーが発生しました。時間をおいて再度お試しください。", { status: 500 });
  }
}
