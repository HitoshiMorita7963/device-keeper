import { z } from "zod";
import { optionalDate, optionalText, requiredDate, requiredId } from "./common";

export const assignSchema = z
  .object({
    deviceId: requiredId("貸出対象端末"),
    employeeId: requiredId("貸出先社員"),
    assignedAt: requiredDate("貸出日"),
    expectedReturnAt: optionalDate,
    assignedById: requiredId("貸出担当者"),
    notes: optionalText(1000),
  })
  .superRefine((v, ctx) => {
    if (v.expectedReturnAt && v.expectedReturnAt < v.assignedAt) {
      ctx.addIssue({ code: "custom", path: ["expectedReturnAt"], message: "返却予定日は貸出日以降の日付にしてください。" });
    }
  });

/** 返却時状態の選択肢 */
export const RETURN_CONDITIONS = ["良好", "軽微な傷・汚れあり", "破損・故障あり", "その他"] as const;

export const returnSchema = z.object({
  deviceId: requiredId("対象端末"),
  returnedAt: requiredDate("返却日"),
  conditionOnReturn: z.enum(RETURN_CONDITIONS, { error: "返却時状態を選択してください。" }),
  accessoriesChecked: z.boolean(),
  returnedById: requiredId("返却担当者"),
  notes: optionalText(1000),
});

export type AssignInput = z.input<typeof assignSchema>;
export type ReturnInput = z.input<typeof returnSchema>;
