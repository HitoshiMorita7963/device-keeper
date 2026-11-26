// データ整合性チェック (コマンドライン版)。バックアップから復元した後などに実行する。
//   npm run db:check                         … DATABASE_URL の DB を確認
//   npm run db:check -- --url <接続文字列>    … 指定した DB を確認
// エラーがあれば終了コード 1 を返す。
import "dotenv/config";
import { createDbClient } from "../src/lib/db";
import { checkIntegrity } from "../src/server/integrity";

const urlIndex = process.argv.indexOf("--url");
const connectionString = urlIndex > 0 ? process.argv[urlIndex + 1] : process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL が設定されていません。");
  process.exit(1);
}

const client = createDbClient(connectionString);

async function main() {
  const [issues, counts] = await Promise.all([
    checkIntegrity(client),
    Promise.all([client.device.count(), client.employee.count(), client.deviceAssignment.count(), client.auditLog.count()]),
  ]);
  console.log(`端末 ${counts[0]} 件・社員 ${counts[1]} 件・貸与履歴 ${counts[2]} 件・操作履歴 ${counts[3]} 件`);
  for (const i of issues) console.log(`[${i.severity === "error" ? "エラー" : "警告"}] ${i.assetNumber ?? "-"} ${i.check}: ${i.message}`);
  const errors = issues.filter((i) => i.severity === "error").length;
  console.log(errors === 0 ? "整合性チェック: エラーはありません。" : `整合性チェック: エラー ${errors} 件`);
  process.exitCode = errors === 0 ? 0 : 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => client.$disconnect());
