import { departmentOptions, locationOptions } from "@/server/masters";

/** 社員フォームのプルダウン選択肢。使用停止のマスタは現在の設定値のみ表示する */
export async function employeeFormOptions(current?: { departmentId: number | null; homeLocationId: number | null }) {
  const [departments, locations] = await Promise.all([
    departmentOptions(current?.departmentId),
    locationOptions(current?.homeLocationId),
  ]);
  return {
    departments: departments.map((d) => ({ value: d.id, label: d.isActive ? d.name : `${d.name} (使用停止)` })),
    locations: locations.map((l) => ({ value: l.id, label: l.isActive ? l.name : `${l.name} (使用停止)` })),
  };
}
