import { testDatabaseUrl } from "./test-db-url";

// アプリのコード (src/lib/db.ts) がテスト用 DB に接続するよう差し替える
process.env.DATABASE_URL = testDatabaseUrl();

// 端末パスワードの暗号化テスト用の鍵 (未設定の環境でもテストできるように固定値を使う)
process.env.DEVICE_SECRET_KEY ??= Buffer.alloc(32, 7).toString("base64");
