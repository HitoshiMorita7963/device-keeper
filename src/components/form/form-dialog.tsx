"use client";

import { useState, type ReactNode } from "react";
import { FormProvider, type DefaultValues, type FieldValues, type UseFormReturn } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { FieldGroup } from "@/components/ui/field";

/** マスタの登録・編集などに使う、ダイアログ内のフォーム */
export function FormDialog<T extends FieldValues>({
  trigger,
  title,
  description,
  form,
  defaultValues,
  onSubmit,
  submitLabel = "保存",
  children,
}: {
  trigger: ReactNode;
  title: string;
  description?: string;
  form: UseFormReturn<T>;
  /** ダイアログを開くたびにこの値で入力欄を初期化する (保存後の最新値を反映するため) */
  defaultValues: DefaultValues<T>;
  /** 成功時に true を返すとダイアログを閉じる */
  onSubmit: (values: T) => Promise<boolean>;
  submitLabel?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const submit = form.handleSubmit(async (values) => {
    if (await onSubmit(values)) setOpen(false);
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) form.reset(defaultValues);
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        <FormProvider {...form}>
          <form onSubmit={submit} noValidate>
            <FieldGroup>{children}</FieldGroup>
            <DialogFooter className="mt-6">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                キャンセル
              </Button>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? "保存中…" : submitLabel}
              </Button>
            </DialogFooter>
          </form>
        </FormProvider>
      </DialogContent>
    </Dialog>
  );
}
