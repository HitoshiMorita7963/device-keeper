import Link from "next/link";
import type { ReactNode } from "react";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";

/** GET パラメータで検索条件を送る一覧画面用の検索フォーム (URL を共有・ブックマークできる) */
export function SearchBar({ action, children }: { action: string; children: ReactNode }) {
  return (
    <form action={action} method="get" className="flex flex-wrap items-end gap-3 rounded-lg border bg-muted/30 p-3" role="search">
      {children}
      <div className="flex gap-2">
        <Button type="submit" size="sm">
          <Search aria-hidden />
          検索
        </Button>
        <Button asChild type="button" variant="ghost" size="sm">
          <Link href={action}>条件クリア</Link>
        </Button>
      </div>
    </form>
  );
}

export function SearchText({ name, label, defaultValue, placeholder, className }: { name: string; label: string; defaultValue?: string; placeholder?: string; className?: string }) {
  return (
    <div className={`flex flex-col gap-1 ${className ?? "w-full sm:w-56"}`}>
      <Label htmlFor={`s-${name}`} className="text-xs">
        {label}
      </Label>
      <Input id={`s-${name}`} name={name} defaultValue={defaultValue} placeholder={placeholder} className="h-8" />
    </div>
  );
}

export function SearchSelect({
  name,
  label,
  defaultValue,
  options,
  emptyLabel = "すべて",
}: {
  name: string;
  label: string;
  defaultValue?: string;
  options: { value: string | number; label: string }[];
  emptyLabel?: string;
}) {
  return (
    <div className="flex w-full flex-col gap-1 sm:w-44">
      <Label htmlFor={`s-${name}`} className="text-xs">
        {label}
      </Label>
      <NativeSelect id={`s-${name}`} name={name} defaultValue={defaultValue ?? ""} className="w-full">
        <NativeSelectOption value="">{emptyLabel}</NativeSelectOption>
        {options.map((o) => (
          <NativeSelectOption key={o.value} value={String(o.value)}>
            {o.label}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    </div>
  );
}
