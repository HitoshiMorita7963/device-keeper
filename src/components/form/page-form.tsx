"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { FormProvider, type FieldValues, type UseFormReturn } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { FieldGroup } from "@/components/ui/field";

/** 登録・編集画面のフォーム枠 (保存・キャンセルボタン付き) */
export function PageForm<T extends FieldValues>({
  form,
  onSubmit,
  cancelHref,
  submitLabel = "保存",
  children,
}: {
  form: UseFormReturn<T>;
  onSubmit: (values: T) => Promise<void>;
  cancelHref: string;
  submitLabel?: string;
  children: ReactNode;
}) {
  const submitting = form.formState.isSubmitting;
  return (
    <FormProvider {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
        <Card>
          <CardContent>
            <FieldGroup>{children}</FieldGroup>
          </CardContent>
          <CardFooter className="justify-end gap-2">
            <Button asChild variant="outline" type="button">
              <Link href={cancelHref}>キャンセル</Link>
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? "保存中…" : submitLabel}
            </Button>
          </CardFooter>
        </Card>
      </form>
    </FormProvider>
  );
}

/** フォーム内の 2〜3 列レイアウト */
export function FormRow({ children, cols = 2 }: { children: ReactNode; cols?: 2 | 3 }) {
  return <div className={cols === 3 ? "grid gap-4 sm:grid-cols-3" : "grid gap-4 sm:grid-cols-2"}>{children}</div>;
}
