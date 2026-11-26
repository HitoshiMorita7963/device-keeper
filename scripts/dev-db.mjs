// 開発・テスト用のローカル PostgreSQL を操作する (本番では使用しない)。
// PostgreSQL / Docker をインストールしていない環境でも DB を用意できるよう、
// npm パッケージ embedded-postgres に同梱された PostgreSQL バイナリを利用する。
//
//   node scripts/dev-db.mjs start   … 起動 (初回はクラスタ作成・DB 作成も行う)
//   node scripts/dev-db.mjs stop    … 停止
//   node scripts/dev-db.mjs status  … 状態確認
//
// 環境変数 DEV_DB_PORT / DEV_DB_USER / DEV_DB_PASSWORD / DEV_DB_HOME で既定値を変更できる。
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import pg from "pg";

const port = Number(process.env.DEV_DB_PORT ?? 5433);
const user = process.env.DEV_DB_USER ?? "device_keeper";
const password = process.env.DEV_DB_PASSWORD ?? "device_keeper_dev";
const databases = ["device_keeper", "device_keeper_test"];

// Windows 版 PostgreSQL は非 ASCII 文字を含むパスで初期化に失敗するため、
// バイナリとデータはホーム配下 (ASCII パス) に置く
const home = path.resolve(process.env.DEV_DB_HOME ?? path.join(os.homedir(), ".device-keeper"));
const dataDir = path.join(home, "pgdata");
const logFile = path.join(home, "postgres.log");

const exe = (name) => (process.platform === "win32" ? `${name}.exe` : name);

async function binaryPackageDir() {
  const platform = process.platform === "win32" ? "windows" : process.platform;
  const { pg_ctl } = await import(`@embedded-postgres/${platform}-${os.arch()}`);
  const dir = path.resolve(path.dirname(pg_ctl), "..", "..");
  return { dir, version: JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8")).version };
}

async function ensureBinaries() {
  const { dir, version } = await binaryPackageDir();
  const binHome = path.join(home, `pg-${version}`);
  if (!existsSync(path.join(binHome, "bin", exe("pg_ctl")))) {
    console.log(`[dev-db] PostgreSQL バイナリを配置します: ${binHome}`);
    mkdirSync(home, { recursive: true });
    cpSync(path.join(dir, "native"), binHome, { recursive: true, verbatimSymlinks: true });
  }
  return path.join(binHome, "bin");
}

function run(bin, name, args, opts = {}) {
  return execFileSync(path.join(bin, exe(name)), args, { stdio: "pipe", encoding: "utf8", ...opts });
}

function isRunning(bin) {
  if (!existsSync(path.join(dataDir, "PG_VERSION"))) return false;
  try {
    run(bin, "pg_ctl", ["status", "-D", dataDir]);
    return true;
  } catch {
    return false;
  }
}

async function start() {
  const bin = await ensureBinaries();

  if (!existsSync(path.join(dataDir, "PG_VERSION"))) {
    console.log(`[dev-db] データベースクラスタを作成します: ${dataDir}`);
    mkdirSync(home, { recursive: true });
    const pwFile = path.join(home, ".pwfile");
    writeFileSync(pwFile, password, { mode: 0o600 });
    try {
      run(bin, "initdb", [
        "-D", dataDir, "-U", user, `--pwfile=${pwFile}`,
        "--encoding=UTF8", "--locale=C", "--auth=scram-sha-256",
      ]);
    } finally {
      rmSync(pwFile, { force: true });
    }
  }

  if (isRunning(bin)) {
    console.log("[dev-db] 既に起動しています。");
  } else {
    run(bin, "pg_ctl", ["start", "-w", "-D", dataDir, "-l", logFile, "-o", `-p ${port} -c listen_addresses=localhost`], {
      stdio: "ignore",
    });
    console.log(`[dev-db] 起動しました (ログ: ${logFile})`);
  }

  const client = new pg.Client({ host: "localhost", port, user, password, database: "postgres" });
  await client.connect();
  for (const name of databases) {
    const { rowCount } = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [name]);
    if (!rowCount) {
      await client.query(`CREATE DATABASE "${name}"`);
      console.log(`[dev-db] データベースを作成しました: ${name}`);
    }
  }
  await client.end();
  console.log(`[dev-db] postgresql://${user}:***@localhost:${port}/{${databases.join(",")}}`);
}

async function stop() {
  const bin = await ensureBinaries();
  if (!isRunning(bin)) {
    console.log("[dev-db] 起動していません。");
    return;
  }
  run(bin, "pg_ctl", ["stop", "-w", "-m", "fast", "-D", dataDir]);
  console.log("[dev-db] 停止しました。");
}

async function status() {
  const bin = await ensureBinaries();
  console.log(isRunning(bin) ? `[dev-db] 起動中 (port ${port})` : "[dev-db] 停止中");
}

const command = process.argv[2] ?? "start";
if (command === "start") await start();
else if (command === "stop") await stop();
else if (command === "status") await status();
else {
  console.error(`不明なコマンドです: ${command} (start | stop | status)`);
  process.exit(1);
}
