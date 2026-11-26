import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { requirePermission } from "@/lib/auth/session";
import { todayJst, toDateInput } from "@/lib/dates";
import { DEVICE_STATUS_LABELS } from "@/lib/labels";
import { pickParams } from "@/lib/pagination";
import type { DisposalInput } from "@/lib/validation/maintenance";
import { disposableDevices } from "@/server/maintenance";
import { DisposalForm } from "../disposal-form";

export const metadata: Metadata = { title: "廃棄処理" };

export default async function NewDisposalPage({ searchParams }: PageProps<"/disposals/new">) {
  await requirePermission("disposal:write");
  const params = pickParams(await searchParams, ["device", "from"] as const);
  const devices = await disposableDevices();
  const deviceOk = devices.some((d) => String(d.id) === params.device);
  const returnTo = params.from === "device" && deviceOk ? `/devices/${params.device}` : undefined;

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader title="廃棄処理" description={<Link href="/disposals" className="hover:underline">廃棄管理</Link>} />
      {params.device && !deviceOk ? (
        <p className="text-sm text-destructive">指定された端末は廃棄できない状態です (貸出中・修理対応中・廃棄済み)。</p>
      ) : null}
      {devices.length === 0 ? (
        <p className="text-sm text-muted-foreground">廃棄できる端末がありません。</p>
      ) : (
        <DisposalForm
          returnTo={returnTo}
          defaultValues={{
            deviceId: deviceOk ? params.device! : "",
            disposedAt: toDateInput(todayJst()),
            disposalReason: "",
            // 未選択 (空文字) から選ばせる。空のまま送信すると入力エラーになる
            disposalMethod: "" as DisposalInput["disposalMethod"],
            disposalVendor: "",
            dataErasure: "" as DisposalInput["dataErasure"],
            notes: "",
          }}
          devices={devices.map((d) => ({ value: d.id, label: `${d.assetNumber} ${d.name} (${d.category.name}・${DEVICE_STATUS_LABELS[d.status]})` }))}
        />
      )}
    </div>
  );
}

