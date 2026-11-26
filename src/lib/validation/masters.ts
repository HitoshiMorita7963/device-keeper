import { z } from "zod";
import { codeText, optionalDate, optionalEmail, optionalId, optionalPhone, optionalText, requiredDate, requiredId, requiredText } from "./common";

export const departmentSchema = z.object({
  departmentCode: codeText("部署コード"),
  name: requiredText("部署名"),
  isActive: z.boolean(),
});

export const categorySchema = z.object({
  categoryCode: codeText("種別コード", 20),
  name: requiredText("種別名", 50),
  prefix: requiredText("採番プレフィックス", 10)
    .toUpperCase()
    .regex(/^[A-Z0-9]+$/, "採番プレフィックスは半角英大文字・数字で入力してください。"),
  numberDigits: z.coerce
    .number({ error: "桁数を入力してください。" })
    .int("桁数は整数で入力してください。")
    .min(3, "桁数は 3〜10 で入力してください。")
    .max(10, "桁数は 3〜10 で入力してください。"),
  isActive: z.boolean(),
});

export const locationSchema = z.object({
  locationCode: codeText("拠点コード"),
  name: requiredText("拠点名"),
  address: optionalText(200),
  managerName: optionalText(50),
  phone: optionalPhone,
  isActive: z.boolean(),
});

/**
 * 退職への変更は退職処理 (retireEmployeeSchema) でのみ行う。
 * 通常の編集で RETIRED を指定できるのは、既に退職済みの社員の状態を維持する場合だけ (サーバー側で検証)。
 */
export const employeeSchema = z.object({
  employeeNumber: codeText("社員番号"),
  name: requiredText("氏名", 50),
  email: optionalEmail,
  departmentId: optionalId,
  homeLocationId: optionalId,
  employmentStatus: z.enum(["ACTIVE", "ON_LEAVE", "RETIRED"], { error: "在籍状態を選択してください。" }),
  joinedAt: optionalDate,
});

export const retireEmployeeSchema = z.object({
  employeeId: requiredId("社員"),
  retiredAt: requiredDate("退職日"),
  /** 貸与中の端末があることを確認したうえで退職処理を続行する */
  acknowledgeAssignedDevices: z.boolean().default(false),
});

/** 更新用スキーマに追加する対象 ID */
export const idField = { id: requiredId("対象") };

export type DepartmentInput = z.input<typeof departmentSchema>;
export type CategoryInput = z.input<typeof categorySchema>;
export type LocationInput = z.input<typeof locationSchema>;
export type EmployeeInput = z.input<typeof employeeSchema>;
