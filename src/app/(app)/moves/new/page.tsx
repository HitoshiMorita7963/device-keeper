import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { requirePermission } from "@/lib/auth/session";
import { todayJst, toDateInput } from "@/lib/dates";
import { pickParams } from "@/lib/pagination";
import { handlerUsers } from "@/server/assignments";
import { locationOptions } from "@/server/masters";
import { movableDevices } from "@/server/moves";
import { MoveForm } from "../move-form";

export const metadata: Metadata = { title: "移動登録" };

export default async function NewMovePage({ searchParams }: PageProps<"/moves/new">) {
  const user = await requirePermission("move:write");
  const params = pickParams(await searchParams, ["device", "from"] as const);
  const [devices, locations, handlers] = await Promise.all([movableDevices(), locationOptions(), handlerUsers()]);
  const deviceOk = devices.some((d) => String(d.id) === params.device);
  const returnTo = params.from === "device" && deviceOk ? `/devices/${params.device}` : undefined;

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader title="移動登録" description={<Link href="/moves" className="hover:underline">拠点間移動</Link>} />
      {params.device && !deviceOk ? <p className="text-sm text-destructive">指定された端末は移動できない状態です。</p> : null}
      {locations.length < 2 ? (
        <p className="text-sm text-muted-foreground">拠点間移動を行うには、使用中の拠点が 2 つ以上必要です。</p>
      ) : (
        <MoveForm
          returnTo={returnTo}
          defaultValues={{
            deviceId: deviceOk ? params.device! : "",
            toLocationId: "",
            movedAt: toDateInput(todayJst()),
            movedById: handlers.some((h) => h.id === user.id) ? String(user.id) : String(handlers[0]?.id ?? ""),
            reason: "",
          }}
          devices={devices.map((d) => ({
            value: d.id,
            label: `${d.assetNumber} ${d.name} (${d.currentLocation.name})`,
            locationId: d.currentLocationId,
            locationName: d.currentLocation.name,
          }))}
          locations={locations.map((l) => ({ value: l.id, label: l.name }))}
          handlers={handlers.map((h) => ({ value: h.id, label: h.displayName }))}
        />
      )}
    </div>
  );
}
