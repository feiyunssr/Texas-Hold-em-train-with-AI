import { describe, expect, it } from "vitest";

import type { HeroCoachProvider, HeroCoachProviderRequest } from "@/ai";
import { TrainingAssetService } from "@/server/persistence/training-assets";
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
} from "@/server/persistence/types";
import { TrainingTableRuntime } from "@/server/training-runtime";

import { HeroCoachService } from "./index";

describe("HeroCoachService", () => {
  it("saves a decision snapshot, charged artifact and wallet ledger on success", async () => {
    const { service, runtime, repository, tableId } = setupService({
      provider: new StaticProvider(validAdvice())
    });

    const result = await service.requestAdvice(requestInput(tableId));
    const view = runtime.getHeroCoachView(tableId);
    const auditTrail = await repository.getDecisionAuditTrail(
      view.handId,
      view.decisionPointId
    );
    const ledger = await repository.getWalletLedger("wallet-1", 10);

    expect(result).toEqual(
      expect.objectContaining({
        status: "saved_charged",
        requestId: "request-1",
        chargedAmount: 5,
        balanceAfter: 95
      })
    );
    expect(auditTrail.snapshot?.decisionPointId).toBe(view.decisionPointId);
    expect(auditTrail.aiArtifacts).toHaveLength(1);
    expect(auditTrail.aiArtifacts[0].status).toBe("SAVED_CHARGED");
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toEqual(
      expect.objectContaining({
        requestId: "request-1",
        amountDelta: -5,
        balanceAfter: 95
      })
    );
  });

  it("returns already_requested for a second formal request on the same decision point", async () => {
    const provider = new StaticProvider(validAdvice());
    const { service, repository, tableId } = setupService({ provider });

    const first = await service.requestAdvice(requestInput(tableId));
    const second = await service.requestAdvice({
      ...requestInput(tableId),
      requestId: "request-2"
    });
    const ledger = await repository.getWalletLedger("wallet-1", 10);

    expect(first.status).toBe("saved_charged");
    expect(second).toEqual(
      expect.objectContaining({
        status: "already_requested",
        existingStatus: "SAVED_CHARGED"
      })
    );
    expect(provider.calls).toBe(1);
    expect(ledger).toHaveLength(1);
  });

  it("returns a committed charged result for a duplicate request_id retry", async () => {
    const { service, tableId } = setupService({
      provider: new StaticProvider(validAdvice())
    });

    const first = await service.requestAdvice(requestInput(tableId));
    const second = await service.requestAdvice(requestInput(tableId));

    expect(first.status).toBe("saved_charged");
    expect(second).toEqual(
      expect.objectContaining({
        status: "saved_charged",
        idempotent: true
      })
    );
    expect(second.status === "saved_charged" && second.advice).toEqual(
      first.status === "saved_charged" ? first.advice : null
    );
  });

  it("locks the current decision point while the provider request is pending", async () => {
    const provider = new DeferredProvider();
    const { service, runtime, tableId } = setupService({ provider });
    const pending = service.requestAdvice(requestInput(tableId));

    await provider.started;
    const rejected = runtime.submitUserAction(tableId, { type: "fold" });
    provider.resolve(validAdvice());
    await pending;

    expect(rejected.type).toBe("rejected");
    expect(rejected.type === "rejected" && rejected.error).toContain("locked");
  });

  it("retries timeout failures and persists failed_not_charged without a ledger", async () => {
    const { service, repository, runtime, tableId } = setupService({
      provider: new NeverProvider(),
      config: {
        requestTimeoutMs: 5,
        retryAttempts: 1,
        retryBackoffMs: 0
      }
    });

    const result = await service.requestAdvice(requestInput(tableId));
    const view = runtime.getHeroCoachView(tableId);
    const auditTrail = await repository.getDecisionAuditTrail(
      view.handId,
      view.decisionPointId
    );

    expect(result).toEqual(
      expect.objectContaining({
        status: "failed_not_charged",
        errorType: "timeout"
      })
    );
    expect(auditTrail.aiArtifacts[0]).toEqual(
      expect.objectContaining({
        status: "FAILED_NOT_CHARGED",
        errorType: "timeout"
      })
    );
    expect(auditTrail.aiArtifacts[0].walletLedgers).toHaveLength(0);
  });

  it("does not charge provider errors, parse failures or schema failures", async () => {
    const providerError = setupService({
      provider: new ThrowingProvider(new Error("model unavailable"))
    });
    const parseFailure = setupService({
      provider: new StaticProvider("{not-json")
    });
    const schemaFailure = setupService({
      provider: new StaticProvider({ primaryAction: "raise" })
    });

    const providerResult = await providerError.service.requestAdvice(
      requestInput(providerError.tableId)
    );
    const schemaResult = await schemaFailure.service.requestAdvice(
      requestInput(schemaFailure.tableId)
    );
    const parseResult = await parseFailure.service.requestAdvice(
      requestInput(parseFailure.tableId)
    );
    const providerLedger = await providerError.repository.getWalletLedger(
      "wallet-1",
      10
    );
    const parseLedger = await parseFailure.repository.getWalletLedger(
      "wallet-1",
      10
    );
    const schemaLedger = await schemaFailure.repository.getWalletLedger(
      "wallet-1",
      10
    );

    expect(providerResult).toEqual(
      expect.objectContaining({
        status: "failed_not_charged",
        errorType: "provider_error"
      })
    );
    expect(schemaResult).toEqual(
      expect.objectContaining({
        status: "failed_not_charged",
        errorType: "schema_validation"
      })
    );
    expect(parseResult).toEqual(
      expect.objectContaining({
        status: "failed_not_charged",
        errorType: "parse_failure"
      })
    );
    expect(providerLedger).toHaveLength(0);
    expect(parseLedger).toHaveLength(0);
    expect(schemaLedger).toHaveLength(0);
  });

  it("stores partial output as partial_not_final without charging", async () => {
    const { service, repository, tableId } = setupService({
      provider: new StaticProvider({
        partial: true,
        primaryAction: "call",
        keyFactors: ["pot"]
      })
    });

    const result = await service.requestAdvice(requestInput(tableId));
    const ledger = await repository.getWalletLedger("wallet-1", 10);

    expect(result).toEqual(
      expect.objectContaining({
        status: "partial_not_final"
      })
    );
    expect(ledger).toHaveLength(0);
  });

  it("rejects invalid charge amounts before persistence", async () => {
    const provider = new StaticProvider(validAdvice());
    const { service, repository, tableId } = setupService({ provider });

    const result = await service.requestAdvice({
      ...requestInput(tableId),
      chargeAmount: 0
    });
    const ledger = await repository.getWalletLedger("wallet-1", 10);

    expect(result).toEqual(
      expect.objectContaining({
        status: "failed_not_charged",
        errorType: "invalid_charge_amount"
      })
    );
    expect(provider.calls).toBe(0);
    expect(ledger).toHaveLength(0);
  });

  it("releases the decision lock when validation fails before saving an artifact", async () => {
    const provider = new StaticProvider(validAdvice());
    const { service, tableId } = setupService({ provider });

    const invalid = await service.requestAdvice({
      ...requestInput(tableId),
      chargeAmount: 0
    });
    const retry = await service.requestAdvice({
      ...requestInput(tableId),
      requestId: "request-2"
    });

    expect(invalid).toEqual(
      expect.objectContaining({
        status: "failed_not_charged",
        errorType: "invalid_charge_amount"
      })
    );
    expect(retry).toEqual(
      expect.objectContaining({
        status: "saved_charged",
        requestId: "request-2"
      })
    );
    expect(provider.calls).toBe(1);
  });

  it("releases the decision lock when snapshot persistence fails", async () => {
    const provider = new StaticProvider(validAdvice());
    const { service, tableId } = setupService({
      provider,
      failNextSnapshotCreate: true
    });

    const failed = await service.requestAdvice(requestInput(tableId));
    const retry = await service.requestAdvice({
      ...requestInput(tableId),
      requestId: "request-2"
    });

    expect(failed).toEqual(
      expect.objectContaining({
        status: "failed_not_charged",
        errorType: "storage_failure"
      })
    );
    expect(retry).toEqual(
      expect.objectContaining({
        status: "saved_charged",
        requestId: "request-2"
      })
    );
    expect(provider.calls).toBe(1);
  });

  it("does not leave a charged artifact when wallet ledger persistence fails", async () => {
    const { service, repository, tableId } = setupService({
      provider: new StaticProvider(validAdvice()),
      failNextLedgerCreate: true
    });

    const result = await service.requestAdvice(requestInput(tableId));
    const ledger = await repository.getWalletLedger("wallet-1", 10);

    expect(result).toEqual(
      expect.objectContaining({
        status: "failed_not_charged",
        errorType: "storage_failure"
      })
    );
    expect(ledger).toHaveLength(0);
    expect(repository.artifactCount).toBe(0);
  });
});

function setupService(options: {
  provider: HeroCoachProvider;
  config?: {
    requestTimeoutMs: number;
    retryAttempts: number;
    retryBackoffMs: number;
  };
  failNextLedgerCreate?: boolean;
  failNextSnapshotCreate?: boolean;
}) {
  const runtime = new TrainingTableRuntime();
  const tableId = runtime.createTable({
    playerCount: 4,
    smallBlind: 10,
    bigBlind: 20,
    startingStack: 200,
    ante: 0,
    heroSeatIndex: 0,
    buttonSeat: 0,
    seed: `hero-coach-${Math.random()}`
  }).snapshot.tableId;
  const repository = new InMemoryTrainingAssetRepository({
    wallets: [walletAccount()],
    failNextLedgerCreate: options.failNextLedgerCreate,
    failNextSnapshotCreate: options.failNextSnapshotCreate
  });
  const service = new HeroCoachService(
    runtime,
    new TrainingAssetService(repository),
    options.provider,
    options.config ?? {
      requestTimeoutMs: 100,
      retryAttempts: 0,
      retryBackoffMs: 0
    }
  );

  return {
    runtime,
    repository,
    service,
    tableId
  };
}

function requestInput(tableId: string) {
  return {
    tableId,
    requestId: "request-1",
    userId: "demo-user",
    walletAccountId: "wallet-1",
    chargeAmount: 5
  };
}

function validAdvice() {
  return {
    primaryAction: "call",
    suggestedBetAmount: null,
    acceptableAlternatives: [
      {
        action: "fold",
        amount: null,
        reason: "保留低风险备选。"
      }
    ],
    keyFactors: ["当前位置", "底池赔率", "后续行动"],
    riskNote: "建议依赖当前公开行动历史，非确定答案。"
  };
}

class StaticProvider implements HeroCoachProvider {
  readonly providerName = "test";
  readonly modelName = "static";
  calls = 0;

  constructor(private readonly response: unknown) {}

  async generateAdvice(): Promise<unknown> {
    this.calls += 1;
    return this.response;
  }
}

class ThrowingProvider implements HeroCoachProvider {
  readonly providerName = "test";
  readonly modelName = "throwing";

  constructor(private readonly error: Error) {}

  async generateAdvice(): Promise<unknown> {
    throw this.error;
  }
}

class NeverProvider implements HeroCoachProvider {
  readonly providerName = "test";
  readonly modelName = "never";

  async generateAdvice(): Promise<unknown> {
    return new Promise(() => undefined);
  }
}

class DeferredProvider implements HeroCoachProvider {
  readonly providerName = "test";
  readonly modelName = "deferred";
  private resolveResponse: ((value: unknown) => void) | null = null;
  private startedResolver: () => void = () => undefined;
  readonly started: Promise<void>;

  constructor() {
    this.started = new Promise((resolve) => {
      this.startedResolver = resolve;
    });
  }

  generateAdvice(_request: HeroCoachProviderRequest): Promise<unknown> {
    this.startedResolver();
    return new Promise((resolve) => {
      this.resolveResponse = resolve;
    });
  }

  resolve(value: unknown): void {
    this.resolveResponse?.(value);
  }
}

class InMemoryTrainingAssetRepository implements TrainingAssetRepository {
  private events: StoredHandEvent[] = [];
  private snapshots: DecisionSnapshotRecord[] = [];
  private artifacts: AIArtifactRecord[] = [];
  private wallets: WalletAccountRecord[];
  private ledgers: WalletLedgerRecord[] = [];
  private history: HandHistoryRow[] = [];
  private idCounter = 1;
  private failNextLedgerCreate: boolean;
  private failNextSnapshotCreate: boolean;

  constructor(options: {
    wallets: WalletAccountRecord[];
    failNextLedgerCreate?: boolean;
    failNextSnapshotCreate?: boolean;
  }) {
    this.wallets = options.wallets;
    this.failNextLedgerCreate = options.failNextLedgerCreate ?? false;
    this.failNextSnapshotCreate = options.failNextSnapshotCreate ?? false;
  }

  get artifactCount(): number {
    return this.artifacts.length;
  }

  async appendHandEvents(
    events: AppendHandEventInput[]
  ): Promise<StoredHandEvent[]> {
    const created = events.map((event) => ({
      id: this.nextId("event"),
      handId: event.handId,
      sequence: event.sequence,
      eventType: event.eventType,
      payload: event.payload,
      schemaVersion: event.schemaVersion ?? 1,
      createdAt: new Date()
    }));
    this.events.push(...created);
    return created;
  }

  async saveDecisionSnapshot(
    snapshot: SaveDecisionSnapshotInput
  ): Promise<DecisionSnapshotRecord> {
    if (this.failNextSnapshotCreate) {
      this.failNextSnapshotCreate = false;
      throw new Error("Simulated snapshot write failure.");
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
      this.artifacts.some((artifact) => artifact.requestId === input.requestId)
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
    const artifact =
      this.artifacts.find((candidate) => candidate.requestId === requestId) ??
      null;

    return artifact
      ? {
          ...artifact,
          walletLedgers: this.ledgers.filter(
            (ledger) => ledger.aiArtifactId === artifact.id
          )
        }
      : null;
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
    return this.events.filter((event) => event.handId === handId);
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
    const clone = this.clone();
    const result = await callback(clone);
    this.events = clone.events;
    this.snapshots = clone.snapshots;
    this.artifacts = clone.artifacts;
    this.wallets = clone.wallets;
    this.ledgers = clone.ledgers;
    this.history = clone.history;
    this.idCounter = clone.idCounter;
    this.failNextLedgerCreate = clone.failNextLedgerCreate;
    return result;
  }

  private clone(): InMemoryTrainingAssetRepository {
    const clone = new InMemoryTrainingAssetRepository({
      wallets: structuredClone(this.wallets),
      failNextLedgerCreate: this.failNextLedgerCreate,
      failNextSnapshotCreate: this.failNextSnapshotCreate
    });
    clone.events = structuredClone(this.events);
    clone.snapshots = structuredClone(this.snapshots);
    clone.artifacts = structuredClone(this.artifacts);
    clone.ledgers = structuredClone(this.ledgers);
    clone.history = structuredClone(this.history);
    clone.idCounter = this.idCounter;
    clone.failNextSnapshotCreate = this.failNextSnapshotCreate;
    return clone;
  }

  private nextId(prefix: string): string {
    const id = `${prefix}-${this.idCounter}`;
    this.idCounter += 1;
    return id;
  }
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
