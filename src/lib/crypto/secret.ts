import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { BusinessRuleError } from "@/lib/auth/errors";

/**
 * 端末パスワードなどの秘密情報の暗号化 (AES-256-GCM)。
 * 鍵は環境変数 DEVICE_SECRET_KEY (32 バイトを base64 で表した文字列) から読む。
 * 鍵を失うと保存済みのパスワードは復号できなくなるため、DB のバックアップとは別の安全な場所に保管すること。
 * 形式: "v1:" + base64(IV 12 バイト + 認証タグ 16 バイト + 暗号文)
 */
const VERSION = "v1";

/** 鍵の未設定・不一致など。利用者にそのまま表示できるメッセージを持つ */
export class SecretKeyError extends BusinessRuleError {
  constructor(message: string) {
    super(message);
    this.name = "SecretKeyError";
  }
}

function key(): Buffer {
  const raw = process.env.DEVICE_SECRET_KEY;
  if (!raw) throw new SecretKeyError("暗号鍵 (環境変数 DEVICE_SECRET_KEY) が設定されていないため、パスワードを保存・表示できません。");
  const buf = Buffer.from(raw, "base64");
  if (buf.length !== 32) throw new SecretKeyError("暗号鍵 (DEVICE_SECRET_KEY) は 32 バイトを base64 で表した値にしてください。");
  return buf;
}

export function hasSecretKey(): boolean {
  try {
    key();
    return true;
  } catch {
    return false;
  }
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return `${VERSION}:${Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64")}`;
}

export function decryptSecret(stored: string): string {
  const [version, payload] = stored.split(":");
  if (version !== VERSION || !payload) throw new SecretKeyError("保存されているパスワードの形式が正しくありません。");
  const buf = Buffer.from(payload, "base64");
  const decipher = createDecipheriv("aes-256-gcm", key(), buf.subarray(0, 12));
  decipher.setAuthTag(buf.subarray(12, 28));
  try {
    return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString("utf8");
  } catch {
    throw new SecretKeyError("パスワードを復号できません。暗号鍵 (DEVICE_SECRET_KEY) が保存時と異なる可能性があります。");
  }
}

/** 空文字・未指定は null (パスワードなし) として扱う */
export function encryptOptional(plain: string | null | undefined): string | null {
  return plain ? encryptSecret(plain) : null;
}
