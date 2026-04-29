import { NextResponse } from "next/server";

import { getPrisma } from "@/server/db";
import { PrismaTrainingAssetRepository } from "@/server/persistence/prisma-training-assets";
import { TrainingAssetService } from "@/server/persistence/training-assets";
import type { HandHistoryFilters } from "@/server/persistence/types";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const userId = url.searchParams.get("userId") ?? "demo-user";
    const limit = readLimit(url.searchParams.get("limit"));
    const filters: HandHistoryFilters = {
      playerCount: readOptionalInteger(url.searchParams.get("playerCount")),
      heroPosition: readOptionalString(url.searchParams.get("position")),
      street: readOptionalString(url.searchParams.get("street")),
      result: readOptionalString(url.searchParams.get("result")),
      label: readOptionalString(url.searchParams.get("tag")),
      problemType: readOptionalString(url.searchParams.get("problemType")),
      opponentStyle: readOptionalString(url.searchParams.get("opponentStyle"))
    };
    const service = new TrainingAssetService(
      new PrismaTrainingAssetRepository(getPrisma())
    );
    const history = await service.listHandHistory(userId, limit, filters);

    return NextResponse.json({ history });
  } catch (error) {
    return NextResponse.json(
      {
        error: "history_error",
        message:
          error instanceof Error ? error.message : "Hand history load failed."
      },
      { status: 500 }
    );
  }
}

function readLimit(value: string | null): number {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 100) {
    return 20;
  }

  return parsed;
}

function readOptionalInteger(value: string | null): number | undefined {
  if (value === null || value === "") {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : undefined;
}

function readOptionalString(value: string | null): string | undefined {
  return value === null || value.trim() === "" ? undefined : value;
}
