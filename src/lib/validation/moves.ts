import { z } from "zod";
import { requiredDate, requiredId, requiredText } from "./common";

/** 移動元は端末の現在拠点をサーバー側で使うため、入力には含めない */
export const moveSchema = z.object({
  deviceId: requiredId("対象端末"),
  toLocationId: requiredId("移動先拠点"),
  movedAt: requiredDate("移動日"),
  movedById: requiredId("担当者"),
  reason: requiredText("移動理由", 500),
});

export type MoveInput = z.input<typeof moveSchema>;
