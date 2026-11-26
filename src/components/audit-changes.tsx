import { fieldLabel, formatAuditValue } from "@/lib/labels";

/** 変更内容として表示しない項目 (内部 ID・自動更新される日時など) */
const HIDDEN_KEYS = new Set([
  "id", "createdAt", "updatedAt", "failedLoginCount", "lockedUntil", "lastLoginAt",
  "assignmentId", "historyId", "maintenanceId", "disposalId", "deviceId",
  "computerNameUpdatedAt", "managementNameUpdatedAt", "managementNameUpdatedById", "agentTokenIssuedAt",
]);

/** 名前を記録している場合は、対応する ID の表示を省く */
const ID_WITH_NAME: Record<string, string> = { currentLocationId: "location", currentEmployeeId: "employee" };

type Json = Record<string, unknown> | null;

/** 監査ログに記録された更新前後の内容から、表示する変更項目を取り出す */
export function auditChanges(before: unknown, after: unknown) {
  const b = (before && typeof before === "object" ? before : null) as Json;
  const a = (after && typeof after === "object" ? after : null) as Json;
  const keys = new Set([...Object.keys(b ?? {}), ...Object.keys(a ?? {})]);
  const changes: { key: string; before: string | null; after: string | null }[] = [];
  for (const key of keys) {
    if (HIDDEN_KEYS.has(key)) continue;
    if (ID_WITH_NAME[key] && (ID_WITH_NAME[key] in (a ?? {}) || ID_WITH_NAME[key] in (b ?? {}))) continue;
    const bv = b?.[key];
    const av = a?.[key];
    // 更新前後の両方がある場合は変わった項目だけ、片方だけの場合 (登録・理由など) はその値を表示する
    if (b && a && key in b && key in a && JSON.stringify(bv) === JSON.stringify(av)) continue;
    const singleSide = !(b && key in b && a && key in a);
    if (singleSide && (bv ?? av ?? "") === "") continue;
    changes.push({
      key,
      before: b && key in b ? formatAuditValue(key, bv) : null,
      after: a && key in a ? formatAuditValue(key, av) : null,
    });
  }
  return changes;
}

export function AuditChanges({ before, after, compact }: { before: unknown; after: unknown; compact?: boolean }) {
  const changes = auditChanges(before, after);
  if (changes.length === 0) return <span className="text-muted-foreground">-</span>;
  const shown = compact ? changes.slice(0, 6) : changes;
  return (
    <ul className="flex flex-col gap-0.5 text-xs">
      {shown.map((c) => (
        <li key={c.key} className="break-all">
          <span className="text-muted-foreground">{fieldLabel(c.key)}: </span>
          {c.before !== null && c.after !== null ? (
            <>
              {c.before} <span aria-label="から">→</span> {c.after}
            </>
          ) : (
            (c.after ?? c.before)
          )}
        </li>
      ))}
      {compact && changes.length > shown.length ? <li className="text-muted-foreground">ほか {changes.length - shown.length} 項目</li> : null}
    </ul>
  );
}
