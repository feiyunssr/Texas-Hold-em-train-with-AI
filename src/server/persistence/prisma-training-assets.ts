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
  HandReplayStep,
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
                  OR: [
                    {
                      labelAssignments: {
                        some: {
                          street: filters.street
                        }
                      }
                    },
                    {
                      eventLogs: {
                        some: {
                          payload: {
                            path: ["reviewStreet"],
                            equals: filters.street
                          }
                        }
                      }
                    },
                    {
                      eventLogs: {
                        some: {
                          payload: {
                            path: ["street"],
                            equals: filters.street
                          }
                        }
                      }
                    }
                  ]
                }
              ])
        ]
      },
      include: {
        aiArtifacts: true,
        eventLogs: {
          orderBy: { sequence: "asc" }
        },
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
      const referenceSequence = replayReferenceSequence(event);
      const street = eventStreet(event);
      const snapshot = snapshotsByEventSequence.get(referenceSequence);
      const labels = [
        ...(snapshot?.labelAssignments ?? []),
        ...hand.labelAssignments.filter(
          (assignment) =>
            assignment.decisionPointId?.includes(
              `event-${referenceSequence}`
            ) ||
            (street !== null && assignment.street === street)
        )
      ];

      return {
        ...toStoredHandEvent(event),
        sequence: replayDisplaySequence(event),
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
            insight.keySequences.includes(referenceSequence) ||
            (street !== null && insight.street === street)
        )
      };
    });

    return {
      handId,
      history,
      steps: buildReplaySteps(
        hand.eventLogs,
        hand.tableConfig.startingStack,
        hand.heroSeatIndex,
        snapshotsByEventSequence
      ),
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

function replayReferenceSequence(record: Prisma.HandEventLogModel): number {
  return (
    readNumericPayloadField(record.payload, "reviewSequence") ?? record.sequence
  );
}

function replayDisplaySequence(record: Prisma.HandEventLogModel): number {
  return (
    readNumericPayloadField(record.payload, "reviewSequence") ??
    readNumericPayloadField(record.payload, "decisionSequence") ??
    record.sequence
  );
}

function readNumericPayloadField(
  payload: Prisma.JsonValue,
  field: string
): number | null {
  if (
    payload === null ||
    typeof payload !== "object" ||
    Array.isArray(payload)
  ) {
    return null;
  }

  const value = (payload as Record<string, unknown>)[field];

  return typeof value === "number" ? value : null;
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
  tableConfigId: string;
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
  eventLogs?: Array<{
    eventType: string;
    payload: Prisma.JsonValue;
  }>;
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
      [
        ...hand.labelAssignments.map((assignment) => assignment.street),
        ...(hand.eventLogs ?? []).map((event) => eventStreetLike(event.payload))
      ].filter((street): street is string => Boolean(street))
    )
  );
  const heroProfit = resolveHeroProfit(hand);

  return {
    handId: hand.id,
    sessionId: hand.tableConfigId,
    status: hand.status,
    startedAt: hand.startedAt,
    completedAt: hand.completedAt,
    completionReason: hand.completionReason,
    playerCount: hand.tableConfig.playerCount,
    blindLevel: `${hand.tableConfig.smallBlind}/${hand.tableConfig.bigBlind}`,
    smallBlind: hand.tableConfig.smallBlind,
    bigBlind: hand.tableConfig.bigBlind,
    startingStack: hand.tableConfig.startingStack,
    heroSeatIndex: hand.heroSeatIndex,
    heroPosition,
    heroProfit,
    heroProfitBB:
      heroProfit === null
        ? null
        : roundToTenth(heroProfit / hand.tableConfig.bigBlind),
    startingHand: readHeroStartingHand(hand),
    result: resolveHeroResult(hand),
    hasAIArtifacts: hand.aiArtifacts.length > 0,
    hasHeroCoach: hand.aiArtifacts.some(
      (artifact) => artifact.artifactKind === "HERO_COACH"
    ),
    hasHandReview: hand.aiArtifacts.some(
      (artifact) => artifact.artifactKind === "HAND_REVIEW"
    ),
    strategyExecutionCount:
      hand.eventLogs?.filter((event) =>
        event.eventType.startsWith("strategy_auto_action_")
      ).length ?? 0,
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
  const heroProfit = resolveHeroProfit(hand);

  if (heroProfit !== null) {
    if (heroProfit > 0) {
      return "win";
    }

    if (heroProfit < 0) {
      return "loss";
    }

    return "even";
  }

  return hand.completionReason;
}

function resolveHeroProfit(hand: HandHistoryPrismaRecord): number | null {
  const finalState = hand.finalStatePayload;
  if (
    !finalState ||
    typeof finalState !== "object" ||
    Array.isArray(finalState)
  ) {
    return null;
  }

  const seats = finalState["seats"];
  if (!Array.isArray(seats) || hand.heroSeatIndex === null) {
    return null;
  }

  const heroSeat = seats.find(
    (seat) =>
      typeof seat === "object" &&
      seat !== null &&
      !Array.isArray(seat) &&
      seat["seatIndex"] === hand.heroSeatIndex
  );
  if (!heroSeat || typeof heroSeat !== "object" || Array.isArray(heroSeat)) {
    return null;
  }

  const stack = heroSeat["stack"];
  if (typeof stack !== "number") {
    return null;
  }

  return stack - resolveHeroStartingStack(hand);
}

function resolveHeroStartingStack(hand: HandHistoryPrismaRecord): number {
  if (hand.heroSeatIndex === null) {
    return hand.tableConfig.startingStack;
  }

  const handStartedEvent = hand.eventLogs?.find(
    (event) => event.eventType === "hand_started"
  );
  const startingStacks = readPayloadNumberArray(
    handStartedEvent?.payload ?? null,
    "startingStacks"
  );
  const startingStack = startingStacks[hand.heroSeatIndex];

  return typeof startingStack === "number"
    ? startingStack
    : hand.tableConfig.startingStack;
}

function eventStreet(record: Prisma.HandEventLogModel): string | null {
  return eventStreetLike(record.payload);
}

function eventStreetLike(payload: Prisma.JsonValue): string | null {
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

function readHeroStartingHand(hand: HandHistoryPrismaRecord): string | null {
  if (hand.heroSeatIndex === null) {
    return null;
  }

  const holeCardsEvent = hand.eventLogs?.find((event) => {
    if (event.eventType !== "hole_cards_dealt") {
      return false;
    }

    const payload = event.payload;
    return (
      payload !== null &&
      typeof payload === "object" &&
      !Array.isArray(payload) &&
      payload["seatIndex"] === hand.heroSeatIndex
    );
  });

  if (!holeCardsEvent) {
    return null;
  }

  const payload = holeCardsEvent.payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }

  const cards = payload["cards"];
  if (!Array.isArray(cards) || cards.length < 2) {
    return null;
  }

  const [first, second] = cards;
  return typeof first === "string" && typeof second === "string"
    ? normalizeStartingHand(first, second)
    : null;
}

function normalizeStartingHand(first: string, second: string): string {
  const rankOrder = "23456789TJQKA";
  const firstRank = first.slice(0, 1);
  const secondRank = second.slice(0, 1);
  const firstSuit = first.slice(1);
  const secondSuit = second.slice(1);

  if (firstRank === secondRank) {
    return `${firstRank}${secondRank}`;
  }

  const ranks =
    rankOrder.indexOf(firstRank) >= rankOrder.indexOf(secondRank)
      ? `${firstRank}${secondRank}`
      : `${secondRank}${firstRank}`;

  return `${ranks}${firstSuit === secondSuit ? "s" : "o"}`;
}

function buildReplaySteps(
  eventLogs: Prisma.HandEventLogModel[],
  startingStack: number,
  heroSeatIndex: number | null,
  snapshotsByEventSequence: Map<number | null, Prisma.DecisionSnapshotModel>
): HandReplayStep[] {
  const seatStacks = new Map<number, number>();
  const streetCommitments = new Map<number, number>();
  const totalCommitments = new Map<number, number>();
  let street: string | null = "preflop";
  let potTotal = 0;
  let currentBet = 0;
  let board: string[] = [];

  return eventLogs.map((event) => {
    const payload = event.payload;
    const referenceSequence = replayReferenceSequence(event);

    if (event.eventType === "hand_started") {
      seedSeats(payload, seatStacks, startingStack);
      street = "preflop";
      potTotal = 0;
      currentBet = 0;
      board = [];
      streetCommitments.clear();
      totalCommitments.clear();
    } else if (event.eventType === "forced_bet_posted") {
      const amount = readPayloadNumber(payload, "amount");
      const seatIndex = readPayloadNumber(payload, "seatIndex");
      if (seatIndex !== null && amount !== null) {
        addCommitment(
          seatIndex,
          amount,
          seatStacks,
          streetCommitments,
          totalCommitments
        );
        potTotal += amount;
        currentBet = Math.max(
          currentBet,
          streetCommitments.get(seatIndex) ?? 0
        );
      }
    } else if (event.eventType === "player_action") {
      const seatIndex = readPayloadNumber(payload, "seatIndex");
      const amount = readPayloadNumber(payload, "amount");
      const totalBetTo = readPayloadNumber(payload, "totalBetTo");
      if (seatIndex !== null && amount !== null) {
        addCommitment(
          seatIndex,
          amount,
          seatStacks,
          streetCommitments,
          totalCommitments
        );
        potTotal += amount;
      }
      currentBet = Math.max(currentBet, totalBetTo ?? currentBet);
    } else if (event.eventType === "street_advanced") {
      street = readPayloadString(payload, "street") ?? street;
      currentBet = 0;
      streetCommitments.clear();
    } else if (event.eventType === "board_dealt") {
      street = readPayloadString(payload, "street") ?? street;
      const nextBoard = readPayloadStringArray(payload, "board");
      if (nextBoard.length > 0) {
        board = nextBoard;
      }
    } else if (event.eventType === "hand_completed") {
      const finalStacks = readPayloadNumberArray(payload, "finalStacks");
      finalStacks.forEach((stack, seatIndex) =>
        seatStacks.set(seatIndex, stack)
      );
    }

    const snapshot = snapshotsByEventSequence.get(referenceSequence);
    return {
      sequence: replayDisplaySequence(event),
      eventType: event.eventType,
      street: eventStreet(event) ?? street,
      summary: summarizeReplayEvent(event.eventType, payload),
      potTotal,
      currentBet,
      board: [...board],
      heroStack:
        heroSeatIndex === null ? null : (seatStacks.get(heroSeatIndex) ?? null),
      heroStreetCommitment:
        heroSeatIndex === null
          ? null
          : (streetCommitments.get(heroSeatIndex) ?? 0),
      heroTotalCommitment:
        heroSeatIndex === null
          ? null
          : (totalCommitments.get(heroSeatIndex) ?? 0),
      actingSeatIndex: snapshot?.actingSeatIndex ?? null,
      legalActionTypes: readLegalActionTypes(snapshot?.legalActions)
    };
  });
}

function seedSeats(
  payload: Prisma.JsonValue,
  seatStacks: Map<number, number>,
  startingStack: number
): void {
  const startingStacks = readPayloadNumberArray(payload, "startingStacks");
  const playerCount =
    readPayloadNumber(payload, "playerCount") ?? startingStacks.length;
  seatStacks.clear();
  for (let seatIndex = 0; seatIndex < playerCount; seatIndex += 1) {
    seatStacks.set(seatIndex, startingStacks[seatIndex] ?? startingStack);
  }
}

function addCommitment(
  seatIndex: number,
  amount: number,
  seatStacks: Map<number, number>,
  streetCommitments: Map<number, number>,
  totalCommitments: Map<number, number>
): void {
  seatStacks.set(seatIndex, (seatStacks.get(seatIndex) ?? 0) - amount);
  streetCommitments.set(
    seatIndex,
    (streetCommitments.get(seatIndex) ?? 0) + amount
  );
  totalCommitments.set(
    seatIndex,
    (totalCommitments.get(seatIndex) ?? 0) + amount
  );
}

function summarizeReplayEvent(
  eventType: string,
  payload: Prisma.JsonValue
): string {
  if (eventType === "player_action") {
    const seatIndex = readPayloadNumber(payload, "seatIndex");
    const action = readPayloadString(payload, "action");
    const amount = readPayloadNumber(payload, "amount") ?? 0;
    return `座位 ${seatIndex === null ? "?" : seatIndex + 1} ${action ?? "行动"} ${amount}`;
  }

  if (eventType === "forced_bet_posted") {
    return `${readPayloadString(payload, "kind") ?? "forced bet"} ${readPayloadNumber(payload, "amount") ?? 0}`;
  }

  if (eventType === "board_dealt") {
    return `公共牌 ${readPayloadStringArray(payload, "cards").join(" ")}`;
  }

  if (eventType === "hand_completed") {
    return `手牌结束：${readPayloadString(payload, "reason") ?? "-"}`;
  }

  if (eventType.startsWith("strategy_auto_action_")) {
    return "翻前策略审计事件";
  }

  return eventType;
}

function readLegalActionTypes(value: Prisma.JsonValue | undefined): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((action) => {
      if (!action || typeof action !== "object" || Array.isArray(action)) {
        return null;
      }

      const type = action["type"];
      return typeof type === "string" ? type : null;
    })
    .filter((type): type is string => type !== null);
}

function readPayloadNumber(
  payload: Prisma.JsonValue,
  key: string
): number | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }

  const value = payload[key];
  return typeof value === "number" ? value : null;
}

function readPayloadString(
  payload: Prisma.JsonValue,
  key: string
): string | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }

  const value = payload[key];
  return typeof value === "string" ? value : null;
}

function readPayloadStringArray(
  payload: Prisma.JsonValue,
  key: string
): string[] {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return [];
  }

  const value = payload[key];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function readPayloadNumberArray(
  payload: Prisma.JsonValue,
  key: string
): number[] {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return [];
  }

  const value = payload[key];
  return Array.isArray(value)
    ? value.filter((item): item is number => typeof item === "number")
    : [];
}

function roundToTenth(value: number): number {
  return Math.round(value * 10) / 10;
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
