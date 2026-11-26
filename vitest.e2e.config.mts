import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/** 画面表示・権限の E2E テスト。本番ビルドしたアプリをテスト用 DB で起動して HTTP で確認する */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": fileURLToPath(new URL("./tests/stubs/server-only.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/e2e/**/*.test.ts"],
    globalSetup: ["tests/global-setup.ts", "tests/e2e/server.ts"],
    setupFiles: ["tests/setup.ts"],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 180_000,
  },
});
