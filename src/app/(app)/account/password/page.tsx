import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { requireUser } from "@/lib/auth/session";
import { PasswordChangeForm } from "./password-form";

export const metadata: Metadata = { title: "パスワード変更" };

export default async function PasswordPage() {
  const user = await requireUser();
  return (
    <div className="flex max-w-xl flex-col gap-6">
      <PageHeader title="パスワード変更" description={user.email} />
      <PasswordChangeForm />
    </div>
  );
}
