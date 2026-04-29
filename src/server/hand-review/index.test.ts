import { describe, expect, it, vi } from "vitest";

import type { HandReview } from "@/ai/hand-review";
import { TrainingAssetService } from "@/server/persistence/training-assets";
import type {
  AIArtifactRecord,
  AppendHandEventInput,
  CreateWalletLedgerInput,
  DebitWalletAccountInput,
  DecisionAuditTrail,
  DecisionSnapshotRecord,
  HandHistoryRow,
  HandReplay,
  SaveAIArtifactInput,
  SaveDecisionSnapshotInput,
  StoredHandEvent,
  TrainingAssetRepository,
  WalletAccountRecord,
  WalletLedgerRecord
} from "@/server/persistence/types";
import type { TrainingTableRuntime } from "@/server/training-runtime";
import type { HandReviewView } from "@/server/training-runtime/types";

import { HandReviewService } from "./index";

describe("HandReviewService", () => {
  it("reuses an existing charged hand review without invoking the provider again", async () => {
    const review: HandReview = {
      summary: "Already reviewed.",
      result: "Hero won.",
      streetInsights: [
        {
          street: "preflop",
          summary: "Open range was sound.",
          keySequences: [1],
          tags: ["range_construction"]
        }
      ],
      tags: ["range_construction"]
    };
    const artifact = artifactRecord(review);
    const ledger = ledgerRecord(artifact.id);
    const repository = new ExistingHandReviewRepository(artifact, ledger);
    const provider = {
      providerName: "mock",
      modelName: "mock-hand-review",
      generateReview: vi.fn()
    };
    const service = new HandReviewService(
      runtimeWithHand("hand-1"),
      new TrainingAssetService(repository),
      provider,
      {
        requestTimeoutMs: 1000,
        retryAttempts: 0,
        retryBackoffMs: 0
      }
    );

    const result = await service.requestReview({
      tableId: "table-1",
      requestId: "new-request",
      userId: "demo-user",
      walletAccountId: "wallet-1",
      chargeAmount: 5
    });

    expect(result).toEqual(
      expect.objectContaining({
        status: "saved_charged",
        requestId: "original-request",
        handId: "hand-1",
        aiArtifactId: artifact.id,
        walletLedgerId: ledger.id,
        idempotent: true,
        review
      })
    );
    expect(provider.generateReview).not.toHaveBeenCalled();
    expect(repository.saveChargedCalls).toBe(0);
  });
});

class ExistingHandReviewRepository implements TrainingAssetRepository {
  saveChargedCalls = 0;

  constructor(
    private readonly artifact: AIArtifactRecord,
    private readonly ledger: WalletLedgerRecord
  ) {}

  appendHandEvents(
    _events: AppendHandEventInput[]
  ): Promise<StoredHandEvent[]> {
    return unexpected();
  }

  saveDecisionSnapshot(
    _snapshot: SaveDecisionSnapshotInput
  ): Promise<DecisionSnapshotRecord> {
    return unexpected();
  }

  saveAIArtifact(_input: SaveAIArtifactInput): Promise<AIArtifactRecord> {
    this.saveChargedCalls += 1;
    return unexpected();
  }

  findAIArtifactByRequestId(
    _requestId: string
  ): Promise<
    (AIArtifactRecord & { walletLedgers: WalletLedgerRecord[] }) | null
  > {
    return Promise.resolve(null);
  }

  findLatestChargedAIArtifactForHand(
    handId: string,
    artifactKind: AIArtifactRecord["artifactKind"]
  ): Promise<
    (AIArtifactRecord & { walletLedgers: WalletLedgerRecord[] }) | null
  > {
    if (
      this.artifact.handId !== handId ||
      this.artifact.artifactKind !== artifactKind ||
      this.artifact.status !== "SAVED_CHARGED"
    ) {
      return Promise.resolve(null);
    }

    return Promise.resolve({
      ...this.artifact,
      walletLedgers: [this.ledger]
    });
  }

  findDecisionSnapshot(
    _handId: string,
    _decisionPointId: string
  ): Promise<DecisionSnapshotRecord | null> {
    return unexpected();
  }

  findWalletAccount(
    _walletAccountId: string
  ): Promise<WalletAccountRecord | null> {
    return unexpected();
  }

  updateWalletBalance(
    _walletAccountId: string,
    _balance: number
  ): Promise<WalletAccountRecord> {
    return unexpected();
  }

  debitWalletAccount(
    _input: DebitWalletAccountInput
  ): Promise<WalletAccountRecord | null> {
    return unexpected();
  }

  createWalletLedger(
    _input: CreateWalletLedgerInput
  ): Promise<WalletLedgerRecord> {
    return unexpected();
  }

  getHandTimeline(_handId: string): Promise<StoredHandEvent[]> {
    return unexpected();
  }

  getDecisionAuditTrail(
    _handId: string,
    _decisionPointId: string
  ): Promise<DecisionAuditTrail> {
    return unexpected();
  }

  listHandHistory(_userId: string, _limit: number): Promise<HandHistoryRow[]> {
    return unexpected();
  }

  getHandReplay(_handId: string, _userId: string): Promise<HandReplay | null> {
    return unexpected();
  }

  getWalletLedger(
    _walletAccountId: string,
    _limit: number
  ): Promise<WalletLedgerRecord[]> {
    return unexpected();
  }

  transaction<T>(
    _callback: (repository: TrainingAssetRepository) => Promise<T>
  ): Promise<T> {
    this.saveChargedCalls += 1;
    return unexpected();
  }
}

function runtimeWithHand(handId: string): TrainingTableRuntime {
  return {
    getHandReviewView: () =>
      ({
        tableId: "table-1",
        handId
      }) as HandReviewView
  } as unknown as TrainingTableRuntime;
}

function artifactRecord(review: HandReview): AIArtifactRecord {
  return {
    id: "artifact-1",
    requestId: "original-request",
    handId: "hand-1",
    decisionSnapshotId: null,
    decisionPointId: null,
    artifactKind: "HAND_REVIEW",
    status: "SAVED_CHARGED",
    promptVersion: "hand-review-v1",
    schemaVersion: 1,
    modelName: "mock-hand-review",
    providerName: "mock",
    requestPayload: { requestId: "original-request" },
    responsePayload: { review },
    errorType: null,
    errorMessage: null,
    createdAt: new Date("2026-04-29T00:00:00.000Z")
  };
}

function ledgerRecord(aiArtifactId: string): WalletLedgerRecord {
  return {
    id: "ledger-1",
    requestId: "original-request",
    userId: "demo-user",
    walletAccountId: "wallet-1",
    aiArtifactId,
    entryType: "AI_CHARGE",
    amountDelta: -5,
    balanceAfter: 95,
    description: "AI hand review",
    metadata: {
      requestId: "original-request",
      artifactKind: "HAND_REVIEW"
    },
    schemaVersion: 1,
    createdAt: new Date("2026-04-29T00:00:00.000Z")
  };
}

function unexpected<T>(): Promise<T> {
  return Promise.reject(new Error("Repository method should not be called."));
}
