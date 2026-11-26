import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

/**
 * アプリ・スクリプト共通の Prisma クライアントを作る。
 * 暗号化したパスワードは既定で取得しない。必要な処理 (管理者による表示) でのみ明示的に選択する。
 */
export function createDbClient(connectionString: string | undefined = process.env.DATABASE_URL) {
  if (!connectionString) {
    throw new Error("環境変数 DATABASE_URL が設定されていません。.env.example を参考に設定してください。");
  }
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
    omit: { device: { initialPasswordEnc: true, loginPasswordEnc: true, agentTokenHash: true } },
  });
}

export type AppPrismaClient = ReturnType<typeof createDbClient>;

// 開発時のホットリロードで接続が増え続けないよう、グローバルに 1 つだけ保持する
const globalForPrisma = globalThis as unknown as { prisma?: AppPrismaClient };

export const db = globalForPrisma.prisma ?? createDbClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;

/** トランザクション内外のどちらでも使えるクライアント型 */
export type DbClient = Omit<typeof db, "$connect" | "$disconnect" | "$on" | "$transaction" | "$extends">;
