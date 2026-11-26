import type { DeviceStatus } from "@/generated/prisma/enums";

/**
 * Excel 台帳の表記ゆれを、システムの入力形式にそろえる (取り込み時に使用)。
 */

/** 照合用のキー (全角/半角・空白の違いを無視) */
export function matchKey(value: string): string {
  return value.normalize("NFKC").replace(/\s+/g, "").toLowerCase();
}

const ERA_START: Record<string, number> = { 令和: 2019, r: 2019, 平成: 1989, h: 1989, 昭和: 1926, s: 1926, 大正: 1912, t: 1912 };

function ymd(y: number, m: number, d: number): string | null {
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return date.toISOString().slice(0, 10);
}

/**
 * 日付の表記を "YYYY-MM-DD" にする。空欄は ""、読み取れない値は null。
 * 対応: 2024/4/1・2024-04-01・2024.4.1・2024年4月1日・R6.4.1・令和6年4月1日・令和元年5月1日・
 *       時刻付き (2024/4/1 0:00:00)・Excel の日付シリアル値 (45383)
 */
export function normalizeDateText(raw: string): string | null {
  const text = raw.normalize("NFKC").trim().replace(/\s+\d{1,2}:\d{2}(:\d{2})?$/, "");
  if (text === "") return "";

  const western = /^(\d{4})[年./-]\s*(\d{1,2})[月./-]\s*(\d{1,2})日?$/.exec(text);
  if (western) return ymd(Number(western[1]), Number(western[2]), Number(western[3]));

  const era = /^(令和|平成|昭和|大正|[RHST])\s*(元|\d{1,2})[年./-]\s*(\d{1,2})[月./-]\s*(\d{1,2})日?$/i.exec(text);
  if (era) {
    const base = ERA_START[era[1].toLowerCase()] ?? ERA_START[era[1]];
    const year = era[2] === "元" ? 1 : Number(era[2]);
    return ymd(base + year - 1, Number(era[3]), Number(era[4]));
  }

  // Excel のシリアル値 (1900 年 1 月 1 日 = 1。1950〜2150 年の範囲のみ受け付ける)
  const serial = /^(\d{5})(\.\d+)?$/.exec(text);
  if (serial) {
    const date = new Date(Date.UTC(1899, 11, 30) + Number(serial[1]) * 86_400_000);
    const y = date.getUTCFullYear();
    if (y >= 1950 && y <= 2150) return date.toISOString().slice(0, 10);
  }
  return null;
}

/** 金額の表記から ¥・円・カンマ・空白を除く ("¥128,000" → "128000")。整数にできない値はそのまま返す */
export function normalizeAmountText(raw: string): string {
  const text = raw.normalize("NFKC").replace(/[¥\\円,\s]/g, "").replace(/^税抜/, "");
  const m = /^(\d+)(\.0+)?$/.exec(text);
  return m ? m[1] : raw.trim();
}

const STATUS_WORDS: Record<DeviceStatus, string[]> = {
  IN_USE: ["使用中", "使用", "貸出中", "貸出", "貸与中", "貸与", "利用中", "稼働中", "in_use", "inuse"],
  IN_STOCK: ["保管中", "保管", "在庫", "在庫中", "未使用", "予備", "空き", "返却済", "返却済み", "返却", "in_stock", "instock"],
  REPAIR: ["修理中", "修理", "故障", "故障中", "repair"],
  LOST: ["紛失", "紛失中", "lost"],
  DISPOSED: ["廃棄", "廃棄済", "廃棄済み", "disposed"],
};

const STATUS_BY_WORD = new Map(
  (Object.entries(STATUS_WORDS) as [DeviceStatus, string[]][]).flatMap(([status, words]) => words.map((w) => [matchKey(w), status] as const)),
);

/** ステータスの表記を端末状態にする。空欄は null、対応しない表記は undefined */
export function normalizeDeviceStatus(raw: string): DeviceStatus | null | undefined {
  const key = matchKey(raw);
  if (key === "") return null;
  return STATUS_BY_WORD.get(key);
}
