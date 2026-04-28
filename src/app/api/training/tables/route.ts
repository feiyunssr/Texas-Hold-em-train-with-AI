import { NextResponse } from "next/server";

import {
  getTrainingTableRuntime,
  TrainingRuntimeError
} from "@/server/training-runtime";
import type { TrainingTableCreateInput } from "@/server/training-runtime/types";

export async function POST(request: Request) {
  try {
    const input = (await request.json()) as TrainingTableCreateInput;
    const result = getTrainingTableRuntime().createTable(input);

    return NextResponse.json(result.snapshot, { status: 201 });
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
      { status: error.code === "invalid_config" ? 400 : 404 }
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
