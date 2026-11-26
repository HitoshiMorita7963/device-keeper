import { NextResponse, type NextRequest } from "next/server";

// セッション Cookie の有無だけを見る楽観的チェック。
// セッションの有効性と権限は各画面・Server Action 側 (src/lib/auth/session.ts) で必ず検証する。
const SESSION_COOKIE = "dk_session";
const PUBLIC_PATHS = ["/login"];
/** 端末連携キーで認証する API (ログイン Cookie を使わない) */
const DEVICE_API = /^\/api\/devices\/[^/]+\/computer-name$/;

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`)) || DEVICE_API.test(pathname)) {
    return NextResponse.next();
  }
  if (!request.cookies.has(SESSION_COOKIE)) {
    const url = new URL("/login", request.url);
    if (pathname !== "/") url.searchParams.set("next", `${pathname}${search}`);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  // 静的ファイルと Next.js 内部パスは対象外
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
