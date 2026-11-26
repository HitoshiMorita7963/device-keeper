import { can } from "@/lib/auth/permissions";
import { getCurrentUser } from "@/lib/auth/session";
import { IMPORT_TARGETS, type ImportTarget } from "@/lib/csv/fields";
import { csvResponse } from "@/lib/csv/response";
import { buildTemplate } from "@/server/csv-export";

/** インポート用テンプレート (見出し行のみの CSV) */
export async function GET(_request: Request, ctx: RouteContext<"/api/csv/template/[target]">) {
  const user = await getCurrentUser();
  if (!user) return new Response("ログインが必要です。", { status: 401 });
  if (!can(user.role, "csv:import")) return new Response("この操作を行う権限がありません。", { status: 403 });
  const { target } = await ctx.params;
  if (!(target in IMPORT_TARGETS)) return new Response("対象が正しくありません。", { status: 404 });
  return csvResponse(buildTemplate(target as ImportTarget), `template_${target}`);
}
