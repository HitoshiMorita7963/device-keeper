import type { NextRequest } from "next/server";
import { getClientMeta } from "@/lib/auth/session";
import { idParam } from "@/lib/validation/common";
import { computerNameSchema } from "@/lib/validation/device-names";
import { reportComputerName } from "@/server/device-names";

/** リクエスト本文の上限 (PC 名だけを受け付けるため小さくする) */
const MAX_BODY_BYTES = 1024;

const json = (status: number, body: Record<string, unknown>, headers: Record<string, string> = {}) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });

/**
 * 端末の PC 名 (Windows の COMPUTERNAME) を受け取る。
 * 認証: Authorization: Bearer <端末連携キー>。キーは端末ごとに管理画面で発行し、その端末の ID でのみ使える。
 * ログイン Cookie では受け付けない (PC 名は管理画面から変更しないため)。
 *
 * POST /api/devices/{id}/computer-name
 *   本文: { "computerName": "DESKTOP-A8F3K2" }
 *   200: { ok, deviceId, assetNumber, computerName, computerNameUpdatedAt, changed }
 *   400 入力エラー / 401 認証失敗 / 403 別の端末のキー / 404 端末なし / 409 廃棄済み / 413 本文が大きすぎる
 */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/devices/[id]/computer-name">) {
  const id = idParam.safeParse((await ctx.params).id);
  if (!id.success) return json(404, { ok: false, error: "端末が見つかりません。" });

  const auth = request.headers.get("authorization") ?? "";
  const token = /^Bearer\s+(\S+)$/i.exec(auth)?.[1] ?? null;

  const raw = await request.text();
  if (Buffer.byteLength(raw) > MAX_BODY_BYTES) return json(413, { ok: false, error: "リクエストが大きすぎます。" });
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return json(400, { ok: false, error: "JSON の形式が正しくありません。" });
  }
  const parsed = computerNameSchema.safeParse(body);
  if (!parsed.success) return json(400, { ok: false, error: parsed.error.issues[0]?.message ?? "入力内容に誤りがあります。" });

  try {
    const { ipAddress } = await getClientMeta();
    const result = await reportComputerName(id.data, token, parsed.data.computerName, ipAddress);
    if (!result.ok) {
      return json(result.status, { ok: false, error: result.error }, result.status === 401 ? { "WWW-Authenticate": 'Bearer realm="device-keeper"' } : {});
    }
    const { ok, deviceId, assetNumber, computerName, computerNameUpdatedAt, changed } = result;
    return json(200, { ok, deviceId, assetNumber, computerName, computerNameUpdatedAt: computerNameUpdatedAt.toISOString(), changed });
  } catch (error) {
    console.error("[computer-name] PC 名の保存に失敗しました", error);
    return json(500, { ok: false, error: "サーバーでエラーが発生しました。" });
  }
}
