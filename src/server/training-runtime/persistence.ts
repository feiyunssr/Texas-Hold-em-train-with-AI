import type { PrismaClient, Prisma } from "../../../generated/prisma/client";

import type {
  HandReviewView,
  HeroCoachView
} from "@/server/training-runtime/types";

type TransactionClient = Parameters<
  Parameters<PrismaClient["$transaction"]>[0]
>[0];

type PrismaExecutor = PrismaClient | TransactionClient;

const REVIEW_EVENT_SEQUENCE_STEP = 1000;

type ReviewEventLogEntry = {
  sequence: number;
  eventType: string;
  payload: Record<string, unknown>;
};

export async function persistRuntimeHandForCoach(
  prisma: PrismaClient,
  view: HeroCoachView,
  userId: string
): Promise<void> {
  const persistedUserId = await findPersistedUserId(prisma, userId);
  const smallBlindSeat = requirePositionSeat(view, "small_blind");
  const bigBlindSeat = requirePositionSeat(view, "big_blind");

  await prisma.$transaction(async (tx) => {
    await upsertTableConfig(
      tx,
      view.tableId,
      view.tableConfig,
      persistedUserId
    );
    await upsertSeatProfiles(
      tx,
      view.tableId,
      view.tableConfig.startingStack,
      view.seats
    );

    await tx.hand.upsert({
      where: { id: view.handId },
      create: {
        id: view.handId,
        tableConfigId: view.tableId,
        userId: persistedUserId,
        status: "STARTED",
        seed: view.tableId,
        buttonSeat: view.tableConfig.buttonSeat,
        smallBlindSeat,
        bigBlindSeat,
        heroSeatIndex: view.tableConfig.heroSeatIndex,
        schemaVersion: 1
      },
      update: {
        userId: persistedUserId,
        status: "STARTED",
        buttonSeat: view.tableConfig.buttonSeat,
        smallBlindSeat,
        bigBlindSeat,
        heroSeatIndex: view.tableConfig.heroSeatIndex
      }
    });
  });
}

export async function persistRuntimeHandForReview(
  prisma: PrismaClient,
  view: HandReviewView,
  userId: string
): Promise<void> {
  const persistedUserId = await findPersistedUserId(prisma, userId);
  const eventLogEntries = buildReviewEventLogEntries(view);

  await prisma.$transaction(async (tx) => {
    await upsertTableConfig(
      tx,
      view.tableId,
      view.tableConfig,
      persistedUserId
    );
    await upsertSeatProfiles(
      tx,
      view.tableId,
      view.tableConfig.startingStack,
      view.seats
    );

    await tx.hand.upsert({
      where: { id: view.handId },
      create: {
        id: view.handId,
        tableConfigId: view.tableId,
        userId: persistedUserId,
        status: "COMPLETED",
        seed: view.tableId,
        buttonSeat: view.buttonSeat,
        smallBlindSeat: view.smallBlindSeat,
        bigBlindSeat: view.bigBlindSeat,
        heroSeatIndex: view.heroSeatIndex,
        completedAt: new Date(),
        completionReason: view.completionReason,
        finalStatePayload: toInputJson(view.finalState),
        schemaVersion: 1
      },
      update: {
        userId: persistedUserId,
        status: "COMPLETED",
        completedAt: new Date(),
        completionReason: view.completionReason,
        finalStatePayload: toInputJson(view.finalState)
      }
    });

    await tx.handEventLog.deleteMany({
      where: { handId: view.handId }
    });

    for (const event of eventLogEntries) {
      await tx.handEventLog.create({
        data: {
          handId: view.handId,
          sequence: event.sequence,
          eventType: event.eventType,
          payload: toInputJson(event.payload),
          schemaVersion: 1
        }
      });
    }
  });
}

export function buildReviewEventLogEntries(
  view: HandReviewView
): ReviewEventLogEntry[] {
  const entries: ReviewEventLogEntry[] = view.timeline.map((event) => ({
    sequence: toReviewEventSequence(event.sequence),
    eventType: event.type,
    payload: {
      ...event.payload,
      reviewSequence: event.sequence,
      reviewStreet: event.street
    }
  }));
  const strategyOffsetsByDecisionSequence = new Map<number, number>();
  const lastReviewSequence = view.timeline.at(-1)?.sequence ?? 0;

  for (const event of [...view.strategyExecutionEvents].sort(
    (left, right) => left.sequence - right.sequence
  )) {
    const decisionSequence =
      getStrategyDecisionSequence(event.payload) ?? lastReviewSequence;
    const offset =
      (strategyOffsetsByDecisionSequence.get(decisionSequence) ?? 0) + 1;

    if (offset >= REVIEW_EVENT_SEQUENCE_STEP) {
      throw new Error(
        `Too many strategy audit events for decision sequence ${decisionSequence}.`
      );
    }

    strategyOffsetsByDecisionSequence.set(decisionSequence, offset);
    entries.push({
      sequence: toReviewEventSequence(decisionSequence) + offset,
      eventType: event.type,
      payload: {
        ...event.payload,
        decisionSequence,
        runtimeSequence: event.sequence,
        reviewStreet: "preflop"
      }
    });
  }

  return entries.sort((left, right) => left.sequence - right.sequence);
}

function toReviewEventSequence(sequence: number): number {
  return sequence * REVIEW_EVENT_SEQUENCE_STEP;
}

function getStrategyDecisionSequence(
  payload: Record<string, unknown>
): number | null {
  const decisionPointId = getStrategyDecisionPointId(payload);
  const match = decisionPointId?.match(/:event-(\d+)$/);

  if (!match) {
    return null;
  }

  return Number.parseInt(match[1], 10);
}

function getStrategyDecisionPointId(
  payload: Record<string, unknown>
): string | null {
  const evaluation = payload.evaluation;

  if (
    evaluation === null ||
    typeof evaluation !== "object" ||
    !("decisionPointId" in evaluation)
  ) {
    return null;
  }

  const decisionPointId = evaluation.decisionPointId;

  return typeof decisionPointId === "string" ? decisionPointId : null;
}

async function findPersistedUserId(
  prisma: PrismaClient,
  userId: string
): Promise<string | null> {
  const existingUser = await prisma.appUser.findUnique({
    where: { id: userId },
    select: { id: true }
  });

  return existingUser?.id ?? null;
}

async function upsertTableConfig(
  tx: PrismaExecutor,
  tableId: string,
  config: HeroCoachView["tableConfig"],
  userId: string | null
): Promise<void> {
  await tx.tableConfig.upsert({
    where: { id: tableId },
    create: {
      id: tableId,
      userId,
      playerCount: config.playerCount,
      startingStack: config.startingStack,
      smallBlind: config.smallBlind,
      bigBlind: config.bigBlind,
      ante: config.ante ?? 0,
      buttonSeat: config.buttonSeat,
      straddleSeat: config.straddleSeat,
      straddleAmount: config.straddleAmount,
      seed: tableId,
      configPayload: toInputJson(config)
    },
    update: {
      userId,
      configPayload: toInputJson(config)
    }
  });
}

async function upsertSeatProfiles(
  tx: PrismaExecutor,
  tableId: string,
  startingStack: number,
  seats: Array<{
    seatIndex: number;
    playerId: string;
    displayName: string;
    isHero: boolean;
    style: string;
    colorTag?: string;
    note?: string;
    position: string;
  }>
): Promise<void> {
  for (const seat of seats) {
    await tx.tableSeatProfile.upsert({
      where: {
        tableConfigId_seatIndex: {
          tableConfigId: tableId,
          seatIndex: seat.seatIndex
        }
      },
      create: {
        tableConfigId: tableId,
        seatIndex: seat.seatIndex,
        playerId: seat.playerId,
        displayName: seat.displayName,
        isHero: seat.isHero,
        startingStack,
        styleProfile: toInputJson({
          style: seat.style,
          colorTag: seat.colorTag ?? "none",
          note: seat.note ?? "",
          position: seat.position
        })
      },
      update: {
        playerId: seat.playerId,
        displayName: seat.displayName,
        isHero: seat.isHero,
        styleProfile: toInputJson({
          style: seat.style,
          colorTag: seat.colorTag ?? "none",
          note: seat.note ?? "",
          position: seat.position
        })
      }
    });
  }
}

function requirePositionSeat(
  view: HeroCoachView,
  position: "small_blind" | "big_blind"
): number {
  const seat = view.seats.find((candidate) => candidate.position === position);

  if (!seat) {
    throw new Error(`Runtime hand is missing ${position} seat metadata.`);
  }

  return seat.seatIndex;
}

function toInputJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}
