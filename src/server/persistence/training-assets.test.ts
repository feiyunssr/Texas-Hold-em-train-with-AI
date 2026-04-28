import { describe, expect, it } from "vitest";

import { TrainingAssetService } from "./training-assets";
import type {
  AIArtifactRecord,
  AppendHandEventInput,
  CreateWalletLedgerInput,
  DebitWalletAccountInput,
  DecisionAuditTrail,
  DecisionSnapshotRecord,
  HandHistoryRow,
  SaveAIArtifactInput,
  SaveDecisionSnapshotInput,
  StoredHandEvent,
  TrainingAssetRepository,
  WalletAccountRecord,
  WalletLedgerRecord
} from "./types";

describe("TrainingAssetService", () => {
  it("reconstructs a completed hand timeline from append-only events", async () => {
    const repository = new InMemoryTrainingAssetRepository();
    const service = new TrainingAssetService(repository);

    await service.appendHandEvents([
      eventInput(1, "hand_started"),
      eventInput(2, "player_action"),
      eventInput(3, "hand_completed")
    ]);

    const timeline = await service.getHandTimeline("hand-1");

    expect(timeline.map((event) => event.sequence)).toEqual([1, 2, 3]);
    expect(timeline.map((event) => event.eventType)).toEqual([
      "hand_started",
      "player_action",
      "hand_completed"
    ]);
  });

  it("links decision snapshot, charged AI artifact and wallet ledger by decision point", async () => {
    const repository = new InMemoryTrainingAssetRepository({
      wallets: [walletAccount()]
    });
    const service = new TrainingAssetService(repository);

    const snapshot = await service.saveDecisionSnapshot({
      handId: "hand-1",
      decisionPointId: "hand-1:preflop:seat-0:1",
      street: "preflop",
      actingSeatIndex: 0,
      eventSequence: 8,
      visibleState: { pot: 30, heroCards: ["As", "Ad"] },
      legalActions: [{ type: "raise", minAmount: 40 }]
    });

    const result = await service.saveChargedAIArtifact({
      requestId: "request-1",
      userId: "demo-user",
      walletAccountId: "wallet-1",
      chargeAmount: 3,
      handId: "hand-1",
      decisionSnapshotId: snapshot.id,
      decisionPointId: snapshot.decisionPointId,
      artifactKind: "HERO_COACH",
      promptVersion: "hero-coach-v1",
      modelName: "mock-coach",
      providerName: "mock",
      requestPayload: { decisionPointId: snapshot.decisionPointId },
      responsePayload: { recommendation: "raise" }
    });

    expect(result.status).toBe("saved_charged");

    const auditTrail = await service.getDecisionAuditTrail(
      "hand-1",
      "hand-1:preflop:seat-0:1"
    );

    expect(auditTrail.snapshot?.id).toBe(snapshot.id);
    expect(auditTrail.aiArtifacts).toHaveLength(1);
    expect(auditTrail.aiArtifacts[0].requestId).toBe("request-1");
    expect(auditTrail.aiArtifacts[0].walletLedgers).toEqual([
      expect.objectContaining({
        requestId: "request-1",
        amountDelta: -3,
        balanceAfter: 97
      })
    ]);
  });

  it("does not duplicate charges for the same request_id", async () => {
    const repository = new InMemoryTrainingAssetRepository({
      wallets: [walletAccount()]
    });
    const service = new TrainingAssetService(repository);

    const first = await service.saveChargedAIArtifact(chargedInput());
    const second = await service.saveChargedAIArtifact(chargedInput());
    const ledger = await service.getWalletLedger("wallet-1");

    expect(first.status).toBe("saved_charged");
    expect(second.status).toBe("saved_charged");
    expect(second.status === "saved_charged" && second.idempotent).toBe(true);
    expect(ledger).toHaveLength(1);
    expect(ledger[0].balanceAfter).toBe(95);
  });

  it("returns the committed charge when a concurrent retry hits a request_id conflict", async () => {
    const existingRepository = new InMemoryTrainingAssetRepository({
      wallets: [{ ...walletAccount(), balance: 95 }],
      artifacts: [
        {
          id: "artifact-existing",
          requestId: "request-1",
          handId: "hand-1",
          decisionSnapshotId: null,
          decisionPointId: "decision-1",
          artifactKind: "HERO_COACH",
          status: "SAVED_CHARGED",
          promptVersion: "hero-coach-v1",
          schemaVersion: 1,
          modelName: "mock-coach",
          providerName: "mock",
          requestPayload: { decisionPointId: "decision-1" },
          responsePayload: { recommendation: "call" },
          errorType: null,
          errorMessage: null,
          createdAt: new Date()
        }
      ],
      ledgers: [
        {
          id: "ledger-existing",
          requestId: "request-1",
          userId: "demo-user",
          walletAccountId: "wallet-1",
          aiArtifactId: "artifact-existing",
          entryType: "AI_CHARGE",
          amountDelta: -5,
          balanceAfter: 95,
          description: "AI hero_coach charge",
          metadata: { requestId: "request-1", artifactKind: "HERO_COACH" },
          schemaVersion: 1,
          createdAt: new Date()
        }
      ]
    });
    const repository = new ConcurrentRetryRepository(existingRepository);
    const service = new TrainingAssetService(repository);

    const result = await service.saveChargedAIArtifact(chargedInput());

    expect(result.status).toBe("saved_charged");
    expect(result.status === "saved_charged" && result.idempotent).toBe(true);
    expect(result.status === "saved_charged" && result.walletLedger.id).toBe(
      "ledger-existing"
    );
  });

  it("rejects non-positive and non-integer charge amounts without touching the wallet", async () => {
    const repository = new InMemoryTrainingAssetRepository({
      wallets: [walletAccount()]
    });
    const service = new TrainingAssetService(repository);

    const zero = await service.saveChargedAIArtifact({
      ...chargedInput(),
      chargeAmount: 0
    });
    const negative = await service.saveChargedAIArtifact({
      ...chargedInput(),
      requestId: "request-2",
      chargeAmount: -10
    });
    const fractional = await service.saveChargedAIArtifact({
      ...chargedInput(),
      requestId: "request-3",
      chargeAmount: 1.5
    });
    const wallet = await repository.findWalletAccount("wallet-1");

    expect(zero).toEqual(
      expect.objectContaining({
        status: "failed_not_charged",
        errorType: "invalid_charge_amount"
      })
    );
    expect(negative).toEqual(
      expect.objectContaining({
        status: "failed_not_charged",
        errorType: "invalid_charge_amount"
      })
    );
    expect(fractional).toEqual(
      expect.objectContaining({
        status: "failed_not_charged",
        errorType: "invalid_charge_amount"
      })
    );
    expect(wallet?.balance).toBe(100);
  });

  it("rolls back the artifact when ledger persistence fails", async () => {
    const repository = new InMemoryTrainingAssetRepository({
      wallets: [walletAccount()],
      failNextLedgerCreate: true
    });
    const service = new TrainingAssetService(repository);

    const result = await service.saveChargedAIArtifact(chargedInput());
    const artifact = await repository.findAIArtifactByRequestId("request-1");
    const ledger = await service.getWalletLedger("wallet-1");
    const wallet = await repository.findWalletAccount("wallet-1");

    expect(result).toEqual(
      expect.objectContaining({
        status: "failed_not_charged",
        errorType: "storage_failure"
      })
    );
    expect(artifact).toBeNull();
    expect(ledger).toHaveLength(0);
    expect(wallet?.balance).toBe(100);
  });
});

class InMemoryTrainingAssetRepository implements TrainingAssetRepository {
  private events: StoredHandEvent[];
  private snapshots: DecisionSnapshotRecord[];
  private artifacts: AIArtifactRecord[];
  private wallets: WalletAccountRecord[];
  private ledgers: WalletLedgerRecord[];
  private history: HandHistoryRow[];
  private failNextLedgerCreate: boolean;
  private idCounter: number;

  constructor(options: InMemoryRepositoryOptions = {}) {
    this.events = options.events ?? [];
    this.snapshots = options.snapshots ?? [];
    this.artifacts = options.artifacts ?? [];
    this.wallets = options.wallets ?? [];
    this.ledgers = options.ledgers ?? [];
    this.history = options.history ?? [];
    this.failNextLedgerCreate = options.failNextLedgerCreate ?? false;
    this.idCounter = options.idCounter ?? 1;
  }

  async appendHandEvents(
    events: AppendHandEventInput[]
  ): Promise<StoredHandEvent[]> {
    const created = events.map((event) => {
      if (
        this.events.some(
          (existing) =>
            existing.handId === event.handId &&
            existing.sequence === event.sequence
        )
      ) {
        throw new Error("Duplicate hand event sequence.");
      }

      return {
        id: this.nextId("event"),
        handId: event.handId,
        sequence: event.sequence,
        eventType: event.eventType,
        payload: event.payload,
        schemaVersion: event.schemaVersion ?? 1,
        createdAt: new Date()
      };
    });

    this.events.push(...created);
    return created;
  }

  async saveDecisionSnapshot(
    snapshot: SaveDecisionSnapshotInput
  ): Promise<DecisionSnapshotRecord> {
    if (
      this.snapshots.some(
        (existing) =>
          existing.handId === snapshot.handId &&
          existing.decisionPointId === snapshot.decisionPointId
      )
    ) {
      throw new Error("Duplicate decision snapshot.");
    }

    const record: DecisionSnapshotRecord = {
      id: this.nextId("snapshot"),
      handId: snapshot.handId,
      decisionPointId: snapshot.decisionPointId,
      street: snapshot.street,
      actingSeatIndex: snapshot.actingSeatIndex,
      eventSequence: snapshot.eventSequence ?? null,
      visibleState: snapshot.visibleState,
      legalActions: snapshot.legalActions,
      schemaVersion: snapshot.schemaVersion ?? 1,
      createdAt: new Date()
    };

    this.snapshots.push(record);
    return record;
  }

  async saveAIArtifact(input: SaveAIArtifactInput): Promise<AIArtifactRecord> {
    if (
      this.artifacts.some((existing) => existing.requestId === input.requestId)
    ) {
      throw new Error("Duplicate AI artifact request.");
    }

    const record: AIArtifactRecord = {
      id: this.nextId("artifact"),
      requestId: input.requestId,
      handId: input.handId ?? null,
      decisionSnapshotId: input.decisionSnapshotId ?? null,
      decisionPointId: input.decisionPointId ?? null,
      artifactKind: input.artifactKind,
      status: input.status,
      promptVersion: input.promptVersion,
      schemaVersion: input.schemaVersion ?? 1,
      modelName: input.modelName,
      providerName: input.providerName,
      requestPayload: input.requestPayload,
      responsePayload: input.responsePayload ?? null,
      errorType: input.errorType ?? null,
      errorMessage: input.errorMessage ?? null,
      createdAt: new Date()
    };

    this.artifacts.push(record);
    return record;
  }

  async findAIArtifactByRequestId(
    requestId: string
  ): Promise<
    (AIArtifactRecord & { walletLedgers: WalletLedgerRecord[] }) | null
  > {
    const artifact = this.artifacts.find(
      (candidate) => candidate.requestId === requestId
    );

    if (!artifact) {
      return null;
    }

    return {
      ...artifact,
      walletLedgers: this.ledgers.filter(
        (ledger) => ledger.aiArtifactId === artifact.id
      )
    };
  }

  async findDecisionSnapshot(
    handId: string,
    decisionPointId: string
  ): Promise<DecisionSnapshotRecord | null> {
    return (
      this.snapshots.find(
        (snapshot) =>
          snapshot.handId === handId &&
          snapshot.decisionPointId === decisionPointId
      ) ?? null
    );
  }

  async findWalletAccount(
    walletAccountId: string
  ): Promise<WalletAccountRecord | null> {
    return this.wallets.find((wallet) => wallet.id === walletAccountId) ?? null;
  }

  async updateWalletBalance(
    walletAccountId: string,
    balance: number
  ): Promise<WalletAccountRecord> {
    const wallet = this.wallets.find(
      (candidate) => candidate.id === walletAccountId
    );

    if (!wallet) {
      throw new Error("Wallet account not found.");
    }

    wallet.balance = balance;
    wallet.updatedAt = new Date();
    return wallet;
  }

  async debitWalletAccount(
    input: DebitWalletAccountInput
  ): Promise<WalletAccountRecord | null> {
    const wallet = this.wallets.find(
      (candidate) =>
        candidate.id === input.walletAccountId &&
        candidate.userId === input.userId
    );

    if (!wallet || wallet.balance < input.amount) {
      return null;
    }

    wallet.balance -= input.amount;
    wallet.updatedAt = new Date();
    return wallet;
  }

  async createWalletLedger(
    input: CreateWalletLedgerInput
  ): Promise<WalletLedgerRecord> {
    if (this.failNextLedgerCreate) {
      this.failNextLedgerCreate = false;
      throw new Error("Simulated ledger write failure.");
    }

    if (
      input.requestId &&
      this.ledgers.some((ledger) => ledger.requestId === input.requestId)
    ) {
      throw new Error("Duplicate wallet ledger request.");
    }

    const record: WalletLedgerRecord = {
      id: this.nextId("ledger"),
      requestId: input.requestId ?? null,
      userId: input.userId,
      walletAccountId: input.walletAccountId,
      aiArtifactId: input.aiArtifactId ?? null,
      entryType: input.entryType,
      amountDelta: input.amountDelta,
      balanceAfter: input.balanceAfter,
      description: input.description ?? null,
      metadata: input.metadata ?? null,
      schemaVersion: input.schemaVersion ?? 1,
      createdAt: new Date()
    };

    this.ledgers.push(record);
    return record;
  }

  async getHandTimeline(handId: string): Promise<StoredHandEvent[]> {
    return this.events
      .filter((event) => event.handId === handId)
      .sort((left, right) => left.sequence - right.sequence);
  }

  async getDecisionAuditTrail(
    handId: string,
    decisionPointId: string
  ): Promise<DecisionAuditTrail> {
    const snapshot = await this.findDecisionSnapshot(handId, decisionPointId);
    const aiArtifacts = this.artifacts
      .filter(
        (artifact) =>
          artifact.handId === handId &&
          artifact.decisionPointId === decisionPointId
      )
      .map((artifact) => ({
        ...artifact,
        walletLedgers: this.ledgers.filter(
          (ledger) => ledger.aiArtifactId === artifact.id
        )
      }));

    return { snapshot, aiArtifacts };
  }

  async listHandHistory(
    _userId: string,
    limit: number
  ): Promise<HandHistoryRow[]> {
    return this.history.slice(0, limit);
  }

  async getWalletLedger(
    walletAccountId: string,
    limit: number
  ): Promise<WalletLedgerRecord[]> {
    return this.ledgers
      .filter((ledger) => ledger.walletAccountId === walletAccountId)
      .slice(0, limit);
  }

  async transaction<T>(
    callback: (repository: TrainingAssetRepository) => Promise<T>
  ): Promise<T> {
    const clone = new InMemoryTrainingAssetRepository({
      events: structuredClone(this.events),
      snapshots: structuredClone(this.snapshots),
      artifacts: structuredClone(this.artifacts),
      wallets: structuredClone(this.wallets),
      ledgers: structuredClone(this.ledgers),
      history: structuredClone(this.history),
      failNextLedgerCreate: this.failNextLedgerCreate,
      idCounter: this.idCounter
    });

    const result = await callback(clone);

    this.events = clone.events;
    this.snapshots = clone.snapshots;
    this.artifacts = clone.artifacts;
    this.wallets = clone.wallets;
    this.ledgers = clone.ledgers;
    this.history = clone.history;
    this.failNextLedgerCreate = clone.failNextLedgerCreate;
    this.idCounter = clone.idCounter;

    return result;
  }

  private nextId(prefix: string): string {
    const id = `${prefix}-${this.idCounter}`;
    this.idCounter += 1;
    return id;
  }
}

class ConcurrentRetryRepository implements TrainingAssetRepository {
  private firstArtifactLookup = true;

  constructor(private readonly committed: TrainingAssetRepository) {}

  appendHandEvents(events: AppendHandEventInput[]): Promise<StoredHandEvent[]> {
    return this.committed.appendHandEvents(events);
  }

  saveDecisionSnapshot(
    snapshot: SaveDecisionSnapshotInput
  ): Promise<DecisionSnapshotRecord> {
    return this.committed.saveDecisionSnapshot(snapshot);
  }

  saveAIArtifact(input: SaveAIArtifactInput): Promise<AIArtifactRecord> {
    return this.committed.saveAIArtifact(input);
  }

  findAIArtifactByRequestId(
    requestId: string
  ): Promise<
    (AIArtifactRecord & { walletLedgers: WalletLedgerRecord[] }) | null
  > {
    if (this.firstArtifactLookup) {
      this.firstArtifactLookup = false;
      return Promise.resolve(null);
    }

    return this.committed.findAIArtifactByRequestId(requestId);
  }

  findDecisionSnapshot(
    handId: string,
    decisionPointId: string
  ): Promise<DecisionSnapshotRecord | null> {
    return this.committed.findDecisionSnapshot(handId, decisionPointId);
  }

  findWalletAccount(
    walletAccountId: string
  ): Promise<WalletAccountRecord | null> {
    return this.committed.findWalletAccount(walletAccountId);
  }

  updateWalletBalance(
    walletAccountId: string,
    balance: number
  ): Promise<WalletAccountRecord> {
    return this.committed.updateWalletBalance(walletAccountId, balance);
  }

  debitWalletAccount(
    input: DebitWalletAccountInput
  ): Promise<WalletAccountRecord | null> {
    return this.committed.debitWalletAccount(input);
  }

  createWalletLedger(
    input: CreateWalletLedgerInput
  ): Promise<WalletLedgerRecord> {
    return this.committed.createWalletLedger(input);
  }

  getHandTimeline(handId: string): Promise<StoredHandEvent[]> {
    return this.committed.getHandTimeline(handId);
  }

  getDecisionAuditTrail(
    handId: string,
    decisionPointId: string
  ): Promise<DecisionAuditTrail> {
    return this.committed.getDecisionAuditTrail(handId, decisionPointId);
  }

  listHandHistory(userId: string, limit: number): Promise<HandHistoryRow[]> {
    return this.committed.listHandHistory(userId, limit);
  }

  getWalletLedger(
    walletAccountId: string,
    limit: number
  ): Promise<WalletLedgerRecord[]> {
    return this.committed.getWalletLedger(walletAccountId, limit);
  }

  transaction<T>(
    _callback: (repository: TrainingAssetRepository) => Promise<T>
  ): Promise<T> {
    return Promise.reject(new Error("Duplicate AI artifact request."));
  }
}

type InMemoryRepositoryOptions = {
  events?: StoredHandEvent[];
  snapshots?: DecisionSnapshotRecord[];
  artifacts?: AIArtifactRecord[];
  wallets?: WalletAccountRecord[];
  ledgers?: WalletLedgerRecord[];
  history?: HandHistoryRow[];
  failNextLedgerCreate?: boolean;
  idCounter?: number;
};

function eventInput(sequence: number, eventType: string): AppendHandEventInput {
  return {
    handId: "hand-1",
    sequence,
    eventType,
    payload: { sequence }
  };
}

function walletAccount(): WalletAccountRecord {
  return {
    id: "wallet-1",
    userId: "demo-user",
    balance: 100,
    schemaVersion: 1,
    createdAt: new Date(),
    updatedAt: new Date()
  };
}

function chargedInput() {
  return {
    requestId: "request-1",
    userId: "demo-user",
    walletAccountId: "wallet-1",
    chargeAmount: 5,
    handId: "hand-1",
    decisionPointId: "decision-1",
    artifactKind: "HERO_COACH" as const,
    promptVersion: "hero-coach-v1",
    modelName: "mock-coach",
    providerName: "mock",
    requestPayload: { decisionPointId: "decision-1" },
    responsePayload: { recommendation: "call" }
  };
}
