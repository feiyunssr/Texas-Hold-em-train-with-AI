import type { Street } from "@/domain/poker";
import type { HandReviewView } from "@/server/training-runtime/types";

import type { AiCoachConfig } from "./config";

export const HAND_REVIEW_PROMPT_VERSION = "hand-review-v1";
export const HAND_REVIEW_SCHEMA_VERSION = 1;

export type HandReviewStreetInsight = {
  street: Exclude<Street, "complete">;
  summary: string;
  keySequences: number[];
  tags: string[];
};

export type HandReview = {
  summary: string;
  result: string;
  streetInsights: HandReviewStreetInsight[];
  tags: string[];
};

export type HandReviewProviderRequest = {
  requestId: string;
  view: HandReviewView;
  promptVersion: string;
  schemaVersion: number;
};

export type HandReviewProvider = {
  providerName: string;
  modelName: string;
  generateReview(
    request: HandReviewProviderRequest,
    signal: AbortSignal
  ): Promise<unknown>;
};

export type HandReviewProviderResult =
  | {
      status: "success";
      review: HandReview;
      rawResponse: unknown;
      attempts: number;
      providerName: string;
      modelName: string;
    }
  | {
      status: "failed";
      errorType:
        | "timeout"
        | "provider_error"
        | "schema_validation"
        | "parse_failure";
      errorMessage: string;
      rawResponse: unknown | null;
      attempts: number;
      providerName: string;
      modelName: string;
    };

export class MockHandReviewProvider implements HandReviewProvider {
  readonly providerName = "mock";
  readonly modelName = "mock-hand-review";

  async generateReview(
    request: HandReviewProviderRequest,
    signal: AbortSignal
  ): Promise<unknown> {
    signal.throwIfAborted();

    const actionEvents = request.view.timeline.filter(
      (event) => event.type === "player_action"
    );
    const streets = uniqueStreets(request.view.timeline);
    const heroDelta =
      request.view.seats.find((seat) => seat.isHero)?.finalStack ??
      request.view.tableConfig.startingStack;

    return {
      summary: `本手牌以 ${request.view.completionReason ?? "unknown"} 结束，共 ${actionEvents.length} 个行动点。`,
      result: `Hero 结束筹码 ${heroDelta}，最终底池 ${request.view.potTotal}。`,
      streetInsights: streets.map((street) => ({
        street,
        summary: `${street} 街需要结合底池、位置和对手风格复盘。`,
        keySequences: actionEvents
          .filter((event) => event.street === street)
          .slice(0, 4)
          .map((event) => event.sequence),
        tags: street === "preflop" ? ["range_construction"] : ["bet_sizing"]
      })),
      tags: ["range_construction", "bet_sizing"]
    };
  }
}

export async function runHandReviewProvider(
  provider: HandReviewProvider,
  config: AiCoachConfig,
  request: HandReviewProviderRequest
): Promise<HandReviewProviderResult> {
  const maxAttempts = config.retryAttempts + 1;
  let lastError: HandReviewProviderResult | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;

    try {
      const rawResponse = await Promise.race([
        provider.generateReview(request, controller.signal),
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(() => {
            controller.abort();
            reject(new TimeoutError("Hand review provider timed out."));
          }, config.requestTimeoutMs);
        })
      ]);
      if (timeout) {
        clearTimeout(timeout);
      }

      const parsedResponse = parseProviderResponse(rawResponse);
      const review = validateHandReview(parsedResponse);

      return {
        status: "success",
        review,
        rawResponse: toJsonCompatible(parsedResponse),
        attempts: attempt,
        providerName: provider.providerName,
        modelName: provider.modelName
      };
    } catch (error) {
      if (timeout) {
        clearTimeout(timeout);
      }
      lastError = {
        status: "failed",
        errorType:
          error instanceof TimeoutError || isAbortError(error)
            ? "timeout"
            : error instanceof HandReviewSchemaError
              ? "schema_validation"
              : error instanceof HandReviewParseError
                ? "parse_failure"
                : "provider_error",
        errorMessage:
          error instanceof Error
            ? error.message
            : "Hand review provider failed.",
        rawResponse: null,
        attempts: attempt,
        providerName: provider.providerName,
        modelName: provider.modelName
      };

      if (
        lastError.errorType === "schema_validation" ||
        lastError.errorType === "parse_failure" ||
        attempt === maxAttempts
      ) {
        return lastError;
      }

      if (config.retryBackoffMs > 0) {
        await sleep(config.retryBackoffMs);
      }
    }
  }

  return (
    lastError ?? {
      status: "failed",
      errorType: "provider_error",
      errorMessage: "Hand review provider failed before producing a response.",
      rawResponse: null,
      attempts: 0,
      providerName: provider.providerName,
      modelName: provider.modelName
    }
  );
}

function validateHandReview(value: unknown): HandReview {
  if (!isRecord(value)) {
    throw new HandReviewSchemaError("Hand review response must be an object.");
  }

  const summary = requireString(value.summary, "summary");
  const result = requireString(value.result, "result");
  const streetInsights = validateStreetInsights(value.streetInsights);
  const tags = validateStringArray(value.tags, "tags");

  return {
    summary,
    result,
    streetInsights,
    tags
  };
}

function validateStreetInsights(value: unknown): HandReviewStreetInsight[] {
  if (!Array.isArray(value)) {
    throw new HandReviewSchemaError("streetInsights must be an array.");
  }

  return value.map((item, index) => {
    if (!isRecord(item)) {
      throw new HandReviewSchemaError(
        `streetInsights[${index}] must be an object.`
      );
    }

    const street = item.street;
    if (!isReviewStreet(street)) {
      throw new HandReviewSchemaError(
        `streetInsights[${index}].street is invalid.`
      );
    }

    return {
      street,
      summary: requireString(item.summary, `streetInsights[${index}].summary`),
      keySequences: validateNumberArray(
        item.keySequences,
        `streetInsights[${index}].keySequences`
      ),
      tags: validateStringArray(item.tags, `streetInsights[${index}].tags`)
    };
  });
}

function parseProviderResponse(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }

  try {
    return JSON.parse(value) as unknown;
  } catch (error) {
    throw new HandReviewParseError(
      error instanceof Error ? error.message : "Failed to parse JSON response."
    );
  }
}

function uniqueStreets(
  timeline: HandReviewView["timeline"]
): Array<Exclude<Street, "complete">> {
  const streets = new Set<Exclude<Street, "complete">>();

  for (const event of timeline) {
    if (isReviewStreet(event.street)) {
      streets.add(event.street);
    }
  }

  return Array.from(streets);
}

function isReviewStreet(value: unknown): value is Exclude<Street, "complete"> {
  return (
    value === "preflop" ||
    value === "flop" ||
    value === "turn" ||
    value === "river"
  );
}

function requireString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new HandReviewSchemaError(`${fieldName} must be a non-empty string.`);
  }

  return value;
}

function validateStringArray(value: unknown, fieldName: string): string[] {
  if (
    !Array.isArray(value) ||
    !value.every((item) => typeof item === "string")
  ) {
    throw new HandReviewSchemaError(`${fieldName} must be a string array.`);
  }

  return value;
}

function validateNumberArray(value: unknown, fieldName: string): number[] {
  if (
    !Array.isArray(value) ||
    !value.every((item) => Number.isInteger(item) && item > 0)
  ) {
    throw new HandReviewSchemaError(
      `${fieldName} must be a positive integer array.`
    );
  }

  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toJsonCompatible(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value)) as unknown;
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "AbortError" ||
      error.message.toLowerCase().includes("abort"))
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class HandReviewSchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HandReviewSchemaError";
  }
}

class HandReviewParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HandReviewParseError";
  }
}

class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TimeoutError";
  }
}
