import { db } from "@/lib/db";
import { hashPassword } from "@/lib/auth/password";
import type { Role } from "@/generated/prisma/enums";

/** テスト用 DB の全テーブルを空にし、資産種別マスタだけを投入し直す */
export async function resetDb() {
  const tables = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tables.length) {
    await db.$executeRawUnsafe(
      `TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`,
    );
  }
  for (const c of [
    { categoryCode: "PC", name: "PC", prefix: "PC" },
    { categoryCode: "SP", name: "スマートフォン", prefix: "SP" },
    { categoryCode: "TAB", name: "タブレット", prefix: "TAB" },
  ]) {
    await db.deviceCategory.create({ data: { ...c, sequence: { create: {} } } });
  }
}

export const TEST_PASSWORD = "correct-horse-battery";

export async function createUser(role: Role, overrides: { email?: string; employeeId?: number; isActive?: boolean } = {}) {
  return db.user.create({
    data: {
      email: overrides.email ?? `${role.toLowerCase()}-${Math.random().toString(36).slice(2, 8)}@example.com`,
      displayName: `${role} user`,
      role,
      passwordHash: await hashPassword(TEST_PASSWORD),
      employeeId: overrides.employeeId,
      isActive: overrides.isActive ?? true,
    },
  });
}

export async function createLocation(code = "HQ") {
  return db.location.create({ data: { locationCode: code, name: `${code}拠点` } });
}

export async function createDevice(locationId: number, overrides: { assetNumber?: string; status?: "IN_STOCK" | "IN_USE" | "REPAIR" | "LOST" | "DISPOSED" } = {}) {
  const category = await db.deviceCategory.findUniqueOrThrow({ where: { categoryCode: "PC" } });
  return db.device.create({
    data: {
      assetNumber: overrides.assetNumber ?? `PC-${Math.random().toString().slice(2, 8)}`,
      name: "テストPC",
      categoryId: category.id,
      currentLocationId: locationId,
      status: overrides.status ?? "IN_STOCK",
    },
  });
}

export async function createEmployee(number = "E0001") {
  return db.employee.create({ data: { employeeNumber: number, name: `社員${number}` } });
}
