// 初期データ投入 (何度実行しても同じ結果になるよう upsert で登録する)
//   - 資産種別マスタ (PC / SP / TAB / MON / PER)
//   - 初期管理者アカウント (SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD)
import "dotenv/config";
import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { hashPassword, MIN_PASSWORD_LENGTH } from "../src/lib/auth/password";

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });

const CATEGORIES = [
  { categoryCode: "PC", name: "PC", prefix: "PC" },
  { categoryCode: "SP", name: "スマートフォン", prefix: "SP" },
  { categoryCode: "TAB", name: "タブレット", prefix: "TAB" },
  { categoryCode: "MON", name: "モニター", prefix: "MON" },
  { categoryCode: "PER", name: "周辺機器", prefix: "PER" },
];

async function main() {
  for (const c of CATEGORIES) {
    const category = await db.deviceCategory.upsert({ where: { categoryCode: c.categoryCode }, update: {}, create: c });
    await db.assetNumberSequence.upsert({ where: { categoryId: category.id }, update: {}, create: { categoryId: category.id } });
  }
  console.log(`資産種別: ${CATEGORIES.map((c) => c.categoryCode).join(", ")}`);

  const email = (process.env.SEED_ADMIN_EMAIL ?? "admin@example.com").trim().toLowerCase();
  const existing = await db.user.findUnique({ where: { email } });
  if (existing) {
    console.log(`管理者アカウントは登録済みです: ${email}`);
    return;
  }

  let password = process.env.SEED_ADMIN_PASSWORD ?? "";
  let generated = false;
  if (!password) {
    password = randomBytes(12).toString("base64url");
    generated = true;
  } else if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`SEED_ADMIN_PASSWORD は${MIN_PASSWORD_LENGTH}文字以上にしてください。`);
  }

  const user = await db.user.create({
    data: { email, displayName: "システム管理者", role: "ADMIN", passwordHash: await hashPassword(password) },
  });
  await db.auditLog.create({
    data: { action: "CREATE", entityType: "User", entityId: String(user.id), afterData: { email, role: "ADMIN", source: "seed" } },
  });

  console.log(`管理者アカウントを作成しました: ${email}`);
  if (generated) {
    // 初回のみ表示する。ログイン後、システム設定からパスワードを変更すること
    console.log(`初期パスワード: ${password}`);
    console.log("※ この初期パスワードは再表示されません。安全な場所に控え、ログイン後に変更してください。");
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
