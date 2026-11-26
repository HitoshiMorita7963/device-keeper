import type { LocationInput } from "@/lib/validation/masters";

/** DB の値をフォームの初期値 (文字列) に変換する */
export function toLocationInput(l?: {
  locationCode: string;
  name: string;
  address: string | null;
  managerName: string | null;
  phone: string | null;
  isActive: boolean;
}): LocationInput {
  return {
    locationCode: l?.locationCode ?? "",
    name: l?.name ?? "",
    address: l?.address ?? "",
    managerName: l?.managerName ?? "",
    phone: l?.phone ?? "",
    isActive: l?.isActive ?? true,
  };
}
