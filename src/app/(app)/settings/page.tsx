import type { Metadata } from "next";
import Link from "next/link";
import { Building, ShieldCheck, Tags, UserCog } from "lucide-react";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { requirePermission } from "@/lib/auth/session";

export const metadata: Metadata = { title: "システム設定" };

const SECTIONS = [
  { href: "/settings/users", title: "利用者管理", description: "ログインできる利用者の登録・権限設定・パスワード再設定を行います。", icon: UserCog },
  { href: "/settings/departments", title: "部署管理", description: "社員の所属部署マスタを登録・編集します。", icon: Building },
  { href: "/settings/categories", title: "資産種別管理", description: "PC・スマートフォンなどの資産種別と、資産管理番号の採番形式を設定します。", icon: Tags },
  { href: "/settings/integrity", title: "データ整合性チェック", description: "端末状態・貸与履歴・修理記録・廃棄記録の間に矛盾がないかを確認します。", icon: ShieldCheck },
];

export default async function SettingsPage() {
  await requirePermission("settings:manage");
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="システム設定" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {SECTIONS.map(({ href, title, description, icon: Icon }) => (
          <Link key={href} href={href} className="group">
            <Card className="h-full transition-colors group-hover:bg-muted/50">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Icon className="size-4" aria-hidden />
                  {title}
                </CardTitle>
                <CardDescription>{description}</CardDescription>
              </CardHeader>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
