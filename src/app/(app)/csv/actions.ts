"use server";

import { revalidatePath } from "next/cache";
import { runAction } from "@/lib/action";
import { ForbiddenError } from "@/lib/auth/errors";
import { can, type Permission } from "@/lib/auth/permissions";
import type { ImportTarget } from "@/lib/csv/fields";
import { importRequestSchema, type ImportRequest } from "@/lib/validation/csv";
import { executeImport, previewImport } from "@/server/csv-import";
import type { Role } from "@/generated/prisma/enums";

/** 取り込み対象ごとに必要な権限 (CSV インポート権限に加えて、対象データの編集権限が必要) */
const TARGET_PERMISSION: Record<ImportTarget, Permission> = {
  devices: "device:write",
  employees: "employee:write",
  locations: "location:write",
};

function assertTarget(role: Role, target: ImportTarget) {
  if (!can(role, TARGET_PERMISSION[target])) throw new ForbiddenError("この取り込み対象を登録する権限がありません。");
}

export async function previewImportAction(input: ImportRequest) {
  return runAction("csv:import", importRequestSchema, input, async (req, ctx) => {
    assertTarget(ctx.user.role, req.target);
    return { ok: true, data: await previewImport(req) };
  });
}

export async function executeImportAction(input: ImportRequest) {
  return runAction("csv:import", importRequestSchema, input, async (req, ctx) => {
    assertTarget(ctx.user.role, req.target);
    const result = await executeImport(req, ctx);
    if (!result.ok) {
      return { ok: false, error: `エラーが ${result.summary.error} 件あるため登録しませんでした。プレビューで内容を確認してください。` };
    }
    for (const path of ["/", "/devices", "/employees", "/locations", "/assignments"]) revalidatePath(path);
    const { create, update, skip } = result.summary;
    return { ok: true, data: result, message: `取り込みが完了しました (登録 ${create} 件・更新 ${update} 件・スキップ ${skip} 件)。` };
  });
}
