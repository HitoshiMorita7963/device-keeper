-- PC 名 (自動取得)・管理用端末名・端末連携キーを追加。既存の端末は値なし (未取得・未設定) のまま残る
-- AlterTable
ALTER TABLE "devices" ADD COLUMN     "agent_token_hash" TEXT,
ADD COLUMN     "agent_token_issued_at" TIMESTAMP(3),
ADD COLUMN     "computer_name" TEXT,
ADD COLUMN     "computer_name_updated_at" TIMESTAMP(3),
ADD COLUMN     "management_name" TEXT,
ADD COLUMN     "management_name_updated_at" TIMESTAMP(3),
ADD COLUMN     "management_name_updated_by" INTEGER;

-- CreateIndex
CREATE UNIQUE INDEX "devices_agent_token_hash_key" ON "devices"("agent_token_hash");

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_management_name_updated_by_fkey" FOREIGN KEY ("management_name_updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

