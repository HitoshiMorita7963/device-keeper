import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { PageHeader } from "@/components/page-header";
import { requirePermission } from "@/lib/auth/session";
import { formatDateTime } from "@/lib/dates";
import { idParam } from "@/lib/validation/common";
import { getUser, linkableEmployees } from "@/server/users";
import { PasswordResetDialog, UserEditForm } from "../user-forms";

export const metadata: Metadata = { title: "利用者編集" };

export default async function EditUserPage({ params }: PageProps<"/settings/users/[id]">) {
  const me = await requirePermission("user:manage");
  const id = idParam.safeParse((await params).id);
  const user = id.success ? await getUser(id.data) : null;
  if (!user) notFound();
  const employees = await linkableEmployees(user.id);
  const locked = user.lockedUntil && user.lockedUntil > new Date();

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader
        title={user.displayName}
        description={
          <span>
            <Link href="/settings/users" className="hover:underline">
              利用者管理
            </Link>{" "}
            / 最終ログイン {formatDateTime(user.lastLoginAt)}
          </span>
        }
        actions={<PasswordResetDialog userId={user.id} email={user.email} />}
      />
      {locked ? (
        <Alert variant="destructive">
          <AlertDescription>
            ログイン失敗が続いたためロック中です ({formatDateTime(user.lockedUntil)} まで)。パスワード再設定でロックを解除できます。
          </AlertDescription>
        </Alert>
      ) : null}
      <UserEditForm
        self={user.id === me.id}
        employees={employees.map((e) => ({ value: e.id, label: `${e.employeeNumber} ${e.name}` }))}
        defaultValues={{
          id: user.id,
          email: user.email,
          displayName: user.displayName,
          role: user.role,
          employeeId: user.employeeId ? String(user.employeeId) : "",
          isActive: user.isActive,
        }}
      />
    </div>
  );
}
