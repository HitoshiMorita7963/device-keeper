import type { Employee } from "@/generated/prisma/client";
import { toDateInput } from "@/lib/dates";
import type { EmployeeInput } from "@/lib/validation/masters";

/** DB の値をフォームの初期値 (文字列) に変換する */
export function toEmployeeInput(e?: Employee): EmployeeInput {
  return {
    employeeNumber: e?.employeeNumber ?? "",
    name: e?.name ?? "",
    email: e?.email ?? "",
    departmentId: e?.departmentId ? String(e.departmentId) : "",
    homeLocationId: e?.homeLocationId ? String(e.homeLocationId) : "",
    employmentStatus: e?.employmentStatus ?? "ACTIVE",
    joinedAt: toDateInput(e?.joinedAt),
  };
}
