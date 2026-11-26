import bcrypt from "bcryptjs";

export { MIN_PASSWORD_LENGTH } from "./password-policy";

const COST = 12;

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, COST);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

// 存在しないユーザーでも照合時間を揃え、アカウントの有無を推測されにくくする
const DUMMY_HASH = bcrypt.hashSync("dummy-password-for-timing", COST);
export async function dummyVerify(plain: string): Promise<void> {
  await bcrypt.compare(plain, DUMMY_HASH);
}
