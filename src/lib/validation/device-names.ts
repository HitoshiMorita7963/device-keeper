import { z } from "zod";
import { optionalText, requiredId } from "./common";

/**
 * Windows のコンピューター名。NetBIOS 名は 15 文字以内だが、DNS ホスト名 (63 文字) まで受け付ける。
 * 先頭は英数字、以降は英数字・ハイフン・アンダースコア (日本語などの文字も許可)。
 */
export const computerNameSchema = z.object({
  computerName: z
    .string({ error: "computerName を文字列で指定してください。" })
    .trim()
    .min(1, "PC名が空です。")
    .max(63, "PC名は63文字以内にしてください。")
    .regex(/^[\p{L}\p{N}][\p{L}\p{N}_-]*$/u, "PC名に使用できない文字が含まれています (英数字・ハイフン・アンダースコアのみ)。"),
});

export const managementNameSchema = z.object({
  id: requiredId("端末"),
  /** 空欄にすると未設定に戻る */
  managementName: optionalText(100),
});

export type ManagementNameInput = z.input<typeof managementNameSchema>;
