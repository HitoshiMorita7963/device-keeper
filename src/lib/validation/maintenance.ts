import { z } from "zod";
import { optionalAmount, optionalDate, optionalText, requiredDate, requiredId, requiredText } from "./common";

export const maintenanceCreateSchema = z.object({
  deviceId: requiredId("対象端末"),
  reportedAt: requiredDate("受付日"),
  problemDescription: requiredText("故障内容", 2000),
  repairVendor: optionalText(100),
  repairCost: optionalAmount,
  status: z.enum(["REPORTED", "IN_PROGRESS"], { error: "対応状況を選択してください。" }),
  notes: optionalText(1000),
});

export const maintenanceUpdateSchema = z
  .object({
    id: requiredId("修理記録"),
    problemDescription: requiredText("故障内容", 2000),
    repairVendor: optionalText(100),
    repairCost: optionalAmount,
    status: z.enum(["REPORTED", "IN_PROGRESS", "COMPLETED", "CANCELLED"], { error: "対応状況を選択してください。" }),
    repairedAt: optionalDate,
    notes: optionalText(1000),
  })
  .superRefine((v, ctx) => {
    if (v.status === "COMPLETED" && !v.repairedAt) {
      ctx.addIssue({ code: "custom", path: ["repairedAt"], message: "修理完了にする場合は修理完了日を入力してください。" });
    }
  });

/** 廃棄方法の選択肢 */
export const DISPOSAL_METHODS = ["産業廃棄物処理業者へ引き渡し", "リサイクル業者へ売却・引き渡し", "リース会社へ返却", "メーカー回収", "その他"] as const;

export const disposalSchema = z.object({
  deviceId: requiredId("対象端末"),
  disposedAt: requiredDate("廃棄日"),
  disposalReason: requiredText("廃棄理由", 1000),
  disposalMethod: z.enum(DISPOSAL_METHODS, { error: "廃棄方法を選択してください。" }),
  disposalVendor: optionalText(100),
  /** データ消去の確認。記憶媒体のない機器 (モニター等) は「不要」を明示的に選ぶ */
  dataErasure: z.enum(["confirmed", "not_required"], { error: "データ消去の確認結果を選択してください。" }),
  notes: optionalText(1000),
});

export type MaintenanceCreateInput = z.input<typeof maintenanceCreateSchema>;
export type MaintenanceUpdateInput = z.input<typeof maintenanceUpdateSchema>;
export type DisposalInput = z.input<typeof disposalSchema>;
