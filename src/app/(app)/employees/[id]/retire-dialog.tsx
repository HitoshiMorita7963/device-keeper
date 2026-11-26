"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { TriangleAlert, UserX } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { retireEmployeeAction } from "../actions";

type AssignedDevice = { assetNumber: string; name: string };

/** 退職処理の確認画面。貸与中の端末がある場合は警告し、確認チェックを必須にする */
export function RetireDialog({
  employeeId,
  employeeName,
  today,
  assignedDevices,
  hasUserAccount,
}: {
  employeeId: number;
  employeeName: string;
  today: string;
  assignedDevices: AssignedDevice[];
  hasUserAccount: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [retiredAt, setRetiredAt] = useState(today);
  const [acknowledged, setAcknowledged] = useState(false);
  const [pending, setPending] = useState(false);
  const hasDevices = assignedDevices.length > 0;

  async function submit() {
    setPending(true);
    const result = await retireEmployeeAction({ employeeId, retiredAt, acknowledgeAssignedDevices: acknowledged });
    setPending(false);
    if (!result.ok) {
      toast.error(result.fieldErrors?.retiredAt?.[0] ?? result.error);
      return;
    }
    toast.success(result.message);
    setOpen(false);
    router.refresh();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setRetiredAt(today);
          setAcknowledged(false);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="destructive">
          <UserX aria-hidden />
          退職処理
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>退職処理の確認</DialogTitle>
          <DialogDescription>{employeeName} さんの在籍状態を「退職」に変更します。</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {hasDevices ? (
            <Alert variant="destructive">
              <TriangleAlert aria-hidden />
              <AlertTitle>貸与中の端末が {assignedDevices.length} 台あります</AlertTitle>
              <AlertDescription>
                <ul className="mt-1 list-disc pl-4">
                  {assignedDevices.map((d) => (
                    <li key={d.assetNumber}>
                      <span className="font-mono">{d.assetNumber}</span> {d.name}
                    </li>
                  ))}
                </ul>
                <p className="mt-2">原則として、退職処理の前に返却処理を行ってください。</p>
              </AlertDescription>
            </Alert>
          ) : null}

          <div className="flex flex-col gap-2">
            <Label htmlFor="retiredAt">退職日</Label>
            <Input id="retiredAt" type="date" value={retiredAt} onChange={(e) => setRetiredAt(e.target.value)} required />
          </div>

          {hasUserAccount ? (
            <p className="text-sm text-muted-foreground">この社員のシステム利用者アカウントは無効化され、ログインできなくなります。</p>
          ) : null}

          {hasDevices ? (
            <div className="flex items-start gap-2">
              <Checkbox id="ack" checked={acknowledged} onCheckedChange={(v) => setAcknowledged(v === true)} />
              <Label htmlFor="ack" className="font-normal leading-snug">
                貸与中の端末があることを確認したうえで、退職処理を実行します
              </Label>
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            キャンセル
          </Button>
          <Button variant="destructive" onClick={submit} disabled={pending || !retiredAt || (hasDevices && !acknowledged)}>
            {pending ? "処理中…" : "退職処理を実行"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
