import type { Prisma, PrismaClient } from "../../../generated/prisma/client";

import type {
  AIArtifactRecord,
  AppendHandEventInput,
  CreateWalletLedgerInput,
  DebitWalletAccountInput,
  DecisionAuditTrail,
  DecisionSnapshotRecord,
  HandHistoryRow,
  JsonValue,
  SaveAIArtifactInput,
  SaveDecisionSnapshotInput,
  StoredHandEvent,
  TrainingAssetRepository,
  WalletAccountRecord,
  WalletLedgerRecord
} from "./types";

type TransactionClient = Parameters<
  Parameters<PrismaClient["$transaction"]>[0]
>[0];

type PrismaExecutor = PrismaClient | TransactionClient;

export class PrismaTrainingAssetRepository implements TrainingAssetRepository {
  constructor(private readonly prisma: PrismaExecutor) {}

  async appendHandEvents(
    events: AppendHandEventInput[]
  ): Promise<StoredHandEvent[]> {
    const created: StoredHandEvent[] = [];

    for (const event of events) {
      const record = await this.prisma.handEventLog.create({
        data: {
          handId: event.handId,
          sequence: event.sequence,
          eventType: event.eventType,
          payload: toInputJson(event.payload),
          schemaVersion: event.schemaVersion ?? 1
        }
      });
      created.push(toStoredHandEvent(record));
    }

    return created;
  }

  async saveDecisionSnapshot(
    snapshot: SaveDecisionSnapshotInput
  ): Promise<DecisionSnapshotRecord> {
    const record = await this.prisma.decisionSnapshot.create({
      data: {
        handId: snapshot.handId,
        decisionPointId: snapshot.decisionPointId,
        street: snapshot.street,
        actingSeatIndex: snapshot.actingSeatIndex,
        eventSequence: snapshot.eventSequence,
        visibleState: toInputJson(snapshot.visibleState),
        legalActions: toInputJson(snapshot.legalActions),
        schemaVersion: snapshot.schemaVersion ?? 1
      }
    });

    return toDecisionSnapshotRecord(record);
  }

  async saveAIArtifact(input: SaveAIArtifactInput): Promise<AIArtifactRecord> {
    const record = await this.prisma.aIArtifact.create({
      data: {
        requestId: input.requestId,
        handId: input.handId,
        decisionSnapshotId: input.decisionSnapshotId,
        decisionPointId: input.decisionPointId,
        artifactKind: input.artifactKind,
        status: input.status,
        promptVersion: input.promptVersion,
        schemaVersion: input.schemaVersion ?? 1,
        modelName: input.modelName,
        providerName: input.providerName,
        requestPayload: toInputJson(input.requestPayload),
        responsePayload:
          input.responsePayload === undefined
            ? undefined
            : toInputJson(input.responsePayload),
        errorType: input.errorType,
        errorMessage: input.errorMessage
      }
    });

    return toAIArtifactRecord(record);
  }

  async findAIArtifactByRequestId(
    requestId: string
  ): Promise<
    (AIArtifactRecord & { walletLedgers: WalletLedgerRecord[] }) | null
  > {
    const record = await this.prisma.aIArtifact.findUnique({
      where: { requestId },
      include: { walletLedgers: true }
    });

    if (!record) {
      return null;
    }

    return {
      ...toAIArtifactRecord(record),
      walletLedgers: record.walletLedgers.map(toWalletLedgerRecord)
    };
  }

  async findDecisionSnapshot(
    handId: string,
    decisionPointId: string
  ): Promise<DecisionSnapshotRecord | null> {
    const record = await this.prisma.decisionSnapshot.findUnique({
      where: {
        handId_decisionPointId: {
          handId,
          decisionPointId
        }
      }
    });

    return record ? toDecisionSnapshotRecord(record) : null;
  }

  async findWalletAccount(
    walletAccountId: string
  ): Promise<WalletAccountRecord | null> {
    const record = await this.prisma.walletAccount.findUnique({
      where: { id: walletAccountId }
    });

    return record ? toWalletAccountRecord(record) : null;
  }

  async updateWalletBalance(
    walletAccountId: string,
    balance: number
  ): Promise<WalletAccountRecord> {
    const record = await this.prisma.walletAccount.update({
      where: { id: walletAccountId },
      data: { balance }
    });

    return toWalletAccountRecord(record);
  }

  async debitWalletAccount(
    input: DebitWalletAccountInput
  ): Promise<WalletAccountRecord | null> {
    const updated = await this.prisma.walletAccount.updateMany({
      where: {
        id: input.walletAccountId,
        userId: input.userId,
        balance: { gte: input.amount }
      },
      data: {
        balance: { decrement: input.amount }
      }
    });

    if (updated.count === 0) {
      return null;
    }

    const record = await this.prisma.walletAccount.findUnique({
      where: { id: input.walletAccountId }
    });

    return record ? toWalletAccountRecord(record) : null;
  }

  async createWalletLedger(
    input: CreateWalletLedgerInput
  ): Promise<WalletLedgerRecord> {
    const record = await this.prisma.walletLedger.create({
      data: {
        requestId: input.requestId,
        userId: input.userId,
        walletAccountId: input.walletAccountId,
        aiArtifactId: input.aiArtifactId,
        entryType: input.entryType,
        amountDelta: input.amountDelta,
        balanceAfter: input.balanceAfter,
        description: input.description,
        metadata:
          input.metadata === undefined
            ? undefined
            : toInputJson(input.metadata),
        schemaVersion: input.schemaVersion ?? 1
      }
    });

    return toWalletLedgerRecord(record);
  }

  async getHandTimeline(handId: string): Promise<StoredHandEvent[]> {
    const records = await this.prisma.handEventLog.findMany({
      where: { handId },
      orderBy: { sequence: "asc" }
    });

    return records.map(toStoredHandEvent);
  }

  async getDecisionAuditTrail(
    handId: string,
    decisionPointId: string
  ): Promise<DecisionAuditTrail> {
    const [snapshot, artifacts] = await Promise.all([
      this.findDecisionSnapshot(handId, decisionPointId),
      this.prisma.aIArtifact.findMany({
        where: { handId, decisionPointId },
        include: {
          walletLedgers: {
            orderBy: { createdAt: "asc" }
          }
        },
        orderBy: { createdAt: "asc" }
      })
    ]);

    return {
      snapshot,
      aiArtifacts: artifacts.map((artifact) => ({
        ...toAIArtifactRecord(artifact),
        walletLedgers: artifact.walletLedgers.map(toWalletLedgerRecord)
      }))
    };
  }

  async listHandHistory(
    userId: string,
    limit: number
  ): Promise<HandHistoryRow[]> {
    const hands = await this.prisma.hand.findMany({
      where: { userId },
      include: {
        aiArtifacts: true,
        labelAssignments: {
          include: { labelDefinition: true }
        },
        tableConfig: true
      },
      orderBy: { startedAt: "desc" },
      take: limit
    });

    return hands.map((hand) => ({
      handId: hand.id,
      status: hand.status,
      startedAt: hand.startedAt,
      completedAt: hand.completedAt,
      completionReason: hand.completionReason,
      playerCount: hand.tableConfig.playerCount,
      heroSeatIndex: hand.heroSeatIndex,
      hasAIArtifacts: hand.aiArtifacts.length > 0,
      labelKeys: hand.labelAssignments.map(
        (assignment) => assignment.labelDefinition.key
      )
    }));
  }

  async getWalletLedger(
    walletAccountId: string,
    limit: number
  ): Promise<WalletLedgerRecord[]> {
    const records = await this.prisma.walletLedger.findMany({
      where: { walletAccountId },
      orderBy: { createdAt: "desc" },
      take: limit
    });

    return records.map(toWalletLedgerRecord);
  }

  transaction<T>(
    callback: (repository: TrainingAssetRepository) => Promise<T>
  ): Promise<T> {
    return this.prisma.$transaction((tx) =>
      callback(new PrismaTrainingAssetRepository(tx))
    );
  }
}

function toStoredHandEvent(record: Prisma.HandEventLogModel): StoredHandEvent {
  return {
    id: record.id,
    handId: record.handId,
    sequence: record.sequence,
    eventType: record.eventType,
    payload: toJsonValue(record.payload),
    schemaVersion: record.schemaVersion,
    createdAt: record.createdAt
  };
}

function toDecisionSnapshotRecord(
  record: Prisma.DecisionSnapshotModel
): DecisionSnapshotRecord {
  return {
    id: record.id,
    handId: record.handId,
    decisionPointId: record.decisionPointId,
    street: record.street,
    actingSeatIndex: record.actingSeatIndex,
    eventSequence: record.eventSequence,
    visibleState: toJsonValue(record.visibleState),
    legalActions: toJsonValue(record.legalActions),
    schemaVersion: record.schemaVersion,
    createdAt: record.createdAt
  };
}

function toAIArtifactRecord(record: Prisma.AIArtifactModel): AIArtifactRecord {
  return {
    id: record.id,
    requestId: record.requestId,
    handId: record.handId,
    decisionSnapshotId: record.decisionSnapshotId,
    decisionPointId: record.decisionPointId,
    artifactKind: record.artifactKind,
    status: record.status,
    promptVersion: record.promptVersion,
    schemaVersion: record.schemaVersion,
    modelName: record.modelName,
    providerName: record.providerName,
    requestPayload: toJsonValue(record.requestPayload),
    responsePayload:
      record.responsePayload === null
        ? null
        : toJsonValue(record.responsePayload),
    errorType: record.errorType,
    errorMessage: record.errorMessage,
    createdAt: record.createdAt
  };
}

function toWalletAccountRecord(
  record: Prisma.WalletAccountModel
): WalletAccountRecord {
  return {
    id: record.id,
    userId: record.userId,
    balance: record.balance,
    schemaVersion: record.schemaVersion,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt
  };
}

function toWalletLedgerRecord(
  record: Prisma.WalletLedgerModel
): WalletLedgerRecord {
  return {
    id: record.id,
    requestId: record.requestId,
    userId: record.userId,
    walletAccountId: record.walletAccountId,
    aiArtifactId: record.aiArtifactId,
    entryType: record.entryType,
    amountDelta: record.amountDelta,
    balanceAfter: record.balanceAfter,
    description: record.description,
    metadata: record.metadata === null ? null : toJsonValue(record.metadata),
    schemaVersion: record.schemaVersion,
    createdAt: record.createdAt
  };
}

function toInputJson(value: JsonValue): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function toJsonValue(value: Prisma.JsonValue): JsonValue {
  return value as JsonValue;
}
