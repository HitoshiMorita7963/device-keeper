import { describe, expect, it } from "vitest";
import { formatDate, parseDateOnly, todayJst, toDateInput } from "@/lib/dates";

describe("日付ユーティリティ", () => {
  it("日本時間で日付が変わった直後を今日として扱う", () => {
    // 2026-01-01 00:30 JST = 2025-12-31 15:30 UTC
    expect(toDateInput(todayJst(new Date("2025-12-31T15:30:00Z")))).toBe("2026-01-01");
    expect(toDateInput(todayJst(new Date("2025-12-31T14:59:00Z")))).toBe("2025-12-31");
  });

  it("YYYY-MM-DD と YYYY/MM/DD を解釈し、存在しない日付は null", () => {
    expect(toDateInput(parseDateOnly("2026-04-01"))).toBe("2026-04-01");
    expect(toDateInput(parseDateOnly("2026/4/1"))).toBe("2026-04-01");
    expect(parseDateOnly("2026-02-30")).toBeNull();
    expect(parseDateOnly("abc")).toBeNull();
  });

  it("表示形式", () => {
    expect(formatDate(parseDateOnly("2026-04-01"))).toBe("2026/04/01");
    expect(formatDate(null)).toBe("-");
  });
});
