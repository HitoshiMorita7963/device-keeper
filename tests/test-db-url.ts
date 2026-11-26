import "dotenv/config";

/** テスト用 DB の接続文字列。誤って開発・本番 DB を消さないよう DB 名に "test" を含むことを必須にする */
export function testDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL が設定されていません (.env.example を参照)。");
  const name = new URL(url).pathname.replace(/^\//, "");
  if (!name.includes("test")) {
    throw new Error(`TEST_DATABASE_URL のデータベース名に "test" が含まれていません: ${name}`);
  }
  if (url === process.env.DATABASE_URL) throw new Error("TEST_DATABASE_URL と DATABASE_URL が同じです。");
  return url;
}
