import type { Role } from "@/generated/prisma/enums";

/** 権限設計書 (docs/permissions.md) に対応する操作権限 */
export type Permission =
  | "dashboard:view"
  | "device:read"
  | "device:write"
  | "employee:read"
  | "employee:write"
  | "location:read"
  | "location:write"
  | "master:write"
  | "assignment:write"
  | "move:write"
  | "maintenance:write"
  | "disposal:write"
  | "csv:import"
  | "csv:export"
  | "audit:read"
  | "user:manage"
  | "settings:manage"
  | "self:read";

const ASSET_MANAGER: readonly Permission[] = [
  "dashboard:view",
  "device:read",
  "device:write",
  "employee:read",
  "location:read",
  "assignment:write",
  "move:write",
  "maintenance:write",
  "csv:import",
  "csv:export",
  "audit:read",
  "self:read",
];

const EMPLOYEE: readonly Permission[] = ["self:read"];

const ALL: readonly Permission[] = [
  ...ASSET_MANAGER,
  "employee:write",
  "location:write",
  "master:write",
  "disposal:write",
  "user:manage",
  "settings:manage",
];

const ROLE_PERMISSIONS: Record<Role, ReadonlySet<Permission>> = {
  ADMIN: new Set(ALL),
  ASSET_MANAGER: new Set(ASSET_MANAGER),
  EMPLOYEE: new Set(EMPLOYEE),
};

export function can(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].has(permission);
}

export const ROLE_LABELS: Record<Role, string> = {
  ADMIN: "管理者",
  ASSET_MANAGER: "IT資産管理担当者",
  EMPLOYEE: "一般社員",
};
