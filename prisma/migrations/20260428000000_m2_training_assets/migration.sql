-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "HandStatus" AS ENUM ('STARTED', 'COMPLETED', 'ABANDONED');

-- CreateEnum
CREATE TYPE "AIArtifactKind" AS ENUM ('BOT_ACTION', 'HERO_COACH', 'HAND_REVIEW', 'HISTORY_DIAGNOSIS');

-- CreateEnum
CREATE TYPE "AIArtifactStatus" AS ENUM ('SAVED_CHARGED', 'FAILED_NOT_CHARGED', 'PENDING_PERSISTENCE', 'PARTIAL_NOT_FINAL');

-- CreateEnum
CREATE TYPE "WalletLedgerEntryType" AS ENUM ('CREDIT_GRANT', 'AI_CHARGE', 'ADJUSTMENT', 'REVERSAL');

-- CreateEnum
CREATE TYPE "LabelAssignmentSource" AS ENUM ('AI', 'USER', 'SYSTEM');

-- CreateTable
CREATE TABLE "app_user" (
    "id" TEXT NOT NULL,
    "email" TEXT,
    "display_name" TEXT,
    "schema_version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallet_account" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "balance" INTEGER NOT NULL DEFAULT 0,
    "schema_version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wallet_account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "table_config" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "player_count" INTEGER NOT NULL,
    "starting_stack" INTEGER NOT NULL,
    "small_blind" INTEGER NOT NULL,
    "big_blind" INTEGER NOT NULL,
    "ante" INTEGER NOT NULL DEFAULT 0,
    "button_seat" INTEGER NOT NULL DEFAULT 0,
    "straddle_seat" INTEGER,
    "straddle_amount" INTEGER,
    "seed" TEXT,
    "config_payload" JSONB NOT NULL,
    "schema_version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "table_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "table_seat_profile" (
    "id" TEXT NOT NULL,
    "table_config_id" TEXT NOT NULL,
    "seat_index" INTEGER NOT NULL,
    "player_id" TEXT NOT NULL,
    "display_name" TEXT,
    "is_hero" BOOLEAN NOT NULL DEFAULT false,
    "starting_stack" INTEGER NOT NULL,
    "style_profile" JSONB,
    "schema_version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "table_seat_profile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hand" (
    "id" TEXT NOT NULL,
    "table_config_id" TEXT NOT NULL,
    "user_id" TEXT,
    "status" "HandStatus" NOT NULL DEFAULT 'STARTED',
    "seed" TEXT NOT NULL,
    "button_seat" INTEGER NOT NULL,
    "small_blind_seat" INTEGER NOT NULL,
    "big_blind_seat" INTEGER NOT NULL,
    "hero_seat_index" INTEGER,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "completion_reason" TEXT,
    "final_state_payload" JSONB,
    "schema_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "hand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hand_event_log" (
    "id" TEXT NOT NULL,
    "hand_id" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "event_type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "schema_version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hand_event_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "decision_snapshot" (
    "id" TEXT NOT NULL,
    "hand_id" TEXT NOT NULL,
    "decision_point_id" TEXT NOT NULL,
    "street" TEXT NOT NULL,
    "acting_seat_index" INTEGER NOT NULL,
    "event_sequence" INTEGER,
    "visible_state" JSONB NOT NULL,
    "legal_actions" JSONB NOT NULL,
    "schema_version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "decision_snapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_artifact" (
    "id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "hand_id" TEXT,
    "decision_snapshot_id" TEXT,
    "decision_point_id" TEXT,
    "artifact_kind" "AIArtifactKind" NOT NULL,
    "status" "AIArtifactStatus" NOT NULL,
    "prompt_version" TEXT NOT NULL,
    "schema_version" INTEGER NOT NULL DEFAULT 1,
    "model_name" TEXT NOT NULL,
    "provider_name" TEXT NOT NULL,
    "request_payload" JSONB NOT NULL,
    "response_payload" JSONB,
    "error_type" TEXT,
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_artifact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "label_definition" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "schema_version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "label_definition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "label_assignment" (
    "id" TEXT NOT NULL,
    "hand_id" TEXT NOT NULL,
    "label_definition_id" TEXT NOT NULL,
    "decision_snapshot_id" TEXT,
    "ai_artifact_id" TEXT,
    "source" "LabelAssignmentSource" NOT NULL,
    "street" TEXT,
    "decision_point_id" TEXT,
    "note" TEXT,
    "metadata" JSONB,
    "schema_version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "label_assignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallet_ledger" (
    "id" TEXT NOT NULL,
    "request_id" TEXT,
    "user_id" TEXT NOT NULL,
    "wallet_account_id" TEXT NOT NULL,
    "ai_artifact_id" TEXT,
    "entry_type" "WalletLedgerEntryType" NOT NULL,
    "amount_delta" INTEGER NOT NULL,
    "balance_after" INTEGER NOT NULL,
    "description" TEXT,
    "metadata" JSONB,
    "schema_version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wallet_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "app_user_email_key" ON "app_user"("email");

-- CreateIndex
CREATE UNIQUE INDEX "wallet_account_user_id_key" ON "wallet_account"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "table_seat_profile_table_config_id_seat_index_key" ON "table_seat_profile"("table_config_id", "seat_index");

-- CreateIndex
CREATE INDEX "hand_started_at_idx" ON "hand"("started_at");

-- CreateIndex
CREATE INDEX "hand_user_id_started_at_idx" ON "hand"("user_id", "started_at");

-- CreateIndex
CREATE UNIQUE INDEX "hand_event_log_hand_id_sequence_key" ON "hand_event_log"("hand_id", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "decision_snapshot_hand_id_decision_point_id_key" ON "decision_snapshot"("hand_id", "decision_point_id");

-- CreateIndex
CREATE UNIQUE INDEX "ai_artifact_request_id_key" ON "ai_artifact"("request_id");

-- CreateIndex
CREATE INDEX "ai_artifact_hand_id_decision_point_id_idx" ON "ai_artifact"("hand_id", "decision_point_id");

-- CreateIndex
CREATE UNIQUE INDEX "label_definition_key_version_key" ON "label_definition"("key", "version");

-- CreateIndex
CREATE INDEX "label_assignment_hand_id_decision_point_id_idx" ON "label_assignment"("hand_id", "decision_point_id");

-- CreateIndex
CREATE UNIQUE INDEX "wallet_ledger_request_id_key" ON "wallet_ledger"("request_id");

-- CreateIndex
CREATE INDEX "wallet_ledger_user_id_created_at_idx" ON "wallet_ledger"("user_id", "created_at");

-- AddForeignKey
ALTER TABLE "wallet_account" ADD CONSTRAINT "wallet_account_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "table_config" ADD CONSTRAINT "table_config_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "table_seat_profile" ADD CONSTRAINT "table_seat_profile_table_config_id_fkey" FOREIGN KEY ("table_config_id") REFERENCES "table_config"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hand" ADD CONSTRAINT "hand_table_config_id_fkey" FOREIGN KEY ("table_config_id") REFERENCES "table_config"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hand" ADD CONSTRAINT "hand_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hand_event_log" ADD CONSTRAINT "hand_event_log_hand_id_fkey" FOREIGN KEY ("hand_id") REFERENCES "hand"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decision_snapshot" ADD CONSTRAINT "decision_snapshot_hand_id_fkey" FOREIGN KEY ("hand_id") REFERENCES "hand"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_artifact" ADD CONSTRAINT "ai_artifact_decision_snapshot_id_fkey" FOREIGN KEY ("decision_snapshot_id") REFERENCES "decision_snapshot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_artifact" ADD CONSTRAINT "ai_artifact_hand_id_fkey" FOREIGN KEY ("hand_id") REFERENCES "hand"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "label_assignment" ADD CONSTRAINT "label_assignment_ai_artifact_id_fkey" FOREIGN KEY ("ai_artifact_id") REFERENCES "ai_artifact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "label_assignment" ADD CONSTRAINT "label_assignment_decision_snapshot_id_fkey" FOREIGN KEY ("decision_snapshot_id") REFERENCES "decision_snapshot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "label_assignment" ADD CONSTRAINT "label_assignment_hand_id_fkey" FOREIGN KEY ("hand_id") REFERENCES "hand"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "label_assignment" ADD CONSTRAINT "label_assignment_label_definition_id_fkey" FOREIGN KEY ("label_definition_id") REFERENCES "label_definition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_ledger" ADD CONSTRAINT "wallet_ledger_ai_artifact_id_fkey" FOREIGN KEY ("ai_artifact_id") REFERENCES "ai_artifact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_ledger" ADD CONSTRAINT "wallet_ledger_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_ledger" ADD CONSTRAINT "wallet_ledger_wallet_account_id_fkey" FOREIGN KEY ("wallet_account_id") REFERENCES "wallet_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
