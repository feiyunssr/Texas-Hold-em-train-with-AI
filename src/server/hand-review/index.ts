import {
  HAND_REVIEW_PROMPT_VERSION,
  HAND_REVIEW_SCHEMA_VERSION,
  runHandReviewProvider,
  type HandReview,
  type HandReviewProvider
} from "@/ai/hand-review";
import type {
  AIArtifactRecord,
  JsonValue,
  WalletLedgerRecord
} from "@/server/persistence/types";
import { TrainingAssetService } from "@/server/persistence/training-assets";
import type { TrainingTableRuntime } from "@/server/training-runtime";

export type RequestHandReviewInput = {
  tableId: string;
  requestId: string;
  userId: string;
  walletAccountId: string;
  chargeAmount: number;
};

export type HandReviewResult =
  | {
      status: "saved_charged";
      requestId: string;
      handId: string;
      aiArtifactId: string;
      walletLedgerId: string;
      chargedAmount: number;
      balanceAfter: number;
      idempotent: boolean;
      review: HandReview;
    }
  | {
      status: "failed_not_charged";
      requestId: string;
      handId: string;
      errorType: string;
      errorMessage: string;
    };

export class HandReviewService {
  constructor(
    private readonly runtime: TrainingTableRuntime,
    private readonly assets: TrainingAssetService,
    private readonly provider: HandReviewProvider,
    private readonly config: {
      requestTimeoutMs: number;
      retryAttempts: number;
      retryBackoffMs: number;
    }
  ) {}

  async requestReview(
    input: RequestHandReviewInput
  ): Promise<HandReviewResult> {
    const view = this.runtime.getHandReviewView(input.tableId);
    const existingRequest = await this.assets.findAIArtifactByRequestId(
      input.requestId
    );

    if (existingRequest) {
      return existingRequestToResult(view.handId, existingRequest);
    }

    const existingHandReview =
      await this.assets.findLatestChargedAIArtifactForHand(
        view.handId,
        "HAND_REVIEW"
      );

    if (existingHandReview) {
      return existingRequestToResult(view.handId, existingHandReview);
    }

    if (!Number.isInteger(input.chargeAmount) || input.chargeAmount <= 0) {
      return {
        status: "failed_not_charged",
        requestId: input.requestId,
        handId: view.handId,
        errorType: "invalid_charge_amount",
        errorMessage: "Charge amount must be a positive integer."
      };
    }

    const requestPayload = toJsonValue({
      requestId: input.requestId,
      promptVersion: HAND_REVIEW_PROMPT_VERSION,
      schemaVersion: HAND_REVIEW_SCHEMA_VERSION,
      view
    });
    const providerResult = await runHandReviewProvider(
      this.provider,
      this.config,
      {
        requestId: input.requestId,
        view,
        promptVersion: HAND_REVIEW_PROMPT_VERSION,
        schemaVersion: HAND_REVIEW_SCHEMA_VERSION
      }
    );

    if (providerResult.status === "success") {
      const chargedResult = await this.assets.saveChargedAIArtifact({
        requestId: input.requestId,
        userId: input.userId,
        walletAccountId: input.walletAccountId,
        chargeAmount: input.chargeAmount,
        handId: view.handId,
        artifactKind: "HAND_REVIEW",
        promptVersion: HAND_REVIEW_PROMPT_VERSION,
        schemaVersion: HAND_REVIEW_SCHEMA_VERSION,
        modelName: providerResult.modelName,
        providerName: providerResult.providerName,
        requestPayload,
        responsePayload: toJsonValue({
          review: providerResult.review,
          rawResponse: providerResult.rawResponse,
          attempts: providerResult.attempts
        }),
        ledgerDescription: "AI hand review"
      });

      if (chargedResult.status === "saved_charged") {
        return {
          status: "saved_charged",
          requestId: input.requestId,
          handId: view.handId,
          aiArtifactId: chargedResult.aiArtifact.id,
          walletLedgerId: chargedResult.walletLedger.id,
          chargedAmount: input.chargeAmount,
          balanceAfter: chargedResult.walletLedger.balanceAfter,
          idempotent: chargedResult.idempotent,
          review: providerResult.review
        };
      }

      return {
        status: "failed_not_charged",
        requestId: input.requestId,
        handId: view.handId,
        errorType: chargedResult.errorType,
        errorMessage: chargedResult.errorMessage
      };
    }

    await this.assets.saveAIArtifact({
      requestId: input.requestId,
      handId: view.handId,
      artifactKind: "HAND_REVIEW",
      status: "FAILED_NOT_CHARGED",
      promptVersion: HAND_REVIEW_PROMPT_VERSION,
      schemaVersion: HAND_REVIEW_SCHEMA_VERSION,
      modelName: providerResult.modelName,
      providerName: providerResult.providerName,
      requestPayload,
      responsePayload:
        providerResult.rawResponse === null
          ? undefined
          : toJsonValue(providerResult.rawResponse),
      errorType: providerResult.errorType,
      errorMessage: providerResult.errorMessage
    });

    return {
      status: "failed_not_charged",
      requestId: input.requestId,
      handId: view.handId,
      errorType: providerResult.errorType,
      errorMessage: providerResult.errorMessage
    };
  }
}

function existingRequestToResult(
  handId: string,
  existing: AIArtifactRecord & { walletLedgers: WalletLedgerRecord[] }
): HandReviewResult {
  if (existing.status === "SAVED_CHARGED") {
    const ledger = existing.walletLedgers.find(
      (candidate) => candidate.requestId === existing.requestId
    );
    const review = parseReviewPayload(existing.responsePayload);

    if (ledger && review) {
      return {
        status: "saved_charged",
        requestId: existing.requestId,
        handId,
        aiArtifactId: existing.id,
        walletLedgerId: ledger.id,
        chargedAmount: Math.abs(ledger.amountDelta),
        balanceAfter: ledger.balanceAfter,
        idempotent: true,
        review
      };
    }
  }

  return {
    status: "failed_not_charged",
    requestId: existing.requestId,
    handId,
    errorType: existing.errorType ?? "existing_request_not_chargeable",
    errorMessage:
      existing.errorMessage ??
      "An existing hand review request was found without a charged result."
  };
}

function parseReviewPayload(value: JsonValue | null): HandReview | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const review = value["review"];
  if (!review || typeof review !== "object" || Array.isArray(review)) {
    return null;
  }

  return review as HandReview;
}

function toJsonValue(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}
