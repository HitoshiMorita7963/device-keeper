import { Badge } from "@/components/ui/badge";

/**
 * 管理用端末名の表示。未設定の場合は PC 名を代わりに薄く表示し、「未設定」であることを明示する。
 */
export function ManagementName({ managementName, computerName }: { managementName: string | null; computerName: string | null }) {
  if (managementName) return <span className="break-words font-medium">{managementName}</span>;
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5 text-muted-foreground">
      {computerName ? <span className="font-mono">{computerName}</span> : null}
      <Badge variant="outline" className="h-5 px-1.5 text-[11px] font-normal text-muted-foreground">
        未設定
      </Badge>
    </span>
  );
}
