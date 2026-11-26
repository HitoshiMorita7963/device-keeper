import { createHash, randomBytes } from "node:crypto";

/** Cookie に渡すセッショントークン (256bit) を生成する */
export function generateSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

/** DB にはトークンそのものではなくハッシュを保存する (DB 漏えい時のなりすまし防止) */
export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
