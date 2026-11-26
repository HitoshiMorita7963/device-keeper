import { afterEach, describe, expect, it } from "vitest";
import { guessMapping } from "@/lib/csv/fields";
import { normalizeAmountText, normalizeDateText, normalizeDeviceStatus } from "@/lib/csv/normalize";
import { decryptSecret, encryptSecret, hasSecretKey } from "@/lib/crypto/secret";
import { LEDGER_HEADERS } from "../helpers/ledger";

describe("Excel 台帳の見出しの自動対応付け", () => {
  it("台帳のすべての列を端末の項目に対応付ける", () => {
    const mapping = guessMapping("devices", LEDGER_HEADERS);
    const col = (h: string) => LEDGER_HEADERS.indexOf(h);
    expect(mapping).toMatchObject({
      assigneeName: col("氏名"),
      assigneeDepartment: col("所属"),
      location: col("拠点"),
      purpose: col("用途"),
      assetNumber: col("端末番号"),
      hostname: col("ホスト名"),
      initialUser: col("初期ユーザ"),
      initialPassword: col("PW"),
      loginUser: col("ユーザー名"),
      loginPassword: col("PW2"),
      purchaseDate: col("購入日"),
      purchasePrice: col("購入価格（税抜）"),
      assignedAt: col("貸出日"),
      expectedReturnAt: col("返却予定日"),
      homeLoanedAt: col("自宅貸出日"),
      status: col("ステータス"),
      recovery: col("リカバリ"),
      returnedAt: col("返却日"),
      manufacturer: col("メーカー"),
      model: col("機種名"),
      osName: col("OS"),
      cpu: col("CPU"),
      memory: col("メモリ"),
      disk: col("ディスク"),
      warrantyExpiry: col("サポート"),
      notes: col("備考①"),
      notes2: col("備考②"),
      category: null,
    });
    // すべての列がいずれかの項目に使われている
    expect(new Set(Object.values(mapping).filter((v) => v !== null)).size).toBe(LEDGER_HEADERS.length);
  });
});

describe("表記ゆれの吸収", () => {
  it.each([
    ["2024/4/1", "2024-04-01"],
    ["2024-04-01", "2024-04-01"],
    ["2024.4.1", "2024-04-01"],
    ["2024年4月1日", "2024-04-01"],
    ["２０２４／４／１", "2024-04-01"],
    ["2024/4/1 0:00:00", "2024-04-01"],
    ["R6.4.1", "2024-04-01"],
    ["令和6年4月1日", "2024-04-01"],
    ["令和元年5月1日", "2019-05-01"],
    ["H31.4.30", "2019-04-30"],
    ["45383", "2024-04-01"],
    ["", ""],
  ])("日付 %s → %s", (raw, expected) => {
    expect(normalizeDateText(raw)).toBe(expected);
  });

  it.each(["2024/2/30", "あり", "3年保守", "12345", "不明"])("日付として読めない値 %s は null", (raw) => {
    expect(normalizeDateText(raw)).toBeNull();
  });

  it("金額から ¥・円・カンマを除く", () => {
    expect(normalizeAmountText("¥128,000")).toBe("128000");
    expect(normalizeAmountText("128,000円")).toBe("128000");
    expect(normalizeAmountText("￥９８，０００")).toBe("98000");
    expect(normalizeAmountText("98000.00")).toBe("98000");
    expect(normalizeAmountText("約10万")).toBe("約10万");
  });

  it("ステータスの言い換えを端末状態にする", () => {
    expect(normalizeDeviceStatus("貸出中")).toBe("IN_USE");
    expect(normalizeDeviceStatus("使用中")).toBe("IN_USE");
    expect(normalizeDeviceStatus("在庫")).toBe("IN_STOCK");
    expect(normalizeDeviceStatus("返却済み")).toBe("IN_STOCK");
    expect(normalizeDeviceStatus("故障")).toBe("REPAIR");
    expect(normalizeDeviceStatus("紛失")).toBe("LOST");
    expect(normalizeDeviceStatus("廃棄")).toBe("DISPOSED");
    expect(normalizeDeviceStatus("")).toBeNull();
    expect(normalizeDeviceStatus("検討中")).toBeUndefined();
  });
});

describe("端末パスワードの暗号化", () => {
  const original = process.env.DEVICE_SECRET_KEY;
  afterEach(() => {
    process.env.DEVICE_SECRET_KEY = original;
  });

  it("暗号化した値は元のパスワードを含まず、同じ鍵で復号できる", () => {
    const enc = encryptSecret("P@ssw0rd!日本語");
    expect(enc).not.toContain("P@ssw0rd");
    expect(enc).not.toBe(encryptSecret("P@ssw0rd!日本語")); // 毎回異なる値になる
    expect(decryptSecret(enc)).toBe("P@ssw0rd!日本語");
  });

  it("鍵が違う・鍵がない場合は分かりやすいエラー", () => {
    const enc = encryptSecret("secret");
    process.env.DEVICE_SECRET_KEY = Buffer.alloc(32, 1).toString("base64");
    expect(() => decryptSecret(enc)).toThrow(/復号できません/);
    delete process.env.DEVICE_SECRET_KEY;
    expect(hasSecretKey()).toBe(false);
    expect(() => encryptSecret("x")).toThrow(/DEVICE_SECRET_KEY/);
  });
});
