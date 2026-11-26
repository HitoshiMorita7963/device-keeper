/**
 * CSV 出力。Excel で文字化けしないよう UTF-8 (BOM 付き)・改行 CRLF で出力する。
 * 先頭が = + - @ などのセルは、表計算ソフトで数式として実行されないよう先頭に ' を付ける (CSV インジェクション対策)。
 */
const FORMULA_PREFIX = /^[=+\-@\t\r]/;

export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let text = value instanceof Date ? value.toISOString() : String(value);
  if (FORMULA_PREFIX.test(text) && !/^-?\d+(\.\d+)?$/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  const lines = [headers, ...rows].map((row) => row.map(csvCell).join(","));
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

/** 出力時に付けた ' を取り除く (エクスポートした CSV を再取り込みする場合) */
export function stripFormulaGuard(value: string): string {
  return value.startsWith("'") && FORMULA_PREFIX.test(value.slice(1)) ? value.slice(1) : value;
}
