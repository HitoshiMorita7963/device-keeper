# 設計書

要件定義・画面設計は「社内IT資産管理システム 画面設計・データベース設計・Claude Code開発指示書 v1.0」に従う。
本書は実装上の判断と構成をまとめたもの。

## 構成

```
src/
  app/
    login/              ログイン画面・ログイン/ログアウト Server Action
    forbidden/          権限不足 (403) 画面
    (app)/              ログイン後の画面 (共通レイアウト: ヘッダー + サイドメニュー)
      page.tsx          ダッシュボード (一般社員は /my へ)
      my/               一般社員向け: 自分の貸与端末・履歴
      employees/ locations/ settings/   各画面 (page.tsx) と Server Action (actions.ts)
  components/
    ui/                 shadcn/ui コンポーネント
    layout/             サイドメニュー・メニュー定義
  lib/
    db.ts               Prisma クライアント
    auth/               認証 (login.ts)・セッション (session.ts)・権限 (permissions.ts)
    action.ts           Server Action 共通処理 (権限チェック・入力検証・エラー変換)
    validation/         入力検証スキーマ (画面とサーバーで共通)
    audit.ts            操作履歴の記録
    dates.ts            日付ユーティリティ (業務日付は日本時間)
  server/               業務処理 (DB 更新 + 操作履歴をトランザクションで実行)。Server Action から呼ぶ
  proxy.ts              未ログイン時のログイン画面へのリダイレクト
prisma/
  schema.prisma         DB 定義 / migrations/ マイグレーション / seed.ts 初期データ
scripts/dev-db.mjs      開発用 PostgreSQL の起動・停止
tests/                  unit/ 単体テスト, integration/ 実 DB を使う結合テスト
```

## 実装上の判断

| 項目 | 判断 | 理由 |
|---|---|---|
| 認証方式 | メール + パスワード (bcrypt, cost 12)。`users.external_auth_id` を用意 | Microsoft 365 の利用状況が未確認のため。Entra ID 採用時は認証部分 (`src/lib/auth/login.ts`) のみ差し替える |
| セッション | ランダムトークン (256bit) を HttpOnly Cookie に保存し、DB には SHA-256 ハッシュのみ保存 | ログアウト・利用者無効化で即時失効でき、DB 漏えい時もなりすましを防ぐ |
| ログイン試行制限 | 5 回連続失敗で 15 分ロック | 総当たり攻撃対策 |
| 権限チェック | 画面 (`requirePermission`)・Server Action (`runAction` / `assertPermission`) の両方でサーバー側検証。`proxy.ts` は Cookie 有無のみ確認 | 画面のボタン非表示だけに頼らない |
| 一般社員のデータ範囲 | 検索条件に必ずログイン利用者の `employee_id` を含める | 他の社員の端末を閲覧させない |
| 未返却の貸与の重複防止 | アプリ側チェックに加え、部分ユニークインデックス `device_assignments_one_open_per_device` (`WHERE returned_at IS NULL`) | 同時操作でも DB が整合性を保証する |
| 現在利用者 | `devices.current_employee_id` を追加 (指示書 3.8「端末の現在利用者を更新する」に対応) | 一覧・検索の性能と分かりやすさ。正は未返却の貸与レコード |
| 資産管理番号の自動採番 | 種別ごとのカウンタ表 `asset_number_sequences` を行ロックして採番 | 同時登録時の番号重複防止 |
| 日付 | 購入日・保証期限・貸出日等は `date` 型。「今日」は日本時間で判定 | タイムゾーンによる 1 日ずれ防止 |
| 監査ログ | 業務データ更新と同一トランザクションで記録。パスワードハッシュ等は除外 | 更新とログの不整合を防ぐ |
| 削除 | 端末は `deleted_at` による論理削除。履歴テーブルは外部キー `RESTRICT` で物理削除不可 | データ整合性ルール 10 |
| キャッシュ | Next.js の Cache Components は無効。全画面をリクエストごとに描画 | 業務データは常に最新を表示する必要があるため |
| フォント | OS 標準の日本語フォント | 外部フォント取得なしで社内ネットワークでもビルドできるように |
| 端末パスワード | AES-256-GCM で暗号化して保存 (鍵は環境変数 `DEVICE_SECRET_KEY`)。Prisma クライアントの既定で暗号化列を取得しない設定にし、管理者の表示操作でのみ復号する | Excel 台帳の PW・PW2 を引き継ぐため。DB やバックアップが漏えいしてもパスワードは読めない |

## PC名の自動取得

- ブラウザの JavaScript からは Windows の PC 名を取得できないため、端末側の PowerShell スクリプト (`agent/windows/Send-ComputerName.ps1`) が API へ送信する
- API: `POST /api/devices/{id}/computer-name` 本文 `{ "computerName": "DESKTOP-A8F3K2" }`、認証 `Authorization: Bearer <端末連携キー>`
  - 200 `{ ok, deviceId, assetNumber, computerName, computerNameUpdatedAt, changed }` / 400 入力エラー / 401 キーなし・不正・無効 / 403 別の端末のキー / 404 端末なし / 409 廃棄済み / 413 本文が大きすぎる
  - ログイン Cookie では受け付けない (`src/proxy.ts` のログイン画面への転送対象外)
- 端末の特定: 端末連携キー (256bit 乱数、DB には SHA-256 のみ) で送信元の端末を特定し、URL の端末 ID と一致する場合のみ受け付ける。PC 名だけでは端末を特定しない
- PC 名の形式: 先頭が英数字、英数字・ハイフン・アンダースコア、63 文字まで (サーバー側で検証。DB 操作は Prisma のパラメーター化クエリ)
- 同じ PC 名の再送信は取得日時のみ更新し、PC 名が変わった場合のみ操作履歴に残す (定期実行による履歴の肥大化を防ぐ)
- 既存の「ホスト名」(Excel 台帳から取り込んだ値・手入力) は残し、自動取得の「PC名」とは別の項目として扱う

## 追加したテーブル・カラム (指示書のデータベース設計からの差分)

- `sessions`: ログインセッション
- `asset_number_sequences`: 資産管理番号の採番カウンタ
- `device_categories.number_digits`: 採番の桁数 (既定 6 → `PC-000001`)
- `devices.current_employee_id`: 現在の利用者
- `device_assignments.accessories_checked`: 返却時の付属品確認 (指示書 3.8 の入力項目)
- `maintenance_records.previous_device_status`: 修理完了時に戻す端末状態
- `users.display_name` / `failed_login_count` / `locked_until` / `last_login_at`: 表示名とログイン試行制限
- `devices.computer_name` / `computer_name_updated_at`: 端末から自動取得した PC 名と最終取得日時
- `devices.management_name` / `management_name_updated_at` / `management_name_updated_by`: 管理用端末名と最終更新日時・更新者 (users への外部キー)
- `devices.agent_token_hash` / `agent_token_issued_at`: 端末連携キーのハッシュ (一意) と発行日時
- `devices.hostname` / `purpose` / `cpu` / `memory` / `disk` / `home_loaned_at` / `recovery` / `initial_user` / `login_user` / `initial_password_enc` / `login_password_enc`: Excel 台帳の項目 (パスワードは暗号化)

## バックアップと復元

- 方式: `scripts/db-backup.mjs` が全テーブルの行を読み取り専用スナップショット (REPEATABLE READ) で読み出し、gzip 圧縮した JSON Lines として保存する。pg_dump などの外部ツールに依存せず、アプリと同じ Node.js だけで実行できる
- ファイルには適用済みマイグレーションの一覧と各テーブルの件数を含める。復元時はスキーマ (マイグレーション) が一致することを確認してから、1 トランザクションで全テーブルを置き換え、件数の一致を確認する。途中で失敗した場合は復元前の状態に戻る
- 列の型 (列挙型・日付・JSON) は `json_populate_recordset` で DB の定義どおりに復元し、自動採番の続きも復元後の最大値に合わせる
- ログインセッションは保存しない (復元後は全員が再ログインする)
- 新しいテーブルを追加した場合は、`scripts/db-backup.mjs` の `TABLES` に追加する (未登録のテーブルがあるとバックアップを中止する)
- 運用手順 (定期実行の設定・復元手順) は [operations.md](operations.md) を参照
