import type {
  ActionType,
  CardCode,
  HandEvent,
  HandState,
  LegalAction,
  PlayerAction,
  Pot,
  SeatStatus,
  Street
} from "@/domain/poker";
import type {
  PreflopStrategyConfig,
  PreflopStrategyEvaluation
} from "@/domain/preflop-strategy";

export type BotStyle = "tight" | "balanced" | "loose" | "aggressive";

export type TrainingTableStatus =
  | "waiting_for_user"
  | "bot_acting"
  | "hand_complete"
  | "training_ended";

export type TrainingTableEndReason = "user_quit" | "hero_eliminated";

export type TrainingTableCreateInput = {
  playerCount: 4 | 6 | 9 | 12;
  smallBlind: number;
  bigBlind: number;
  startingStack: number;
  ante?: number;
  straddleSeat?: number;
  straddleAmount?: number;
  heroSeatIndex?: number;
  buttonSeat?: number;
  seed?: string;
  aiStyles?: BotStyle[];
  heroPreflopStrategy?: PreflopStrategyConfig;
};

export type TrainingTableConfig = Required<
  Pick<
    TrainingTableCreateInput,
    | "playerCount"
    | "smallBlind"
    | "bigBlind"
    | "startingStack"
    | "heroSeatIndex"
    | "buttonSeat"
  >
> &
  Pick<TrainingTableCreateInput, "ante" | "straddleSeat" | "straddleAmount"> & {
    aiStyles: BotStyle[];
  };

export type RuntimeSeatProfile = {
  seatIndex: number;
  playerId: string;
  displayName: string;
  isHero: boolean;
  style: BotStyle | "hero";
};

export type PublicSeatState = {
  seatIndex: number;
  playerId: string;
  displayName: string;
  isHero: boolean;
  style: BotStyle | "hero";
  stack: number;
  status: SeatStatus;
  streetCommitment: number;
  totalCommitment: number;
  holeCards: CardCode[] | null;
  isButton: boolean;
  isSmallBlind: boolean;
  isBigBlind: boolean;
  lastAction: PublicActionSummary | null;
};

export type PublicActionSummary = {
  sequence: number;
  street: Street;
  seatIndex: number;
  action: ActionType;
  amount: number;
  totalBetTo: number;
};

export type PublicStreetActionSummary = {
  street: Street;
  actions: PublicActionSummary[];
  summary: string;
};

export type PublicDisplayPot = {
  label: string;
  amount: number;
  eligibleSeatIndexes: number[];
  winnerSeatIndexes: number[];
  share: number | null;
  oddChips: number;
};

export type PublicHandState = {
  handId: string;
  street: Street;
  board: CardCode[];
  potTotal: number;
  pots: Pot[];
  displayPots: PublicDisplayPot[];
  currentActorSeat: number | null;
  currentBet: number;
  toCall: number;
  minRaiseTo: number | null;
  maxBetAmount: number | null;
  effectiveStack: number;
  lastAction: PublicActionSummary | null;
  streetActionSummary: PublicStreetActionSummary[];
  legalActions: LegalAction[];
  seats: PublicSeatState[];
  completionReason: HandState["completionReason"];
  awards: HandState["awards"];
  showdownResults: HandState["showdownResults"];
  lastSequence: number;
};

export type RuntimePublicEvent = {
  sequence: number;
  type:
    | "table_created"
    | "hand_started"
    | "training_ended"
    | "runtime_snapshot"
    | "user_action_rejected"
    | "strategy_auto_action_evaluated"
    | "strategy_auto_action_submitted"
    | "strategy_auto_action_skipped"
    | HandEvent["type"];
  payload: Record<string, unknown>;
  createdAt: string;
};

export type PublicHeroPreflopStrategyState = {
  mode: PreflopStrategyConfig["mode"];
  configId: string | null;
  name: string | null;
  version: string | null;
  paused: boolean;
  current: PublicStrategyEvaluationSummary | null;
  recentEvents: PublicStrategyExecutionEvent[];
};

export type PublicStrategyEvaluationSummary = {
  status: PreflopStrategyEvaluation["status"];
  strategyId: string;
  strategyVersion: string;
  startingHand: string;
  decisionPointId: string;
  summary: string;
  ruleId?: string;
  ruleLabel?: string;
  action?: PlayerAction;
  reason?: string;
};

export type PublicStrategyExecutionEvent = {
  sequence: number;
  type:
    | "strategy_auto_action_evaluated"
    | "strategy_auto_action_submitted"
    | "strategy_auto_action_skipped";
  payload: Record<string, unknown>;
  createdAt: string;
};

export type TrainingTableSnapshot = {
  tableId: string;
  status: TrainingTableStatus;
  endReason: TrainingTableEndReason | null;
  config: TrainingTableConfig;
  heroPreflopStrategy: PublicHeroPreflopStrategyState;
  hand: PublicHandState;
  createdAt: string;
  updatedAt: string;
};

export type BotSeatView = {
  tableId: string;
  handId: string;
  seatIndex: number;
  style: BotStyle;
  street: Street;
  board: CardCode[];
  potTotal: number;
  currentBet: number;
  currentActorSeat: number | null;
  heroSeatIndex: number;
  seats: Array<{
    seatIndex: number;
    stack: number;
    status: SeatStatus;
    streetCommitment: number;
    totalCommitment: number;
    isHero: boolean;
    style: BotStyle | "hero";
    holeCards: CardCode[] | null;
  }>;
  legalActions: LegalAction[];
  visibleActionHistory: Array<{
    sequence: number;
    seatIndex: number;
    action: ActionType;
    amount: number;
    totalBetTo: number;
  }>;
};

export type HeroCoachView = {
  tableId: string;
  handId: string;
  decisionPointId: string;
  actingSeatIndex: number;
  tableConfig: TrainingTableConfig;
  street: Street;
  board: CardCode[];
  heroHoleCards: CardCode[];
  potTotal: number;
  pots: Pot[];
  currentBet: number;
  eventSequence: number;
  legalActions: LegalAction[];
  seats: Array<{
    seatIndex: number;
    playerId: string;
    displayName: string;
    isHero: boolean;
    style: BotStyle | "hero";
    stack: number;
    effectiveStackAgainstHero: number;
    status: SeatStatus;
    streetCommitment: number;
    totalCommitment: number;
    position: "button" | "small_blind" | "big_blind" | "other";
  }>;
  bettingHistory: Array<{
    sequence: number;
    street: Street;
    seatIndex: number;
    action: ActionType;
    amount: number;
    totalBetTo: number;
  }>;
};

export type HandReviewTimelineEvent = {
  sequence: number;
  street: Street;
  type: HandEvent["type"];
  payload: HandEvent["payload"];
};

export type HandReviewView = {
  tableId: string;
  handId: string;
  handNumber: number;
  tableConfig: TrainingTableConfig;
  heroSeatIndex: number;
  buttonSeat: number;
  smallBlindSeat: number;
  bigBlindSeat: number;
  completionReason: HandState["completionReason"];
  board: CardCode[];
  potTotal: number;
  awards: HandState["awards"];
  showdownResults: HandState["showdownResults"];
  finalState: PublicHandState;
  seats: Array<{
    seatIndex: number;
    playerId: string;
    displayName: string;
    isHero: boolean;
    style: BotStyle | "hero";
    finalStack: number;
    totalCommitment: number;
    status: SeatStatus;
    holeCards: CardCode[];
    position: "button" | "small_blind" | "big_blind" | "other";
  }>;
  timeline: HandReviewTimelineEvent[];
  strategyExecutionEvents: PublicStrategyExecutionEvent[];
};

export type BeginHeroCoachRequestResult =
  | {
      status: "locked";
      view: HeroCoachView;
    }
  | {
      status: "already_requested";
      view: HeroCoachView;
    };

export type TrainingRuntimeEvent =
  | {
      type: "created";
      snapshot: TrainingTableSnapshot;
      event: RuntimePublicEvent;
    }
  | {
      type: "advanced";
      snapshot: TrainingTableSnapshot;
      events: RuntimePublicEvent[];
    }
  | {
      type: "rejected";
      snapshot: TrainingTableSnapshot;
      event: RuntimePublicEvent;
      error: string;
    };

export type SubmitUserActionInput = Omit<PlayerAction, "seatIndex"> & {
  amount?: number;
};

export type UpdateHeroPreflopStrategyInput = {
  config?: PreflopStrategyConfig;
  paused?: boolean;
};
