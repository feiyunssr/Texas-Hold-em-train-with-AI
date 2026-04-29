import type { Prisma, PrismaClient } from "../../../generated/prisma/client";

import type {
  AIArtifactRecord,
  AppendHandEventInput,
  CreateWalletLedgerInput,
  DebitWalletAccountInput,
  DecisionAuditTrail,
  HandHistoryFilters,
  DecisionSnapshotRecord,
  HandHistoryRow,
  HandReplay,
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

  async findLatestChargedAIArtifactForHand(
    handId: string,
    artifactKind: AIArtifactRecord["artifactKind"]
  ): Promise<
    (AIArtifactRecord & { walletLedgers: WalletLedgerRecord[] }) | null
  > {
    const record = await this.prisma.aIArtifact.findFirst({
      where: {
        handId,
        artifactKind,
        status: "SAVED_CHARGED"
      },
      include: {
        walletLedgers: {
          orderBy: { createdAt: "asc" }
        }
      },
      orderBy: { createdAt: "desc" }
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
    limit: number,
    filters: HandHistoryFilters = {}
  ): Promise<HandHistoryRow[]> {
    const hands = await this.prisma.hand.findMany({
      where: {
        userId,
        ...(filters.playerCount === undefined
          ? {}
          : { tableConfig: { playerCount: filters.playerCount } }),
        AND: [
          ...(filters.label === undefined && filters.problemType === undefined
            ? []
            : [
                {
                  labelAssignments: {
                    some: {
                      labelDefinition: {
                        key: filters.label ?? filters.problemType
                      }
                    }
                  }
                }
              ]),
          ...(filters.street === undefined
            ? []
            : [
                {
                  labelAssignments: {
                    some: {
                      street: filters.street
                    }
                  }
                }
              ])
        ]
      },
      include: {
        aiArtifacts: true,
        labelAssignments: {
          include: { labelDefinition: true }
        },
        tableConfig: {
          include: { seatProfiles: true }
        }
      },
      orderBy: { startedAt: "desc" },
      take: Math.max(limit * 5, limit)
    });

    return hands
      .map(toHandHistoryRow)
      .filter((row) => matchesHandHistoryFilters(row, filters))
      .slice(0, limit);
  }

  async getHandReplay(
    handId: string,
    userId: string
  ): Promise<HandReplay | null> {
    const hand = await this.prisma.hand.findFirst({
      where: { id: handId, userId },
      include: {
        tableConfig: {
          include: { seatProfiles: true }
        },
        eventLogs: {
          orderBy: { sequence: "asc" }
        },
        aiArtifacts: {
          include: {
            walletLedgers: {
              orderBy: { createdAt: "asc" }
            }
          },
          orderBy: { createdAt: "asc" }
        },
        decisionSnapshots: {
          include: {
            aiArtifacts: {
              include: {
                walletLedgers: {
                  orderBy: { createdAt: "asc" }
                }
              },
              orderBy: { createdAt: "asc" }
            },
            labelAssignments: {
              include: { labelDefinition: true },
              orderBy: { createdAt: "asc" }
            }
          }
        },
        labelAssignments: {
          include: { labelDefinition: true },
          orderBy: { createdAt: "asc" }
        }
      }
    });

    if (!hand) {
      return null;
    }

    const history = toHandHistoryRow(hand);
    const snapshotsByEventSequence = new Map(
      hand.decisionSnapshots
        .filter((snapshot) => snapshot.eventSequence !== null)
        .map((snapshot) => [snapshot.eventSequence, snapshot])
    );
    const handReviewArtifacts = hand.aiArtifacts
      .filter((artifact) => artifact.artifactKind === "HAND_REVIEW")
      .map((artifact) => ({
        ...toAIArtifactRecord(artifact),
        walletLedgers: artifact.walletLedgers.map(toWalletLedgerRecord)
      }));
    const handReviewInsights = handReviewArtifacts.flatMap((artifact) =>
      extractHandReviewInsights(artifact.id, artifact.responsePayload)
    );
    const timeline = hand.eventLogs.map((event) => {
      const street = eventStreet(event);
      const snapshot = snapshotsByEventSequence.get(event.sequence);
      const labels = [
        ...(snapshot?.labelAssignments ?? []),
        ...hand.labelAssignments.filter(
          (assignment) =>
            assignment.decisionPointId?.includes(`event-${event.sequence}`) ||
            (street !== null && assignment.street === street)
        )
      ];

      return {
        ...toStoredHandEvent(event),
        street,
        aiArtifacts:
          snapshot?.aiArtifacts.map((artifact) => ({
            ...toAIArtifactRecord(artifact),
            walletLedgers: artifact.walletLedgers.map(toWalletLedgerRecord)
          })) ?? [],
        labels: labels.map((assignment) => ({
          key: assignment.labelDefinition.key,
          title: assignment.labelDefinition.title,
          source: assignment.source,
          note: assignment.note,
          aiArtifactId: assignment.aiArtifactId
        })),
        handReviewInsights: handReviewInsights.filter(
          (insight) =>
            insight.keySequences.includes(event.sequence) ||
            (street !== null && insight.street === street)
        )
      };
    });

    return {
      handId,
      history,
      timeline,
      handReviewArtifacts
    };
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

type HandHistoryPrismaRecord = {
  id: string;
  status: string;
  startedAt: Date;
  completedAt: Date | null;
  completionReason: string | null;
  heroSeatIndex: number | null;
  finalStatePayload?: Prisma.JsonValue | null;
  tableConfig: {
    playerCount: number;
    startingStack: number;
    buttonSeat: number;
    smallBlind: number;
    bigBlind: number;
    seatProfiles: Array<{
      seatIndex: number;
      isHero: boolean;
      styleProfile: Prisma.JsonValue | null;
    }>;
  };
  aiArtifacts: Array<{
    artifactKind: string;
  }>;
  labelAssignments: Array<{
    street: string | null;
    labelDefinition: {
      key: string;
    };
  }>;
};

function toHandHistoryRow(hand: HandHistoryPrismaRecord): HandHistoryRow {
  const heroSeat = hand.tableConfig.seatProfiles.find(
    (seat) => seat.isHero || seat.seatIndex === hand.heroSeatIndex
  );
  const heroPosition = readStyleProfileString(
    heroSeat?.styleProfile,
    "position"
  );
  const opponentStyles = Array.from(
    new Set(
      hand.tableConfig.seatProfiles
        .filter((seat) => !seat.isHero)
        .map((seat) => readStyleProfileString(seat.styleProfile, "style"))
        .filter((style): style is string => Boolean(style))
    )
  );
  const labelKeys = Array.from(
    new Set(
      hand.labelAssignments.map((assignment) => assignment.labelDefinition.key)
    )
  );
  const streets = Array.from(
    new Set(
      hand.labelAssignments
        .map((assignment) => assignment.street)
        .filter((street): street is string => Boolean(street))
    )
  );

  return {
    handId: hand.id,
    status: hand.status,
    startedAt: hand.startedAt,
    completedAt: hand.completedAt,
    completionReason: hand.completionReason,
    playerCount: hand.tableConfig.playerCount,
    heroSeatIndex: hand.heroSeatIndex,
    heroPosition,
    result: resolveHeroResult(hand),
    hasAIArtifacts: hand.aiArtifacts.length > 0,
    hasHeroCoach: hand.aiArtifacts.some(
      (artifact) => artifact.artifactKind === "HERO_COACH"
    ),
    hasHandReview: hand.aiArtifacts.some(
      (artifact) => artifact.artifactKind === "HAND_REVIEW"
    ),
    labelKeys,
    streets,
    opponentStyles
  };
}

function matchesHandHistoryFilters(
  row: HandHistoryRow,
  filters: HandHistoryFilters
): boolean {
  return (
    (filters.heroPosition === undefined ||
      row.heroPosition === filters.heroPosition) &&
    (filters.opponentStyle === undefined ||
      row.opponentStyles.includes(filters.opponentStyle)) &&
    (filters.street === undefined || row.streets.includes(filters.street)) &&
    (filters.label === undefined || row.labelKeys.includes(filters.label)) &&
    (filters.problemType === undefined ||
      row.labelKeys.includes(filters.problemType)) &&
    (filters.result === undefined ||
      row.completionReason === filters.result ||
      row.result === filters.result)
  );
}

function resolveHeroResult(hand: HandHistoryPrismaRecord): string | null {
  const finalState = hand.finalStatePayload;
  if (
    !finalState ||
    typeof finalState !== "object" ||
    Array.isArray(finalState)
  ) {
    return hand.completionReason;
  }

  const seats = finalState["seats"];
  if (!Array.isArray(seats) || hand.heroSeatIndex === null) {
    return hand.completionReason;
  }

  const heroSeat = seats.find(
    (seat) =>
      typeof seat === "object" &&
      seat !== null &&
      !Array.isArray(seat) &&
      seat["seatIndex"] === hand.heroSeatIndex
  );
  if (!heroSeat || typeof heroSeat !== "object" || Array.isArray(heroSeat)) {
    return hand.completionReason;
  }

  const stack = heroSeat["stack"];
  if (typeof stack !== "number") {
    return hand.completionReason;
  }

  if (stack > hand.tableConfig.startingStack) {
    return "win";
  }

  if (stack < hand.tableConfig.startingStack) {
    return "loss";
  }

  return "even";
}

function eventStreet(record: Prisma.HandEventLogModel): string | null {
  const payload = record.payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }

  const reviewStreet = payload["reviewStreet"];
  if (typeof reviewStreet === "string") {
    return reviewStreet;
  }

  const street = payload["street"];
  if (typeof street === "string") {
    return street;
  }

  return null;
}

function extractHandReviewInsights(
  aiArtifactId: string,
  responsePayload: JsonValue | null
): Array<{
  aiArtifactId: string;
  street: string;
  keySequences: number[];
  summary: string;
  tags: string[];
}> {
  if (
    !responsePayload ||
    typeof responsePayload !== "object" ||
    Array.isArray(responsePayload)
  ) {
    return [];
  }

  const review = responsePayload["review"];
  if (!review || typeof review !== "object" || Array.isArray(review)) {
    return [];
  }

  const streetInsights = review["streetInsights"];
  if (!Array.isArray(streetInsights)) {
    return [];
  }

  return streetInsights.flatMap((insight) => {
    if (!insight || typeof insight !== "object" || Array.isArray(insight)) {
      return [];
    }

    const street = insight["street"];
    const summary = insight["summary"];
    const keySequences = insight["keySequences"];
    const tags = insight["tags"];

    if (
      typeof street !== "string" ||
      typeof summary !== "string" ||
      !Array.isArray(keySequences) ||
      !Array.isArray(tags)
    ) {
      return [];
    }

    return [
      {
        aiArtifactId,
        street,
        summary,
        keySequences: keySequences.filter((sequence): sequence is number =>
          Number.isInteger(sequence)
        ),
        tags: tags.filter((tag): tag is string => typeof tag === "string")
      }
    ];
  });
}

function readStyleProfileString(
  value: Prisma.JsonValue | null | undefined,
  key: string
): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const candidate = value[key];
  return typeof candidate === "string" ? candidate : null;
}

function toInputJson(value: JsonValue): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function toJsonValue(value: Prisma.JsonValue): JsonValue {
  return value as JsonValue;
}
