// 日付のみの項目 (購入日・保証期限・貸出日など) は DB の date 型で保持し、
// Prisma では UTC 0 時の Date として扱う。業務上の「今日」は日本時間で判定する。

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** 日本時間の今日 (UTC 0 時の Date) */
export function todayJst(now: Date = new Date()): Date {
  const jst = new Date(now.getTime() + JST_OFFSET_MS);
  return new Date(Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate()));
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

/** "YYYY-MM-DD" を date 型用の Date に変換する。不正な値は null */
export function parseDateOnly(value: string): Date | null {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value.trim().replaceAll("/", "-"));
  if (!m) return null;
  const date = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return date.getUTCMonth() === Number(m[2]) - 1 && date.getUTCDate() === Number(m[3]) ? date : null;
}

/** date 型の値を "YYYY-MM-DD" に変換する (フォーム初期値・CSV 用) */
export function toDateInput(date: Date | null | undefined): string {
  return date ? date.toISOString().slice(0, 10) : "";
}

/** 画面表示用 "YYYY/MM/DD" */
export function formatDate(date: Date | null | undefined): string {
  return date ? toDateInput(date).replaceAll("-", "/") : "-";
}

/** 日時の画面表示用 (日本時間) */
export function formatDateTime(date: Date | null | undefined): string {
  if (!date) return "-";
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
