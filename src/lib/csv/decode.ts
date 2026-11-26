/**
 * CSV ファイルのバイト列を文字列にする。
 * UTF-8 として正しく読めればそのまま使い、読めなければ Excel 既定の Shift_JIS とみなす。先頭の BOM は除く。
 */
export function decodeCsvBytes(buffer: ArrayBuffer | Uint8Array): { text: string; encoding: "UTF-8" | "Shift_JIS" } {
  let text: string;
  let encoding: "UTF-8" | "Shift_JIS" = "UTF-8";
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    text = new TextDecoder("shift_jis").decode(buffer);
    encoding = "Shift_JIS";
  }
  return { text: text.replace(/^\uFEFF/, ""), encoding };
}
