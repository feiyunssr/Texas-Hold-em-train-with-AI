import { NextResponse } from "next/server";

import { getPrisma } from "@/server/db";
import { PrismaTrainingAssetRepository } from "@/server/persistence/prisma-training-assets";
import { TrainingAssetService } from "@/server/persistence/training-assets";

type ReplayRouteContext = {
  params: Promise<{
    handId: string;
  }>;
};

export async function GET(request: Request, context: ReplayRouteContext) {
  try {
    const { handId } = await context.params;
    const url = new URL(request.url);
    const userId = url.searchParams.get("userId") ?? "demo-user";
    const service = new TrainingAssetService(
      new PrismaTrainingAssetRepository(getPrisma())
    );
    const replay = await service.getHandReplay(handId, userId);

    if (!replay) {
      return NextResponse.json(
        {
          error: "hand_not_found",
          message: "Hand replay was not found."
        },
        { status: 404 }
      );
    }

    return NextResponse.json(replay);
  } catch (error) {
    return NextResponse.json(
      {
        error: "replay_error",
        message:
          error instanceof Error ? error.message : "Hand replay load failed."
      },
      { status: 500 }
    );
  }
}
