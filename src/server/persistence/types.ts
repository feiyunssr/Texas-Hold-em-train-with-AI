export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type AIArtifactKind =
  | "BOT_ACTION"
  | "HERO_COACH"
  | "HAND_REVIEW"
  | "HISTORY_DIAGNOSIS";

export type AIArtifactStatus =
  | "SAVED_CHARGED"
  | "FAILED_NOT_CHARGED"
  | "PENDING_PERSISTENCE"
  | "PARTIAL_NOT_FINAL";

export type WalletLedgerEntryType =
  | "CREDIT_GRANT"
  | "AI_CHARGE"
  | "ADJUSTMENT"
  | "REVERSAL";

export type StoredHandEvent = {
  id: string;
  handId: string;
  sequence: number;
  eventType: string;
  payload: JsonValue;
  schemaVersion: number;
  createdAt: Date;
};

export type DecisionSnapshotRecord = {
  id: string;
  handId: string;
  decisionPointId: string;
  street: string;
  actingSeatIndex: number;
  eventSequence: number | null;
  visibleState: JsonValue;
  legalActions: JsonValue;
  schemaVersion: number;
  createdAt: Date;
};

export type AIArtifactRecord = {
  id: string;
  requestId: string;
  handId: string | null;
  decisionSnapshotId: string | null;
  decisionPointId: string | null;
  artifactKind: AIArtifactKind;
  status: AIArtifactStatus;
  promptVersion: string;
  schemaVersion: number;
  modelName: string;
  providerName: string;
  requestPayload: JsonValue;
  responsePayload: JsonValue | null;
  errorType: string | null;
  errorMessage: string | null;
  createdAt: Date;
};

export type WalletAccountRecord = {
  id: string;
  userId: string;
  balance: number;
  schemaVersion: number;
  createdAt: Date;
  updatedAt: Date;
};

export type WalletLedgerRecord = {
  id: string;
  requestId: string | null;
  userId: string;
  walletAccountId: string;
  aiArtifactId: string | null;
  entryType: WalletLedgerEntryType;
  amountDelta: number;
  balanceAfter: number;
  description: string | null;
  metadata: JsonValue | null;
  schemaVersion: number;
  createdAt: Date;
};

export type HandHistoryRow = {
  handId: string;
  sessionId: string;
  status: string;
  startedAt: Date;
  completedAt: Date | null;
  completionReason: string | null;
  playerCount: number;
  blindLevel: string;
  smallBlind: number;
  bigBlind: number;
  startingStack: number;
  heroSeatIndex: number | null;
  heroPosition: string | null;
  heroProfit: number | null;
  heroProfitBB: number | null;
  startingHand: string | null;
  result: string | null;
  hasAIArtifacts: boolean;
  hasHeroCoach: boolean;
  hasHandReview: boolean;
  strategyExecutionCount: number;
  labelKeys: string[];
  streets: string[];
  opponentStyles: string[];
};

export type HandReplayStep = {
  sequence: number;
  eventType: string;
  street: string | null;
  summary: string;
  potTotal: number;
  currentBet: number;
  board: string[];
  heroStack: number | null;
  heroStreetCommitment: number | null;
  heroTotalCommitment: number | null;
  actingSeatIndex: number | null;
  legalActionTypes: string[];
};

export type DecisionAuditTrail = {
  snapshot: DecisionSnapshotRecord | null;
  aiArtifacts: Array<
    AIArtifactRecord & {
      walletLedgers: WalletLedgerRecord[];
    }
  >;
};

export type HandHistoryFilters = {
  playerCount?: number;
  heroPosition?: string;
  street?: string;
  result?: string;
  label?: string;
  problemType?: string;
  opponentStyle?: string;
};

export type HandReplay = {
  handId: string;
  history: HandHistoryRow;
  steps: HandReplayStep[];
  timeline: Array<
    StoredHandEvent & {
      street: string | null;
      aiArtifacts: Array<
        AIArtifactRecord & { walletLedgers: WalletLedgerRecord[] }
      >;
      labels: Array<{
        key: string;
        title: string;
        source: string;
        note: string | null;
        aiArtifactId: string | null;
      }>;
      handReviewInsights: Array<{
        aiArtifactId: string;
        summary: string;
        tags: string[];
      }>;
    }
  >;
  handReviewArtifacts: Array<
    AIArtifactRecord & { walletLedgers: WalletLedgerRecord[] }
  >;
};

export type SaveDecisionSnapshotInput = {
  handId: string;
  decisionPointId: string;
  street: string;
  actingSeatIndex: number;
  eventSequence?: number;
  visibleState: JsonValue;
  legalActions: JsonValue;
  schemaVersion?: number;
};

export type AppendHandEventInput = {
  handId: string;
  sequence: number;
  eventType: string;
  payload: JsonValue;
  schemaVersion?: number;
};

export type SaveAIArtifactInput = {
  requestId: string;
  handId?: string;
  decisionSnapshotId?: string;
  decisionPointId?: string;
  artifactKind: AIArtifactKind;
  status: AIArtifactStatus;
  promptVersion: string;
  schemaVersion?: number;
  modelName: string;
  providerName: string;
  requestPayload: JsonValue;
  responsePayload?: JsonValue;
  errorType?: string;
  errorMessage?: string;
};

export type CreateWalletLedgerInput = {
  requestId?: string;
  userId: string;
  walletAccountId: string;
  aiArtifactId?: string;
  entryType: WalletLedgerEntryType;
  amountDelta: number;
  balanceAfter: number;
  description?: string;
  metadata?: JsonValue;
  schemaVersion?: number;
};

export type DebitWalletAccountInput = {
  walletAccountId: string;
  userId: string;
  amount: number;
};

export type TrainingAssetRepository = {
  appendHandEvents(events: AppendHandEventInput[]): Promise<StoredHandEvent[]>;
  saveDecisionSnapshot(
    snapshot: SaveDecisionSnapshotInput
  ): Promise<DecisionSnapshotRecord>;
  saveAIArtifact(input: SaveAIArtifactInput): Promise<AIArtifactRecord>;
  findAIArtifactByRequestId(
    requestId: string
  ): Promise<
    (AIArtifactRecord & { walletLedgers: WalletLedgerRecord[] }) | null
  >;
  findLatestChargedAIArtifactForHand(
    handId: string,
    artifactKind: AIArtifactKind
  ): Promise<
    (AIArtifactRecord & { walletLedgers: WalletLedgerRecord[] }) | null
  >;
  findDecisionSnapshot(
    handId: string,
    decisionPointId: string
  ): Promise<DecisionSnapshotRecord | null>;
  findWalletAccount(
    walletAccountId: string
  ): Promise<WalletAccountRecord | null>;
  updateWalletBalance(
    walletAccountId: string,
    balance: number
  ): Promise<WalletAccountRecord>;
  debitWalletAccount(
    input: DebitWalletAccountInput
  ): Promise<WalletAccountRecord | null>;
  createWalletLedger(
    input: CreateWalletLedgerInput
  ): Promise<WalletLedgerRecord>;
  getHandTimeline(handId: string): Promise<StoredHandEvent[]>;
  getDecisionAuditTrail(
    handId: string,
    decisionPointId: string
  ): Promise<DecisionAuditTrail>;
  listHandHistory(
    userId: string,
    limit: number,
    filters?: HandHistoryFilters
  ): Promise<HandHistoryRow[]>;
  getHandReplay(handId: string, userId: string): Promise<HandReplay | null>;
  getWalletLedger(
    walletAccountId: string,
    limit: number
  ): Promise<WalletLedgerRecord[]>;
  transaction<T>(
    callback: (repository: TrainingAssetRepository) => Promise<T>
  ): Promise<T>;
};
