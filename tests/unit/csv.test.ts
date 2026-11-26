import { describe, expect, it } from "vitest";
import { csvCell, stripFormulaGuard, toCsv } from "@/lib/csv/format";
import { guessMapping } from "@/lib/csv/fields";

describe("CSV 出力", () => {
  it("BOM 付き・CRLF で出力し、カンマ・改行・引用符をエスケープする", () => {
    const csv = toCsv(["名称", "備考"], [["PC, 予備", '「A」"B"\n2行目'], [null, 0]]);
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toBe('\uFEFF名称,備考\r\n"PC, 予備","「A」""B""\n2行目"\r\n,0\r\n');
  });

  it("数式として解釈されるセルを無害化する (負の数値はそのまま)", () => {
    expect(csvCell("=HYPERLINK(\"http://evil\")")).toBe("\"'=HYPERLINK(\"\"http://evil\"\")\"");
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvCell("-1500")).toBe("-1500");
    expect(stripFormulaGuard("'=1+1")).toBe("=1+1");
    expect(stripFormulaGuard("'通常の値")).toBe("'通常の値");
  });
});

describe("項目の自動対応付け", () => {
  it("項目名・別名・エクスポートの見出しから列を推定する", () => {
    const mapping = guessMapping("devices", ["\uFEFF資産管理番号", "名称", "種別", "設置場所", "シリアル", "不明な列"]);
    expect(mapping).toMatchObject({ assetNumber: 0, name: 1, category: 2, location: 3, serialNumber: 4, model: null });
  });
});

describe("CSV の文字コード判定", () => {
  it("Excel で保存した Shift_JIS を読み込める", async () => {
    const { decodeCsvBytes } = await import("@/lib/csv/decode");
    // "PC-1,テスト\r\n" を Shift_JIS で表したバイト列
    const sjis = new Uint8Array([0x50, 0x43, 0x2d, 0x31, 0x2c, 0x83, 0x65, 0x83, 0x58, 0x83, 0x67, 0x0d, 0x0a]);
    expect(decodeCsvBytes(sjis)).toEqual({ text: "PC-1,テスト\r\n", encoding: "Shift_JIS" });
  });

  it("UTF-8 (BOM 付き) は BOM を除いてそのまま読み込む", async () => {
    const { decodeCsvBytes } = await import("@/lib/csv/decode");
    const bytes = new TextEncoder().encode("\uFEFF資産名称\r\nノートPC");
    expect(decodeCsvBytes(bytes)).toEqual({ text: "資産名称\r\nノートPC", encoding: "UTF-8" });
  });
});
