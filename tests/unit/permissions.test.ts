import { describe, expect, it } from "vitest";
import { can, type Permission } from "@/lib/auth/permissions";

describe("権限設計", () => {
  it("管理者はすべての操作ができる", () => {
    const all: Permission[] = [
      "device:write", "employee:write", "location:write", "master:write", "disposal:write",
      "user:manage", "settings:manage", "csv:import", "csv:export", "audit:read",
    ];
    for (const p of all) expect(can("ADMIN", p), p).toBe(true);
  });

  it("IT資産管理担当者は端末・貸出・移動・修理・CSV・操作履歴を扱える", () => {
    for (const p of [
      "device:read", "device:write", "employee:read", "location:read", "assignment:write",
      "move:write", "maintenance:write", "csv:import", "csv:export", "audit:read",
    ] as Permission[]) {
      expect(can("ASSET_MANAGER", p), p).toBe(true);
    }
  });

  it("IT資産管理担当者は社員・拠点の編集、廃棄、ユーザー管理、システム設定ができない", () => {
    for (const p of ["employee:write", "location:write", "disposal:write", "user:manage", "settings:manage", "master:write"] as Permission[]) {
      expect(can("ASSET_MANAGER", p), p).toBe(false);
    }
  });

  it("一般社員は自分の情報のみ閲覧でき、台帳・他の社員の情報は閲覧できない", () => {
    expect(can("EMPLOYEE", "self:read")).toBe(true);
    for (const p of ["dashboard:view", "device:read", "employee:read", "location:read", "audit:read", "csv:export"] as Permission[]) {
      expect(can("EMPLOYEE", p), p).toBe(false);
    }
  });
});
