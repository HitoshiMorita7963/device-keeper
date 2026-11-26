import { vi } from "vitest";
import { authenticate } from "@/lib/auth/login";
import { TEST_PASSWORD } from "./db";

/**
 * Server Action をテストから呼ぶための擬似リクエスト。
 * next/headers の Cookie だけを差し替え、セッション検証・権限チェックは本物のコードで行う。
 * 使う側のテストファイルで次のモックを宣言すること:
 *   vi.mock("next/headers", () => import("../helpers/request").then((m) => m.nextHeadersMock));
 *   vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
 */
const state = { token: null as string | null };

export const nextHeadersMock = {
  cookies: async () => ({
    get: (name: string) => (name === "dk_session" && state.token ? { name, value: state.token } : undefined),
    set: vi.fn(),
    delete: vi.fn(),
  }),
  headers: async () => new Headers({ "x-forwarded-for": "198.51.100.7", "user-agent": "vitest" }),
};

/** 指定の利用者でログインした状態にする */
export async function loginAs(email: string) {
  const result = await authenticate(email, TEST_PASSWORD, { ipAddress: null, userAgent: null });
  if (!result.ok) throw new Error(`login failed: ${result.error}`);
  state.token = result.token;
}

export function logout() {
  state.token = null;
}
