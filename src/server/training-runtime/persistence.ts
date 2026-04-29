import type { PrismaClient, Prisma } from "../../../generated/prisma/client";

import type {
  HandReviewView,
  HeroCoachView
} from "@/server/training-runtime/types";

type TransactionClient = Parameters<
  Parameters<PrismaClient["$transaction"]>[0]
>[0];

type PrismaExecutor = PrismaClient | TransactionClient;

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

    for (const event of view.timeline) {
      await tx.handEventLog.upsert({
        where: {
          handId_sequence: {
            handId: view.handId,
            sequence: event.sequence
          }
        },
        create: {
          handId: view.handId,
          sequence: event.sequence,
          eventType: event.type,
          payload: toInputJson({
            ...event.payload,
            reviewStreet: event.street
          }),
          schemaVersion: 1
        },
        update: {
          eventType: event.type,
          payload: toInputJson({
            ...event.payload,
            reviewStreet: event.street
          })
        }
      });
    }
  });
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
          position: seat.position
        })
      },
      update: {
        playerId: seat.playerId,
        displayName: seat.displayName,
        isHero: seat.isHero,
        styleProfile: toInputJson({
          style: seat.style,
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
