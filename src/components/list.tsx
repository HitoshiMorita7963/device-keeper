import Link from "next/link";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { DeviceStatus, EmploymentStatus } from "@/generated/prisma/enums";
import { DEVICE_STATUS_LABELS, EMPLOYMENT_STATUS_LABELS } from "@/lib/labels";
import { PAGE_SIZE } from "@/lib/pagination";

/** 一覧のページ送り。検索条件を保ったままページ番号だけを変える */
export function Pager({
  basePath,
  params,
  page,
  total,
  pageSize = PAGE_SIZE,
}: {
  basePath: string;
  params: Record<string, string | undefined>;
  page: number;
  total: number;
  pageSize?: number;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const href = (p: number) => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v && k !== "page") sp.set(k, v);
    if (p > 1) sp.set("page", String(p));
    const qs = sp.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  };
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
      <span>
        全 {total} 件中 {from}〜{to} 件を表示
      </span>
      {pages > 1 ? (
        <nav className="flex items-center gap-2" aria-label="ページ送り">
          {page > 1 ? (
            <Button asChild variant="outline" size="sm">
              <Link href={href(page - 1)}>前へ</Link>
            </Button>
          ) : (
            <Button variant="outline" size="sm" disabled>
              前へ
            </Button>
          )}
          <span className="tabular-nums">
            {page} / {pages}
          </span>
          {page < pages ? (
            <Button asChild variant="outline" size="sm">
              <Link href={href(page + 1)}>次へ</Link>
            </Button>
          ) : (
            <Button variant="outline" size="sm" disabled>
              次へ
            </Button>
          )}
        </nav>
      ) : null}
    </div>
  );
}

export function ActiveBadge({ active }: { active: boolean }) {
  return active ? <Badge variant="secondary">使用中</Badge> : <Badge variant="outline">使用停止</Badge>;
}

export function EmploymentStatusBadge({ status }: { status: EmploymentStatus }) {
  const variant = status === "ACTIVE" ? "secondary" : status === "RETIRED" ? "outline" : "default";
  return <Badge variant={variant}>{EMPLOYMENT_STATUS_LABELS[status]}</Badge>;
}

const DEVICE_STATUS_CLASS: Record<DeviceStatus, string> = {
  IN_STOCK: "bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200",
  IN_USE: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
  REPAIR: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  LOST: "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200",
  DISPOSED: "bg-muted text-muted-foreground",
};

export function DeviceStatusBadge({ status }: { status: DeviceStatus }) {
  return (
    <Badge variant="outline" className={`border-transparent ${DEVICE_STATUS_CLASS[status]}`}>
      {DEVICE_STATUS_LABELS[status]}
    </Badge>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="py-6 text-center text-sm text-muted-foreground">{children}</p>;
}

/** 詳細画面の「項目名: 値」表示 */
export function DetailList({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((item) => (
        <div key={item.label} className="min-w-0">
          <dt className="text-xs text-muted-foreground">{item.label}</dt>
          <dd className="mt-0.5 break-words text-sm">{item.value ?? "-"}</dd>
        </div>
      ))}
    </dl>
  );
}
