import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { requirePermission } from "@/lib/auth/session";
import { linkableEmployees } from "@/server/users";
import { UserCreateForm } from "../user-forms";

export const metadata: Metadata = { title: "利用者登録" };

export default async function NewUserPage() {
  await requirePermission("user:manage");
  const employees = await linkableEmployees();
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader title="利用者登録" description={<Link href="/settings/users" className="hover:underline">利用者管理</Link>} />
      <UserCreateForm employees={employees.map((e) => ({ value: e.id, label: `${e.employeeNumber} ${e.name}` }))} />
    </div>
  );
}
