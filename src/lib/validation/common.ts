import { z } from "zod";
import { parseDateOnly } from "@/lib/dates";

// フォームの入力値はすべて文字列で届くため、ここで DB に保存する型へ変換する。
// 同じスキーマを画面 (React Hook Form) とサーバー (Server Action) の両方で使う。

const tooLong = (max: number) => `${max}文字以内で入力してください。`;

export const requiredText = (label: string, max = 100) =>
  z.string().trim().min(1, `${label}を入力してください。`).max(max, tooLong(max));

export const optionalText = (max = 200) =>
  z
    .string()
    .trim()
    .max(max, tooLong(max))
    .transform((v) => (v === "" ? null : v));

/** コード値 (拠点コード・部署コード等)。半角英数字とハイフン・アンダースコア */
export const codeText = (label: string, max = 30) =>
  requiredText(label, max).regex(/^[A-Za-z0-9_-]+$/, `${label}は半角英数字・ハイフン・アンダースコアで入力してください。`);

export const optionalEmail = z
  .string()
  .trim()
  .toLowerCase()
  .max(254, tooLong(254))
  .refine((v) => v === "" || z.email().safeParse(v).success, "メールアドレスの形式が正しくありません。")
  .transform((v) => (v === "" ? null : v));

export const optionalPhone = z
  .string()
  .trim()
  .max(30, tooLong(30))
  .refine((v) => v === "" || /^[0-9+\-() ]+$/.test(v), "電話番号は数字・ハイフンで入力してください。")
  .transform((v) => (v === "" ? null : v));

function toId(v: string | number): number | null {
  if (v === "") return null;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : NaN;
}

export const optionalId = z.union([z.string(), z.number()]).transform((v, ctx) => {
  const id = toId(v);
  if (Number.isNaN(id)) {
    ctx.addIssue({ code: "custom", message: "選択内容が正しくありません。" });
    return z.NEVER;
  }
  return id;
});

export const requiredId = (label: string) =>
  z.union([z.string(), z.number()]).transform((v, ctx) => {
    const id = toId(v);
    if (id === null || Number.isNaN(id)) {
      ctx.addIssue({ code: "custom", message: `${label}を選択してください。` });
      return z.NEVER;
    }
    return id;
  });

export const optionalDate = z
  .string()
  .trim()
  .transform((v, ctx) => {
    if (v === "") return null;
    const date = parseDateOnly(v);
    if (!date) {
      ctx.addIssue({ code: "custom", message: "日付は YYYY-MM-DD 形式で入力してください。" });
      return z.NEVER;
    }
    return date;
  });

export const requiredDate = (label: string) =>
  z
    .string()
    .trim()
    .transform((v, ctx) => {
      const date = v === "" ? null : parseDateOnly(v);
      if (!date) {
        ctx.addIssue({ code: "custom", message: v === "" ? `${label}を入力してください。` : "日付は YYYY-MM-DD 形式で入力してください。" });
        return z.NEVER;
      }
      return date;
    });

/** 0 以上の整数 (金額等)。空欄は null */
export const optionalAmount = z
  .string()
  .trim()
  .transform((v, ctx) => {
    if (v === "") return null;
    const n = Number(v.replaceAll(",", ""));
    if (!Number.isInteger(n) || n < 0 || n > 2_000_000_000) {
      ctx.addIssue({ code: "custom", message: "0 以上の整数で入力してください。" });
      return z.NEVER;
    }
    return n;
  });

export const idParam = z.coerce.number().int().positive();
