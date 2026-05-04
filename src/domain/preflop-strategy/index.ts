import type { CardCode, LegalAction, PlayerAction } from "@/domain/poker";

export type HeroPreflopStrategyMode = "off" | "suggest" | "auto";

export type HeroPreflopPosition =
  | "button"
  | "small_blind"
  | "big_blind"
  | "other";

export type PreflopFacing =
  | "unopened"
  | "limped"
  | "single_raise"
  | "three_bet_or_more"
  | "any";

export type StartingHandClass =
  | "pair"
  | "suited"
  | "offsuit"
  | "broadway"
  | "suited_ace"
  | "small_pair";

export type StartingHandNotation = string;

export type PreflopStrategyAtomicAction = {
  kind: "fold" | "call" | "open_raise" | "three_bet" | "four_bet" | "jam";
  raiseToBb?: number;
  label?: string;
};

export type PreflopStrategyDecision =
  | PreflopStrategyAtomicAction
  | {
      kind: "mix";
      label?: string;
      options: Array<{
        weight: number;
        action: PreflopStrategyAtomicAction;
      }>;
    };

export type PreflopStrategyRule = {
  id: string;
  label: string;
  enabled?: boolean;
  positions?: HeroPreflopPosition[];
  facing?: PreflopFacing;
  tableSizes?: number[];
  effectiveStackBb?: {
    min?: number;
    max?: number;
  };
  handClasses?: StartingHandClass[];
  matrix?: Record<StartingHandNotation, boolean>;
  action: PreflopStrategyDecision;
};

export type PreflopStrategyConfig = {
  id: string;
  name: string;
  version: string;
  mode: HeroPreflopStrategyMode;
  rules: PreflopStrategyRule[];
  defaultAction?: PreflopStrategyAtomicAction | null;
};

export type PreflopStrategyContext = {
  handId: string;
  decisionPointId: string;
  heroSeatIndex: number;
  heroHoleCards: [CardCode, CardCode];
  position: HeroPreflopPosition;
  effectiveStackBb: number;
  facing: PreflopFacing;
  previousRaiseSizeBb: number | null;
  hasStraddle: boolean;
  tableSize: number;
  legalActions: LegalAction[];
  bigBlind: number;
  streetCommitment: number;
};

export type PreflopStrategyEvaluation =
  | {
      status: "matched";
      strategyId: string;
      strategyVersion: string;
      ruleId: string;
      ruleLabel: string;
      startingHand: StartingHandNotation;
      context: PreflopStrategyContext;
      decision: PreflopStrategyAtomicAction;
      mixedFrom: PreflopStrategyDecision | null;
      mixRoll: number | null;
      action: PlayerAction;
      summary: string;
    }
  | {
      status: "skipped";
      strategyId: string;
      strategyVersion: string;
      startingHand: StartingHandNotation;
      context: PreflopStrategyContext;
      reason: string;
      summary: string;
    };

const RANK_ORDER = "23456789TJQKA";

export function classifyStartingHand(
  cards: readonly [CardCode, CardCode]
): StartingHandNotation {
  const [left, right] = cards;
  const leftRank = left[0];
  const rightRank = right[0];
  const suited = left[1] === right[1];

  if (leftRank === rightRank) {
    return `${leftRank}${rightRank}`;
  }

  const ranks = [leftRank, rightRank].sort(
    (a, b) => RANK_ORDER.indexOf(b) - RANK_ORDER.indexOf(a)
  );

  return `${ranks[0]}${ranks[1]}${suited ? "s" : "o"}`;
}

export function evaluatePreflopStrategy(
  config: PreflopStrategyConfig,
  context: PreflopStrategyContext
): PreflopStrategyEvaluation {
  const startingHand = classifyStartingHand(context.heroHoleCards);
  const base = {
    strategyId: config.id,
    strategyVersion: config.version,
    startingHand,
    context
  };

  if (config.mode === "off") {
    return {
      ...base,
      status: "skipped",
      reason: "strategy_off",
      summary: "翻前策略已关闭。"
    };
  }

  const rule = config.rules.find((candidate) =>
    ruleMatches(candidate, context, startingHand)
  );

  if (!rule) {
    const defaultAction = config.defaultAction ?? null;
    if (!defaultAction) {
      return {
        ...base,
        status: "skipped",
        reason: "no_matching_rule",
        summary: `${startingHand} 未命中策略范围。`
      };
    }

    return buildMatchedEvaluation(config, context, startingHand, {
      id: "default",
      label: "默认动作",
      action: defaultAction
    });
  }

  return buildMatchedEvaluation(config, context, startingHand, rule);
}

function buildMatchedEvaluation(
  config: PreflopStrategyConfig,
  context: PreflopStrategyContext,
  startingHand: StartingHandNotation,
  rule: Pick<PreflopStrategyRule, "id" | "label" | "action">
): PreflopStrategyEvaluation {
  const selected = selectAtomicDecision(rule.action, context);
  const mapped = mapDecisionToLegalAction(selected.action, context);
  const base = {
    strategyId: config.id,
    strategyVersion: config.version,
    startingHand,
    context
  };

  if (!mapped.action) {
    return {
      ...base,
      status: "skipped",
      reason: mapped.reason,
      summary: `${rule.label}: ${mapped.reason}`
    };
  }

  return {
    ...base,
    status: "matched",
    ruleId: rule.id,
    ruleLabel: rule.label,
    decision: selected.action,
    mixedFrom: selected.mixedFrom,
    mixRoll: selected.mixRoll,
    action: mapped.action,
    summary: `${startingHand} 命中 ${rule.label}，执行 ${selected.action.kind}`
  };
}

function ruleMatches(
  rule: PreflopStrategyRule,
  context: PreflopStrategyContext,
  startingHand: StartingHandNotation
): boolean {
  if (rule.enabled === false) {
    return false;
  }

  if (rule.positions && !rule.positions.includes(context.position)) {
    return false;
  }

  if (rule.facing && rule.facing !== "any" && rule.facing !== context.facing) {
    return false;
  }

  if (rule.tableSizes && !rule.tableSizes.includes(context.tableSize)) {
    return false;
  }

  if (
    rule.effectiveStackBb?.min !== undefined &&
    context.effectiveStackBb < rule.effectiveStackBb.min
  ) {
    return false;
  }

  if (
    rule.effectiveStackBb?.max !== undefined &&
    context.effectiveStackBb > rule.effectiveStackBb.max
  ) {
    return false;
  }

  const matrixHit = rule.matrix?.[startingHand] === true;
  const classHit = (rule.handClasses ?? []).some((handClass) =>
    startingHandMatchesClass(startingHand, handClass)
  );

  return matrixHit || classHit;
}

function startingHandMatchesClass(
  startingHand: StartingHandNotation,
  handClass: StartingHandClass
): boolean {
  const first = startingHand[0];
  const second = startingHand[1];

  if (handClass === "pair") {
    return first === second;
  }

  if (handClass === "suited") {
    return startingHand.endsWith("s");
  }

  if (handClass === "offsuit") {
    return startingHand.endsWith("o");
  }

  if (handClass === "broadway") {
    return (
      ["A", "K", "Q", "J", "T"].includes(first) &&
      ["A", "K", "Q", "J", "T"].includes(second)
    );
  }

  if (handClass === "suited_ace") {
    return first === "A" && startingHand.endsWith("s");
  }

  return (
    first === second && RANK_ORDER.indexOf(first) <= RANK_ORDER.indexOf("6")
  );
}

function selectAtomicDecision(
  decision: PreflopStrategyDecision,
  context: PreflopStrategyContext
): {
  action: PreflopStrategyAtomicAction;
  mixedFrom: PreflopStrategyDecision | null;
  mixRoll: number | null;
} {
  if (decision.kind !== "mix") {
    return {
      action: decision,
      mixedFrom: null,
      mixRoll: null
    };
  }

  const totalWeight = decision.options.reduce(
    (sum, option) => sum + Math.max(0, option.weight),
    0
  );
  if (totalWeight <= 0) {
    return {
      action: { kind: "fold", label: "无有效混合权重" },
      mixedFrom: decision,
      mixRoll: 0
    };
  }

  const roll =
    deterministicUnitInterval(
      `${context.handId}:${context.decisionPointId}:${JSON.stringify(decision)}`
    ) * totalWeight;
  let cursor = 0;

  for (const option of decision.options) {
    cursor += Math.max(0, option.weight);
    if (roll <= cursor) {
      return {
        action: option.action,
        mixedFrom: decision,
        mixRoll: roll / totalWeight
      };
    }
  }

  return {
    action: decision.options[decision.options.length - 1].action,
    mixedFrom: decision,
    mixRoll: roll / totalWeight
  };
}

function mapDecisionToLegalAction(
  decision: PreflopStrategyAtomicAction,
  context: PreflopStrategyContext
): { action: PlayerAction | null; reason: string } {
  const legal = context.legalActions;
  const actionBase = { seatIndex: context.heroSeatIndex };

  if (decision.kind === "fold") {
    const fold = legal.find((candidate) => candidate.type === "fold");
    if (fold) {
      return { action: { ...actionBase, type: "fold" }, reason: "ok" };
    }

    const check = legal.find((candidate) => candidate.type === "check");
    return check
      ? { action: { ...actionBase, type: "check" }, reason: "ok" }
      : { action: null, reason: "fold_not_legal" };
  }

  if (decision.kind === "call") {
    const call = legal.find((candidate) => candidate.type === "call");
    if (call) {
      return {
        action: { ...actionBase, type: "call", amount: call.amount },
        reason: "ok"
      };
    }

    const check = legal.find((candidate) => candidate.type === "check");
    return check
      ? { action: { ...actionBase, type: "check" }, reason: "ok" }
      : { action: null, reason: "call_not_legal" };
  }

  if (decision.kind === "jam") {
    const allIn = legal.find((candidate) => candidate.type === "all-in");
    return allIn
      ? {
          action: { ...actionBase, type: "all-in", amount: allIn.amount },
          reason: "ok"
        }
      : { action: null, reason: "jam_not_legal" };
  }

  const raiseAction =
    legal.find((candidate) => candidate.type === "raise") ??
    legal.find((candidate) => candidate.type === "bet");
  if (!raiseAction) {
    return { action: null, reason: "raise_not_legal" };
  }

  const minAmount = raiseAction.minAmount ?? raiseAction.amount ?? 0;
  const maxAmount = raiseAction.maxAmount ?? raiseAction.amount ?? minAmount;
  let amount = raiseAction.amount ?? minAmount;

  if (decision.raiseToBb !== undefined) {
    const targetTotal = Math.round(decision.raiseToBb * context.bigBlind);
    amount = targetTotal - context.streetCommitment;

    if (amount < minAmount || amount > maxAmount) {
      return {
        action: null,
        reason: "raise_amount_out_of_legal_range"
      };
    }
  }

  return {
    action: {
      ...actionBase,
      type: raiseAction.type,
      amount
    },
    reason: "ok"
  };
}

function deterministicUnitInterval(input: string): number {
  let hash = 2166136261;

  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0) / 0xffffffff;
}
