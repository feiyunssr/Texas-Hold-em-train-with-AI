import {
  HERO_COACH_PROMPT_VERSION,
  HERO_COACH_SCHEMA_VERSION,
  runHeroCoachProvider,
  type HeroCoachProvider
} from "@/ai/hero-coach";
import type { JsonValue } from "@/server/persistence/types";
import { TrainingAssetService } from "@/server/persistence/training-assets";
import type { TrainingTableRuntime } from "@/server/training-runtime";

export type RequestHeroCoachAdviceInput = {
  tableId: string;
  requestId: string;
  userId: string;
  walletAccountId: string;
  chargeAmount: number;
};

export type HeroCoachAdviceResult =
  | {
      status: "saved_charged";
      requestId: string;
      decisionPointId: string;
      aiArtifactId: string;
      walletLedgerId: string;
      chargedAmount: number;
      balanceAfter: number;
      idempotent: boolean;
      advice: JsonValue;
    }
  | {
      status: "partial_not_final";
      requestId: string;
      decisionPointId: string;
      aiArtifactId: string;
      partialResponse: JsonValue | null;
    }
  | {
      status: "failed_not_charged";
      requestId: string;
      decisionPointId: string;
      errorType: string;
      errorMessage: string;
    }
  | {
      status: "already_requested";
      requestId: string;
      decisionPointId: string;
      existingStatus: string | null;
      aiArtifactId: string | null;
    };

export class HeroCoachService {
  constructor(
    private readonly runtime: TrainingTableRuntime,
    private readonly assets: TrainingAssetService,
    private readonly provider: HeroCoachProvider,
    private readonly config: {
      requestTimeoutMs: number;
      retryAttempts: number;
      retryBackoffMs: number;
    }
  ) {}

  async requestAdvice(
    input: RequestHeroCoachAdviceInput
  ): Promise<HeroCoachAdviceResult> {
    const lock = this.runtime.beginHeroCoachRequest(input.tableId);
    const { view } = lock;
    let hasSavedDecisionArtifact = false;

    if (lock.status === "already_requested") {
      const existingRequest = await this.assets.findAIArtifactByRequestId(
        input.requestId
      );

      if (existingRequest) {
        return existingRequestToResult(view.decisionPointId, existingRequest);
      }

      const auditTrail = await this.assets.getDecisionAuditTrail(
        view.handId,
        view.decisionPointId
      );
      const existingDecisionArtifact = auditTrail.aiArtifacts[0];

      if (existingDecisionArtifact) {
        return artifactToExistingResult(input.requestId, view.decisionPointId, {
          aiArtifactId: existingDecisionArtifact.id,
          existingStatus: existingDecisionArtifact.status
        });
      }

      return {
        status: "already_requested",
        requestId: input.requestId,
        decisionPointId: view.decisionPointId,
        existingStatus: null,
        aiArtifactId: null
      };
    }

    try {
      const existingRequest = await this.assets.findAIArtifactByRequestId(
        input.requestId
      );
      if (existingRequest) {
        return existingRequestToResult(view.decisionPointId, existingRequest);
      }

      const snapshot = await this.findOrCreateDecisionSnapshot(view);
      const auditTrail = await this.assets.getDecisionAuditTrail(
        view.handId,
        view.decisionPointId
      );
      const existingDecisionArtifact = auditTrail.aiArtifacts[0];

      if (existingDecisionArtifact) {
        hasSavedDecisionArtifact = true;
        return artifactToExistingResult(input.requestId, view.decisionPointId, {
          aiArtifactId: existingDecisionArtifact.id,
          existingStatus: existingDecisionArtifact.status
        });
      }

      if (!Number.isInteger(input.chargeAmount) || input.chargeAmount <= 0) {
        return {
          status: "failed_not_charged",
          requestId: input.requestId,
          decisionPointId: view.decisionPointId,
          errorType: "invalid_charge_amount",
          errorMessage: "Charge amount must be a positive integer."
        };
      }

      const requestPayload = toJsonValue({
        requestId: input.requestId,
        promptVersion: HERO_COACH_PROMPT_VERSION,
        schemaVersion: HERO_COACH_SCHEMA_VERSION,
        view
      });
      const providerResult = await runHeroCoachProvider(
        this.provider,
        this.config,
        {
          requestId: input.requestId,
          view,
          promptVersion: HERO_COACH_PROMPT_VERSION,
          schemaVersion: HERO_COACH_SCHEMA_VERSION
        }
      );

      if (providerResult.status === "success") {
        const chargedResult = await this.assets.saveChargedAIArtifact({
          requestId: input.requestId,
          userId: input.userId,
          walletAccountId: input.walletAccountId,
          chargeAmount: input.chargeAmount,
          handId: view.handId,
          decisionSnapshotId: snapshot.id,
          decisionPointId: view.decisionPointId,
          artifactKind: "HERO_COACH",
          promptVersion: HERO_COACH_PROMPT_VERSION,
          schemaVersion: HERO_COACH_SCHEMA_VERSION,
          modelName: providerResult.modelName,
          providerName: providerResult.providerName,
          requestPayload,
          responsePayload: toJsonValue({
            advice: providerResult.advice,
            rawResponse: providerResult.rawResponse,
            attempts: providerResult.attempts
          }),
          ledgerDescription: "AI hero coach advice"
        });

        if (chargedResult.status === "saved_charged") {
          hasSavedDecisionArtifact = true;
          return {
            status: "saved_charged",
            requestId: input.requestId,
            decisionPointId: view.decisionPointId,
            aiArtifactId: chargedResult.aiArtifact.id,
            walletLedgerId: chargedResult.walletLedger.id,
            chargedAmount: input.chargeAmount,
            balanceAfter: chargedResult.walletLedger.balanceAfter,
            idempotent: chargedResult.idempotent,
            advice: toJsonValue(providerResult.advice)
          };
        }

        return {
          status: "failed_not_charged",
          requestId: input.requestId,
          decisionPointId: view.decisionPointId,
          errorType: chargedResult.errorType,
          errorMessage: chargedResult.errorMessage
        };
      }

      if (providerResult.status === "partial_not_final") {
        const artifact = await this.assets.saveAIArtifact({
          requestId: input.requestId,
          handId: view.handId,
          decisionSnapshotId: snapshot.id,
          decisionPointId: view.decisionPointId,
          artifactKind: "HERO_COACH",
          status: "PARTIAL_NOT_FINAL",
          promptVersion: HERO_COACH_PROMPT_VERSION,
          schemaVersion: HERO_COACH_SCHEMA_VERSION,
          modelName: providerResult.modelName,
          providerName: providerResult.providerName,
          requestPayload,
          responsePayload: toJsonValue({
            partialResponse: providerResult.partialResponse,
            attempts: providerResult.attempts
          }),
          errorType: "partial_not_final",
          errorMessage:
            "Provider returned a partial response that did not satisfy the final schema."
        });

        hasSavedDecisionArtifact = true;
        return {
          status: "partial_not_final",
          requestId: input.requestId,
          decisionPointId: view.decisionPointId,
          aiArtifactId: artifact.id,
          partialResponse: artifact.responsePayload
        };
      }

      const failedArtifact = await this.assets.saveAIArtifact({
        requestId: input.requestId,
        handId: view.handId,
        decisionSnapshotId: snapshot.id,
        decisionPointId: view.decisionPointId,
        artifactKind: "HERO_COACH",
        status: "FAILED_NOT_CHARGED",
        promptVersion: HERO_COACH_PROMPT_VERSION,
        schemaVersion: HERO_COACH_SCHEMA_VERSION,
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

      hasSavedDecisionArtifact = true;
      return {
        status: "failed_not_charged",
        requestId: input.requestId,
        decisionPointId: view.decisionPointId,
        errorType: failedArtifact.errorType ?? providerResult.errorType,
        errorMessage: failedArtifact.errorMessage ?? providerResult.errorMessage
      };
    } catch (error) {
      return {
        status: "failed_not_charged",
        requestId: input.requestId,
        decisionPointId: view.decisionPointId,
        errorType: "storage_failure",
        errorMessage:
          error instanceof Error
            ? error.message
            : "Hero coach request failed before charging."
      };
    } finally {
      if (hasSavedDecisionArtifact) {
        this.runtime.completeHeroCoachRequest(
          input.tableId,
          view.decisionPointId
        );
      } else {
        this.runtime.releaseHeroCoachRequest(
          input.tableId,
          view.decisionPointId
        );
      }
    }
  }

  private async findOrCreateDecisionSnapshot(
    view: ReturnType<TrainingTableRuntime["getHeroCoachView"]>
  ) {
    const existing = await this.assets.findDecisionSnapshot(
      view.handId,
      view.decisionPointId
    );

    if (existing) {
      return existing;
    }

    try {
      return await this.assets.saveDecisionSnapshot({
        handId: view.handId,
        decisionPointId: view.decisionPointId,
        street: view.street,
        actingSeatIndex: view.actingSeatIndex,
        eventSequence: view.eventSequence,
        visibleState: toJsonValue(view),
        legalActions: toJsonValue(view.legalActions),
        schemaVersion: HERO_COACH_SCHEMA_VERSION
      });
    } catch (error) {
      const racedExisting = await this.assets.findDecisionSnapshot(
        view.handId,
        view.decisionPointId
      );

      if (racedExisting) {
        return racedExisting;
      }

      throw error;
    }
  }
}

function artifactToExistingResult(
  requestId: string,
  decisionPointId: string,
  existing: {
    aiArtifactId: string;
    existingStatus: string;
  }
): HeroCoachAdviceResult {
  return {
    status: "already_requested",
    requestId,
    decisionPointId,
    existingStatus: existing.existingStatus,
    aiArtifactId: existing.aiArtifactId
  };
}

function existingRequestToResult(
  decisionPointId: string,
  artifact: Awaited<
    ReturnType<TrainingAssetService["findAIArtifactByRequestId"]>
  > extends infer T
    ? NonNullable<T>
    : never
): HeroCoachAdviceResult {
  if (artifact.status === "SAVED_CHARGED") {
    const ledger = artifact.walletLedgers.find(
      (candidate) => candidate.requestId === artifact.requestId
    );

    if (ledger) {
      return {
        status: "saved_charged",
        requestId: artifact.requestId,
        decisionPointId,
        aiArtifactId: artifact.id,
        walletLedgerId: ledger.id,
        chargedAmount: Math.abs(ledger.amountDelta),
        balanceAfter: ledger.balanceAfter,
        idempotent: true,
        advice: extractAdvicePayload(artifact.responsePayload)
      };
    }
  }

  if (artifact.status === "PARTIAL_NOT_FINAL") {
    return {
      status: "partial_not_final",
      requestId: artifact.requestId,
      decisionPointId,
      aiArtifactId: artifact.id,
      partialResponse: artifact.responsePayload
    };
  }

  if (artifact.status === "FAILED_NOT_CHARGED") {
    return {
      status: "failed_not_charged",
      requestId: artifact.requestId,
      decisionPointId,
      errorType: artifact.errorType ?? "already_failed",
      errorMessage:
        artifact.errorMessage ?? "This hero coach request already failed."
    };
  }

  return artifactToExistingResult(artifact.requestId, decisionPointId, {
    aiArtifactId: artifact.id,
    existingStatus: artifact.status
  });
}

function toJsonValue(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}

function extractAdvicePayload(responsePayload: JsonValue | null): JsonValue {
  if (
    responsePayload &&
    typeof responsePayload === "object" &&
    !Array.isArray(responsePayload) &&
    "advice" in responsePayload
  ) {
    return responsePayload.advice;
  }

  return responsePayload ?? {};
}
