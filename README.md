# 社内IT資産管理システム (device-keeper)

会社が保有する PC・社用スマートフォン・タブレット・周辺機器を一元管理する Web システムです。
端末の利用者・所在・状態、貸出・返却履歴、拠点間移動履歴を管理します。

- 設計書: [docs/design.md](docs/design.md) / [docs/database.md](docs/database.md) / [docs/permissions.md](docs/permissions.md)
- 開発の進捗・初期リリースの完了条件: [docs/progress.md](docs/progress.md)
- 運用手順 (利用者登録・バックアップ・復元): [docs/operations.md](docs/operations.md)

## 技術スタック

| 分類 | 採用技術 |
|---|---|
| フレームワーク | Next.js 16 (App Router, Server Actions) / TypeScript |
| DB / ORM | PostgreSQL 17 / Prisma 7 (`@prisma/adapter-pg`) |
| UI | Tailwind CSS 4 / shadcn/ui (Radix) |
| 入力検証 | Zod / React Hook Form |
| 認証 | メールアドレス + パスワード (bcrypt) + DB セッション。将来 Microsoft Entra ID SSO へ切替可能な構成 |
| テスト | Vitest (単体・実 DB を使った結合テスト・本番ビルドに対する画面/権限の E2E テスト) |

## 必要なもの

- Node.js 20.19 以上 (動作確認: 24.x)
- PostgreSQL 15 以上 (開発時は同梱スクリプトで自動起動できるため、インストール不要)

## 開発環境の構築

```bash
npm install
```

```bash
cp .env.example .env
```

`.env` の `SEED_ADMIN_PASSWORD` に初期管理者のパスワード (12文字以上) を設定します。
未設定の場合はランダムなパスワードが生成され、シード実行時に一度だけ表示されます。

```bash
npm run db:start
```

開発用 PostgreSQL (ポート 5433) を起動し、`device_keeper` と `device_keeper_test` を作成します。
バイナリとデータは `~/.device-keeper/` に置かれます (Windows 版 PostgreSQL は日本語を含むパスで動作しないため)。
既存の PostgreSQL を使う場合はこの手順を省略し、`.env` の接続文字列を書き換えてください。

```bash
npm run db:migrate
```

```bash
npm run db:seed
```

資産種別マスタ (PC / SP / TAB / MON / PER) と初期管理者 (`SEED_ADMIN_EMAIL`、既定 `admin@example.com`) を登録します。

```bash
npm run dev
```

http://localhost:3000 を開き、初期管理者でログインします。

## よく使うコマンド

| コマンド | 内容 |
|---|---|
| `npm run dev` | 開発サーバー起動 |
| `npm test` | 単体・結合テスト (テスト用 DB の内容は毎回消去されます) |
| `npm run test:e2e` | 本番ビルドを作成し、全画面 × 全権限の表示・アクセス制御をテスト |
| `npm run test:all` | 上記すべて |
| `npm run typecheck` | 型チェック |
| `npm run lint` | ESLint |
| `npm run build` / `npm start` | 本番ビルド / 起動 |
| `npm run db:start` / `db:stop` / `db:status` | 開発用 PostgreSQL の起動 / 停止 / 状態確認 |
| `npm run db:migrate` | スキーマ変更からマイグレーションを作成・適用 (開発時) |
| `npm run db:deploy` | 作成済みマイグレーションを適用 (本番) |
| `npm run db:seed` | 初期データ投入 (何度実行しても安全) |
| `npm run db:backup` | バックアップ作成 (`./backups`、30 世代保持) |
| `npm run db:backup:verify` | 最新のバックアップを一時 DB に復元して件数・整合性を確認 |
| `npm run db:restore -- <ファイル> --yes` | バックアップから復元 (現在のデータは置き換わります) |
| `npm run db:check` | データ整合性チェック |

## 環境変数

| 変数 | 必須 | 説明 |
|---|---|---|
| `DATABASE_URL` | ○ | PostgreSQL 接続文字列 |
| `TEST_DATABASE_URL` | テスト時 | テスト用 DB。DB 名に `test` を含む必要あり |
| `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` | 初回 | 初期管理者 |
| `SESSION_TTL_HOURS` | | セッション有効期間 (既定 12 時間) |
| `SESSION_COOKIE_SECURE` | | Cookie の Secure 属性 (本番は既定で有効) |
| `BACKUP_DIR` / `BACKUP_KEEP` | | バックアップの保存先 (既定 `./backups`) / 保持世代数 (既定 30) |
| `DEVICE_SECRET_KEY` | パスワード保存時 | 端末パスワードの暗号鍵 (32 バイトを base64)。紛失すると保存済みのパスワードは復号できない |

`.env` は Git にコミットしないでください (`.gitignore` 済み)。

## 本番運用

1. PostgreSQL を用意し、`.env` の `DATABASE_URL` を設定します (開発用の `db:start` は本番で使わない)。端末のパスワードを保存する場合は `DEVICE_SECRET_KEY` も設定します (生成方法は `.env.example`)。
2. `npm ci` → `npm run db:deploy` (マイグレーション適用) → `npm run db:seed` (初回のみ) → `npm run build` → `npm start`
3. HTTPS 終端 (リバースプロキシ等) の後ろで公開します。HTTP のみでの公開はしないでください。
4. 初期管理者でログインし、ヘッダーの鍵アイコンからパスワードを変更します。
5. システム設定 → 利用者管理 から、IT資産管理担当者・一般社員の利用者を登録します。
6. 定期バックアップを設定します。手順は [docs/operations.md](docs/operations.md) を参照してください。
