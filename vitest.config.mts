import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // Server Component 専用モジュールをテストから読み込めるようにする
      "server-only": fileURLToPath(new URL("./tests/stubs/server-only.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // 画面の E2E テストは本番ビルドを使うため別コマンド (npm run test:e2e) で実行する
    exclude: ["tests/e2e/**", "node_modules/**"],
    globalSetup: ["tests/global-setup.ts"],
    setupFiles: ["tests/setup.ts"],
    // 結合テストは同じテスト用 DB を使うため直列に実行する
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
