import { NextResponse } from "next/server";

import {
  getTrainingTableRuntime,
  TrainingRuntimeError
} from "@/server/training-runtime";
import type { UpdateSeatProfileInput } from "@/server/training-runtime/types";

type SeatProfileRouteContext = {
  params: Promise<{
    tableId: string;
    seatIndex: string;
  }>;
};

export async function PATCH(
  request: Request,
  context: SeatProfileRouteContext
) {
  try {
    const { tableId, seatIndex } = await context.params;
    const input = (await request.json()) as UpdateSeatProfileInput;
    const parsedSeatIndex = parseSeatIndexRouteSegment(seatIndex);
    const result = getTrainingTableRuntime().updateSeatProfile(
      tableId,
      parsedSeatIndex,
      input
    );

    return NextResponse.json(result.snapshot);
  } catch (error) {
    return trainingRuntimeErrorResponse(error);
  }
}

export function parseSeatIndexRouteSegment(seatIndex: string): number {
  if (!/^\d+$/.test(seatIndex)) {
    throw new TrainingRuntimeError(
      "invalid_config",
      "Seat index must be an integer route segment."
    );
  }

  return Number.parseInt(seatIndex, 10);
}

function trainingRuntimeErrorResponse(error: unknown) {
  if (error instanceof TrainingRuntimeError) {
    return NextResponse.json(
      {
        error: error.code,
        message: error.message
      },
      { status: error.code === "table_not_found" ? 404 : 400 }
    );
  }

  return NextResponse.json(
    {
      error: "runtime_error",
      message:
        error instanceof Error ? error.message : "Training runtime failed."
    },
    { status: 500 }
  );
}
