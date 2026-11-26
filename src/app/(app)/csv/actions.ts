"use server";

import { revalidatePath } from "next/cache";
import { runAction } from "@/lib/action";
import { ForbiddenError } from "@/lib/auth/errors";
import { can, type Permission } from "@/lib/auth/permissions";
import type { ImportTarget } from "@/lib/csv/fields";
import { importRequestSchema, type ImportRequest, type ImportRequestInput } from "@/lib/validation/csv";
import { executeImport, previewImport } from "@/server/csv-import";
import type { Role } from "@/generated/prisma/enums";

/** 取り込み対象ごとに必要な権限 (CSV インポート権限に加えて、対象データの編集権限が必要) */
const TARGET_PERMISSION: Record<ImportTarget, Permission> = {
  devices: "device:write",
  employees: "employee:write",
  locations: "location:write",
};

function assertAllowed(role: Role, req: ImportRequest) {
  if (!can(role, TARGET_PERMISSION[req.target])) throw new ForbiddenError("この取り込み対象を登録する権限がありません。");
  if (req.target !== "devices") return;
  // パスワードの保存は端末パスワードを扱える利用者 (管理者) のみ
  const passwordsMapped = ["initialPassword", "loginPassword"].some((k) => req.mapping[k] !== null && req.mapping[k] !== undefined);
  if (passwordsMapped && !can(role, "device:secret")) {
    throw new ForbiddenError("パスワードの列を取り込めるのは管理者のみです。パスワードの列を「対応付けない」にしてください。");
  }
  // 社員・部署・拠点の自動登録は、それらを登録できる利用者 (管理者) のみ
  if (req.options.autoCreate && !(["employee:write", "location:write", "master:write"] as const).every((p) => can(role, p))) {
    throw new ForbiddenError("社員・部署・拠点の自動登録は管理者のみ行えます。");
  }
}

export async function previewImportAction(input: ImportRequestInput) {
  return runAction("csv:import", importRequestSchema, input, async (req, ctx) => {
    assertAllowed(ctx.user.role, req);
    return { ok: true, data: await previewImport(req) };
  });
}

export async function executeImportAction(input: ImportRequestInput) {
  return runAction("csv:import", importRequestSchema, input, async (req, ctx) => {
    assertAllowed(ctx.user.role, req);
    const result = await executeImport(req, ctx);
    if (!result.ok) {
      return { ok: false, error: `エラーが ${result.summary.error} 件あるため登録しませんでした。プレビューで内容を確認してください。` };
    }
    for (const path of ["/", "/devices", "/employees", "/locations", "/assignments", "/settings/departments"]) revalidatePath(path);
    const { create, update, skip } = result.summary;
    return { ok: true, data: result, message: `取り込みが完了しました (登録 ${create} 件・更新 ${update} 件・スキップ ${skip} 件)。` };
  });
}
