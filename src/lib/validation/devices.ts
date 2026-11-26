import { z } from "zod";
import { optionalAmount, optionalDate, optionalText, requiredId, requiredText } from "./common";

/** 資産管理番号: 半角英数字とハイフン等 (例: PC-000001)。Excel 台帳の既存番号も取り込めるよう _ と . も許可する */
const assetNumberText = z
  .string()
  .trim()
  .toUpperCase()
  .max(30, "30文字以内で入力してください。")
  .refine((v) => v === "" || /^[A-Z0-9][A-Z0-9._-]*$/.test(v), "資産管理番号は半角英数字とハイフン・アンダースコア・ピリオドで入力してください。");

/** 登録・編集で共通の項目 */
const deviceFields = {
  name: requiredText("資産名称"),
  categoryId: requiredId("資産種別"),
  manufacturer: optionalText(100),
  model: optionalText(100),
  serialNumber: optionalText(100),
  osName: optionalText(50),
  osVersion: optionalText(50),
  purchaseDate: optionalDate,
  purchasePrice: optionalAmount,
  purchaseVendor: optionalText(100),
  warrantyExpiry: optionalDate,
  notes: optionalText(1000),
  // Excel 台帳から引き継いだ項目 (未指定の場合は変更しない)
  hostname: optionalText(100).optional(),
  purpose: optionalText(100).optional(),
  cpu: optionalText(100).optional(),
  memory: optionalText(50).optional(),
  disk: optionalText(50).optional(),
  homeLoanedAt: optionalDate.optional(),
  recovery: optionalText(200).optional(),
};

/**
 * 登録時に選べる端末状態。
 * 使用中は貸出処理、廃棄済みは廃棄処理でのみ設定する (履歴と整合させるため)。
 */
export const INITIAL_DEVICE_STATUSES = ["IN_STOCK", "REPAIR", "LOST"] as const;

export const deviceCreateSchema = z
  .object({
    ...deviceFields,
    /** auto: 資産種別の設定に従い自動採番 / manual: 既存の番号を手入力 */
    assetNumberMode: z.enum(["auto", "manual"]),
    assetNumber: assetNumberText,
    currentLocationId: requiredId("現在拠点"),
    status: z.enum(INITIAL_DEVICE_STATUSES, { error: "端末状態を選択してください。" }),
  })
  .superRefine((v, ctx) => {
    if (v.assetNumberMode === "manual" && v.assetNumber === "") {
      ctx.addIssue({ code: "custom", path: ["assetNumber"], message: "資産管理番号を入力してください。" });
    }
  });

/** 編集時は拠点 (拠点間移動で変更) と状態 (状態変更・貸出・廃棄で変更) を扱わない */
export const deviceUpdateSchema = z.object({
  ...deviceFields,
  id: requiredId("端末"),
  assetNumber: assetNumberText.refine((v) => v !== "", "資産管理番号を入力してください。"),
});

/** 手動で変更できる端末状態 */
export const MANUAL_DEVICE_STATUSES = ["IN_STOCK", "IN_USE", "REPAIR", "LOST"] as const;

export const deviceStatusChangeSchema = z.object({
  id: requiredId("端末"),
  status: z.enum(MANUAL_DEVICE_STATUSES, { error: "変更後の状態を選択してください。" }),
  reason: requiredText("変更理由", 500),
});

export const deviceDeleteSchema = z.object({
  id: requiredId("端末"),
  reason: requiredText("削除理由", 500),
});

/** 端末のログイン情報 (管理者のみ変更可)。パスワード欄が空欄の場合は変更しない */
export const deviceCredentialsSchema = z.object({
  id: requiredId("端末"),
  initialUser: optionalText(100),
  loginUser: optionalText(100),
  initialPassword: z.string().max(200, "200文字以内で入力してください。"),
  loginPassword: z.string().max(200, "200文字以内で入力してください。"),
  clearInitialPassword: z.boolean(),
  clearLoginPassword: z.boolean(),
});

export type DeviceCredentialsInput = z.input<typeof deviceCredentialsSchema>;
export type DeviceCreateInput = z.input<typeof deviceCreateSchema>;
export type DeviceUpdateInput = z.input<typeof deviceUpdateSchema>;
export type DeviceStatusChangeInput = z.input<typeof deviceStatusChangeSchema>;
