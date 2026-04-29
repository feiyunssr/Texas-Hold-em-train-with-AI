import { randomBytes } from "node:crypto";

import {
  applyAction,
  createHand,
  getLegalActions,
  type HandConfig,
  type HandEvent,
  type HandState,
  type PlayerAction
} from "@/domain/poker";

import type {
  BeginHeroCoachRequestResult,
  BotSeatView,
  BotStyle,
  HandReviewTimelineEvent,
  HandReviewView,
  HeroCoachView,
  PublicHandState,
  RuntimePublicEvent,
  RuntimeSeatProfile,
  SubmitUserActionInput,
  TrainingRuntimeEvent,
  TrainingTableConfig,
  TrainingTableCreateInput,
  TrainingTableSnapshot,
  TrainingTableStatus
} from "./types";

export class TrainingRuntimeError extends Error {
  constructor(
    readonly code:
      | "invalid_config"
      | "table_not_found"
      | "not_waiting_for_user"
      | "decision_point_locked"
      | "illegal_action"
      | "hand_not_complete",
    message: string
  ) {
    super(message);
    this.name = "TrainingRuntimeError";
  }
}

type RuntimeSession = {
  tableId: string;
  handId: string;
  handNumber: number;
  config: TrainingTableConfig;
  seatProfiles: RuntimeSeatProfile[];
  hand: HandState;
  status: TrainingTableStatus;
  seedBase: string;
  publicEvents: RuntimePublicEvent[];
  heroCoachRequests: Map<string, "requesting" | "completed">;
  nextRuntimeSequence: number;
  createdAt: Date;
  updatedAt: Date;
};

type Subscriber = (
  event: RuntimePublicEvent,
  snapshot: TrainingTableSnapshot
) => void;

const DEFAULT_BOT_STYLES: BotStyle[] = [
  "balanced",
  "tight",
  "loose",
  "aggressive"
];

export class TrainingTableRuntime {
  private readonly sessions = new Map<string, RuntimeSession>();
  private readonly subscribers = new Map<string, Set<Subscriber>>();

  createTable(input: TrainingTableCreateInput): TrainingRuntimeEvent {
    const config = normalizeCreateInput(input);
    const tableId = this.createTableId();
    const seedBase = input.seed ?? tableId;
    const seatProfiles = createSeatProfiles(config);
    const hand = createRuntimeHand(config, seedBase, 1);
    const now = new Date();
    let session: RuntimeSession = {
      tableId,
      handId: createRuntimeId(`${tableId}-hand`, 1),
      handNumber: 1,
      config,
      seatProfiles,
      hand,
      status: "bot_acting",
      seedBase,
      publicEvents: [],
      heroCoachRequests: new Map(),
      nextRuntimeSequence: 1,
      createdAt: now,
      updatedAt: now
    };

    session = appendRuntimeEvent(session, "table_created", {
      tableId,
      playerCount: config.playerCount,
      heroSeatIndex: config.heroSeatIndex
    });
    session = appendRuntimeEvent(session, "hand_started", {
      handId: session.handId,
      handNumber: session.handNumber,
      buttonSeat: hand.buttonSeat,
      smallBlindSeat: hand.smallBlindSeat,
      bigBlindSeat: hand.bigBlindSeat
    });
    session = appendNewHandEvents(session, []);
    session = this.advanceBots(session);
    this.sessions.set(tableId, session);

    const snapshot = buildTableSnapshot(session);
    const event = session.publicEvents[session.publicEvents.length - 1];
    this.publish(session, event, snapshot);

    return {
      type: "created",
      snapshot,
      event
    };
  }

  getTableSnapshot(tableId: string): TrainingTableSnapshot {
    return buildTableSnapshot(this.requireSession(tableId));
  }

  getPublicEvents(tableId: string, afterSequence = 0): RuntimePublicEvent[] {
    return this.requireSession(tableId).publicEvents.filter(
      (event) => event.sequence > afterSequence
    );
  }

  getBotSeatView(tableId: string, seatIndex: number): BotSeatView {
    const session = this.requireSession(tableId);
    const profile = session.seatProfiles[seatIndex];

    if (!profile || profile.isHero) {
      throw new TrainingRuntimeError(
        "invalid_config",
        "Bot seat view can only be built for an AI opponent seat."
      );
    }

    return buildBotSeatView(session, seatIndex);
  }

  getHeroCoachView(tableId: string): HeroCoachView {
    const session = this.requireSession(tableId);

    if (
      session.status !== "waiting_for_user" ||
      session.hand.currentActorSeat !== session.config.heroSeatIndex
    ) {
      throw new TrainingRuntimeError(
        "not_waiting_for_user",
        "Hero coach view can only be built at the user's current decision point."
      );
    }

    return buildHeroCoachView(session);
  }

  getHandReviewView(tableId: string): HandReviewView {
    const session = this.requireSession(tableId);

    if (
      session.status !== "hand_complete" ||
      session.hand.street !== "complete"
    ) {
      throw new TrainingRuntimeError(
        "hand_not_complete",
        "Hand review view can only be built after the hand is complete."
      );
    }

    return buildHandReviewView(session);
  }

  beginHeroCoachRequest(tableId: string): BeginHeroCoachRequestResult {
    let session = this.requireSession(tableId);
    const view = this.getHeroCoachView(tableId);
    const existingStatus = session.heroCoachRequests.get(view.decisionPointId);

    if (existingStatus) {
      return {
        status: "already_requested",
        view
      };
    }

    const heroCoachRequests = new Map(session.heroCoachRequests);
    heroCoachRequests.set(view.decisionPointId, "requesting");
    session = {
      ...session,
      heroCoachRequests,
      updatedAt: new Date()
    };
    this.sessions.set(tableId, session);

    return {
      status: "locked",
      view
    };
  }

  completeHeroCoachRequest(tableId: string, decisionPointId: string): void {
    const session = this.requireSession(tableId);

    if (!session.heroCoachRequests.has(decisionPointId)) {
      return;
    }

    const heroCoachRequests = new Map(session.heroCoachRequests);
    heroCoachRequests.set(decisionPointId, "completed");
    this.sessions.set(tableId, {
      ...session,
      heroCoachRequests,
      updatedAt: new Date()
    });
  }

  releaseHeroCoachRequest(tableId: string, decisionPointId: string): void {
    const session = this.requireSession(tableId);

    if (session.heroCoachRequests.get(decisionPointId) !== "requesting") {
      return;
    }

    const heroCoachRequests = new Map(session.heroCoachRequests);
    heroCoachRequests.delete(decisionPointId);
    this.sessions.set(tableId, {
      ...session,
      heroCoachRequests,
      updatedAt: new Date()
    });
  }

  submitUserAction(
    tableId: string,
    input: SubmitUserActionInput
  ): TrainingRuntimeEvent {
    let session = this.requireSession(tableId);
    const heroSeatIndex = session.config.heroSeatIndex;

    if (
      session.status !== "waiting_for_user" ||
      session.hand.currentActorSeat !== heroSeatIndex
    ) {
      const rejected = appendRuntimeEvent(session, "user_action_rejected", {
        reason: "not_waiting_for_user",
        requestedAction: input.type
      });
      this.sessions.set(tableId, rejected);
      const snapshot = buildTableSnapshot(rejected);
      const event = rejected.publicEvents[rejected.publicEvents.length - 1];
      this.publish(rejected, event, snapshot);

      return {
        type: "rejected",
        snapshot,
        event,
        error: "It is not currently the user seat's turn."
      };
    }

    const currentDecisionPointId = buildDecisionPointId(session);
    if (
      session.heroCoachRequests.get(currentDecisionPointId) === "requesting"
    ) {
      const rejected = appendRuntimeEvent(session, "user_action_rejected", {
        reason: "decision_point_locked",
        requestedAction: input.type,
        decisionPointId: currentDecisionPointId
      });
      this.sessions.set(tableId, rejected);
      const snapshot = buildTableSnapshot(rejected);
      const event = rejected.publicEvents[rejected.publicEvents.length - 1];
      this.publish(rejected, event, snapshot);

      return {
        type: "rejected",
        snapshot,
        event,
        error:
          "The current decision point is locked while AI coach advice is pending."
      };
    }

    try {
      const previousPublicEventCount = session.publicEvents.length;
      session = this.applyRuntimeAction(session, {
        seatIndex: heroSeatIndex,
        type: input.type,
        amount: input.amount
      });
      session = this.advanceBots(session);
      this.sessions.set(tableId, session);

      const snapshot = buildTableSnapshot(session);
      const events = session.publicEvents.slice(previousPublicEventCount);
      this.publishAll(session, events, snapshot);

      return {
        type: "advanced",
        snapshot,
        events
      };
    } catch (error) {
      const rejected = appendRuntimeEvent(session, "user_action_rejected", {
        reason: "illegal_action",
        requestedAction: input.type,
        requestedAmount: input.amount,
        message:
          error instanceof Error ? error.message : "User action was rejected."
      });
      this.sessions.set(tableId, rejected);
      const snapshot = buildTableSnapshot(rejected);
      const event = rejected.publicEvents[rejected.publicEvents.length - 1];
      this.publish(rejected, event, snapshot);

      return {
        type: "rejected",
        snapshot,
        event,
        error:
          error instanceof Error ? error.message : "User action was rejected."
      };
    }
  }

  startNextHand(tableId: string): TrainingRuntimeEvent {
    let session = this.requireSession(tableId);
    if (session.status !== "hand_complete") {
      throw new TrainingRuntimeError(
        "hand_not_complete",
        "The next hand can only start after the current hand is complete."
      );
    }

    const handNumber = session.handNumber + 1;
    const startingStacks = session.hand.seats.map((seat) =>
      seat.stack > 0 ? seat.stack : session.config.startingStack
    );
    const previousPublicEventCount = session.publicEvents.length;
    const nextConfig = {
      ...session.config,
      buttonSeat: (session.hand.buttonSeat + 1) % session.config.playerCount
    };
    const hand = createRuntimeHand(
      nextConfig,
      session.seedBase,
      handNumber,
      startingStacks
    );
    session = {
      ...session,
      handId: createRuntimeId(`${session.tableId}-hand`, handNumber),
      handNumber,
      config: nextConfig,
      hand,
      status: "bot_acting",
      heroCoachRequests: new Map(),
      updatedAt: new Date()
    };
    session = appendRuntimeEvent(session, "hand_started", {
      handId: session.handId,
      handNumber,
      buttonSeat: hand.buttonSeat,
      smallBlindSeat: hand.smallBlindSeat,
      bigBlindSeat: hand.bigBlindSeat
    });
    session = appendNewHandEvents(session, []);
    session = this.advanceBots(session);
    this.sessions.set(tableId, session);

    const snapshot = buildTableSnapshot(session);
    const events = session.publicEvents.slice(previousPublicEventCount);
    this.publishAll(session, events, snapshot);

    return {
      type: "advanced",
      snapshot,
      events
    };
  }

  subscribe(tableId: string, subscriber: Subscriber): () => void {
    this.requireSession(tableId);
    const subscribers = this.subscribers.get(tableId) ?? new Set<Subscriber>();
    subscribers.add(subscriber);
    this.subscribers.set(tableId, subscribers);

    return () => {
      subscribers.delete(subscriber);
      if (subscribers.size === 0) {
        this.subscribers.delete(tableId);
      }
    };
  }

  private advanceBots(session: RuntimeSession): RuntimeSession {
    let nextSession = session;
    let guard = 0;

    while (
      nextSession.hand.street !== "complete" &&
      nextSession.hand.currentActorSeat !== null &&
      nextSession.hand.currentActorSeat !== nextSession.config.heroSeatIndex
    ) {
      if (guard++ > 200) {
        throw new Error("Bot action guard exceeded.");
      }

      const actorSeat = nextSession.hand.currentActorSeat;
      const view = buildBotSeatView(nextSession, actorSeat);
      const action = chooseBotAction(view);
      nextSession = this.applyRuntimeAction(nextSession, action);
    }

    nextSession = {
      ...nextSession,
      status:
        nextSession.hand.street === "complete"
          ? "hand_complete"
          : "waiting_for_user",
      updatedAt: new Date()
    };

    return appendRuntimeEvent(nextSession, "runtime_snapshot", {
      status: nextSession.status,
      currentActorSeat: nextSession.hand.currentActorSeat,
      street: nextSession.hand.street
    });
  }

  private applyRuntimeAction(
    session: RuntimeSession,
    action: PlayerAction
  ): RuntimeSession {
    const beforeLength = session.hand.events.length;
    const nextHand = applyAction(session.hand, action);
    return appendNewHandEvents(
      {
        ...session,
        hand: nextHand,
        updatedAt: new Date()
      },
      session.hand.events.slice(0, beforeLength)
    );
  }

  private requireSession(tableId: string): RuntimeSession {
    const session = this.sessions.get(tableId);
    if (!session) {
      throw new TrainingRuntimeError(
        "table_not_found",
        `Training table ${tableId} was not found.`
      );
    }

    return session;
  }

  private publish(
    session: RuntimeSession,
    event: RuntimePublicEvent | undefined,
    snapshot: TrainingTableSnapshot
  ): void {
    if (!event) {
      return;
    }

    const subscribers = this.subscribers.get(session.tableId);
    if (!subscribers) {
      return;
    }

    for (const subscriber of subscribers) {
      subscriber(event, snapshot);
    }
  }

  private publishAll(
    session: RuntimeSession,
    events: RuntimePublicEvent[],
    snapshot: TrainingTableSnapshot
  ): void {
    for (const event of events) {
      this.publish(session, event, snapshot);
    }
  }

  private createTableId(): string {
    let tableId: string;

    do {
      tableId = createRandomRuntimeId("tbl");
    } while (this.sessions.has(tableId));

    return tableId;
  }
}

export function buildBotSeatView(
  session: RuntimeSession,
  seatIndex: number
): BotSeatView {
  const profile = session.seatProfiles[seatIndex];
  const legalActions =
    session.hand.currentActorSeat === seatIndex
      ? getLegalActions(session.hand)
      : [];

  return {
    tableId: session.tableId,
    handId: session.handId,
    seatIndex,
    style: profile.style as BotStyle,
    street: session.hand.street,
    board: session.hand.board,
    potTotal: calculatePotTotal(session.hand),
    currentBet: session.hand.currentBet,
    currentActorSeat: session.hand.currentActorSeat,
    heroSeatIndex: session.config.heroSeatIndex,
    seats: session.hand.seats.map((seat) => {
      const seatProfile = session.seatProfiles[seat.seatIndex];
      return {
        seatIndex: seat.seatIndex,
        stack: seat.stack,
        status: seat.status,
        streetCommitment: seat.streetCommitment,
        totalCommitment: seat.totalCommitment,
        isHero: seatProfile.isHero,
        style: seatProfile.style,
        holeCards: seat.seatIndex === seatIndex ? seat.holeCards : null
      };
    }),
    legalActions,
    visibleActionHistory: session.hand.events
      .filter(
        (event): event is Extract<HandEvent, { type: "player_action" }> =>
          event.type === "player_action"
      )
      .map((event) => ({
        sequence: event.sequence,
        seatIndex: event.payload.seatIndex,
        action: event.payload.action,
        amount: event.payload.amount,
        totalBetTo: event.payload.totalBetTo
      }))
  };
}

export function buildHeroCoachView(session: RuntimeSession): HeroCoachView {
  const heroSeatIndex = session.config.heroSeatIndex;
  const heroSeat = session.hand.seats[heroSeatIndex];
  const legalActions =
    session.hand.currentActorSeat === heroSeatIndex
      ? getLegalActions(session.hand)
      : [];
  const streetBySequence = new Map<number, typeof session.hand.street>();
  let currentStreet: typeof session.hand.street = "preflop";

  for (const event of session.hand.events) {
    if (event.type === "street_advanced") {
      currentStreet = event.payload.street;
    }

    streetBySequence.set(event.sequence, currentStreet);
  }

  return {
    tableId: session.tableId,
    handId: session.handId,
    decisionPointId: buildDecisionPointId(session),
    actingSeatIndex: heroSeatIndex,
    tableConfig: session.config,
    street: session.hand.street,
    board: session.hand.board,
    heroHoleCards: heroSeat.holeCards,
    potTotal: calculatePotTotal(session.hand),
    pots: session.hand.pots,
    currentBet: session.hand.currentBet,
    eventSequence: getLastHandEventSequence(session),
    legalActions,
    seats: session.hand.seats.map((seat) => {
      const profile = session.seatProfiles[seat.seatIndex];
      return {
        seatIndex: seat.seatIndex,
        playerId: profile.playerId,
        displayName: profile.displayName,
        isHero: profile.isHero,
        style: profile.style,
        stack: seat.stack,
        effectiveStackAgainstHero: Math.min(heroSeat.stack, seat.stack),
        status: seat.status,
        streetCommitment: seat.streetCommitment,
        totalCommitment: seat.totalCommitment,
        position: getSeatPosition(session.hand, seat.seatIndex)
      };
    }),
    bettingHistory: session.hand.events
      .filter(
        (event): event is Extract<HandEvent, { type: "player_action" }> =>
          event.type === "player_action"
      )
      .map((event) => ({
        sequence: event.sequence,
        street: streetBySequence.get(event.sequence) ?? "preflop",
        seatIndex: event.payload.seatIndex,
        action: event.payload.action,
        amount: event.payload.amount,
        totalBetTo: event.payload.totalBetTo
      }))
  };
}

export function buildHandReviewView(session: RuntimeSession): HandReviewView {
  const timeline = buildHandReviewTimeline(session.hand.events);

  return {
    tableId: session.tableId,
    handId: session.handId,
    handNumber: session.handNumber,
    tableConfig: session.config,
    heroSeatIndex: session.config.heroSeatIndex,
    buttonSeat: session.hand.buttonSeat,
    smallBlindSeat: session.hand.smallBlindSeat,
    bigBlindSeat: session.hand.bigBlindSeat,
    completionReason: session.hand.completionReason,
    board: session.hand.board,
    potTotal: calculatePotTotal(session.hand),
    awards: session.hand.awards,
    showdownResults: session.hand.showdownResults,
    finalState: buildPublicHandState(session),
    seats: session.hand.seats.map((seat) => {
      const profile = session.seatProfiles[seat.seatIndex];
      return {
        seatIndex: seat.seatIndex,
        playerId: profile.playerId,
        displayName: profile.displayName,
        isHero: profile.isHero,
        style: profile.style,
        finalStack: seat.stack,
        totalCommitment: seat.totalCommitment,
        status: seat.status,
        holeCards: seat.holeCards,
        position: getSeatPosition(session.hand, seat.seatIndex)
      };
    }),
    timeline
  };
}

export function buildTableSnapshot(
  session: RuntimeSession
): TrainingTableSnapshot {
  return {
    tableId: session.tableId,
    status: session.status,
    config: session.config,
    hand: buildPublicHandState(session),
    createdAt: session.createdAt.toISOString(),
    updatedAt: session.updatedAt.toISOString()
  };
}

function buildDecisionPointId(session: RuntimeSession): string {
  return [
    session.handId,
    session.hand.street,
    `seat-${session.config.heroSeatIndex}`,
    `event-${getLastHandEventSequence(session)}`
  ].join(":");
}

function getLastHandEventSequence(session: RuntimeSession): number {
  return session.hand.events[session.hand.events.length - 1]?.sequence ?? 0;
}

function getSeatPosition(
  hand: HandState,
  seatIndex: number
): "button" | "small_blind" | "big_blind" | "other" {
  if (seatIndex === hand.buttonSeat) {
    return "button";
  }

  if (seatIndex === hand.smallBlindSeat) {
    return "small_blind";
  }

  if (seatIndex === hand.bigBlindSeat) {
    return "big_blind";
  }

  return "other";
}

function buildHandReviewTimeline(
  events: HandEvent[]
): HandReviewTimelineEvent[] {
  let currentStreet: HandReviewTimelineEvent["street"] = "preflop";

  return events.map((event) => {
    if (event.type === "street_advanced") {
      currentStreet = event.payload.street;
    }

    return {
      sequence: event.sequence,
      street: currentStreet,
      type: event.type,
      payload: event.payload
    };
  });
}

export function getTrainingTableRuntime(): TrainingTableRuntime {
  const globalRuntime = globalThis as typeof globalThis & {
    __trainingTableRuntime?: TrainingTableRuntime;
  };

  if (!globalRuntime.__trainingTableRuntime) {
    globalRuntime.__trainingTableRuntime = new TrainingTableRuntime();
  }

  return globalRuntime.__trainingTableRuntime;
}

function normalizeCreateInput(
  input: TrainingTableCreateInput
): TrainingTableConfig {
  const allowedPlayerCounts = new Set([4, 6, 9, 12]);
  if (!allowedPlayerCounts.has(input.playerCount)) {
    throw new TrainingRuntimeError(
      "invalid_config",
      "Training tables must use 4, 6, 9, or 12 seats."
    );
  }

  assertPositiveInteger(input.smallBlind, "smallBlind");
  assertPositiveInteger(input.bigBlind, "bigBlind");
  assertPositiveInteger(input.startingStack, "startingStack");

  if (input.bigBlind <= input.smallBlind) {
    throw new TrainingRuntimeError(
      "invalid_config",
      "bigBlind must be greater than smallBlind."
    );
  }

  if (input.ante !== undefined) {
    assertNonNegativeInteger(input.ante, "ante");
  }

  const heroSeatIndex = input.heroSeatIndex ?? 0;
  const buttonSeat = input.buttonSeat ?? 0;
  validateSeatIndex(heroSeatIndex, input.playerCount, "heroSeatIndex");
  validateSeatIndex(buttonSeat, input.playerCount, "buttonSeat");

  if (input.straddleSeat !== undefined || input.straddleAmount !== undefined) {
    if (
      input.straddleSeat === undefined ||
      input.straddleAmount === undefined
    ) {
      throw new TrainingRuntimeError(
        "invalid_config",
        "straddleSeat and straddleAmount must be provided together."
      );
    }
    validateSeatIndex(input.straddleSeat, input.playerCount, "straddleSeat");
    assertPositiveInteger(input.straddleAmount, "straddleAmount");
  }

  return {
    playerCount: input.playerCount,
    smallBlind: input.smallBlind,
    bigBlind: input.bigBlind,
    startingStack: input.startingStack,
    ante: input.ante ?? 0,
    straddleSeat: input.straddleSeat,
    straddleAmount: input.straddleAmount,
    heroSeatIndex,
    buttonSeat,
    aiStyles: normalizeStyles(input.aiStyles, input.playerCount - 1)
  };
}

function createRuntimeHand(
  config: TrainingTableConfig,
  seedBase: string,
  handNumber: number,
  startingStacks?: number[]
): HandState {
  const handConfig: HandConfig = {
    playerCount: config.playerCount,
    startingStack: config.startingStack,
    smallBlind: config.smallBlind,
    bigBlind: config.bigBlind,
    ante: config.ante,
    buttonSeat: config.buttonSeat,
    straddleSeat: config.straddleSeat,
    straddleAmount: config.straddleAmount,
    startingStacks
  };

  return createHand(handConfig, `${seedBase}:${handNumber}`);
}

function createSeatProfiles(config: TrainingTableConfig): RuntimeSeatProfile[] {
  let botStyleIndex = 0;

  return Array.from({ length: config.playerCount }, (_, seatIndex) => {
    const isHero = seatIndex === config.heroSeatIndex;
    const style = isHero ? "hero" : config.aiStyles[botStyleIndex++];

    return {
      seatIndex,
      playerId: isHero ? "hero" : `bot-${seatIndex + 1}`,
      displayName: isHero ? "Hero" : `AI ${seatIndex + 1}`,
      isHero,
      style
    };
  });
}

function chooseBotAction(view: BotSeatView): PlayerAction {
  const legalActions = view.legalActions;
  const check = legalActions.find((action) => action.type === "check");
  if (check) {
    return { seatIndex: view.seatIndex, type: "check" };
  }

  const call = legalActions.find((action) => action.type === "call");
  const fold = legalActions.find((action) => action.type === "fold");
  const raise = legalActions.find((action) => action.type === "raise");
  const bet = legalActions.find((action) => action.type === "bet");
  const allIn = legalActions.find((action) => action.type === "all-in");

  if (
    view.style === "tight" &&
    call &&
    (call.toCall ?? call.amount ?? 0) > view.currentBet / 2
  ) {
    return {
      seatIndex: view.seatIndex,
      type: fold ? "fold" : "call",
      amount: call.amount
    };
  }

  if (view.style === "aggressive") {
    const pressureAction = raise ?? bet;
    if (
      pressureAction &&
      pressureAction.amount !== undefined &&
      pressureAction.amount <= Math.max(view.currentBet * 2, view.potTotal)
    ) {
      return {
        seatIndex: view.seatIndex,
        type: pressureAction.type,
        amount: pressureAction.amount
      };
    }
  }

  if (view.style === "loose" && allIn && !call) {
    return { seatIndex: view.seatIndex, type: "all-in", amount: allIn.amount };
  }

  if (call) {
    return { seatIndex: view.seatIndex, type: "call", amount: call.amount };
  }
  if (fold) {
    return { seatIndex: view.seatIndex, type: "fold" };
  }
  if (allIn) {
    return { seatIndex: view.seatIndex, type: "all-in", amount: allIn.amount };
  }

  throw new Error("Bot strategy received no legal action.");
}

function buildPublicHandState(session: RuntimeSession): PublicHandState {
  const legalActions =
    session.hand.currentActorSeat === session.config.heroSeatIndex
      ? getLegalActions(session.hand)
      : [];

  return {
    handId: session.handId,
    street: session.hand.street,
    board: session.hand.board,
    potTotal: calculatePotTotal(session.hand),
    pots: session.hand.pots,
    currentActorSeat: session.hand.currentActorSeat,
    currentBet: session.hand.currentBet,
    legalActions,
    seats: session.hand.seats.map((seat) => {
      const profile = session.seatProfiles[seat.seatIndex];
      return {
        seatIndex: seat.seatIndex,
        playerId: profile.playerId,
        displayName: profile.displayName,
        isHero: profile.isHero,
        style: profile.style,
        stack: seat.stack,
        status: seat.status,
        streetCommitment: seat.streetCommitment,
        totalCommitment: seat.totalCommitment,
        holeCards:
          profile.isHero || session.hand.street === "complete"
            ? seat.holeCards
            : null,
        isButton: seat.seatIndex === session.hand.buttonSeat,
        isSmallBlind: seat.seatIndex === session.hand.smallBlindSeat,
        isBigBlind: seat.seatIndex === session.hand.bigBlindSeat
      };
    }),
    completionReason: session.hand.completionReason,
    awards: session.hand.awards,
    showdownResults: session.hand.showdownResults,
    lastSequence:
      session.publicEvents[session.publicEvents.length - 1]?.sequence ?? 0
  };
}

function appendNewHandEvents(
  session: RuntimeSession,
  previousEvents: HandEvent[]
): RuntimeSession {
  const previousSequences = new Set(
    previousEvents.map((event) => event.sequence)
  );
  const newEvents = session.hand.events.filter(
    (event) => !previousSequences.has(event.sequence)
  );

  return newEvents.reduce(
    (nextSession, event) =>
      appendRuntimeEvent(nextSession, event.type, redactHandEvent(event)),
    session
  );
}

function appendRuntimeEvent(
  session: RuntimeSession,
  type: RuntimePublicEvent["type"],
  payload: RuntimePublicEvent["payload"]
): RuntimeSession {
  return {
    ...session,
    nextRuntimeSequence: session.nextRuntimeSequence + 1,
    publicEvents: [
      ...session.publicEvents,
      {
        sequence: session.nextRuntimeSequence,
        type,
        payload,
        createdAt: new Date().toISOString()
      }
    ]
  };
}

function redactHandEvent(event: HandEvent): Record<string, unknown> {
  if (event.type === "hole_cards_dealt") {
    return {
      seatIndex: event.payload.seatIndex,
      dealt: true
    };
  }

  return event.payload;
}

function calculatePotTotal(hand: HandState): number {
  return hand.seats.reduce((sum, seat) => sum + seat.totalCommitment, 0);
}

function normalizeStyles(
  styles: BotStyle[] | undefined,
  count: number
): BotStyle[] {
  return Array.from({ length: count }, (_, index) => {
    const style =
      styles?.[index] ?? DEFAULT_BOT_STYLES[index % DEFAULT_BOT_STYLES.length];
    if (!DEFAULT_BOT_STYLES.includes(style)) {
      throw new TrainingRuntimeError(
        "invalid_config",
        `Unsupported bot style ${style}.`
      );
    }

    return style;
  });
}

function createRuntimeId(prefix: string, sequence: number): string {
  return `${prefix}_${sequence.toString().padStart(6, "0")}`;
}

function createRandomRuntimeId(prefix: string): string {
  return `${prefix}_${randomBytes(16).toString("base64url")}`;
}

function assertPositiveInteger(value: number, fieldName: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new TrainingRuntimeError(
      "invalid_config",
      `${fieldName} must be a positive integer.`
    );
  }
}

function assertNonNegativeInteger(value: number, fieldName: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new TrainingRuntimeError(
      "invalid_config",
      `${fieldName} must be a non-negative integer.`
    );
  }
}

function validateSeatIndex(
  seatIndex: number,
  playerCount: number,
  fieldName: string
): void {
  if (
    !Number.isInteger(seatIndex) ||
    seatIndex < 0 ||
    seatIndex >= playerCount
  ) {
    throw new TrainingRuntimeError(
      "invalid_config",
      `${fieldName} must be a valid seat index.`
    );
  }
}
