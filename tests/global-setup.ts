import { execSync } from "node:child_process";
import { testDatabaseUrl } from "./test-db-url";

/** テスト開始前にテスト用 DB へマイグレーションを適用する */
export default function setup() {
  execSync("npx prisma migrate deploy", {
    stdio: "pipe",
    env: { ...process.env, DATABASE_URL: testDatabaseUrl() },
  });
}
