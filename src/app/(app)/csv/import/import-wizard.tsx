"use client";

import Link from "next/link";
import Papa from "papaparse";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { CircleAlert, FileUp, RotateCcw } from "lucide-react";
import { ConfirmDialog } from "@/components/form/confirm-dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { decodeCsvBytes } from "@/lib/csv/decode";
import { guessMapping, IMPORT_LIMITS, IMPORT_TARGETS, requiredMappingFields, type ImportMode, type ImportTarget } from "@/lib/csv/fields";
import { cn } from "@/lib/utils";
import type { AutoCreated, ImportSummary, RowAction, RowResult } from "@/server/csv-import";
import { executeImportAction, previewImportAction } from "../actions";

type Parsed = { fileName: string; encoding: string; headers: string[]; rows: string[][] };
type Preview = { summary: ImportSummary; rows: RowResult[]; autoCreated: AutoCreated };

/** パスワードの列 (管理者のみ取り込み可) */
const SECRET_FIELDS = new Set(["initialPassword", "loginPassword"]);

/** 自動登録されるマスタの一覧 */
function AutoCreatedList({ autoCreated }: { autoCreated: AutoCreated }) {
  const groups = [
    { label: "社員", items: autoCreated.employees },
    { label: "部署", items: autoCreated.departments },
    { label: "拠点", items: autoCreated.locations },
  ].filter((g) => g.items.length > 0);
  if (groups.length === 0) return null;
  return (
    <Alert>
      <AlertTitle>次のデータを新規登録します</AlertTitle>
      <AlertDescription>
        <dl className="mt-1 flex flex-col gap-1">
          {groups.map((g) => (
            <div key={g.label}>
              <dt className="inline font-medium">
                {g.label} ({g.items.length} 件):{" "}
              </dt>
              <dd className="inline">{g.items.join("、")}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-2 text-xs">社員番号・拠点コード・部署コードは仮の番号です。登録後に各管理画面で正式な値に変更できます。</p>
      </AlertDescription>
    </Alert>
  );
}

const ACTION_LABEL: Record<RowAction, string> = { create: "登録", update: "更新", skip: "スキップ", error: "エラー" };
const ACTION_CLASS: Record<RowAction, string> = {
  create: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
  update: "bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200",
  skip: "bg-muted text-muted-foreground",
  error: "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200",
};

/** Excel で保存した CSV (Shift_JIS) と UTF-8 の両方を読めるようにする */
async function readCsvFile(file: File): Promise<Parsed> {
  if (file.size > IMPORT_LIMITS.maxFileBytes) throw new Error(`ファイルサイズは ${IMPORT_LIMITS.maxFileBytes / 1024 / 1024}MB 以下にしてください。`);
  const { text, encoding } = decodeCsvBytes(await file.arrayBuffer());
  const result = Papa.parse<string[]>(text, { skipEmptyLines: "greedy" });
  if (result.errors.length) {
    const e = result.errors[0];
    throw new Error(`CSV の形式に誤りがあります (${(e.row ?? 0) + 1} 行目付近: ${e.message})。`);
  }
  const [headers, ...rows] = result.data;
  if (!headers?.length) throw new Error("見出し行がありません。");
  if (rows.length === 0) throw new Error("データ行がありません。");
  if (rows.length > IMPORT_LIMITS.maxRows) throw new Error(`1 回に取り込めるのは ${IMPORT_LIMITS.maxRows} 行までです。ファイルを分割してください。`);
  if (headers.length > IMPORT_LIMITS.maxColumns) throw new Error(`列数は ${IMPORT_LIMITS.maxColumns} 列以内にしてください。`);
  return { fileName: file.name, encoding, headers: headers.map((h) => h.trim()), rows };
}

function SummaryCards({ summary, filter, onFilter }: { summary: ImportSummary; filter: RowAction | "all"; onFilter: (f: RowAction | "all") => void }) {
  const items: { key: RowAction | "all"; label: string; value: number }[] = [
    { key: "all", label: "全行", value: summary.total },
    { key: "create", label: "登録", value: summary.create },
    { key: "update", label: "更新", value: summary.update },
    { key: "skip", label: "スキップ", value: summary.skip },
    { key: "error", label: "エラー", value: summary.error },
  ];
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-5" role="group" aria-label="判定結果で絞り込み">
      {items.map((i) => (
        <button
          key={i.key}
          type="button"
          onClick={() => onFilter(i.key)}
          aria-pressed={filter === i.key}
          className={cn(
            "rounded-lg border p-3 text-left transition-colors hover:bg-muted/50",
            filter === i.key && "ring-2 ring-primary",
            i.key === "error" && i.value > 0 && "border-destructive/50",
          )}
        >
          <div className="text-xs text-muted-foreground">{i.label}</div>
          <div className={cn("text-xl font-semibold tabular-nums", i.key === "error" && i.value > 0 && "text-destructive")}>{i.value}</div>
        </button>
      ))}
    </div>
  );
}

export function ImportWizard({
  targets,
  categories,
  canAutoCreate,
  canImportSecrets,
}: {
  targets: ImportTarget[];
  categories: { id: number; name: string }[];
  /** 社員・部署・拠点を自動登録できるか (管理者のみ) */
  canAutoCreate: boolean;
  /** パスワードの列を取り込めるか (管理者のみ) */
  canImportSecrets: boolean;
}) {
  const [target, setTarget] = useState<ImportTarget>(targets[0]);
  const [mode, setMode] = useState<ImportMode>("skip");
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [mapping, setMapping] = useState<Record<string, number | null>>({});
  const [preview, setPreview] = useState<Preview | null>(null);
  const [filter, setFilter] = useState<RowAction | "all">("all");
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [done, setDone] = useState<ImportSummary | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [defaultCategoryId, setDefaultCategoryId] = useState("");
  const [autoCreate, setAutoCreate] = useState(false);

  const definition = IMPORT_TARGETS[target];
  const options = useMemo(
    () => ({ defaultCategoryId: target === "devices" && defaultCategoryId ? Number(defaultCategoryId) : null, autoCreate: target === "devices" && autoCreate }),
    [target, defaultCategoryId, autoCreate],
  );
  const request = useMemo(
    () => (parsed ? { target, mode, headers: parsed.headers, rows: parsed.rows, mapping, options } : null),
    [target, mode, parsed, mapping, options],
  );
  const requiredKeys = new Set(requiredMappingFields(target, mode, options).map((f) => f.key));
  const secretLocked = (key: string) => target === "devices" && SECRET_FIELDS.has(key) && !canImportSecrets;

  /** 見出しから対応付けを推定する。パスワードを扱えない利用者はパスワードの列を対応付けない */
  function initialMapping(t: ImportTarget, headers: string[]) {
    const guessed = guessMapping(t, headers);
    if (t === "devices" && !canImportSecrets) for (const k of SECRET_FIELDS) guessed[k] = null;
    return guessed;
  }
  const missingRequired = definition.fields.filter((f) => requiredKeys.has(f.key) && (mapping[f.key] === null || mapping[f.key] === undefined));

  function reset() {
    setPreview(null);
    setDone(null);
    setFilter("all");
  }

  async function onFile(file: File | undefined) {
    reset();
    setParsed(null);
    setFileError(null);
    if (!file) return;
    try {
      const data = await readCsvFile(file);
      setParsed(data);
      setMapping(initialMapping(target, data.headers));
    } catch (e) {
      setFileError(e instanceof Error ? e.message : "ファイルを読み込めませんでした。");
    }
  }

  async function runPreview() {
    if (!request) return;
    setBusy(true);
    const result = await previewImportAction(request);
    setBusy(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    setPreview(result.data);
    setFilter(result.data.summary.error > 0 ? "error" : "all");
  }

  async function execute() {
    if (!request) return;
    setBusy(true);
    const result = await executeImportAction(request);
    setBusy(false);
    setConfirming(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(result.message);
    setDone(result.data.summary);
    setPreview({ summary: result.data.summary, rows: result.data.rows, autoCreated: result.data.autoCreated });
  }

  const rows = preview?.rows.filter((r) => filter === "all" || r.action === filter) ?? [];
  const changes = preview ? preview.summary.create + preview.summary.update : 0;

  return (
    <div className="flex flex-col gap-6">
      {/* 1. ファイル選択 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">1. 取り込み対象とファイルの選択</CardTitle>
          <CardDescription>
            Excel で保存した CSV (Shift_JIS)・UTF-8 のどちらも読み込めます。1 行目は見出し行にしてください (最大 {IMPORT_LIMITS.maxRows} 行)。
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="target">取り込み対象</Label>
              <NativeSelect
                id="target"
                className="w-full"
                value={target}
                disabled={busy}
                onChange={(e) => {
                  const next = e.target.value as ImportTarget;
                  setTarget(next);
                  reset();
                  if (parsed) setMapping(initialMapping(next, parsed.headers));
                }}
              >
                {targets.map((t) => (
                  <NativeSelectOption key={t} value={t}>
                    {IMPORT_TARGETS[t].label}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
              <a href={`/api/csv/template/${target}`} className="text-sm text-primary hover:underline">
                {definition.label}のテンプレートをダウンロード
              </a>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="file">CSV ファイル</Label>
              <Input id="file" type="file" accept=".csv,text/csv" disabled={busy} onChange={(e) => onFile(e.target.files?.[0])} />
              {parsed ? (
                <p className="text-sm text-muted-foreground">
                  {parsed.fileName} ({parsed.encoding}・{parsed.rows.length} 行・{parsed.headers.length} 列)
                </p>
              ) : null}
            </div>
          </div>

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium">既に登録されている{definition.keyLabel}の行の扱い</legend>
            <label className="flex items-start gap-2 text-sm">
              <input type="radio" name="mode" value="skip" checked={mode === "skip"} disabled={busy} onChange={() => { setMode("skip"); reset(); }} className="mt-1 accent-primary" />
              <span>
                <span className="font-medium">スキップする (新規のみ登録)</span>
                <span className="block text-muted-foreground">既存データは一切変更しません。初めての取り込みにおすすめです。</span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm">
              <input type="radio" name="mode" value="upsert" checked={mode === "upsert"} disabled={busy} onChange={() => { setMode("upsert"); reset(); }} className="mt-1 accent-primary" />
              <span>
                <span className="font-medium">CSV の内容で更新する</span>
                <span className="block text-muted-foreground">
                  値が入っている項目だけを上書きします (空欄の項目は既存の値を残します)。端末の拠点・状態・利用者は更新しません。
                </span>
              </span>
            </label>
          </fieldset>

          {target === "devices" ? (
            <div className="grid gap-4 rounded-lg border bg-muted/30 p-3 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Label htmlFor="default-category">資産種別</Label>
                <NativeSelect
                  id="default-category"
                  className="w-full"
                  value={defaultCategoryId}
                  disabled={busy}
                  onChange={(e) => {
                    setDefaultCategoryId(e.target.value);
                    reset();
                  }}
                >
                  <NativeSelectOption value="">CSV の「資産種別」列で指定する</NativeSelectOption>
                  {categories.map((c) => (
                    <NativeSelectOption key={c.id} value={String(c.id)}>
                      すべて「{c.name}」として登録
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
                <span className="text-xs text-muted-foreground">
                  台帳に種別の列がない場合はここで選びます。種別の違う端末は、ファイルを分けて取り込んでください。
                </span>
              </div>
              <div className="flex flex-col gap-2">
                <span className="text-sm font-medium">社員・部署・拠点の自動登録</span>
                {canAutoCreate ? (
                  <label className="flex items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={autoCreate}
                      disabled={busy}
                      onChange={(e) => {
                        setAutoCreate(e.target.checked);
                        reset();
                      }}
                      className="mt-1 accent-primary"
                    />
                    <span>
                      見つからない社員・部署・拠点を自動登録する
                      <span className="block text-xs text-muted-foreground">
                        利用者は氏名で照合し、見つからない場合は仮の社員番号で登録します。登録される内容はプレビューで確認できます。
                      </span>
                    </span>
                  </label>
                ) : (
                  <span className="text-xs text-muted-foreground">自動登録は管理者のみ行えます。社員・拠点は事前に登録しておいてください。</span>
                )}
              </div>
            </div>
          ) : null}

          {fileError ? (
            <Alert variant="destructive">
              <CircleAlert aria-hidden />
              <AlertTitle>ファイルを読み込めませんでした</AlertTitle>
              <AlertDescription>{fileError}</AlertDescription>
            </Alert>
          ) : null}
        </CardContent>
      </Card>

      {/* 2. 項目対応付け */}
      {parsed ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">2. 項目の対応付け</CardTitle>
            <CardDescription>CSV の見出しから自動で対応付けています。違っている場合は列を選び直してください。</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>システムの項目</TableHead>
                  <TableHead>CSV の列</TableHead>
                  <TableHead>1 行目の値</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {definition.fields.map((f) => {
                  const index = mapping[f.key];
                  return (
                    <TableRow key={f.key}>
                      <TableCell className="whitespace-normal">
                        <span className="font-medium">{f.label}</span>
                        {requiredKeys.has(f.key) ? <span className="ml-2 text-xs text-destructive">必須</span> : null}
                        {secretLocked(f.key) ? (
                          <span className="block text-xs text-muted-foreground">パスワードは管理者のみ取り込めます</span>
                        ) : f.hint ? (
                          <span className="block text-xs text-muted-foreground">{f.hint}</span>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        <NativeSelect
                          aria-label={`${f.label}に対応する列`}
                          className="w-48"
                          value={index === null || index === undefined ? "" : String(index)}
                          disabled={busy || secretLocked(f.key)}
                          aria-invalid={requiredKeys.has(f.key) && (index === null || index === undefined)}
                          onChange={(e) => {
                            setMapping({ ...mapping, [f.key]: e.target.value === "" ? null : Number(e.target.value) });
                            reset();
                          }}
                        >
                          <NativeSelectOption value="">(対応付けない)</NativeSelectOption>
                          {parsed.headers.map((h, i) => (
                            <NativeSelectOption key={i} value={String(i)}>
                              {h || `(${i + 1} 列目)`}
                            </NativeSelectOption>
                          ))}
                        </NativeSelect>
                      </TableCell>
                      <TableCell className="max-w-56 truncate text-muted-foreground">
                        {index === null || index === undefined ? "-" : parsed.rows[0]?.[index] || "(空欄)"}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Button onClick={runPreview} disabled={busy || missingRequired.length > 0}>
                {busy && !preview ? "確認中…" : "プレビュー (エラー確認)"}
              </Button>
              {missingRequired.length > 0 ? (
                <span className="text-sm text-destructive">必須項目の列を選択してください: {missingRequired.map((f) => f.label).join("、")}</span>
              ) : null}
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* 3. プレビュー・登録 */}
      {preview ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{done ? "4. 登録結果" : "3. プレビュー"}</CardTitle>
            <CardDescription>
              {done
                ? "取り込みが完了しました。"
                : "まだ登録されていません。内容を確認し、エラーがなければ登録を実行してください。"}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {done ? (
              <Alert>
                <AlertTitle>
                  登録 {done.create} 件・更新 {done.update} 件・スキップ {done.skip} 件
                </AlertTitle>
                <AlertDescription>
                  <span>
                    結果は{" "}
                    <Link href={target === "devices" ? "/devices" : target === "employees" ? "/employees" : "/locations"} className="text-primary hover:underline">
                      {definition.label}一覧
                    </Link>{" "}
                    と操作履歴で確認できます。
                  </span>
                </AlertDescription>
              </Alert>
            ) : preview.summary.error > 0 ? (
              <Alert variant="destructive">
                <CircleAlert aria-hidden />
                <AlertTitle>エラーが {preview.summary.error} 件あります</AlertTitle>
                <AlertDescription>
                  エラーが 1 件でもある場合は登録できません (一部だけ登録されることはありません)。CSV を修正して選択し直してください。
                </AlertDescription>
              </Alert>
            ) : null}

            <AutoCreatedList autoCreated={preview.autoCreated} />

            <SummaryCards summary={preview.summary} filter={filter} onFilter={setFilter} />

            <div className="max-h-[480px] overflow-auto rounded-lg border">
              <Table>
                <TableHeader className="sticky top-0 bg-background">
                  <TableRow>
                    <TableHead className="w-16">行</TableHead>
                    <TableHead className="w-24">判定</TableHead>
                    <TableHead>{definition.keyLabel}</TableHead>
                    <TableHead>名称</TableHead>
                    <TableHead>内容</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.slice(0, 500).map((r) => (
                    <TableRow key={r.line} className="align-top">
                      <TableCell className="tabular-nums">{r.line}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={cn("border-transparent", ACTION_CLASS[r.action])}>
                          {ACTION_LABEL[r.action]}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono">{r.key || "-"}</TableCell>
                      <TableCell className="max-w-48 truncate">{r.name || "-"}</TableCell>
                      <TableCell className="whitespace-normal text-xs">
                        {r.messages.length ? (
                          <ul className={cn("flex flex-col gap-0.5", r.action === "error" && "text-destructive")}>
                            {r.messages.map((m, i) => (
                              <li key={i}>{m}</li>
                            ))}
                          </ul>
                        ) : (
                          "-"
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {rows.length > 500 ? <p className="text-xs text-muted-foreground">先頭 500 行のみ表示しています。</p> : null}

            <div className="flex flex-wrap gap-2">
              {done ? (
                <Button
                  variant="outline"
                  onClick={() => {
                    reset();
                    setParsed(null);
                  }}
                >
                  <RotateCcw aria-hidden />
                  別のファイルを取り込む
                </Button>
              ) : (
                <Button onClick={() => setConfirming(true)} disabled={busy || preview.summary.error > 0 || changes === 0}>
                  <FileUp aria-hidden />
                  登録を実行
                </Button>
              )}
              {!done && changes === 0 && preview.summary.error === 0 ? (
                <span className="self-center text-sm text-muted-foreground">登録・更新する行はありません。</span>
              ) : null}
            </div>
          </CardContent>
        </Card>
      ) : null}

      <ConfirmDialog
        open={confirming}
        onOpenChange={(open) => !busy && setConfirming(open)}
        title="CSV の内容を登録しますか？"
        description="判定をもう一度行ったうえで、すべての行をまとめて登録します。途中でエラーが起きた場合は 1 件も登録されません。"
        confirmLabel="登録する"
        pending={busy}
        onConfirm={execute}
        items={[
          { label: "取り込み対象", value: definition.label },
          { label: "ファイル", value: parsed?.fileName },
          { label: "新規登録", value: `${preview?.summary.create ?? 0} 件` },
          { label: "更新", value: `${preview?.summary.update ?? 0} 件` },
          { label: "スキップ", value: `${preview?.summary.skip ?? 0} 件` },
        ]}
      />
    </div>
  );
}
