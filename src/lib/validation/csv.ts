import { z } from "zod";
import { IMPORT_LIMITS } from "@/lib/csv/fields";

const cell = z.string().max(IMPORT_LIMITS.maxCellLength, `1 つのセルは ${IMPORT_LIMITS.maxCellLength} 文字以内にしてください。`);

export const importRequestSchema = z.object({
  target: z.enum(["devices", "employees", "locations"], { error: "取り込み対象を選択してください。" }),
  mode: z.enum(["skip", "upsert"]),
  headers: z.array(cell).min(1).max(IMPORT_LIMITS.maxColumns, `列数は ${IMPORT_LIMITS.maxColumns} 列以内にしてください。`),
  rows: z
    .array(z.array(cell).max(IMPORT_LIMITS.maxColumns))
    .min(1, "データ行がありません。")
    .max(IMPORT_LIMITS.maxRows, `1 回に取り込めるのは ${IMPORT_LIMITS.maxRows} 行までです。ファイルを分割してください。`),
  mapping: z.record(z.string(), z.number().int().min(0).nullable()),
  /** 端末の取り込みでのみ使う追加設定 */
  options: z
    .object({
      defaultCategoryId: z.number().int().positive().nullable(),
      autoCreate: z.boolean(),
    })
    .default({ defaultCategoryId: null, autoCreate: false }),
});

/** Server Action に渡す値 (options は省略可) */
export type ImportRequestInput = z.input<typeof importRequestSchema>;
/** 検証後の値 */
export type ImportRequest = z.output<typeof importRequestSchema>;
