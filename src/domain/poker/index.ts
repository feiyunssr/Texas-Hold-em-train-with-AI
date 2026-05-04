import { evalHand } from "poker-evaluator";

export type Suit = "c" | "d" | "h" | "s";
export type Rank =
  | "2"
  | "3"
  | "4"
  | "5"
  | "6"
  | "7"
  | "8"
  | "9"
  | "T"
  | "J"
  | "Q"
  | "K"
  | "A";
export type CardCode = `${Rank}${Suit}`;
export type Street = "preflop" | "flop" | "turn" | "river" | "complete";
export type SeatStatus = "active" | "folded" | "all-in";
export type ActionType = "fold" | "check" | "call" | "bet" | "raise" | "all-in";
export type CompletionReason = "fold" | "showdown";

export type PokerEngineHealth = {
  module: "domain/poker";
  isolated: true;
};

export type HandConfig = {
  playerCount: number;
  startingStack: number;
  smallBlind: number;
  bigBlind: number;
  ante?: number;
  buttonSeat?: number;
  straddleSeat?: number;
  straddleAmount?: number;
  startingStacks?: number[];
  deck?: CardCode[];
};

export type SeatState = {
  seatIndex: number;
  playerId: string;
  stack: number;
  holeCards: CardCode[];
  status: SeatStatus;
  streetCommitment: number;
  totalCommitment: number;
  actedThisRound: boolean;
  raiseVersionSeen: number;
};

export type Pot = {
  amount: number;
  eligibleSeatIndexes: number[];
};

export type LegalAction = {
  type: ActionType;
  amount?: number;
  minAmount?: number;
  maxAmount?: number;
  toCall?: number;
  totalBetTo?: number;
};

export type PlayerAction = {
  seatIndex: number;
  type: ActionType;
  amount?: number;
};

export type ShowdownResult = {
  seatIndex: number;
  handName: string;
  value: number;
};

export type PotAward = {
  potAmount: number;
  winnerSeatIndexes: number[];
  share: number;
  oddChips: number;
};

export type HandEvent =
  | {
      sequence: number;
      type: "hand_started";
      payload: {
        playerCount: number;
        buttonSeat: number;
        smallBlindSeat: number;
        bigBlindSeat: number;
        startingStacks: number[];
      };
    }
  | {
      sequence: number;
      type: "forced_bet_posted";
      payload: {
        seatIndex: number;
        kind: "ante" | "small_blind" | "big_blind" | "straddle";
        amount: number;
      };
    }
  | {
      sequence: number;
      type: "hole_cards_dealt";
      payload: {
        seatIndex: number;
        cards: CardCode[];
      };
    }
  | {
      sequence: number;
      type: "player_action";
      payload: {
        seatIndex: number;
        action: ActionType;
        amount: number;
        totalBetTo: number;
      };
    }
  | {
      sequence: number;
      type: "street_advanced";
      payload: {
        street: Street;
      };
    }
  | {
      sequence: number;
      type: "board_dealt";
      payload: {
        street: Exclude<Street, "preflop" | "complete">;
        cards: CardCode[];
        board: CardCode[];
      };
    }
  | {
      sequence: number;
      type: "showdown_evaluated";
      payload: {
        results: ShowdownResult[];
      };
    }
  | {
      sequence: number;
      type: "pot_awarded";
      payload: PotAward;
    }
  | {
      sequence: number;
      type: "hand_completed";
      payload: {
        reason: CompletionReason;
        finalStacks: number[];
      };
    };

export type HandState = {
  config: Required<
    Pick<
      HandConfig,
      "playerCount" | "startingStack" | "smallBlind" | "bigBlind"
    >
  > &
    Pick<HandConfig, "ante" | "straddleSeat" | "straddleAmount">;
  buttonSeat: number;
  smallBlindSeat: number;
  bigBlindSeat: number;
  street: Street;
  seats: SeatState[];
  deck: CardCode[];
  board: CardCode[];
  currentActorSeat: number | null;
  currentBet: number;
  lastFullRaiseAmount: number;
  raiseVersion: number;
  events: HandEvent[];
  nextSequence: number;
  completionReason?: CompletionReason;
  pots: Pot[];
  showdownResults: ShowdownResult[];
  awards: PotAward[];
};

const RANKS: Rank[] = [
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "T",
  "J",
  "Q",
  "K",
  "A"
];
const SUITS: Suit[] = ["c", "d", "h", "s"];

export function getPokerEngineHealth(): PokerEngineHealth {
  return {
    module: "domain/poker",
    isolated: true
  };
}

export function createHand(
  config: HandConfig,
  seed: string | number
): HandState {
  validateConfig(config);

  const buttonSeat = config.buttonSeat ?? 0;
  const smallBlindSeat = nextSeatIndex(buttonSeat, config.playerCount);
  const bigBlindSeat = nextSeatIndex(smallBlindSeat, config.playerCount);
  const startingStacks =
    config.startingStacks ??
    Array(config.playerCount).fill(config.startingStack);
  const deck = buildDeck(config.deck, seed);
  const seats = startingStacks.map((stack, seatIndex): SeatState => {
    if (!Number.isInteger(stack) || stack <= 0) {
      throw new Error(
        "All starting stacks must be positive integer chip amounts."
      );
    }

    return {
      seatIndex,
      playerId: `seat-${seatIndex + 1}`,
      stack,
      holeCards: [],
      status: "active",
      streetCommitment: 0,
      totalCommitment: 0,
      actedThisRound: false,
      raiseVersionSeen: 0
    };
  });

  let state: HandState = {
    config: {
      playerCount: config.playerCount,
      startingStack: config.startingStack,
      smallBlind: config.smallBlind,
      bigBlind: config.bigBlind,
      ante: config.ante ?? 0,
      straddleSeat: config.straddleSeat,
      straddleAmount: config.straddleAmount
    },
    buttonSeat,
    smallBlindSeat,
    bigBlindSeat,
    street: "preflop",
    seats,
    deck,
    board: [],
    currentActorSeat: null,
    currentBet: 0,
    lastFullRaiseAmount: config.bigBlind,
    raiseVersion: 0,
    events: [],
    nextSequence: 1,
    pots: [],
    showdownResults: [],
    awards: []
  };

  state = appendEvent(state, {
    type: "hand_started",
    payload: {
      playerCount: config.playerCount,
      buttonSeat,
      smallBlindSeat,
      bigBlindSeat,
      startingStacks
    }
  });

  for (const seat of state.seats) {
    if ((config.ante ?? 0) > 0) {
      state = postForcedBet(state, seat.seatIndex, "ante", config.ante ?? 0);
    }
  }

  state = postForcedBet(
    state,
    smallBlindSeat,
    "small_blind",
    config.smallBlind
  );
  state = postForcedBet(state, bigBlindSeat, "big_blind", config.bigBlind);

  if (config.straddleSeat !== undefined && (config.straddleAmount ?? 0) > 0) {
    state = postForcedBet(
      state,
      config.straddleSeat,
      "straddle",
      config.straddleAmount ?? 0
    );
  }

  state = dealHoleCards(state);
  state = {
    ...state,
    currentBet: Math.max(...state.seats.map((seat) => seat.streetCommitment)),
    lastFullRaiseAmount: Math.max(
      config.bigBlind,
      Math.max(...state.seats.map((seat) => seat.streetCommitment))
    ),
    raiseVersion: 1
  };

  const firstActorReference = config.straddleSeat ?? bigBlindSeat;
  return {
    ...state,
    currentActorSeat: findNextActionSeat(state, firstActorReference)
  };
}

export function getLegalActions(state: HandState): LegalAction[] {
  if (state.street === "complete" || state.currentActorSeat === null) {
    return [];
  }

  const seat = state.seats[state.currentActorSeat];
  if (seat.status !== "active" || seat.stack <= 0) {
    return [];
  }

  const toCall = Math.max(0, state.currentBet - seat.streetCommitment);
  const legalActions: LegalAction[] = [];

  if (toCall > 0) {
    legalActions.push({ type: "fold" });
    legalActions.push({
      type: "call",
      amount: Math.min(toCall, seat.stack),
      toCall
    });
  } else {
    legalActions.push({ type: "check", amount: 0 });
  }

  const allInTo = seat.streetCommitment + seat.stack;
  const hasOpenBet = state.currentBet > 0;
  const canRaise =
    !seat.actedThisRound || seat.raiseVersionSeen < state.raiseVersion;
  const minimumTotalBet = hasOpenBet
    ? state.currentBet + state.lastFullRaiseAmount
    : state.config.bigBlind;

  if (seat.stack > 0) {
    if (hasOpenBet && canRaise && allInTo >= minimumTotalBet) {
      legalActions.push({
        type: "raise",
        amount: minimumTotalBet - seat.streetCommitment,
        minAmount: minimumTotalBet - seat.streetCommitment,
        maxAmount: seat.stack,
        totalBetTo: minimumTotalBet
      });
    }

    if (!hasOpenBet && canRaise && allInTo >= minimumTotalBet) {
      legalActions.push({
        type: "bet",
        amount: minimumTotalBet,
        minAmount: minimumTotalBet,
        maxAmount: seat.stack,
        totalBetTo: minimumTotalBet
      });
    }

    if (canRaise || seat.stack <= toCall) {
      legalActions.push({
        type: "all-in",
        amount: seat.stack,
        totalBetTo: allInTo
      });
    }
  }

  return legalActions;
}

export function applyAction(state: HandState, action: PlayerAction): HandState {
  if (state.street === "complete") {
    throw new Error("Cannot apply an action to a completed hand.");
  }
  if (state.currentActorSeat !== action.seatIndex) {
    throw new Error(`Seat ${action.seatIndex} is not the current actor.`);
  }

  const legalAction = resolveLegalAction(state, action);
  const seat = state.seats[action.seatIndex];
  const nextSeats = cloneSeats(state.seats);
  let amount = legalAction.amount ?? 0;
  let totalBetTo = seat.streetCommitment;
  let currentBet = state.currentBet;
  let lastFullRaiseAmount = state.lastFullRaiseAmount;
  let raiseVersion = state.raiseVersion;

  if (action.type === "fold") {
    nextSeats[action.seatIndex] = {
      ...nextSeats[action.seatIndex],
      status: "folded",
      actedThisRound: true,
      raiseVersionSeen: raiseVersion
    };
  } else if (action.type === "check") {
    nextSeats[action.seatIndex] = {
      ...nextSeats[action.seatIndex],
      actedThisRound: true,
      raiseVersionSeen: raiseVersion
    };
  } else {
    amount = normalizeActionAmount(state, action, legalAction);
    const nextSeat = commitChips(nextSeats[action.seatIndex], amount);
    totalBetTo = nextSeat.streetCommitment;

    if (totalBetTo > currentBet) {
      const raiseAmount = totalBetTo - currentBet;
      currentBet = totalBetTo;
      if (raiseAmount >= state.lastFullRaiseAmount) {
        lastFullRaiseAmount = raiseAmount;
        raiseVersion += 1;
      }
    }

    nextSeats[action.seatIndex] = {
      ...nextSeat,
      actedThisRound: true,
      raiseVersionSeen: raiseVersion
    };
  }

  const nextState = appendEvent(
    {
      ...state,
      seats: nextSeats,
      currentBet,
      lastFullRaiseAmount,
      raiseVersion,
      currentActorSeat: null
    },
    {
      type: "player_action",
      payload: {
        seatIndex: action.seatIndex,
        action: action.type,
        amount,
        totalBetTo
      }
    }
  );

  return settleState(nextState, action.seatIndex);
}

export function playUntilTerminal(
  state: HandState,
  chooseAction: (state: HandState, legalActions: LegalAction[]) => PlayerAction
): HandState {
  let nextState = state;
  let guard = 0;

  while (nextState.street !== "complete") {
    if (guard++ > 500) {
      throw new Error("playUntilTerminal exceeded the action guard.");
    }

    const legalActions = getLegalActions(nextState);
    if (nextState.currentActorSeat === null || legalActions.length === 0) {
      throw new Error("Hand is not complete but has no legal actor.");
    }
    nextState = applyAction(nextState, chooseAction(nextState, legalActions));
  }

  return nextState;
}

export function buildPots(seats: SeatState[]): Pot[] {
  const contributionLevels = Array.from(
    new Set(
      seats
        .map((seat) => seat.totalCommitment)
        .filter((commitment) => commitment > 0)
    )
  ).sort((left, right) => left - right);

  const pots: Pot[] = [];
  let previousLevel = 0;

  for (const level of contributionLevels) {
    const contributors = seats.filter((seat) => seat.totalCommitment >= level);
    const amount = (level - previousLevel) * contributors.length;
    const eligibleSeatIndexes = contributors
      .filter((seat) => seat.status !== "folded")
      .map((seat) => seat.seatIndex);

    if (amount > 0 && eligibleSeatIndexes.length > 0) {
      pots.push({ amount, eligibleSeatIndexes });
    }

    previousLevel = level;
  }

  return pots;
}

export function evaluateShowdown(
  seats: SeatState[],
  board: CardCode[],
  eligibleSeatIndexes: number[]
): ShowdownResult[] {
  if (board.length !== 5) {
    throw new Error("Showdown requires a complete five-card board.");
  }

  return eligibleSeatIndexes.map((seatIndex) => {
    const seat = seats[seatIndex];
    const evaluated = evalHand([...seat.holeCards, ...board]);

    return {
      seatIndex,
      handName: evaluated.handName,
      value: evaluated.value
    };
  });
}

function settleState(state: HandState, previousActorSeat: number): HandState {
  const contenders = state.seats.filter((seat) => seat.status !== "folded");
  if (contenders.length === 1) {
    return completeByFold(state, contenders[0].seatIndex);
  }

  if (shouldRunOutToShowdown(state)) {
    return completeByShowdown(dealRemainingBoard(state));
  }

  if (isBettingRoundComplete(state)) {
    if (state.street === "river") {
      return completeByShowdown(state);
    }

    const advanced = advanceStreet(state);
    if (shouldRunOutToShowdown(advanced)) {
      return completeByShowdown(dealRemainingBoard(advanced));
    }

    return {
      ...advanced,
      currentActorSeat: findNextActionSeat(advanced, advanced.buttonSeat)
    };
  }

  return {
    ...state,
    currentActorSeat: findNextActionSeat(state, previousActorSeat)
  };
}

function shouldRunOutToShowdown(state: HandState): boolean {
  const seatsStillAbleToAct = activeSeats(state);

  return (
    seatsStillAbleToAct.length === 0 ||
    (seatsStillAbleToAct.length === 1 && isBettingRoundComplete(state))
  );
}

function completeByFold(state: HandState, winnerSeatIndex: number): HandState {
  const pots = buildPots(state.seats);
  const totalPot = pots.reduce((sum, pot) => sum + pot.amount, 0);
  const seats = cloneSeats(state.seats);
  seats[winnerSeatIndex] = {
    ...seats[winnerSeatIndex],
    stack: seats[winnerSeatIndex].stack + totalPot
  };

  const award: PotAward = {
    potAmount: totalPot,
    winnerSeatIndexes: [winnerSeatIndex],
    share: totalPot,
    oddChips: 0
  };

  return appendCompletionEvents(
    {
      ...state,
      seats,
      street: "complete",
      currentActorSeat: null,
      pots,
      awards: [award],
      completionReason: "fold"
    },
    [award],
    "fold"
  );
}

function completeByShowdown(state: HandState): HandState {
  const pots = buildPots(state.seats);
  const showdownSeatIndexes = Array.from(
    new Set(pots.flatMap((pot) => pot.eligibleSeatIndexes))
  );
  const showdownResults = evaluateShowdown(
    state.seats,
    state.board,
    showdownSeatIndexes
  );
  let nextState = appendEvent(
    {
      ...state,
      pots,
      showdownResults,
      currentActorSeat: null
    },
    {
      type: "showdown_evaluated",
      payload: {
        results: showdownResults
      }
    }
  );
  const seats = cloneSeats(nextState.seats);
  const awards: PotAward[] = [];

  for (const pot of pots) {
    const eligibleResults = showdownResults.filter((result) =>
      pot.eligibleSeatIndexes.includes(result.seatIndex)
    );
    const bestValue = Math.max(
      ...eligibleResults.map((result) => result.value)
    );
    const winnerSeatIndexes = eligibleResults
      .filter((result) => result.value === bestValue)
      .map((result) => result.seatIndex)
      .sort((left, right) => left - right);
    const share = Math.floor(pot.amount / winnerSeatIndexes.length);
    const oddChips = pot.amount % winnerSeatIndexes.length;

    winnerSeatIndexes.forEach((seatIndex, index) => {
      seats[seatIndex] = {
        ...seats[seatIndex],
        stack: seats[seatIndex].stack + share + (index < oddChips ? 1 : 0)
      };
    });

    awards.push({
      potAmount: pot.amount,
      winnerSeatIndexes,
      share,
      oddChips
    });
  }

  nextState = {
    ...nextState,
    seats,
    street: "complete",
    awards,
    completionReason: "showdown"
  };

  return appendCompletionEvents(nextState, awards, "showdown");
}

function appendCompletionEvents(
  state: HandState,
  awards: PotAward[],
  reason: CompletionReason
): HandState {
  let nextState = state;

  for (const award of awards) {
    nextState = appendEvent(nextState, {
      type: "pot_awarded",
      payload: award
    });
  }

  return appendEvent(nextState, {
    type: "hand_completed",
    payload: {
      reason,
      finalStacks: nextState.seats.map((seat) => seat.stack)
    }
  });
}

function advanceStreet(state: HandState): HandState {
  const nextStreet = nextStreetAfter(state.street);
  let nextState = resetBettingRound({
    ...state,
    street: nextStreet
  });

  nextState = appendEvent(nextState, {
    type: "street_advanced",
    payload: {
      street: nextStreet
    }
  });

  if (
    nextStreet === "flop" ||
    nextStreet === "turn" ||
    nextStreet === "river"
  ) {
    nextState = dealBoardForStreet(nextState, nextStreet);
  }

  return nextState;
}

function dealRemainingBoard(state: HandState): HandState {
  let nextState = state;

  while (nextState.board.length < 5) {
    const targetStreet: Exclude<Street, "preflop" | "complete"> =
      nextState.board.length < 3
        ? "flop"
        : nextState.board.length === 3
          ? "turn"
          : "river";

    nextState = {
      ...nextState,
      street: targetStreet
    };
    nextState = appendEvent(nextState, {
      type: "street_advanced",
      payload: {
        street: targetStreet
      }
    });
    nextState = dealBoardForStreet(nextState, targetStreet);
  }

  return nextState;
}

function dealBoardForStreet(
  state: HandState,
  street: Exclude<Street, "preflop" | "complete">
): HandState {
  const cardsToDeal = street === "flop" ? 3 : 1;
  const cards = state.deck.slice(0, cardsToDeal);
  const board = [...state.board, ...cards];

  if (cards.length !== cardsToDeal) {
    throw new Error("Deck exhausted while dealing the board.");
  }

  return appendEvent(
    {
      ...state,
      deck: state.deck.slice(cardsToDeal),
      board
    },
    {
      type: "board_dealt",
      payload: {
        street,
        cards,
        board
      }
    }
  );
}

function resetBettingRound(state: HandState): HandState {
  return {
    ...state,
    currentBet: 0,
    lastFullRaiseAmount: state.config.bigBlind,
    raiseVersion: 0,
    currentActorSeat: null,
    seats: state.seats.map((seat) => ({
      ...seat,
      streetCommitment: 0,
      actedThisRound: seat.status !== "active",
      raiseVersionSeen: 0
    }))
  };
}

function isBettingRoundComplete(state: HandState): boolean {
  const seatsNeedingAction = activeSeats(state).filter(
    (seat) => !seat.actedThisRound || seat.streetCommitment < state.currentBet
  );

  return seatsNeedingAction.length === 0;
}

function activeSeats(state: HandState): SeatState[] {
  return state.seats.filter((seat) => seat.status === "active");
}

function resolveLegalAction(
  state: HandState,
  action: PlayerAction
): LegalAction {
  const legalActions = getLegalActions(state);
  const legalAction = legalActions.find(
    (candidate) => candidate.type === action.type
  );

  if (!legalAction) {
    throw new Error(
      `Action ${action.type} is not legal for seat ${action.seatIndex}.`
    );
  }

  return legalAction;
}

function normalizeActionAmount(
  state: HandState,
  action: PlayerAction,
  legalAction: LegalAction
): number {
  const seat = state.seats[action.seatIndex];
  const requestedAmount = action.amount ?? legalAction.amount ?? 0;

  if (!Number.isInteger(requestedAmount) || requestedAmount < 0) {
    throw new Error("Action amount must be a non-negative integer.");
  }
  if (requestedAmount > seat.stack) {
    throw new Error("Action amount exceeds the acting seat stack.");
  }

  if (action.type === "call") {
    const callAmount = legalAction.amount ?? 0;
    if (requestedAmount !== callAmount) {
      throw new Error(`Call amount must be ${callAmount}.`);
    }
  }

  if (action.type === "bet" || action.type === "raise") {
    const minAmount = legalAction.minAmount ?? legalAction.amount ?? 0;
    const maxAmount = legalAction.maxAmount ?? seat.stack;
    if (requestedAmount < minAmount || requestedAmount > maxAmount) {
      throw new Error(
        `${action.type} amount must be between ${minAmount} and ${maxAmount}.`
      );
    }
  }

  if (action.type === "all-in" && requestedAmount !== seat.stack) {
    throw new Error(`All-in amount must be the full stack of ${seat.stack}.`);
  }

  return requestedAmount;
}

function commitChips(seat: SeatState, amount: number): SeatState {
  const nextStack = seat.stack - amount;

  return {
    ...seat,
    stack: nextStack,
    streetCommitment: seat.streetCommitment + amount,
    totalCommitment: seat.totalCommitment + amount,
    status: nextStack === 0 ? "all-in" : seat.status
  };
}

function postForcedBet(
  state: HandState,
  seatIndex: number,
  kind: "ante" | "small_blind" | "big_blind" | "straddle",
  requestedAmount: number
): HandState {
  if (!Number.isInteger(requestedAmount) || requestedAmount < 0) {
    throw new Error(`${kind} must be a non-negative integer chip amount.`);
  }

  const seats = cloneSeats(state.seats);
  const amount = Math.min(requestedAmount, seats[seatIndex].stack);
  seats[seatIndex] = commitChips(seats[seatIndex], amount);

  return appendEvent(
    {
      ...state,
      seats
    },
    {
      type: "forced_bet_posted",
      payload: {
        seatIndex,
        kind,
        amount
      }
    }
  );
}

function dealHoleCards(state: HandState): HandState {
  let nextState = state;
  const seats = cloneSeats(state.seats);
  const dealOrder = orderedSeatIndexesFrom(
    nextSeatIndex(state.buttonSeat, state.seats.length),
    state.seats.length
  );
  let deck = state.deck;

  for (let round = 0; round < 2; round += 1) {
    for (const seatIndex of dealOrder) {
      const card = deck[0];
      if (!card) {
        throw new Error("Deck exhausted while dealing hole cards.");
      }
      seats[seatIndex] = {
        ...seats[seatIndex],
        holeCards: [...seats[seatIndex].holeCards, card]
      };
      deck = deck.slice(1);
    }
  }

  nextState = {
    ...nextState,
    seats,
    deck
  };

  for (const seat of seats) {
    nextState = appendEvent(nextState, {
      type: "hole_cards_dealt",
      payload: {
        seatIndex: seat.seatIndex,
        cards: seat.holeCards
      }
    });
  }

  return nextState;
}

function appendEvent(
  state: HandState,
  event: Omit<HandEvent, "sequence">
): HandState {
  return {
    ...state,
    events: [
      ...state.events,
      {
        sequence: state.nextSequence,
        ...event
      } as HandEvent
    ],
    nextSequence: state.nextSequence + 1
  };
}

function findNextActionSeat(
  state: HandState,
  afterSeatIndex: number
): number | null {
  for (let offset = 1; offset <= state.seats.length; offset += 1) {
    const seatIndex = (afterSeatIndex + offset) % state.seats.length;
    const seat = state.seats[seatIndex];
    if (
      seat.status === "active" &&
      (!seat.actedThisRound || seat.streetCommitment < state.currentBet)
    ) {
      return seatIndex;
    }
  }

  return null;
}

function nextStreetAfter(street: Street): Street {
  if (street === "preflop") {
    return "flop";
  }
  if (street === "flop") {
    return "turn";
  }
  if (street === "turn") {
    return "river";
  }

  return "complete";
}

function nextSeatIndex(seatIndex: number, playerCount: number): number {
  return (seatIndex + 1) % playerCount;
}

function orderedSeatIndexesFrom(
  startSeatIndex: number,
  playerCount: number
): number[] {
  return Array.from(
    { length: playerCount },
    (_, offset) => (startSeatIndex + offset) % playerCount
  );
}

function buildDeck(
  preferredDeck: CardCode[] | undefined,
  seed: string | number
): CardCode[] {
  const fullDeck = createOrderedDeck();

  if (!preferredDeck) {
    return shuffle(fullDeck, seed);
  }

  const preferredCards = [...preferredDeck];
  const duplicate = preferredCards.find(
    (card, index) => preferredCards.indexOf(card) !== index
  );
  if (duplicate) {
    throw new Error(`Deck contains duplicate card ${duplicate}.`);
  }

  const preferredSet = new Set(preferredCards);
  const remainder = shuffle(
    fullDeck.filter((card) => !preferredSet.has(card)),
    seed
  );

  return [...preferredCards, ...remainder];
}

function createOrderedDeck(): CardCode[] {
  return SUITS.flatMap((suit) =>
    RANKS.map((rank) => `${rank}${suit}` as CardCode)
  );
}

function shuffle(cards: CardCode[], seed: string | number): CardCode[] {
  const shuffled = [...cards];
  const random = createSeededRandom(seed);

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [
      shuffled[swapIndex],
      shuffled[index]
    ];
  }

  return shuffled;
}

function createSeededRandom(seed: string | number): () => number {
  let state =
    typeof seed === "number"
      ? seed >>> 0
      : [...seed].reduce((hash, char) => {
          return Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
        }, 2166136261);

  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

function cloneSeats(seats: SeatState[]): SeatState[] {
  return seats.map((seat) => ({
    ...seat,
    holeCards: [...seat.holeCards]
  }));
}

function validateConfig(config: HandConfig): void {
  if (
    !Number.isInteger(config.playerCount) ||
    config.playerCount < 4 ||
    config.playerCount > 12
  ) {
    throw new Error("NLHE cash tables must have 4-12 players.");
  }
  if (!Number.isInteger(config.startingStack) || config.startingStack <= 0) {
    throw new Error("startingStack must be a positive integer chip amount.");
  }
  if (!Number.isInteger(config.smallBlind) || config.smallBlind <= 0) {
    throw new Error("smallBlind must be a positive integer chip amount.");
  }
  if (
    !Number.isInteger(config.bigBlind) ||
    config.bigBlind <= config.smallBlind
  ) {
    throw new Error("bigBlind must be greater than smallBlind.");
  }
  if (
    config.buttonSeat !== undefined &&
    (!Number.isInteger(config.buttonSeat) ||
      config.buttonSeat < 0 ||
      config.buttonSeat >= config.playerCount)
  ) {
    throw new Error("buttonSeat must reference an occupied seat.");
  }
  if (
    config.startingStacks !== undefined &&
    config.startingStacks.length !== config.playerCount
  ) {
    throw new Error("startingStacks must match playerCount.");
  }
  if (
    config.straddleSeat !== undefined &&
    (!Number.isInteger(config.straddleSeat) ||
      config.straddleSeat < 0 ||
      config.straddleSeat >= config.playerCount)
  ) {
    throw new Error("straddleSeat must reference an occupied seat.");
  }
}
