import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/list";
import { addDays, formatDate, todayJst } from "@/lib/dates";
import type { searchAssignments } from "@/server/assignments";
import { DUE_SOON_DAYS } from "@/server/assignments";

type Row = Awaited<ReturnType<typeof searchAssignments>>["rows"][number];

/** 返却予定日の表示 (期限超過・期限間近を強調) */
function DueDate({ row }: { row: Row }) {
  const today = todayJst();
  if (!row.expectedReturnAt) return <span className="text-muted-foreground">なし</span>;
  const overdue = !row.returnedAt && row.expectedReturnAt < today;
  const soon = !row.returnedAt && !overdue && row.expectedReturnAt <= addDays(today, DUE_SOON_DAYS);
  const days = Math.round((today.getTime() - row.expectedReturnAt.getTime()) / 86_400_000);
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {formatDate(row.expectedReturnAt)}
      {overdue ? <Badge variant="destructive">{days}日超過</Badge> : null}
      {soon ? <Badge variant="outline">まもなく</Badge> : null}
    </span>
  );
}

export function AssignmentTable({ rows, showReturnButton }: { rows: Row[]; showReturnButton?: boolean }) {
  if (rows.length === 0) return <EmptyState>該当する貸出はありません。</EmptyState>;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>資産管理番号</TableHead>
          <TableHead>資産名称</TableHead>
          <TableHead>利用者</TableHead>
          <TableHead>部署</TableHead>
          <TableHead>貸出日</TableHead>
          <TableHead>返却予定日</TableHead>
          <TableHead>返却日</TableHead>
          <TableHead>担当</TableHead>
          {showReturnButton ? <TableHead className="w-20" /> : null}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((a) => (
          <TableRow key={a.id}>
            <TableCell className="font-mono">
              <Link href={`/devices/${a.device.id}`} className="text-primary hover:underline">
                {a.device.assetNumber}
              </Link>
            </TableCell>
            <TableCell className="max-w-48 truncate">{a.device.name}</TableCell>
            <TableCell>
              <Link href={`/employees/${a.employee.id}`} className="hover:underline">
                {a.employee.name}
              </Link>
            </TableCell>
            <TableCell>{a.employee.department?.name ?? "-"}</TableCell>
            <TableCell>{formatDate(a.assignedAt)}</TableCell>
            <TableCell>
              <DueDate row={a} />
            </TableCell>
            <TableCell>{a.returnedAt ? formatDate(a.returnedAt) : <Badge variant="secondary">貸出中</Badge>}</TableCell>
            <TableCell className="text-xs text-muted-foreground">
              {a.assignedBy?.displayName ?? "-"}
              {a.returnedBy ? ` / ${a.returnedBy.displayName}` : ""}
            </TableCell>
            {showReturnButton ? (
              <TableCell>
                {!a.returnedAt ? (
                  <Button asChild size="sm" variant="outline">
                    <Link href={`/assignments/return?device=${a.device.id}`}>返却</Link>
                  </Button>
                ) : null}
              </TableCell>
            ) : null}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
