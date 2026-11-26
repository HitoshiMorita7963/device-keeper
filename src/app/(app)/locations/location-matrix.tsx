import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/list";
import type { locationCategoryMatrix } from "@/server/moves";

/** 拠点別・資産種別別の端末数。数値から該当条件の端末一覧へ遷移できる */
export function LocationMatrix({ data, linkDevices }: { data: Awaited<ReturnType<typeof locationCategoryMatrix>>; linkDevices: boolean }) {
  const cell = (count: number, href: string) =>
    count === 0 ? <span className="text-muted-foreground">0</span> : linkDevices ? <Link href={href} className="text-primary hover:underline">{count}</Link> : count;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">拠点別端末数</CardTitle>
      </CardHeader>
      <CardContent>
        {data.grandTotal === 0 ? (
          <EmptyState>登録されている端末はありません。</EmptyState>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>拠点</TableHead>
                {data.categories.map((c) => (
                  <TableHead key={c.id} className="text-right">
                    {c.name}
                  </TableHead>
                ))}
                <TableHead className="text-right">合計</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.rows.map((r) => (
                <TableRow key={r.location.id}>
                  <TableCell>
                    <Link href={`/locations/${r.location.id}`} className="hover:underline">
                      {r.location.name}
                    </Link>
                  </TableCell>
                  {r.values.map((v, i) => (
                    <TableCell key={data.categories[i].id} className="text-right tabular-nums">
                      {cell(v, `/devices?location=${r.location.id}&category=${data.categories[i].id}`)}
                    </TableCell>
                  ))}
                  <TableCell className="text-right font-medium tabular-nums">{cell(r.total, `/devices?location=${r.location.id}`)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell>合計</TableCell>
                {data.totals.map((t, i) => (
                  <TableCell key={data.categories[i].id} className="text-right tabular-nums">
                    {t}
                  </TableCell>
                ))}
                <TableCell className="text-right tabular-nums">{data.grandTotal}</TableCell>
              </TableRow>
            </TableFooter>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
