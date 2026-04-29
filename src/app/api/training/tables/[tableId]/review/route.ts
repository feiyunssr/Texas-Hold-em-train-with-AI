import { NextResponse } from "next/server";

import { getAiCoachConfig, MockHandReviewProvider } from "@/ai";
import { getPrisma } from "@/server/db";
import { HandReviewService } from "@/server/hand-review";
import { PrismaTrainingAssetRepository } from "@/server/persistence/prisma-training-assets";
import { TrainingAssetService } from "@/server/persistence/training-assets";
import {
  getTrainingTableRuntime,
  TrainingRuntimeError
} from "@/server/training-runtime";
import { persistRuntimeHandForReview } from "@/server/training-runtime/persistence";

type ReviewRouteContext = {
  params: Promise<{
    tableId: string;
  }>;
};

type ReviewRequestBody = {
  requestId?: unknown;
  userId?: unknown;
  walletAccountId?: unknown;
  chargeAmount?: unknown;
};

export async function POST(request: Request, context: ReviewRouteContext) {
  try {
    const { tableId } = await context.params;
    const body = (await request.json()) as ReviewRequestBody;
    const input = {
      tableId,
      requestId: requireString(body.requestId, "requestId"),
      userId: requireString(body.userId, "userId"),
      walletAccountId: requireString(body.walletAccountId, "walletAccountId"),
      chargeAmount: requireInteger(body.chargeAmount, "chargeAmount")
    };
    const runtime = getTrainingTableRuntime();
    const prisma = getPrisma();
    const view = runtime.getHandReviewView(tableId);

    await persistRuntimeHandForReview(prisma, view, input.userId);

    const service = new HandReviewService(
      runtime,
      new TrainingAssetService(new PrismaTrainingAssetRepository(prisma)),
      new MockHandReviewProvider(),
      getAiCoachConfig()
    );
    const result = await service.requestReview(input);

    return NextResponse.json(result);
  } catch (error) {
    return reviewErrorResponse(error);
  }
}

function requireString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ReviewRouteInputError(`${fieldName} must be a non-empty string.`);
  }

  return value;
}

function requireInteger(value: unknown, fieldName: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new ReviewRouteInputError(`${fieldName} must be an integer.`);
  }

  return value;
}

function reviewErrorResponse(error: unknown) {
  if (error instanceof ReviewRouteInputError) {
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
      {
        status:
          error.code === "table_not_found"
            ? 404
            : error.code === "hand_not_complete"
              ? 409
              : 400
      }
    );
  }

  return NextResponse.json(
    {
      error: "hand_review_error",
      message:
        error instanceof Error ? error.message : "Hand review request failed."
    },
    { status: 500 }
  );
}

class ReviewRouteInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReviewRouteInputError";
  }
}
