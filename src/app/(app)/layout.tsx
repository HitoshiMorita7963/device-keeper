import Link from "next/link";
import { KeyRound, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MobileNav, SideNav } from "@/components/layout/side-nav";
import { requireUser } from "@/lib/auth/session";
import { ROLE_LABELS } from "@/lib/auth/permissions";
import { APP_NAME } from "@/lib/constants";
import { logoutAction } from "../login/actions";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await requireUser();

  return (
    <div className="flex min-h-svh flex-col">
      <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/95 px-3 backdrop-blur md:px-5">
        <MobileNav role={user.role} appName={APP_NAME} />
        <Link href="/" className="truncate font-semibold">
          {APP_NAME}
        </Link>
        <div className="ml-auto flex items-center gap-3">
          <div className="hidden text-right leading-tight sm:block">
            <div className="text-sm font-medium">{user.displayName}</div>
            <div className="text-xs text-muted-foreground">{ROLE_LABELS[user.role]}</div>
          </div>
          <Button asChild variant="ghost" size="icon-sm" aria-label="パスワード変更" title="パスワード変更">
            <Link href="/account/password">
              <KeyRound aria-hidden />
            </Link>
          </Button>
          <form action={logoutAction}>
            <Button type="submit" variant="outline" size="sm" aria-label="ログアウト">
              <LogOut aria-hidden />
              <span className="hidden sm:inline">ログアウト</span>
            </Button>
          </form>
        </div>
      </header>
      <div className="flex flex-1">
        <SideNav role={user.role} />
        <main className="min-w-0 flex-1 p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
