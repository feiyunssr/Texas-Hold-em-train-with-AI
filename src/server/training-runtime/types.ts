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

export type BotStyle = "tight" | "balanced" | "loose" | "aggressive";

export type TrainingTableStatus =
  | "waiting_for_user"
  | "bot_acting"
  | "hand_complete";

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
};

export type PublicHandState = {
  handId: string;
  street: Street;
  board: CardCode[];
  potTotal: number;
  pots: Pot[];
  currentActorSeat: number | null;
  currentBet: number;
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
    | "runtime_snapshot"
    | "user_action_rejected"
    | HandEvent["type"];
  payload: Record<string, unknown>;
  createdAt: string;
};

export type TrainingTableSnapshot = {
  tableId: string;
  status: TrainingTableStatus;
  config: TrainingTableConfig;
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
