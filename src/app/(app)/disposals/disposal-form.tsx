"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { TriangleAlert } from "lucide-react";
import { ConfirmDialog } from "@/components/form/confirm-dialog";
import { SelectField, TextareaField, TextField, type Option } from "@/components/form/fields";
import { FormRow, PageForm } from "@/components/form/page-form";
import { formResolver } from "@/components/form/resolver";
import { returnPath } from "@/components/form/return-path";
import { applyActionResult } from "@/components/form/submit-result";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { DISPOSAL_METHODS, disposalSchema, type DisposalInput } from "@/lib/validation/maintenance";
import { disposeDeviceAction } from "./actions";

const labelOf = (options: Option[], value: unknown) => options.find((o) => String(o.value) === String(value))?.label;

const ERASURE_OPTIONS = [
  { value: "confirmed", label: "データ消去を確認した (消去証明書の受領・ツールでの消去等)" },
  { value: "not_required", label: "記憶媒体がないため不要 (モニター・周辺機器等)" },
];

/** 廃棄処理。取り消しできない操作のため、確認画面でチェックを必須にする */
export function DisposalForm({ defaultValues, devices, returnTo }: { defaultValues: DisposalInput; devices: Option[]; returnTo?: string }) {
  const router = useRouter();
  const form = useForm<DisposalInput>({ resolver: formResolver(disposalSchema), defaultValues });
  const [confirming, setConfirming] = useState<DisposalInput | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [pending, setPending] = useState(false);

  async function execute() {
    if (!confirming || !acknowledged) return;
    setPending(true);
    const result = await disposeDeviceAction(confirming);
    setPending(false);
    setConfirming(null);
    if (applyActionResult(result, form.setError)) router.push(returnPath(returnTo, `/devices/${result.data.deviceId}`, result.data));
  }

  return (
    <>
      <PageForm
        form={form}
        cancelHref={returnTo ?? "/disposals"}
        submitLabel="確認へ進む"
        onSubmit={async (values) => {
          setAcknowledged(false);
          setConfirming(values);
        }}
      >
        <SelectField<DisposalInput>
          name="deviceId"
          label="対象端末"
          required
          options={devices}
          description="貸出中・修理対応中の端末は、返却・修理完了の後に廃棄できます。"
        />
        <FormRow>
          <TextField<DisposalInput> name="disposedAt" label="廃棄日" required type="date" />
          <SelectField<DisposalInput> name="disposalMethod" label="廃棄方法" required options={DISPOSAL_METHODS.map((m) => ({ value: m, label: m }))} />
        </FormRow>
        <TextareaField<DisposalInput> name="disposalReason" label="廃棄理由" required description="例: 耐用年数経過・故障により修理不能" />
        <TextField<DisposalInput> name="disposalVendor" label="廃棄業者" maxLength={100} />
        <SelectField<DisposalInput>
          name="dataErasure"
          label="データ消去の確認"
          required
          options={ERASURE_OPTIONS}
          description="PC・スマートフォン・タブレットは、社外に出す前に必ずデータ消去を確認してください。"
        />
        <TextareaField<DisposalInput> name="notes" label="備考" description="消去証明書の番号などを記録できます。" />
      </PageForm>

      <ConfirmDialog
        open={!!confirming}
        onOpenChange={(open) => !open && !pending && setConfirming(null)}
        title="この端末を廃棄済みにしますか？"
        description="廃棄済みにした端末は、貸出・移動・編集ができなくなります。この操作は取り消せません (履歴はすべて保持されます)。"
        confirmLabel="廃棄する"
        pending={pending}
        confirmDisabled={!acknowledged}
        onConfirm={execute}
        items={
          confirming
            ? [
                { label: "端末", value: labelOf(devices, confirming.deviceId) },
                { label: "廃棄日", value: String(confirming.disposedAt) },
                { label: "廃棄方法", value: String(confirming.disposalMethod) },
                { label: "廃棄理由", value: String(confirming.disposalReason) },
                { label: "廃棄業者", value: String(confirming.disposalVendor ?? "") },
                { label: "データ消去", value: confirming.dataErasure === "confirmed" ? "消去済み" : "不要" },
              ]
            : []
        }
      >
        <Alert variant="destructive">
          <TriangleAlert aria-hidden />
          <AlertTitle>取り消しできない操作です</AlertTitle>
          <AlertDescription>
            <div className="mt-1 flex items-start gap-2">
              <Checkbox id="ack-dispose" checked={acknowledged} onCheckedChange={(v) => setAcknowledged(v === true)} />
              <Label htmlFor="ack-dispose" className="font-normal leading-snug">
                対象端末と内容に誤りがないことを確認しました
              </Label>
            </div>
          </AlertDescription>
        </Alert>
      </ConfirmDialog>
    </>
  );
}
