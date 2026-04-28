import type { ActionType, LegalAction } from "@/domain/poker";
import type { HeroCoachView } from "@/server/training-runtime/types";

import type { AiCoachConfig } from "./config";

export const HERO_COACH_PROMPT_VERSION = "hero-coach-v1";
export const HERO_COACH_SCHEMA_VERSION = 1;

export type HeroCoachAdvice = {
  primaryAction: ActionType;
  suggestedBetAmount: number | null;
  acceptableAlternatives: Array<{
    action: ActionType;
    amount: number | null;
    reason: string | null;
  }>;
  keyFactors: string[];
  riskNote: string;
};

export type HeroCoachProviderRequest = {
  requestId: string;
  view: HeroCoachView;
  promptVersion: string;
  schemaVersion: number;
};

export type HeroCoachProvider = {
  providerName: string;
  modelName: string;
  generateAdvice(
    request: HeroCoachProviderRequest,
    signal: AbortSignal
  ): Promise<unknown>;
};

export type HeroCoachProviderResult =
  | {
      status: "success";
      advice: HeroCoachAdvice;
      rawResponse: unknown;
      attempts: number;
      providerName: string;
      modelName: string;
    }
  | {
      status: "partial_not_final";
      partialResponse: unknown;
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

export class MockHeroCoachProvider implements HeroCoachProvider {
  readonly providerName = "mock";
  readonly modelName = "mock-hero-coach";

  async generateAdvice(
    request: HeroCoachProviderRequest,
    signal: AbortSignal
  ): Promise<unknown> {
    signal.throwIfAborted();

    const preferred =
      request.view.legalActions.find((action) => action.type === "check") ??
      request.view.legalActions.find((action) => action.type === "call") ??
      request.view.legalActions.find((action) => action.type === "bet") ??
      request.view.legalActions.find((action) => action.type === "raise") ??
      request.view.legalActions[0];

    return {
      primaryAction: preferred.type,
      suggestedBetAmount:
        preferred.type === "bet" || preferred.type === "raise"
          ? (preferred.amount ?? preferred.minAmount ?? null)
          : null,
      acceptableAlternatives: request.view.legalActions
        .filter((action) => action.type !== preferred.type)
        .slice(0, 2)
        .map((action) => ({
          action: action.type,
          amount: action.amount ?? action.minAmount ?? null,
          reason: "保持可执行的低方差备选线。"
        })),
      keyFactors: [
        `当前底池 ${request.view.potTotal}`,
        `街道 ${request.view.street}`,
        `可选动作 ${request.view.legalActions.map((action) => action.type).join(", ")}`
      ],
      riskNote: "开发期 mock 建议仅用于验证请求、持久化和扣费链路。"
    };
  }
}

export async function runHeroCoachProvider(
  provider: HeroCoachProvider,
  config: AiCoachConfig,
  request: HeroCoachProviderRequest
): Promise<HeroCoachProviderResult> {
  const maxAttempts = config.retryAttempts + 1;
  let lastError: HeroCoachProviderResult | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;

    try {
      const rawResponse = await Promise.race([
        provider.generateAdvice(request, controller.signal),
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(() => {
            controller.abort();
            reject(new TimeoutError("Hero coach provider timed out."));
          }, config.requestTimeoutMs);
        })
      ]);
      if (timeout) {
        clearTimeout(timeout);
      }

      const parsedResponse = parseProviderResponse(rawResponse);

      if (isPartialResponse(parsedResponse)) {
        return {
          status: "partial_not_final",
          partialResponse: toJsonCompatible(parsedResponse),
          attempts: attempt,
          providerName: provider.providerName,
          modelName: provider.modelName
        };
      }

      const advice = validateHeroCoachAdvice(parsedResponse, request.view);

      return {
        status: "success",
        advice,
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
            : error instanceof HeroCoachSchemaError
              ? "schema_validation"
              : error instanceof HeroCoachParseError
                ? "parse_failure"
                : "provider_error",
        errorMessage:
          error instanceof Error
            ? error.message
            : "Hero coach provider failed.",
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
      errorMessage: "Hero coach provider failed before producing a response.",
      rawResponse: null,
      attempts: 0,
      providerName: provider.providerName,
      modelName: provider.modelName
    }
  );
}

export function validateHeroCoachAdvice(
  value: unknown,
  view: HeroCoachView
): HeroCoachAdvice {
  if (!isRecord(value)) {
    throw new HeroCoachSchemaError("Hero coach response must be an object.");
  }

  const legalActionsByType = new Map(
    view.legalActions.map((action) => [action.type, action])
  );
  const legalActionTypes = new Set(legalActionsByType.keys());
  const primaryAction = value.primaryAction;

  if (!isActionType(primaryAction) || !legalActionTypes.has(primaryAction)) {
    throw new HeroCoachSchemaError(
      "primaryAction must be one of the current legal actions."
    );
  }

  const suggestedBetAmount = normalizeNullableInteger(
    value.suggestedBetAmount,
    "suggestedBetAmount"
  );
  validateRecommendedAmount(
    primaryAction,
    suggestedBetAmount,
    legalActionsByType.get(primaryAction),
    "suggestedBetAmount"
  );
  const acceptableAlternatives = validateAlternatives(
    value.acceptableAlternatives,
    legalActionsByType
  );
  const keyFactors = validateKeyFactors(value.keyFactors);

  if (typeof value.riskNote !== "string" || value.riskNote.trim() === "") {
    throw new HeroCoachSchemaError("riskNote must be a non-empty string.");
  }

  return {
    primaryAction,
    suggestedBetAmount,
    acceptableAlternatives,
    keyFactors,
    riskNote: value.riskNote
  };
}

class HeroCoachSchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HeroCoachSchemaError";
  }
}

class HeroCoachParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HeroCoachParseError";
  }
}

class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AbortError";
  }
}

function validateAlternatives(
  value: unknown,
  legalActionsByType: Map<ActionType, LegalAction>
): HeroCoachAdvice["acceptableAlternatives"] {
  if (!Array.isArray(value)) {
    throw new HeroCoachSchemaError("acceptableAlternatives must be an array.");
  }

  return value.map((item) => {
    if (!isRecord(item)) {
      throw new HeroCoachSchemaError("Each alternative must be an object.");
    }

    if (!isActionType(item.action) || !legalActionsByType.has(item.action)) {
      throw new HeroCoachSchemaError(
        "Each alternative action must be legal now."
      );
    }
    const amount = normalizeNullableInteger(item.amount, "alternative.amount");
    validateRecommendedAmount(
      item.action,
      amount,
      legalActionsByType.get(item.action),
      "alternative.amount"
    );

    return {
      action: item.action,
      amount,
      reason:
        item.reason === null || item.reason === undefined
          ? null
          : requireString(item.reason, "alternative.reason")
    };
  });
}

function validateKeyFactors(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 3) {
    throw new HeroCoachSchemaError("keyFactors must contain 1 to 3 strings.");
  }

  return value.map((item) => requireString(item, "keyFactors item"));
}

function normalizeNullableInteger(
  value: unknown,
  fieldName: string
): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new HeroCoachSchemaError(
      `${fieldName} must be a non-negative integer.`
    );
  }

  return value;
}

function validateRecommendedAmount(
  action: ActionType,
  amount: number | null,
  legalAction: LegalAction | undefined,
  fieldName: string
): void {
  if (!legalAction) {
    throw new HeroCoachSchemaError(`${fieldName} action must be legal now.`);
  }

  if (action === "fold") {
    if (amount !== null) {
      throw new HeroCoachSchemaError(`${fieldName} must be null for fold.`);
    }
    return;
  }

  if (action === "check") {
    if (amount !== null && amount !== (legalAction.amount ?? 0)) {
      throw new HeroCoachSchemaError(`${fieldName} must be 0 for check.`);
    }
    return;
  }

  if (action === "call" || action === "all-in") {
    const exactAmount = legalAction.amount ?? 0;
    if (amount !== null && amount !== exactAmount) {
      throw new HeroCoachSchemaError(
        `${fieldName} must be exactly ${exactAmount} for ${action}.`
      );
    }
    return;
  }

  const minAmount = legalAction.minAmount ?? legalAction.amount ?? 0;
  const maxAmount = legalAction.maxAmount ?? legalAction.amount ?? minAmount;
  if (amount === null || amount < minAmount || amount > maxAmount) {
    throw new HeroCoachSchemaError(
      `${fieldName} must be between ${minAmount} and ${maxAmount} for ${action}.`
    );
  }
}

function requireString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new HeroCoachSchemaError(`${fieldName} must be a non-empty string.`);
  }

  return value;
}

function isPartialResponse(value: unknown): boolean {
  return isRecord(value) && value.partial === true;
}

function parseProviderResponse(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }

  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new HeroCoachParseError(
      "Hero coach provider returned malformed JSON."
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isActionType(value: unknown): value is ActionType {
  return (
    value === "fold" ||
    value === "check" ||
    value === "call" ||
    value === "bet" ||
    value === "raise" ||
    value === "all-in"
  );
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function toJsonCompatible(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value)) as unknown;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
