import type {
  AIArtifactRecord,
  AppendHandEventInput,
  DecisionAuditTrail,
  DecisionSnapshotRecord,
  HandHistoryRow,
  HandHistoryFilters,
  HandReplay,
  SaveAIArtifactInput,
  SaveDecisionSnapshotInput,
  StoredHandEvent,
  TrainingAssetRepository,
  WalletLedgerRecord
} from "./types";

export type ChargedAIArtifactInput = Omit<SaveAIArtifactInput, "status"> & {
  userId: string;
  walletAccountId: string;
  chargeAmount: number;
  ledgerDescription?: string;
};

export type ChargedAIArtifactResult =
  | {
      status: "saved_charged";
      requestId: string;
      aiArtifact: AIArtifactRecord;
      walletLedger: WalletLedgerRecord;
      idempotent: boolean;
    }
  | {
      status: "failed_not_charged";
      requestId: string;
      errorType:
        | "invalid_charge_amount"
        | "storage_failure"
        | "wallet_not_found"
        | "insufficient_balance";
      errorMessage: string;
    };

export class TrainingAssetService {
  constructor(private readonly repository: TrainingAssetRepository) {}

  appendHandEvents(events: AppendHandEventInput[]): Promise<StoredHandEvent[]> {
    assertStrictlyIncreasingSequences(events);
    return this.repository.appendHandEvents(events);
  }

  saveDecisionSnapshot(
    snapshot: SaveDecisionSnapshotInput
  ): Promise<DecisionSnapshotRecord> {
    return this.repository.saveDecisionSnapshot({
      ...snapshot,
      schemaVersion: snapshot.schemaVersion ?? 1
    });
  }

  saveAIArtifact(input: SaveAIArtifactInput): Promise<AIArtifactRecord> {
    return this.repository.saveAIArtifact({
      ...input,
      schemaVersion: input.schemaVersion ?? 1
    });
  }

  findAIArtifactByRequestId(
    requestId: string
  ): ReturnType<TrainingAssetRepository["findAIArtifactByRequestId"]> {
    return this.repository.findAIArtifactByRequestId(requestId);
  }

  findLatestChargedAIArtifactForHand(
    handId: string,
    artifactKind: Parameters<
      TrainingAssetRepository["findLatestChargedAIArtifactForHand"]
    >[1]
  ): ReturnType<TrainingAssetRepository["findLatestChargedAIArtifactForHand"]> {
    return this.repository.findLatestChargedAIArtifactForHand(
      handId,
      artifactKind
    );
  }

  findDecisionSnapshot(
    handId: string,
    decisionPointId: string
  ): ReturnType<TrainingAssetRepository["findDecisionSnapshot"]> {
    return this.repository.findDecisionSnapshot(handId, decisionPointId);
  }

  async saveChargedAIArtifact(
    input: ChargedAIArtifactInput
  ): Promise<ChargedAIArtifactResult> {
    if (!Number.isInteger(input.chargeAmount) || input.chargeAmount <= 0) {
      return {
        status: "failed_not_charged",
        requestId: input.requestId,
        errorType: "invalid_charge_amount",
        errorMessage: "Charge amount must be a positive integer."
      };
    }

    const existing = await this.repository.findAIArtifactByRequestId(
      input.requestId
    );

    if (existing) {
      const existingChargedResult = this.toIdempotentChargedResult(
        input.requestId,
        existing
      );

      if (existingChargedResult) {
        return existingChargedResult;
      }

      return {
        status: "failed_not_charged",
        requestId: input.requestId,
        errorType: "storage_failure",
        errorMessage:
          "An artifact already exists for this request without a matching charged ledger."
      };
    }

    try {
      return await this.repository.transaction(async (tx) => {
        const walletAccount = await tx.findWalletAccount(input.walletAccountId);

        if (!walletAccount || walletAccount.userId !== input.userId) {
          throw new ChargePersistenceError(
            "wallet_not_found",
            "Wallet account was not found for the request user."
          );
        }

        const aiArtifact = await tx.saveAIArtifact({
          ...input,
          status: "SAVED_CHARGED",
          schemaVersion: input.schemaVersion ?? 1
        });
        const debitedWalletAccount = await tx.debitWalletAccount({
          walletAccountId: input.walletAccountId,
          userId: input.userId,
          amount: input.chargeAmount
        });

        if (!debitedWalletAccount) {
          throw new ChargePersistenceError(
            "insufficient_balance",
            "Wallet account does not have enough credits for this charge."
          );
        }

        const balanceAfter = debitedWalletAccount.balance;
        const walletLedger = await tx.createWalletLedger({
          requestId: input.requestId,
          userId: input.userId,
          walletAccountId: input.walletAccountId,
          aiArtifactId: aiArtifact.id,
          entryType: "AI_CHARGE",
          amountDelta: -input.chargeAmount,
          balanceAfter,
          description:
            input.ledgerDescription ??
            `AI ${input.artifactKind.toLowerCase()} charge`,
          metadata: {
            requestId: input.requestId,
            artifactKind: input.artifactKind
          },
          schemaVersion: input.schemaVersion ?? 1
        });

        return {
          status: "saved_charged",
          requestId: input.requestId,
          aiArtifact,
          walletLedger,
          idempotent: false
        };
      });
    } catch (error) {
      if (error instanceof ChargePersistenceError) {
        return {
          status: "failed_not_charged",
          requestId: input.requestId,
          errorType: error.errorType,
          errorMessage: error.message
        };
      }

      const existingChargedResult = await this.findIdempotentChargedResult(
        input.requestId
      );

      if (existingChargedResult) {
        return existingChargedResult;
      }

      return {
        status: "failed_not_charged",
        requestId: input.requestId,
        errorType: "storage_failure",
        errorMessage:
          error instanceof Error
            ? error.message
            : "The charged AI artifact transaction failed."
      };
    }
  }

  getHandTimeline(handId: string): Promise<StoredHandEvent[]> {
    return this.repository.getHandTimeline(handId);
  }

  getDecisionAuditTrail(
    handId: string,
    decisionPointId: string
  ): Promise<DecisionAuditTrail> {
    return this.repository.getDecisionAuditTrail(handId, decisionPointId);
  }

  listHandHistory(
    userId: string,
    limit = 20,
    filters?: HandHistoryFilters
  ): Promise<HandHistoryRow[]> {
    return this.repository.listHandHistory(userId, limit, filters);
  }

  getHandReplay(handId: string, userId: string): Promise<HandReplay | null> {
    return this.repository.getHandReplay(handId, userId);
  }

  getWalletLedger(
    walletAccountId: string,
    limit = 50
  ): Promise<WalletLedgerRecord[]> {
    return this.repository.getWalletLedger(walletAccountId, limit);
  }

  private async findIdempotentChargedResult(
    requestId: string
  ): Promise<ChargedAIArtifactResult | null> {
    const existing = await this.repository.findAIArtifactByRequestId(requestId);

    if (!existing) {
      return null;
    }

    return this.toIdempotentChargedResult(requestId, existing);
  }

  private toIdempotentChargedResult(
    requestId: string,
    existing: AIArtifactRecord & { walletLedgers: WalletLedgerRecord[] }
  ): ChargedAIArtifactResult | null {
    const existingLedger = existing.walletLedgers.find(
      (ledger) => ledger.requestId === requestId
    );

    if (existing.status !== "SAVED_CHARGED" || !existingLedger) {
      return null;
    }

    return {
      status: "saved_charged",
      requestId,
      aiArtifact: existing,
      walletLedger: existingLedger,
      idempotent: true
    };
  }
}

class ChargePersistenceError extends Error {
  constructor(
    readonly errorType: "wallet_not_found" | "insufficient_balance",
    message: string
  ) {
    super(message);
    this.name = "ChargePersistenceError";
  }
}

function assertStrictlyIncreasingSequences(
  events: AppendHandEventInput[]
): void {
  for (let index = 1; index < events.length; index += 1) {
    if (events[index].sequence <= events[index - 1].sequence) {
      throw new Error("Hand event sequences must be strictly increasing.");
    }
  }
}
