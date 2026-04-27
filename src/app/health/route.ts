import { NextResponse } from "next/server";

import { getAiCoachConfig } from "@/ai/config";

export function GET() {
  return NextResponse.json({
    ok: true,
    service: "texas-holdem-train-with-ai",
    aiCoach: getAiCoachConfig()
  });
}
