import { NextResponse } from "next/server";

import {
  getTrainingTableRuntime,
  TrainingRuntimeError
} from "@/server/training-runtime";
import type {
  RuntimePublicEvent,
  TrainingTableSnapshot
} from "@/server/training-runtime/types";

type TableRouteContext = {
  params: Promise<{
    tableId: string;
  }>;
};

export async function GET(request: Request, context: TableRouteContext) {
  try {
    const { tableId } = await context.params;
    const runtime = getTrainingTableRuntime();
    const url = new URL(request.url);
    const afterSequence = resolveReplayAfterSequence(request, url);
    const encoder = new TextEncoder();

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const send = (
          event: RuntimePublicEvent,
          snapshot: TrainingTableSnapshot
        ) => {
          controller.enqueue(encoder.encode(formatSseEvent(event, snapshot)));
        };

        const snapshot = runtime.getTableSnapshot(tableId);
        controller.enqueue(
          encoder.encode(
            formatSseEvent(
              {
                sequence: snapshot.hand.lastSequence,
                type: "runtime_snapshot",
                payload: { replay: true },
                createdAt: new Date().toISOString()
              },
              snapshot
            )
          )
        );

        for (const event of runtime.getPublicEvents(tableId, afterSequence)) {
          controller.enqueue(encoder.encode(formatSseEvent(event, snapshot)));
        }

        const unsubscribe = runtime.subscribe(tableId, send);
        request.signal.addEventListener("abort", () => {
          unsubscribe();
          controller.close();
        });
      }
    });

    return new Response(stream, {
      headers: {
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "Content-Type": "text/event-stream; charset=utf-8",
        "X-Accel-Buffering": "no"
      }
    });
  } catch (error) {
    return trainingRuntimeErrorResponse(error);
  }
}

export function resolveReplayAfterSequence(request: Request, url: URL): number {
  return (
    parseReplaySequence(request.headers.get("Last-Event-ID")) ??
    parseReplaySequence(url.searchParams.get("after")) ??
    0
  );
}

function parseReplaySequence(value: string | null): number | undefined {
  if (value === null || value.trim() === "") {
    return undefined;
  }

  const sequence = Number(value);
  if (!Number.isSafeInteger(sequence) || sequence < 0) {
    return undefined;
  }

  return sequence;
}

function formatSseEvent(
  event: RuntimePublicEvent,
  snapshot: TrainingTableSnapshot
): string {
  return [
    `id: ${event.sequence}`,
    `event: ${event.type}`,
    `data: ${JSON.stringify({ event, snapshot })}`,
    "",
    ""
  ].join("\n");
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
