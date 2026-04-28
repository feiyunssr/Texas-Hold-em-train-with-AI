import { NextResponse } from "next/server";

import {
  getTrainingTableRuntime,
  TrainingRuntimeError
} from "@/server/training-runtime";
import type { SubmitUserActionInput } from "@/server/training-runtime/types";

type TableRouteContext = {
  params: Promise<{
    tableId: string;
  }>;
};

export async function POST(request: Request, context: TableRouteContext) {
  try {
    const { tableId } = await context.params;
    const input = (await request.json()) as SubmitUserActionInput;
    const result = getTrainingTableRuntime().submitUserAction(tableId, input);

    if (result.type === "rejected") {
      return NextResponse.json(
        {
          error: "illegal_action",
          message: result.error,
          snapshot: result.snapshot
        },
        { status: 409 }
      );
    }

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
