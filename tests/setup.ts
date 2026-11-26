import { testDatabaseUrl } from "./test-db-url";

// アプリのコード (src/lib/db.ts) がテスト用 DB に接続するよう差し替える
process.env.DATABASE_URL = testDatabaseUrl();
