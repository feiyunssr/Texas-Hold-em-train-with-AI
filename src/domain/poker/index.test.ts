import { describe, expect, it } from "vitest";

import {
  applyAction,
  buildPots,
  type CardCode,
  createHand,
  getLegalActions,
  getPokerEngineHealth,
  type HandConfig,
  type HandState,
  playUntilTerminal
} from "./index";

describe("poker domain harness", () => {
  it("runs without importing Next.js, database, AI, or UI modules", () => {
    expect(getPokerEngineHealth()).toEqual({
      module: "domain/poker",
      isolated: true
    });
  });
});

describe("hand setup", () => {
  it("initializes a 4-player table with button, blinds, hole cards and first actor", () => {
    const hand = createHand(baseConfig({ playerCount: 4 }), "setup-4");

    expect(hand.buttonSeat).toBe(0);
    expect(hand.smallBlindSeat).toBe(1);
    expect(hand.bigBlindSeat).toBe(2);
    expect(hand.currentActorSeat).toBe(3);
    expect(hand.seats[1].totalCommitment).toBe(10);
    expect(hand.seats[2].totalCommitment).toBe(20);
    expect(hand.seats.every((seat) => seat.holeCards.length === 2)).toBe(true);
  });

  it("initializes a 12-player table and keeps preflop order deterministic", () => {
    const hand = createHand(
      baseConfig({ playerCount: 12, buttonSeat: 8 }),
      "setup-12"
    );

    expect(hand.smallBlindSeat).toBe(9);
    expect(hand.bigBlindSeat).toBe(10);
    expect(hand.currentActorSeat).toBe(11);
    expect(hand.seats).toHaveLength(12);
    expect(
      hand.events.filter((event) => event.type === "hole_cards_dealt")
    ).toHaveLength(12);
  });
});

describe("legal actions and event log", () => {
  it("generates no-limit preflop actions from the current bet", () => {
    const hand = createHand(baseConfig({ playerCount: 4 }), "legal-actions");
    const actions = getLegalActions(hand);

    expect(actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "fold" }),
        expect.objectContaining({ type: "call", amount: 20, toCall: 20 }),
        expect.objectContaining({
          type: "raise",
          amount: 40,
          minAmount: 40,
          maxAmount: 100
        }),
        expect.objectContaining({ type: "all-in", amount: 100 })
      ])
    );
  });

  it("uses the straddle size as the preflop minimum raise increment", () => {
    const hand = createHand(
      baseConfig({
        playerCount: 4,
        startingStack: 200,
        straddleSeat: 3,
        straddleAmount: 40
      }),
      "straddle-min-raise"
    );
    const raise = getLegalActions(hand).find(
      (candidate) => candidate.type === "raise"
    );

    expect(hand.currentBet).toBe(40);
    expect(hand.currentActorSeat).toBe(0);
    expect(raise).toEqual(
      expect.objectContaining({
        amount: 80,
        minAmount: 80,
        totalBetTo: 80
      })
    );
  });

  it("does not reopen raises to prior actors after an incomplete all-in raise", () => {
    let hand = createHand(
      baseConfig({
        playerCount: 4,
        startingStack: 200,
        startingStacks: [200, 200, 200, 170]
      }),
      "incomplete-all-in"
    );

    hand = applyAction(hand, action(hand, "call", 20));
    hand = applyAction(hand, action(hand, "call", 20));
    hand = applyAction(hand, action(hand, "call", 10));
    hand = applyAction(hand, action(hand, "check"));
    hand = applyAction(hand, action(hand, "bet", 100));
    hand = applyAction(hand, action(hand, "call", 100));
    hand = applyAction(hand, action(hand, "all-in", 150));
    hand = applyAction(hand, action(hand, "call", 150));

    expect(hand.currentActorSeat).toBe(1);
    expect(hand.currentBet).toBe(150);
    expect(getLegalActions(hand)).toEqual([
      { type: "fold" },
      { type: "call", amount: 50, toCall: 50 }
    ]);
  });

  it("appends events without mutating earlier state snapshots", () => {
    const hand = createHand(baseConfig({ playerCount: 4 }), "append-only");
    const originalEvents = hand.events;
    const next = applyAction(hand, action(hand, "fold"));

    expect(hand.events).toBe(originalEvents);
    expect(hand.events).toHaveLength(originalEvents.length);
    expect(next.events).toHaveLength(originalEvents.length + 1);
    expect(next.events.map((event) => event.sequence)).toEqual(
      Array.from({ length: next.events.length }, (_, index) => index + 1)
    );
  });
});

describe("hand flow", () => {
  it("plays a complete hand from preflop through river showdown", () => {
    const hand = createHand(
      baseConfig({
        playerCount: 4,
        deck: deckForSeats(
          [
            ["As", "Ad"],
            ["Kc", "Kd"],
            ["Qs", "Qd"],
            ["Jc", "Jd"]
          ],
          ["2c", "7d", "9h", "4s", "5c"]
        )
      }),
      "full-hand"
    );

    const terminal = playUntilTerminal(hand, callOrCheck);

    expect(terminal.street).toBe("complete");
    expect(terminal.completionReason).toBe("showdown");
    expect(terminal.board).toEqual(["2c", "7d", "9h", "4s", "5c"]);
    expect(terminal.awards).toEqual([
      expect.objectContaining({ winnerSeatIndexes: [0], potAmount: 80 })
    ]);
    expect(terminal.seats[0].stack).toBe(160);
  });

  it("ends immediately when all but one player fold", () => {
    let hand = createHand(baseConfig({ playerCount: 4 }), "fold-end");

    hand = applyAction(hand, action(hand, "fold"));
    hand = applyAction(hand, action(hand, "fold"));
    hand = applyAction(hand, action(hand, "fold"));

    expect(hand.street).toBe("complete");
    expect(hand.completionReason).toBe("fold");
    expect(hand.awards).toEqual([
      {
        potAmount: 30,
        winnerSeatIndexes: [2],
        share: 30,
        oddChips: 0
      }
    ]);
    expect(hand.seats[2].stack).toBe(110);
  });

  it("deals remaining streets after all players are all-in", () => {
    const hand = createHand(
      baseConfig({
        playerCount: 4,
        deck: deckForSeats(
          [
            ["As", "Ad"],
            ["Kc", "Kd"],
            ["Qs", "Qd"],
            ["Jc", "Jd"]
          ],
          ["2c", "7d", "9h", "4s", "5c"]
        )
      }),
      "all-in"
    );

    const terminal = playUntilTerminal(hand, allInOnly);

    expect(terminal.street).toBe("complete");
    expect(terminal.completionReason).toBe("showdown");
    expect(terminal.board).toHaveLength(5);
    expect(terminal.seats[0].stack).toBe(400);
    expect(
      terminal.events.some((event) => event.type === "showdown_evaluated")
    ).toBe(true);
  });

  it("auto-runs to showdown when only one covering player can still act", () => {
    const hand = createHand(
      baseConfig({
        playerCount: 4,
        startingStack: 200,
        startingStacks: [200, 50, 50, 50],
        deck: deckForSeats(
          [
            ["As", "Ad"],
            ["Kc", "Kd"],
            ["Qs", "Qd"],
            ["Jc", "Jd"]
          ],
          ["2c", "7d", "9h", "4s", "5c"]
        )
      }),
      "single-covering-runout"
    );

    const terminal = playUntilTerminal(hand, allInFromShortStacksCallFromCover);

    expect(terminal.street).toBe("complete");
    expect(terminal.completionReason).toBe("showdown");
    expect(terminal.board).toEqual(["2c", "7d", "9h", "4s", "5c"]);
    expect(terminal.currentActorSeat).toBeNull();
    expect(
      terminal.events.filter((event) => event.type === "player_action")
    ).toHaveLength(4);
    expect(terminal.seats[0].stack).toBe(350);
  });

  it("splits a multi-player showdown pot when the board plays", () => {
    const hand = createHand(
      baseConfig({
        playerCount: 4,
        deck: deckForSeats(
          [
            ["2c", "3d"],
            ["4c", "5d"],
            ["6c", "7d"],
            ["8c", "9d"]
          ],
          ["Ah", "Kh", "Qh", "Jh", "Th"]
        )
      }),
      "split-pot"
    );

    const terminal = playUntilTerminal(hand, callOrCheck);

    expect(terminal.awards).toEqual([
      {
        potAmount: 80,
        winnerSeatIndexes: [0, 1, 2, 3],
        share: 20,
        oddChips: 0
      }
    ]);
    expect(terminal.seats.map((seat) => seat.stack)).toEqual([
      100, 100, 100, 100
    ]);
  });

  it("builds and awards side pots by contribution level", () => {
    const hand = createHand(
      baseConfig({
        playerCount: 4,
        startingStacks: [50, 100, 200, 200],
        startingStack: 200,
        deck: deckForSeats(
          [
            ["Ac", "Ad"],
            ["Kc", "Kd"],
            ["Qc", "Qd"],
            ["Jc", "Jd"]
          ],
          ["2h", "7s", "9c", "4d", "5h"]
        )
      }),
      "side-pot"
    );

    const terminal = playUntilTerminal(hand, allInOnly);

    expect(buildPots(terminal.seats)).toEqual([
      { amount: 200, eligibleSeatIndexes: [0, 1, 2, 3] },
      { amount: 150, eligibleSeatIndexes: [1, 2, 3] },
      { amount: 200, eligibleSeatIndexes: [2, 3] }
    ]);
    expect(terminal.awards).toEqual([
      {
        potAmount: 200,
        winnerSeatIndexes: [0],
        share: 200,
        oddChips: 0
      },
      {
        potAmount: 150,
        winnerSeatIndexes: [1],
        share: 150,
        oddChips: 0
      },
      {
        potAmount: 200,
        winnerSeatIndexes: [2],
        share: 200,
        oddChips: 0
      }
    ]);
    expect(terminal.seats.map((seat) => seat.stack)).toEqual([
      200, 150, 200, 0
    ]);
  });

  it("replays deterministically for the same seed and action policy", () => {
    const first = playUntilTerminal(
      createHand(baseConfig({ playerCount: 6 }), "deterministic"),
      callOrCheck
    );
    const second = playUntilTerminal(
      createHand(baseConfig({ playerCount: 6 }), "deterministic"),
      callOrCheck
    );

    expect(second.board).toEqual(first.board);
    expect(second.seats.map((seat) => seat.holeCards)).toEqual(
      first.seats.map((seat) => seat.holeCards)
    );
    expect(second.seats.map((seat) => seat.stack)).toEqual(
      first.seats.map((seat) => seat.stack)
    );
    expect(second.events).toEqual(first.events);
  });
});

function baseConfig(overrides: Partial<HandConfig> = {}): HandConfig {
  return {
    playerCount: 4,
    startingStack: 100,
    smallBlind: 10,
    bigBlind: 20,
    buttonSeat: 0,
    ...overrides
  };
}

function action(
  state: HandState,
  type: "fold" | "check" | "call" | "bet" | "raise" | "all-in",
  amount?: number
) {
  if (state.currentActorSeat === null) {
    throw new Error("Expected a current actor.");
  }

  return {
    seatIndex: state.currentActorSeat,
    type,
    amount
  };
}

function callOrCheck(state: HandState) {
  const legalActions = getLegalActions(state);
  const preferred =
    legalActions.find((candidate) => candidate.type === "check") ??
    legalActions.find((candidate) => candidate.type === "call") ??
    legalActions.find((candidate) => candidate.type === "fold");

  if (!preferred || state.currentActorSeat === null) {
    throw new Error("No passive action is available.");
  }

  return {
    seatIndex: state.currentActorSeat,
    type: preferred.type,
    amount: preferred.amount
  };
}

function allInOnly(state: HandState) {
  const legalActions = getLegalActions(state);
  const allIn = legalActions.find((candidate) => candidate.type === "all-in");
  const call = legalActions.find((candidate) => candidate.type === "call");

  if (state.currentActorSeat === null) {
    throw new Error("Expected a current actor.");
  }

  if (allIn) {
    return {
      seatIndex: state.currentActorSeat,
      type: allIn.type,
      amount: allIn.amount
    };
  }

  if (call) {
    return {
      seatIndex: state.currentActorSeat,
      type: call.type,
      amount: call.amount
    };
  }

  throw new Error("No all-in or call action is available.");
}

function allInFromShortStacksCallFromCover(state: HandState) {
  const legalActions = getLegalActions(state);
  const call = legalActions.find((candidate) => candidate.type === "call");
  const allIn = legalActions.find((candidate) => candidate.type === "all-in");

  if (state.currentActorSeat === null) {
    throw new Error("Expected a current actor.");
  }

  if (state.currentActorSeat === 0 && call) {
    return {
      seatIndex: state.currentActorSeat,
      type: call.type,
      amount: call.amount
    };
  }

  if (allIn) {
    return {
      seatIndex: state.currentActorSeat,
      type: allIn.type,
      amount: allIn.amount
    };
  }

  if (call) {
    return {
      seatIndex: state.currentActorSeat,
      type: call.type,
      amount: call.amount
    };
  }

  throw new Error("No all-in or call action is available.");
}

function deckForSeats(
  seatCards: [CardCode, CardCode][],
  board: [CardCode, CardCode, CardCode, CardCode, CardCode]
): CardCode[] {
  const dealOrder = [1, 2, 3, 0];

  return [
    ...dealOrder.map((seatIndex) => seatCards[seatIndex][0]),
    ...dealOrder.map((seatIndex) => seatCards[seatIndex][1]),
    ...board
  ];
}
