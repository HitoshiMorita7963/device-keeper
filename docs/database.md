# データベース設計

定義の正は `prisma/schema.prisma`、適用済み DDL は `prisma/migrations/`。テーブル名・カラム名は指示書 4 章に合わせて snake_case。

## テーブル一覧

| テーブル | 内容 | 主な制約 |
|---|---|---|
| `departments` | 部署マスタ | `department_code` 一意 |
| `locations` | 拠点マスタ | `location_code` 一意 |
| `employees` | 社員 | `employee_number` 一意、`email` 一意 (任意) |
| `device_categories` | 資産種別マスタ | `category_code` 一意、`prefix` 一意 |
| `asset_number_sequences` | 資産管理番号の採番カウンタ (種別ごと) | |
| `devices` | 端末台帳 (`deleted_at` で論理削除) | `asset_number` 一意 |
| `device_assignments` | 貸与履歴 | 未返却 (`returned_at IS NULL`) は端末ごとに 1 件まで (部分ユニークインデックス) |
| `device_location_history` | 拠点移動履歴 | |
| `maintenance_records` | 修理・故障履歴 | 対応中 (`status IN (REPORTED, IN_PROGRESS)`) は端末ごとに 1 件まで (部分ユニークインデックス) |
| `disposal_records` | 廃棄履歴 | 端末ごとに 1 件 |
| `users` | システム利用者 | `email` 一意、`employee_id` 一意 |
| `sessions` | ログインセッション (トークンの SHA-256) | |
| `audit_logs` | 操作履歴 (追記のみ) | |

履歴テーブルから端末・社員・拠点への外部キーは `ON DELETE RESTRICT` とし、履歴が残る親データは物理削除できない。

## 列挙値

| 型 | 値 |
|---|---|
| 端末状態 `DeviceStatus` | `IN_STOCK` 保管中 / `IN_USE` 使用中 / `REPAIR` 修理中 / `LOST` 紛失 / `DISPOSED` 廃棄済み |
| 在籍状態 `EmploymentStatus` | `ACTIVE` 在籍 / `ON_LEAVE` 休職 / `RETIRED` 退職 |
| 権限 `Role` | `ADMIN` 管理者 / `ASSET_MANAGER` IT資産管理担当者 / `EMPLOYEE` 一般社員 |
| 修理状況 `MaintenanceStatus` | `REPORTED` 受付 / `IN_PROGRESS` 修理中 / `COMPLETED` 完了 / `CANCELLED` 取消 |

## スキーマ変更の手順

1. `prisma/schema.prisma` を編集する
2. `npm run db:migrate -- --name <変更内容>` でマイグレーションを作成・適用する (対話型ターミナルで実行すること)
3. 生成された `prisma/migrations/*/migration.sql` をレビューしてコミットする
4. 本番では `npm run db:deploy` で適用する
