import { evalHand } from "poker-evaluator";

import type {
  ActionType,
  CardCode,
  LegalAction,
  PlayerAction,
  SeatStatus,
  Street
} from "@/domain/poker";
import { classifyStartingHand } from "@/domain/preflop-strategy";

export type BotStyle =
  | "tight-passive"
  | "tight-aggressive"
  | "loose-passive"
  | "loose-aggressive"
  | "balanced";

export type LegacyBotStyle = "tight" | "loose" | "aggressive";

export type BotSeatStrategyView = {
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
  buttonSeat: number;
  smallBlindSeat: number;
  bigBlindSeat: number;
  bigBlind: number;
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

export type BotDecisionTrace = {
  seatIndex: number;
  style: BotStyle;
  street: Street;
  seed: string;
  roll: number;
  bucket: string;
  pressure: number;
  selectedAction: PlayerAction;
  reason: string;
};

export type BotStrategyResult = {
  action: PlayerAction;
  trace: BotDecisionTrace;
};

type StyleProfile = {
  preflopEnter: number;
  preflopRaise: number;
  postflopBet: number;
  continuePressure: number;
  aggression: number;
};

const STYLE_PROFILES: Record<BotStyle, StyleProfile> = {
  "tight-passive": {
    preflopEnter: 58,
    preflopRaise: 82,
    postflopBet: 0.76,
    continuePressure: 0.64,
    aggression: 0.58
  },
  "tight-aggressive": {
    preflopEnter: 54,
    preflopRaise: 74,
    postflopBet: 0.62,
    continuePressure: 0.58,
    aggression: 0.9
  },
  "loose-passive": {
    preflopEnter: 34,
    preflopRaise: 76,
    postflopBet: 0.7,
    continuePressure: 0.46,
    aggression: 0.46
  },
  "loose-aggressive": {
    preflopEnter: 28,
    preflopRaise: 58,
    postflopBet: 0.44,
    continuePressure: 0.42,
    aggression: 1
  },
  balanced: {
    preflopEnter: 44,
    preflopRaise: 68,
    postflopBet: 0.58,
    continuePressure: 0.52,
    aggression: 0.72
  }
};

export function normalizeBotStyle(style: BotStyle | LegacyBotStyle): BotStyle {
  if (style === "tight") {
    return "tight-passive";
  }

  if (style === "loose") {
    return "loose-passive";
  }

  if (style === "aggressive") {
    return "loose-aggressive";
  }

  return style;
}

export function chooseBotStrategyAction(
  view: BotSeatStrategyView
): BotStrategyResult {
  const ownCards = view.seats[view.seatIndex]?.holeCards;
  if (!ownCards || ownCards.length !== 2) {
    throw new Error("Bot strategy requires the acting seat's hole cards.");
  }

  if (view.legalActions.length === 0) {
    throw new Error("Bot strategy received no legal action.");
  }

  const seed = buildDecisionSeed(view);
  const roll = seededRatio(seed);
  const result =
    view.street === "preflop"
      ? choosePreflopAction(view, [ownCards[0], ownCards[1]], roll)
      : choosePostflopAction(view, [ownCards[0], ownCards[1]], roll);

  return {
    action: result.action,
    trace: {
      seatIndex: view.seatIndex,
      style: view.style,
      street: view.street,
      seed,
      roll,
      bucket: result.bucket,
      pressure: result.pressure,
      selectedAction: result.action,
      reason: result.reason
    }
  };
}

function choosePreflopAction(
  view: BotSeatStrategyView,
  ownCards: [CardCode, CardCode],
  roll: number
): {
  action: PlayerAction;
  bucket: string;
  pressure: number;
  reason: string;
} {
  const profile = STYLE_PROFILES[view.style];
  const startingHand = classifyStartingHand(ownCards);
  const handScore = scoreStartingHand(startingHand);
  const pressure = currentPressure(view);
  const raiseCount = visiblePreflopRaiseCount(view);
  const check = findAction(view, "check");
  const call = findAction(view, "call");
  const fold = findAction(view, "fold");
  const raise = findAction(view, "raise");
  const allIn = findAction(view, "all-in");
  const shouldRaise =
    handScore >= profile.preflopRaise - (raiseCount === 0 ? 6 : 0) &&
    roll < 0.36 * profile.aggression;

  if ((raise || allIn) && shouldRaise) {
    const action = buildSizedAction(view, raise ?? allIn, preflopRaiseTo(view));
    return {
      action,
      bucket: `${startingHand}:raise`,
      pressure,
      reason: `${startingHand} 在 ${view.style} 范围内选择施压。`
    };
  }

  if (check) {
    return {
      action: { seatIndex: view.seatIndex, type: "check" },
      bucket: `${startingHand}:check`,
      pressure,
      reason: "无需投入额外筹码，选择过牌。"
    };
  }

  if (call && handScore >= profile.preflopEnter + pressure * 22) {
    return {
      action: { seatIndex: view.seatIndex, type: "call", amount: call.amount },
      bucket: `${startingHand}:continue`,
      pressure,
      reason: `${startingHand} 达到继续范围。`
    };
  }

  if (allIn && handScore > 88 && roll < 0.24 * profile.aggression) {
    return {
      action: {
        seatIndex: view.seatIndex,
        type: "all-in",
        amount: allIn.amount
      },
      bucket: `${startingHand}:jam`,
      pressure,
      reason: `${startingHand} 高强度翻前范围偶发全下。`
    };
  }

  return {
    action: fold
      ? { seatIndex: view.seatIndex, type: "fold" }
      : fallbackAction(view),
    bucket: `${startingHand}:fold`,
    pressure,
    reason: `${startingHand} 未达到 ${view.style} 的继续阈值。`
  };
}

function choosePostflopAction(
  view: BotSeatStrategyView,
  ownCards: [CardCode, CardCode],
  roll: number
): {
  action: PlayerAction;
  bucket: string;
  pressure: number;
  reason: string;
} {
  const profile = STYLE_PROFILES[view.style];
  const strength = scorePostflopHand(ownCards, view.board);
  const pressure = currentPressure(view);
  const check = findAction(view, "check");
  const call = findAction(view, "call");
  const fold = findAction(view, "fold");
  const bet = findAction(view, "bet");
  const raise = findAction(view, "raise");
  const allIn = findAction(view, "all-in");
  const drawBonus =
    hasFlushDraw(ownCards, view.board) || hasOpenEnder(ownCards, view.board)
      ? 0.12
      : 0;
  const effectiveStrength = Math.min(1, strength.value + drawBonus);

  if ((bet || raise) && effectiveStrength >= profile.postflopBet) {
    const action = buildSizedAction(
      view,
      bet ?? raise,
      Math.round(view.potTotal * (0.48 + profile.aggression * 0.22))
    );
    return {
      action,
      bucket: `${strength.bucket}:value-pressure`,
      pressure,
      reason: `${strength.bucket} 达到价值下注或加注阈值。`
    };
  }

  if (
    (bet || raise) &&
    roll < (profile.aggression - 0.4) * 0.24 &&
    effectiveStrength >= 0.34
  ) {
    const action = buildSizedAction(
      view,
      bet ?? raise,
      Math.round(view.potTotal / 2)
    );
    return {
      action,
      bucket: `${strength.bucket}:semi-bluff`,
      pressure,
      reason: `${view.style} 使用中等牌力或听牌半诈唬。`
    };
  }

  if (check) {
    return {
      action: { seatIndex: view.seatIndex, type: "check" },
      bucket: `${strength.bucket}:check`,
      pressure,
      reason: "无下注压力，保留摊牌权益。"
    };
  }

  if (
    call &&
    effectiveStrength + potOddsAllowance(view) >=
      profile.continuePressure + pressure * 0.22
  ) {
    return {
      action: { seatIndex: view.seatIndex, type: "call", amount: call.amount },
      bucket: `${strength.bucket}:call`,
      pressure,
      reason: `${strength.bucket} 结合底池赔率选择继续。`
    };
  }

  if (allIn && effectiveStrength > 0.9 && roll < profile.aggression * 0.16) {
    return {
      action: {
        seatIndex: view.seatIndex,
        type: "all-in",
        amount: allIn.amount
      },
      bucket: `${strength.bucket}:jam`,
      pressure,
      reason: `${strength.bucket} 强牌偶发全下。`
    };
  }

  return {
    action: fold
      ? { seatIndex: view.seatIndex, type: "fold" }
      : fallbackAction(view),
    bucket: `${strength.bucket}:fold`,
    pressure,
    reason: `${strength.bucket} 面对当前压力不足以继续。`
  };
}

function scoreStartingHand(startingHand: string): number {
  if (startingHand.length === 2) {
    const rank = startingHand[0];
    const pairScore: Record<string, number> = {
      A: 100,
      K: 96,
      Q: 91,
      J: 85,
      T: 78,
      "9": 68,
      "8": 60,
      "7": 52,
      "6": 46,
      "5": 43,
      "4": 40,
      "3": 38,
      "2": 36
    };
    return pairScore[rank] ?? 34;
  }

  const highRank = startingHand[0];
  const lowRank = startingHand[1];
  const suited = startingHand.endsWith("s");
  const high = rankScore(highRank);
  const low = rankScore(lowRank);
  const connected = Math.abs(rankIndex(highRank) - rankIndex(lowRank)) <= 1;
  const broadway = highRank.match(/[AKQJT]/) && lowRank.match(/[AKQJT]/);

  return (
    high +
    low * 0.64 +
    (suited ? 7 : 0) +
    (connected ? 5 : 0) +
    (broadway ? 7 : 0)
  );
}

function scorePostflopHand(
  cards: [CardCode, CardCode],
  board: CardCode[]
): {
  bucket: string;
  value: number;
} {
  if (board.length < 3) {
    return { bucket: "no-board", value: 0.28 };
  }

  const evaluated = evalHand([...cards, ...board]);
  const name = String(evaluated.handName).toLowerCase();

  if (name.includes("straight flush") || name.includes("royal")) {
    return { bucket: "straight-flush", value: 1 };
  }
  if (name.includes("four")) {
    return { bucket: "quads", value: 0.98 };
  }
  if (name.includes("full")) {
    return { bucket: "full-house", value: 0.94 };
  }
  if (name.includes("flush")) {
    return { bucket: "flush", value: 0.88 };
  }
  if (name.includes("straight")) {
    return { bucket: "straight", value: 0.82 };
  }
  if (name.includes("three")) {
    return { bucket: "trips", value: 0.72 };
  }
  if (name.includes("two pair")) {
    return { bucket: "two-pair", value: 0.64 };
  }
  if (name.includes("pair")) {
    return { bucket: "pair", value: 0.46 };
  }

  return { bucket: "high-card", value: 0.24 };
}

function buildSizedAction(
  view: BotSeatStrategyView,
  action: LegalAction | undefined,
  targetAmount: number
): PlayerAction {
  if (!action) {
    return fallbackAction(view);
  }

  if (action.type === "all-in") {
    return { seatIndex: view.seatIndex, type: "all-in", amount: action.amount };
  }

  if (action.type !== "bet" && action.type !== "raise") {
    return {
      seatIndex: view.seatIndex,
      type: action.type,
      amount: action.amount
    };
  }

  const min = action.minAmount ?? action.amount ?? 0;
  const max = action.maxAmount ?? action.amount ?? min;

  return {
    seatIndex: view.seatIndex,
    type: action.type,
    amount: Math.min(max, Math.max(min, Math.round(targetAmount)))
  };
}

function preflopRaiseTo(view: BotSeatStrategyView): number {
  const raiseCount = visiblePreflopRaiseCount(view);
  const baseTotal =
    raiseCount === 0 ? view.bigBlind * 2.5 : view.currentBet * 3;
  const seat = view.seats[view.seatIndex];
  const committed = seat?.streetCommitment ?? 0;

  return Math.max(0, Math.round(baseTotal - committed));
}

function fallbackAction(view: BotSeatStrategyView): PlayerAction {
  const check = findAction(view, "check");
  if (check) {
    return { seatIndex: view.seatIndex, type: "check" };
  }

  const call = findAction(view, "call");
  if (call) {
    return { seatIndex: view.seatIndex, type: "call", amount: call.amount };
  }

  const fold = findAction(view, "fold");
  if (fold) {
    return { seatIndex: view.seatIndex, type: "fold" };
  }

  const allIn = findAction(view, "all-in");
  if (allIn) {
    return { seatIndex: view.seatIndex, type: "all-in", amount: allIn.amount };
  }

  throw new Error("Bot strategy received no usable legal action.");
}

function findAction(
  view: BotSeatStrategyView,
  type: ActionType
): LegalAction | undefined {
  return view.legalActions.find((action) => action.type === type);
}

function currentPressure(view: BotSeatStrategyView): number {
  const seat = view.seats[view.seatIndex];
  if (!seat) {
    return 1;
  }

  const toCall = Math.max(0, view.currentBet - seat.streetCommitment);
  const denominator = Math.max(1, view.potTotal + toCall);

  return Math.min(1, toCall / denominator);
}

function potOddsAllowance(view: BotSeatStrategyView): number {
  const pressure = currentPressure(view);

  return pressure <= 0 ? 0.12 : Math.max(0, 0.18 - pressure);
}

function visiblePreflopRaiseCount(view: BotSeatStrategyView): number {
  return view.visibleActionHistory.filter(
    (event) => event.action === "raise" || event.action === "all-in"
  ).length;
}

function hasFlushDraw(cards: [CardCode, CardCode], board: CardCode[]): boolean {
  if (board.length < 3 || board.length >= 5) {
    return false;
  }

  const suitCounts = [...cards, ...board].reduce<Record<string, number>>(
    (counts, card) => {
      const suit = card[1];
      counts[suit] = (counts[suit] ?? 0) + 1;
      return counts;
    },
    {}
  );

  return Object.values(suitCounts).some((count) => count === 4);
}

function hasOpenEnder(cards: [CardCode, CardCode], board: CardCode[]): boolean {
  if (board.length < 3 || board.length >= 5) {
    return false;
  }

  const indexes = Array.from(
    new Set([...cards, ...board].map((card) => rankIndex(card[0])))
  ).sort((left, right) => left - right);

  return indexes.some((index) =>
    [index, index + 1, index + 2, index + 3].every((candidate) =>
      indexes.includes(candidate)
    )
  );
}

function rankScore(rank: string): number {
  return (rankIndex(rank) + 2) * 3.1;
}

function rankIndex(rank: string): number {
  return "23456789TJQKA".indexOf(rank);
}

function buildDecisionSeed(view: BotSeatStrategyView): string {
  const lastActionSequence = view.visibleActionHistory.at(-1)?.sequence ?? 0;

  return [
    view.tableId,
    view.handId,
    view.seatIndex,
    view.street,
    lastActionSequence,
    view.currentBet
  ].join(":");
}

function seededRatio(seed: string): number {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0) / 2 ** 32;
}
