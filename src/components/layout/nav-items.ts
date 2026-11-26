import {
  ArrowLeftRight,
  Building2,
  FileSpreadsheet,
  History,
  LayoutDashboard,
  Laptop,
  Settings,
  Trash2,
  Truck,
  Users,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import type { Permission } from "@/lib/auth/permissions";

export type NavItem = { href: string; label: string; icon: LucideIcon; permission: Permission };

/** サイドメニュー。権限を持たない項目は表示しない (サーバー側でも同じ権限で検証する) */
export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "ダッシュボード", icon: LayoutDashboard, permission: "dashboard:view" },
  { href: "/my", label: "マイ端末", icon: Laptop, permission: "self:read" },
  { href: "/devices", label: "端末管理", icon: Laptop, permission: "device:read" },
  { href: "/employees", label: "社員管理", icon: Users, permission: "employee:read" },
  { href: "/locations", label: "拠点管理", icon: Building2, permission: "location:read" },
  { href: "/assignments", label: "貸出・返却", icon: ArrowLeftRight, permission: "assignment:write" },
  { href: "/moves", label: "拠点間移動", icon: Truck, permission: "move:write" },
  { href: "/maintenance", label: "修理・故障", icon: Wrench, permission: "maintenance:write" },
  { href: "/disposals", label: "廃棄管理", icon: Trash2, permission: "disposal:write" },
  { href: "/csv", label: "CSV管理", icon: FileSpreadsheet, permission: "csv:export" },
  { href: "/audit-logs", label: "操作履歴", icon: History, permission: "audit:read" },
  { href: "/settings", label: "システム設定", icon: Settings, permission: "settings:manage" },
];
