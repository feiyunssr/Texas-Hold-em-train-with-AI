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
export {
  getTrainingTableRuntime,
  TrainingRuntimeError,
  TrainingTableRuntime
} from "./training-runtime";
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
export type {
  BotSeatView,
  BotStyle,
  PublicHandState,
  RuntimePublicEvent,
  TrainingTableSnapshot
} from "./training-runtime/types";
