import { describe, expect, it } from "vitest";
import { auditChanges } from "@/components/audit-changes";

describe("操作履歴の変更内容の表示", () => {
  it("変わった項目だけを日本語の項目名・値で表示し、内部 ID は表示しない", () => {
    const changes = auditChanges(
      { status: "REPORTED", repairCost: null, deviceStatus: "REPAIR", problemDescription: "故障" },
      { status: "COMPLETED", repairCost: 8800, deviceStatus: "IN_USE", problemDescription: "故障", maintenanceId: 3 },
    );
    expect(changes).toEqual([
      { key: "status", before: "受付", after: "完了" },
      { key: "repairCost", before: "(なし)", after: "8800" },
      { key: "deviceStatus", before: "修理中", after: "使用中" },
    ]);
  });

  it("名前を記録している場合は ID を省き、空の値は表示しない", () => {
    const changes = auditChanges({ currentLocationId: 1, location: "本社" }, { currentLocationId: 2, location: "大阪支店", reason: "配置換え", notes: null });
    expect(changes.map((c) => c.key)).toEqual(["location", "reason"]);
  });
});
