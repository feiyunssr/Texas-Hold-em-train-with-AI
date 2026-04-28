import { NextResponse } from "next/server";

import {
  getTrainingTableRuntime,
  TrainingRuntimeError
} from "@/server/training-runtime";

type TableRouteContext = {
  params: Promise<{
    tableId: string;
  }>;
};

export async function POST(_request: Request, context: TableRouteContext) {
  try {
    const { tableId } = await context.params;
    const result = getTrainingTableRuntime().startNextHand(tableId);

    return NextResponse.json(result.snapshot);
  } catch (error) {
    return trainingRuntimeErrorResponse(error);
  }
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
