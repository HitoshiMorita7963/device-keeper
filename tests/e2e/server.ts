import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { testDatabaseUrl } from "../test-db-url";

export const E2E_PORT = Number(process.env.E2E_PORT ?? 3100);

/** 本番ビルド (npm run build 済み) をテスト用 DB に接続して起動し、テスト終了後に停止する */
export default async function setup() {
  let server: ChildProcess | null = spawn(process.execPath, [path.resolve("node_modules/next/dist/bin/next"), "start", "-p", String(E2E_PORT)], {
    env: { ...process.env, DATABASE_URL: testDatabaseUrl(), NODE_ENV: "production", SESSION_COOKIE_SECURE: "false" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  server.stdout?.on("data", (d) => (output += d));
  server.stderr?.on("data", (d) => (output += d));

  const deadline = Date.now() + 90_000;
  for (;;) {
    try {
      const res = await fetch(`http://localhost:${E2E_PORT}/login`);
      if (res.ok) break;
    } catch {
      // 起動待ち
    }
    if (Date.now() > deadline) throw new Error(`E2E 用サーバーが起動しませんでした:\n${output}`);
    await new Promise((r) => setTimeout(r, 500));
  }

  return async () => {
    server?.kill();
    server = null;
  };
}
