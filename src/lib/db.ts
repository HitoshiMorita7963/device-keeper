import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

function createClient() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("環境変数 DATABASE_URL が設定されていません。.env.example を参考に設定してください。");
  }
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}

// 開発時のホットリロードで接続が増え続けないよう、グローバルに 1 つだけ保持する
const globalForPrisma = globalThis as unknown as { prisma?: ReturnType<typeof createClient> };

export const db = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;

/** トランザクション内外のどちらでも使えるクライアント型 */
export type DbClient = Omit<typeof db, "$connect" | "$disconnect" | "$on" | "$transaction" | "$extends">;
