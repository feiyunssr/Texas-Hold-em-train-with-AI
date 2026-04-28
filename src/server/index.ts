export type ServiceHealth = {
  ok: true;
  service: string;
};

export function getServiceHealth(): ServiceHealth {
  return {
    ok: true,
    service: "texas-holdem-train-with-ai"
  };
}

export { getPrisma } from "./db";
export { PrismaTrainingAssetRepository } from "./persistence/prisma-training-assets";
export { TrainingAssetService } from "./persistence/training-assets";
export type {
  AIArtifactKind,
  AIArtifactRecord,
  AIArtifactStatus,
  DecisionAuditTrail,
  DecisionSnapshotRecord,
  HandHistoryRow,
  StoredHandEvent,
  TrainingAssetRepository,
  WalletAccountRecord,
  WalletLedgerRecord
} from "./persistence/types";
