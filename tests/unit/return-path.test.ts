import { describe, expect, it } from "vitest";
import { returnPath } from "@/components/form/return-path";

describe("登録後の遷移先", () => {
  it("端末詳細から開いた場合は、最終的に選ばれた端末の詳細へ戻る", () => {
    expect(returnPath("/devices/1", "/moves", { deviceId: 2 })).toBe("/devices/2");
  });
  it("社員詳細から開いた場合は、選ばれた社員の詳細へ戻る", () => {
    expect(returnPath("/employees/5", "/devices/9", { deviceId: 9, employeeId: 7 })).toBe("/employees/7");
  });
  it("一覧から開いた場合は既定の遷移先", () => {
    expect(returnPath(undefined, "/moves", { deviceId: 2 })).toBe("/moves");
  });
});
