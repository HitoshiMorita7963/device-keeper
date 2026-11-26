import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { requireUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { getDashboardSummary, WARRANTY_WARNING_DAYS } from "@/lib/dashboard";
import { formatDateTime } from "@/lib/dates";
import { actionLabel, entityLabel } from "@/lib/labels";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "ダッシュボード" };

export default async function DashboardPage() {
  const user = await requireUser();
  if (!can(user.role, "dashboard:view")) redirect("/my");

  const s = await getDashboardSummary();
  const cards = [
    { label: "登録端末総数", value: s.total, href: "/devices" },
    { label: "使用中", value: s.inUse, href: "/devices?status=IN_USE" },
    { label: "保管中", value: s.inStock, href: "/devices?status=IN_STOCK" },
    { label: "修理中", value: s.repair, href: "/devices?status=REPAIR" },
    { label: "紛失", value: s.lost, href: "/devices?status=LOST", alert: s.lost > 0 },
    { label: "返却期限超過", value: s.overdue, href: "/devices?overdue=1", alert: s.overdue > 0 },
    {
      label: `保証期限間近 (${WARRANTY_WARNING_DAYS}日以内)`,
      value: s.warrantySoon,
      href: "/devices?warranty=soon",
      alert: s.warrantySoon > 0,
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="ダッシュボード" />

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7" aria-label="端末集計">
        {cards.map((c) => (
          <Link key={c.label} href={c.href} className="group">
            <Card className={cn("h-full transition-colors group-hover:bg-muted/50", c.alert && "border-destructive/50")}>
              <CardHeader className="pb-1">
                <CardTitle className="text-xs font-medium text-muted-foreground">{c.label}</CardTitle>
              </CardHeader>
              <CardContent>
                <span className={cn("text-3xl font-semibold tabular-nums", c.alert && "text-destructive")}>
                  {c.value}
                </span>
                <span className="ml-1 text-sm text-muted-foreground">台</span>
              </CardContent>
            </Card>
          </Link>
        ))}
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">拠点別端末保有数</CardTitle>
          </CardHeader>
          <CardContent>
            {s.byLocation.length === 0 ? (
              <p className="text-sm text-muted-foreground">拠点が登録されていません。</p>
            ) : (
              <ul className="divide-y">
                {s.byLocation.map((l) => (
                  <li key={l.id} className="flex items-center justify-between py-2 text-sm">
                    <Link href={`/locations/${l.id}`} className="hover:underline">
                      {l.name}
                    </Link>
                    <span className="tabular-nums">{l.count} 台</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">最近の操作履歴</CardTitle>
          </CardHeader>
          <CardContent>
            {s.recentLogs.length === 0 ? (
              <p className="text-sm text-muted-foreground">操作履歴はまだありません。</p>
            ) : (
              <ul className="divide-y">
                {s.recentLogs.map((log) => (
                  <li key={log.id} className="flex flex-wrap items-baseline justify-between gap-x-3 py-2 text-sm">
                    <span>
                      {entityLabel(log.entityType)}を{actionLabel(log.action)}
                      <span className="ml-2 text-muted-foreground">{log.user?.displayName ?? "システム"}</span>
                    </span>
                    <span className="text-xs text-muted-foreground tabular-nums">{formatDateTime(log.createdAt)}</span>
                  </li>
                ))}
              </ul>
            )}
            {can(user.role, "audit:read") ? (
              <Link href="/audit-logs" className="mt-3 inline-block text-sm text-primary hover:underline">
                すべての操作履歴を見る
              </Link>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
