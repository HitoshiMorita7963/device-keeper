"use client";

import type { ReactNode } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

/** 重要な操作の実行前に、入力内容を一覧表示して確認する */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  items,
  confirmLabel,
  pending,
  confirmDisabled,
  onConfirm,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  items: { label: string; value: ReactNode }[];
  confirmLabel: string;
  pending?: boolean;
  /** 確認チェックが未入力など、実行ボタンだけを押せなくする場合 */
  confirmDisabled?: boolean;
  onConfirm: () => void;
  children?: ReactNode;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="sm:max-w-lg">
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description ? <AlertDialogDescription>{description}</AlertDialogDescription> : null}
        </AlertDialogHeader>
        {items.length > 0 ? (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 rounded-lg border p-3 text-sm">
            {items.map((item) => (
              <div key={item.label} className="contents">
                <dt className="text-muted-foreground">{item.label}</dt>
                <dd className="break-words">{item.value || "-"}</dd>
              </div>
            ))}
          </dl>
        ) : null}
        {children}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>戻る</AlertDialogCancel>
          <AlertDialogAction
            disabled={pending || confirmDisabled}
            onClick={(e) => {
              // 処理完了まで閉じない
              e.preventDefault();
              onConfirm();
            }}
          >
            {pending ? "処理中…" : confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
