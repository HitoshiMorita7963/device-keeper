"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import type { FieldValues, Resolver } from "react-hook-form";
import type { z } from "zod";

/**
 * 画面側の入力チェック用 resolver。
 * 変換後の値ではなく入力値のまま送信する (Server Action 側で同じスキーマにより再検証・変換するため)。
 */
export function formResolver<S extends z.ZodType<unknown, FieldValues>>(schema: S): Resolver<z.input<S>> {
  return zodResolver(schema, undefined, { raw: true }) as unknown as Resolver<z.input<S>>;
}
