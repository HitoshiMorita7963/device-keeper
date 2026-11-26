import { toDateInput, todayJst } from "@/lib/dates";

/** CSV ファイルのダウンロード応答 */
export function csvResponse(csv: string, basename: string): Response {
  const filename = `${basename}_${toDateInput(todayJst()).replaceAll("-", "")}.csv`;
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Cache-Control": "no-store",
    },
  });
}
