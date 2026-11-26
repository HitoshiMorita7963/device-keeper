import type { Device } from "@/generated/prisma/client";
import { toDateInput } from "@/lib/dates";
import type { DeviceCreateInput, DeviceUpdateInput } from "@/lib/validation/devices";
import { categoryOptions } from "@/server/masters";
import { db } from "@/lib/db";
import { formatAssetNumber } from "@/server/devices";

const str = (v: string | number | null | undefined) => (v === null || v === undefined ? "" : String(v));

const EMPTY_SPEC = {
  manufacturer: "",
  model: "",
  serialNumber: "",
  osName: "",
  osVersion: "",
  purchaseDate: "",
  purchasePrice: "",
  purchaseVendor: "",
  warrantyExpiry: "",
  notes: "",
};

export function emptyDeviceInput(locationId?: number | null): DeviceCreateInput {
  return {
    ...EMPTY_SPEC,
    name: "",
    categoryId: "",
    assetNumberMode: "auto",
    assetNumber: "",
    currentLocationId: str(locationId),
    status: "IN_STOCK",
  };
}

export function toDeviceUpdateInput(d: Device): DeviceUpdateInput {
  return {
    id: String(d.id),
    assetNumber: d.assetNumber,
    name: d.name,
    categoryId: String(d.categoryId),
    manufacturer: str(d.manufacturer),
    model: str(d.model),
    serialNumber: str(d.serialNumber),
    osName: str(d.osName),
    osVersion: str(d.osVersion),
    purchaseDate: toDateInput(d.purchaseDate),
    purchasePrice: str(d.purchasePrice),
    purchaseVendor: str(d.purchaseVendor),
    warrantyExpiry: toDateInput(d.warrantyExpiry),
    notes: str(d.notes),
  };
}

/** 資産種別の選択肢と、自動採番した場合の次の番号 (目安) */
export async function categoryOptionsWithNextNumber(includeId?: number | null) {
  const [categories, sequences] = await Promise.all([categoryOptions(includeId), db.assetNumberSequence.findMany()]);
  const last = new Map(sequences.map((s) => [s.categoryId, s.lastNumber]));
  return categories.map((c) => ({
    value: c.id,
    label: c.isActive ? c.name : `${c.name} (使用停止)`,
    nextNumber: formatAssetNumber(c.prefix, c.numberDigits, (last.get(c.id) ?? 0) + 1),
  }));
}
