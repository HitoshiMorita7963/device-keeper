// データベースのバックアップ・復元。
// 外部ツール (pg_dump) に依存せず、アプリと同じ Node.js だけで動くよう、全テーブルの行を JSON 形式で保存する。
//
//   node scripts/db-backup.mjs backup                     … バックアップを作成 (既定: ./backups)
//   node scripts/db-backup.mjs list                       … バックアップ一覧
//   node scripts/db-backup.mjs verify [ファイル]           … 一時 DB に復元して件数・整合性を確認 (元の DB は変更しない)
//   node scripts/db-backup.mjs restore <ファイル> --yes    … DATABASE_URL の DB の内容を、バックアップの内容で置き換える
//
// 環境変数: DATABASE_URL (必須) / BACKUP_DIR 保存先 (既定 ./backups) / BACKUP_KEEP 保持世代数 (既定 30)
//
// ファイル形式 (gzip 圧縮した JSON Lines):
//   1 行目: {"format":"device-keeper-backup","version":1,"createdAt":...,"migrations":[...],"counts":{...}}
//   2 行目以降: {"t":"テーブル名","r":{行データ}}
// ログインセッション (sessions) は保存しない (復元後は全員が再ログインする)。
import "dotenv/config";
import { spawnSync } from "node:child_process";
import { createReadStream, createWriteStream, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import { once } from "node:events";
import { createGunzip, createGzip } from "node:zlib";
import pg from "pg";

const BACKUP_DIR = path.resolve(process.env.BACKUP_DIR ?? "backups");
const KEEP = Number(process.env.BACKUP_KEEP ?? 30);
const PREFIX = "device_keeper_";
const FORMAT = "device-keeper-backup";
const BATCH = 1000;

/** 復元時の登録順 (外部キーの参照先を先に入れる)。新しいテーブルを追加したらここにも追加すること */
const TABLES = [
  "departments",
  "locations",
  "device_categories",
  "asset_number_sequences",
  "employees",
  "users",
  "devices",
  "device_assignments",
  "device_location_history",
  "maintenance_records",
  "disposal_records",
  "audit_logs",
];
const EXCLUDED = new Set(["sessions", "_prisma_migrations"]);

function fail(message) {
  console.error(`[db-backup] ${message}`);
  process.exit(1);
}

/** Prisma 用の接続文字列から、node-postgres が解釈できない ?schema= などを除く */
function connectionUrl(url, database) {
  if (!url) fail("DATABASE_URL が設定されていません。");
  const u = new URL(url);
  u.search = "";
  if (database) u.pathname = `/${database}`;
  return u.toString();
}

async function connect(url) {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  return client;
}

/** DB 上のテーブルがすべて TABLES に含まれているか確認する (保存漏れを防ぐ) */
async function assertTablesKnown(client) {
  const { rows } = await client.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public'");
  const unknown = rows.map((r) => r.tablename).filter((t) => !TABLES.includes(t) && !EXCLUDED.has(t));
  if (unknown.length) fail(`バックアップ対象に登録されていないテーブルがあります: ${unknown.join(", ")} (scripts/db-backup.mjs の TABLES に追加してください)`);
}

async function appliedMigrations(client) {
  const { rows } = await client.query("SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name");
  return rows.map((r) => r.migration_name);
}

async function primaryKey(client, table) {
  const { rows } = await client.query(
    `SELECT a.attname FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
     WHERE i.indrelid = $1::regclass AND i.indisprimary`,
    [`"${table}"`],
  );
  return rows.map((r) => r.attname);
}

async function counts(client) {
  const result = {};
  for (const t of TABLES) result[t] = Number((await client.query(`SELECT count(*) FROM "${t}"`)).rows[0].count);
  return result;
}

function backups() {
  if (!existsSync(BACKUP_DIR)) return [];
  return readdirSync(BACKUP_DIR)
    .filter((f) => f.startsWith(PREFIX) && f.endsWith(".jsonl.gz"))
    .sort()
    .map((f) => path.join(BACKUP_DIR, f));
}

function timestamp() {
  const jst = new Date(Date.now() + 9 * 3600_000).toISOString();
  return jst.slice(0, 19).replace(/[-:]/g, "").replace("T", "_");
}

async function write(stream, line) {
  if (!stream.write(`${line}\n`)) await once(stream, "drain");
}

// ---------------------------------------------------------------------------
// バックアップ
// ---------------------------------------------------------------------------

async function backup() {
  const client = await connect(connectionUrl(process.env.DATABASE_URL));
  mkdirSync(BACKUP_DIR, { recursive: true });
  const file = path.join(BACKUP_DIR, `${PREFIX}${timestamp()}.jsonl.gz`);
  const partial = `${file}.partial`;
  try {
    await assertTablesKnown(client);
    // 全テーブルを同じ時点の内容で保存するため、読み取り専用のスナップショットで読む
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const header = { format: FORMAT, version: 1, createdAt: new Date().toISOString(), migrations: await appliedMigrations(client), counts: await counts(client) };

    const gzip = createGzip();
    const out = createWriteStream(partial);
    const done = new Promise((resolve, reject) => {
      out.on("finish", resolve);
      out.on("error", reject);
      gzip.on("error", reject);
    });
    gzip.pipe(out);
    await write(gzip, JSON.stringify(header));
    for (const table of TABLES) {
      const pk = await primaryKey(client, table);
      const order = pk.map((c) => `"${c}"`).join(", ");
      for (let offset = 0; ; offset += BATCH) {
        const { rows } = await client.query(`SELECT row_to_json(t) AS r FROM (SELECT * FROM "${table}" ORDER BY ${order} LIMIT ${BATCH} OFFSET ${offset}) t`);
        for (const { r } of rows) await write(gzip, JSON.stringify({ t: table, r }));
        if (rows.length < BATCH) break;
      }
    }
    gzip.end();
    await done;
    await client.query("COMMIT");
    // 書き込み完了後に名前を変えることで、途中で失敗した不完全なファイルを正式なバックアップと誤認しない
    rmSync(file, { force: true });
    await import("node:fs/promises").then((fs) => fs.rename(partial, file));
    const total = Object.values(header.counts).reduce((a, b) => a + b, 0);
    console.log(`[db-backup] バックアップを作成しました: ${file} (${total} 行, ${(statSync(file).size / 1024).toFixed(1)} KB)`);
  } catch (error) {
    rmSync(partial, { force: true });
    throw error;
  } finally {
    await client.end();
  }

  const all = backups();
  for (const old of all.slice(0, Math.max(0, all.length - KEEP))) {
    rmSync(old);
    console.log(`[db-backup] 保持数 (${KEEP} 世代) を超えた古いバックアップを削除しました: ${path.basename(old)}`);
  }
  return file;
}

// ---------------------------------------------------------------------------
// 復元
// ---------------------------------------------------------------------------

async function* readBackup(file) {
  const lines = createInterface({ input: createReadStream(file).pipe(createGunzip()), crlfDelay: Infinity });
  for await (const line of lines) if (line) yield JSON.parse(line);
}

async function readHeader(file) {
  for await (const header of readBackup(file)) {
    if (header.format !== FORMAT) fail(`${path.basename(file)} は device-keeper のバックアップではありません。`);
    return header;
  }
  fail(`${path.basename(file)} が空です。`);
}

/**
 * 対象 DB の内容をバックアップで置き換える。1 つのトランザクションで行い、途中で失敗した場合は元の状態に戻る。
 * 対象 DB のスキーマ (適用済みマイグレーション) がバックアップ作成時と同じであることを確認してから行う。
 */
async function restoreInto(file, url) {
  const header = await readHeader(file);
  const client = await connect(url);
  try {
    const current = await appliedMigrations(client);
    if (JSON.stringify(current) !== JSON.stringify(header.migrations)) {
      fail(
        `DB のスキーマとバックアップ作成時のスキーマが一致しません。\n  DB: ${current.at(-1) ?? "(なし)"}\n  バックアップ: ${header.migrations.at(-1) ?? "(なし)"}\n` +
          "バックアップ作成時と同じバージョンのアプリでマイグレーションを適用してから復元してください。",
      );
    }
    await assertTablesKnown(client);
    await client.query("BEGIN");
    await client.query(`TRUNCATE ${[...TABLES, "sessions"].map((t) => `"${t}"`).join(", ")} RESTART IDENTITY CASCADE`);

    let table = null;
    let batch = [];
    const flush = async () => {
      if (batch.length === 0) return;
      // json_populate_recordset で列の型 (列挙型・日付・JSON 等) を DB の定義どおりに復元する
      await client.query(`INSERT INTO "${table}" SELECT * FROM json_populate_recordset(NULL::"${table}", $1::json)`, [JSON.stringify(batch)]);
      batch = [];
    };
    let first = true;
    for await (const line of readBackup(file)) {
      if (first) {
        first = false;
        continue;
      }
      if (line.t !== table) {
        await flush();
        if (!TABLES.includes(line.t)) throw new Error(`不明なテーブルの行があります: ${line.t}`);
        table = line.t;
      }
      batch.push(line.r);
      if (batch.length >= BATCH) await flush();
    }
    await flush();

    // 自動採番 (id) の続きをバックアップ時点の最大値に合わせる
    for (const t of TABLES) {
      // id 列のないテーブル (採番カウンタ等) は対象外。存在しない列を指定するとトランザクションが中断されるため先に確認する
      const { rows } = await client.query(
        `SELECT pg_get_serial_sequence($1, 'id') AS seq FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = $2 AND column_name = 'id'`,
        [`"${t}"`, t],
      );
      const seq = rows[0]?.seq;
      if (seq) await client.query(`SELECT setval($1, COALESCE(MAX(id), 1), MAX(id) IS NOT NULL) FROM "${t}"`, [seq]);
    }

    const restored = await counts(client);
    const diff = TABLES.filter((t) => restored[t] !== header.counts[t]);
    if (diff.length) throw new Error(`復元後の件数がバックアップと一致しません: ${diff.join(", ")}`);
    await client.query("COMMIT");
    return { header, restored };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}

async function restore(file, confirmed) {
  if (!file || !existsSync(file)) fail("復元するバックアップファイルを指定してください (npm run db:backup:list で一覧を確認できます)。");
  const url = connectionUrl(process.env.DATABASE_URL);
  const header = await readHeader(file);
  const database = new URL(url).pathname.slice(1);
  if (!confirmed) {
    console.log(`[db-backup] データベース「${database}」の内容を ${path.basename(file)} (${header.createdAt} 作成) で置き換えます。現在のデータは失われます。`);
    console.log("[db-backup] 実行する場合は --yes を付けてください。事前に npm run db:backup で現在の状態を保存しておくことを推奨します。");
    process.exit(1);
  }
  await restoreInto(file, url);
  console.log(`[db-backup] 復元しました: ${database} ← ${path.basename(file)}`);
  console.log("[db-backup] ログイン中のセッションは無効になりました。npm run db:check で内容を確認してください。");
}

/** 一時 DB を作成してマイグレーションを適用し、バックアップを復元して件数・整合性を確認する */
async function verify(file) {
  const url = connectionUrl(process.env.DATABASE_URL);
  const target = file ?? backups().at(-1);
  if (!target) fail("バックアップがありません。先に npm run db:backup を実行してください。");
  const scratch = `${new URL(url).pathname.slice(1)}_restore_check`;
  const scratchUrl = connectionUrl(process.env.DATABASE_URL, scratch);
  const admin = await connect(connectionUrl(process.env.DATABASE_URL, "postgres"));
  await admin.query(`DROP DATABASE IF EXISTS "${scratch}" WITH (FORCE)`);
  await admin.query(`CREATE DATABASE "${scratch}"`);
  try {
    const migrate = spawnSync(process.execPath, [path.resolve("node_modules/prisma/build/index.js"), "migrate", "deploy"], {
      env: { ...process.env, DATABASE_URL: scratchUrl },
      encoding: "utf8",
    });
    if (migrate.status !== 0) fail(`一時 DB へのマイグレーション適用に失敗しました:\n${migrate.stdout}${migrate.stderr}`);
    const { header, restored } = await restoreInto(target, scratchUrl);
    console.log(`[db-backup] ${path.basename(target)} (${header.createdAt} 作成) を一時 DB「${scratch}」に復元しました。`);
    console.table(restored);
    const check = spawnSync(process.execPath, [path.resolve("node_modules/tsx/dist/cli.mjs"), "scripts/check-integrity.ts", "--url", scratchUrl], { stdio: "inherit" });
    if (check.status !== 0) fail("復元したデータの整合性チェックでエラーが見つかりました。");
    console.log("[db-backup] 復元確認が完了しました (件数一致・整合性エラーなし)。");
  } finally {
    await admin.query(`DROP DATABASE IF EXISTS "${scratch}" WITH (FORCE)`);
    await admin.end();
  }
}

const [command, arg] = process.argv.slice(2);
try {
  if (command === "backup") await backup();
  else if (command === "list") {
    for (const f of backups()) console.log(`${path.basename(f)}\t${(statSync(f).size / 1024).toFixed(1)} KB`);
  } else if (command === "restore") await restore(arg, process.argv.includes("--yes"));
  else if (command === "verify") await verify(arg && !arg.startsWith("--") ? path.resolve(arg) : undefined);
  else fail("使い方: node scripts/db-backup.mjs backup | list | verify [ファイル] | restore <ファイル> --yes");
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
