import { NextResponse } from "next/server";

import { getAiCoachConfig } from "@/ai";
import { MockHeroCoachProvider } from "@/ai/hero-coach";
import { getPrisma } from "@/server/db";
import { HeroCoachService } from "@/server/hero-coach";
import { PrismaTrainingAssetRepository } from "@/server/persistence/prisma-training-assets";
import { TrainingAssetService } from "@/server/persistence/training-assets";
import {
  getTrainingTableRuntime,
  TrainingRuntimeError
} from "@/server/training-runtime";
import type { HeroCoachView } from "@/server/training-runtime/types";

import type { Prisma } from "../../../../../../../generated/prisma/client";

type CoachRouteContext = {
  params: Promise<{
    tableId: string;
  }>;
};

type CoachRequestBody = {
  requestId?: unknown;
  userId?: unknown;
  walletAccountId?: unknown;
  chargeAmount?: unknown;
};

export async function POST(request: Request, context: CoachRouteContext) {
  try {
    const { tableId } = await context.params;
    const body = (await request.json()) as CoachRequestBody;
    const input = {
      tableId,
      requestId: requireString(body.requestId, "requestId"),
      userId: requireString(body.userId, "userId"),
      walletAccountId: requireString(body.walletAccountId, "walletAccountId"),
      chargeAmount: requireInteger(body.chargeAmount, "chargeAmount")
    };
    const runtime = getTrainingTableRuntime();
    const prisma = getPrisma();
    const view = runtime.getHeroCoachView(tableId);

    await persistRuntimeHandForCoach(prisma, view, input.userId);

    const service = new HeroCoachService(
      runtime,
      new TrainingAssetService(new PrismaTrainingAssetRepository(prisma)),
      new MockHeroCoachProvider(),
      getAiCoachConfig()
    );
    const result = await service.requestAdvice(input);

    return NextResponse.json(result, {
      status: result.status === "already_requested" ? 409 : 200
    });
  } catch (error) {
    return coachErrorResponse(error);
  }
}

async function persistRuntimeHandForCoach(
  prisma: ReturnType<typeof getPrisma>,
  view: HeroCoachView,
  userId: string
): Promise<void> {
  const existingUser = await prisma.appUser.findUnique({
    where: { id: userId },
    select: { id: true }
  });
  const persistedUserId = existingUser?.id ?? null;
  const smallBlindSeat = requirePositionSeat(view, "small_blind");
  const bigBlindSeat = requirePositionSeat(view, "big_blind");

  await prisma.$transaction(async (tx) => {
    await tx.tableConfig.upsert({
      where: { id: view.tableId },
      create: {
        id: view.tableId,
        userId: persistedUserId,
        playerCount: view.tableConfig.playerCount,
        startingStack: view.tableConfig.startingStack,
        smallBlind: view.tableConfig.smallBlind,
        bigBlind: view.tableConfig.bigBlind,
        ante: view.tableConfig.ante ?? 0,
        buttonSeat: view.tableConfig.buttonSeat,
        straddleSeat: view.tableConfig.straddleSeat,
        straddleAmount: view.tableConfig.straddleAmount,
        seed: view.tableId,
        configPayload: toInputJson(view.tableConfig)
      },
      update: {
        configPayload: toInputJson(view.tableConfig)
      }
    });

    for (const seat of view.seats) {
      await tx.tableSeatProfile.upsert({
        where: {
          tableConfigId_seatIndex: {
            tableConfigId: view.tableId,
            seatIndex: seat.seatIndex
          }
        },
        create: {
          tableConfigId: view.tableId,
          seatIndex: seat.seatIndex,
          playerId: seat.playerId,
          displayName: seat.displayName,
          isHero: seat.isHero,
          startingStack: view.tableConfig.startingStack,
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
        status: "STARTED",
        buttonSeat: view.tableConfig.buttonSeat,
        smallBlindSeat,
        bigBlindSeat,
        heroSeatIndex: view.tableConfig.heroSeatIndex
      }
    });
  });
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

function requireString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new CoachRouteInputError(`${fieldName} must be a non-empty string.`);
  }

  return value;
}

function requireInteger(value: unknown, fieldName: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new CoachRouteInputError(`${fieldName} must be an integer.`);
  }

  return value;
}

function coachErrorResponse(error: unknown) {
  if (error instanceof CoachRouteInputError) {
    return NextResponse.json(
      {
        error: "invalid_request",
        message: error.message
      },
      { status: 400 }
    );
  }

  if (error instanceof TrainingRuntimeError) {
    return NextResponse.json(
      {
        error: error.code,
        message: error.message
      },
      { status: error.code === "table_not_found" ? 404 : 409 }
    );
  }

  return NextResponse.json(
    {
      error: "hero_coach_error",
      message:
        error instanceof Error ? error.message : "Hero coach request failed."
    },
    { status: 500 }
  );
}

class CoachRouteInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CoachRouteInputError";
  }
}
