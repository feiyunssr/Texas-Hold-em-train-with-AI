import { describe, expect, it } from "vitest";

import { TrainingRuntimeError, TrainingTableRuntime } from "./index";
import type { BotStyle, TrainingTableSnapshot } from "./types";

describe("training table runtime", () => {
  it.each([4, 6, 9, 12] as const)(
    "creates a %i-seat table and advances bots until the user acts",
    (playerCount) => {
      const runtime = new TrainingTableRuntime();
      const result = runtime.createTable(baseCreateInput(playerCount));

      expect(result.snapshot.config.playerCount).toBe(playerCount);
      expect(result.snapshot.status).toBe("waiting_for_user");
      expect(result.snapshot.hand.currentActorSeat).toBe(0);
      expect(result.snapshot.hand.legalActions.length).toBeGreaterThan(0);
      expect(result.snapshot.hand.seats).toHaveLength(playerCount);
    }
  );

  it("creates non-enumerable table identifiers for exposed routes", () => {
    const runtime = new TrainingTableRuntime();
    const first = runtime.createTable(baseCreateInput(4)).snapshot.tableId;
    const second = runtime.createTable(baseCreateInput(4)).snapshot.tableId;

    expect(first).toMatch(/^tbl_[A-Za-z0-9_-]{22}$/);
    expect(second).toMatch(/^tbl_[A-Za-z0-9_-]{22}$/);
    expect(first).not.toBe(second);
    expect(first).not.toMatch(/^tbl_\d{6}$/);
  });

  it("builds a bot-seat-view without leaking hero or opponent hole cards", () => {
    const runtime = new TrainingTableRuntime();
    const { snapshot } = runtime.createTable({
      ...baseCreateInput(6),
      heroSeatIndex: 5,
      aiStyles: ["balanced", "tight", "loose", "aggressive", "balanced"]
    });

    expect(snapshot.status).toBe("waiting_for_user");

    const view = runtime.getBotSeatView(snapshot.tableId, 0);

    expect(view.seatIndex).toBe(0);
    expect(view.seats[0].holeCards).toHaveLength(2);
    expect(view.seats[5].isHero).toBe(true);
    expect(view.seats[5].holeCards).toBeNull();
    expect(view.seats[1].holeCards).toBeNull();
    expect(view.legalActions).toEqual([]);
  });

  it("builds a hero-coach-view with only the user's current decision context", () => {
    const runtime = new TrainingTableRuntime();
    const { snapshot } = runtime.createTable(baseCreateInput(6));
    const view = runtime.getHeroCoachView(snapshot.tableId);

    expect(view.tableId).toBe(snapshot.tableId);
    expect(view.handId).toBe(snapshot.hand.handId);
    expect(view.decisionPointId).toContain(":seat-0:");
    expect(view.heroHoleCards).toHaveLength(2);
    expect(view.board).toEqual(snapshot.hand.board);
    expect(view.legalActions).toEqual(snapshot.hand.legalActions);
    expect(view.seats).toHaveLength(6);
    expect(
      view.seats.every((seat) => "effectiveStackAgainstHero" in seat)
    ).toBe(true);
    expect(
      view.bettingHistory.every((event) => event.sequence <= view.eventSequence)
    ).toBe(true);
  });

  it("exposes M7 table pressure and action-line display fields", () => {
    const runtime = new TrainingTableRuntime();
    const { snapshot } = runtime.createTable(baseCreateInput(6));

    expect(snapshot.hand.toCall).toBeGreaterThanOrEqual(0);
    expect(snapshot.hand.effectiveStack).toBeGreaterThan(0);
    expect(snapshot.hand.displayPots.length).toBeGreaterThan(0);
    expect(snapshot.hand.displayPots[0].label).toBe("主池");
    expect(snapshot.hand.streetActionSummary[0].street).toBe("preflop");
    expect(snapshot.hand.maxBetAmount).toBeGreaterThan(0);

    const result = runtime.submitUserAction(
      snapshot.tableId,
      preferPassiveAction(snapshot)
    );
    const acted = result.snapshot.hand.streetActionSummary.flatMap(
      (street) => street.actions
    );

    expect(result.snapshot.hand.lastAction).toEqual(acted.at(-1));
    expect(
      result.snapshot.hand.seats.some((seat) => seat.lastAction !== null)
    ).toBe(true);
  });

  it("does not derive live side pots from unmatched current commitments", () => {
    const runtime = new TrainingTableRuntime();
    const { snapshot } = runtime.createTable(baseCreateInput(6));

    expect(snapshot.status).toBe("waiting_for_user");
    expect(snapshot.hand.pots).toEqual([]);
    expect(snapshot.hand.potTotal).toBe(90);
    expect(snapshot.hand.displayPots).toEqual([
      expect.objectContaining({
        label: "主池",
        amount: 90,
        eligibleSeatIndexes: [0, 1, 2, 3, 4, 5],
        winnerSeatIndexes: [],
        share: null
      })
    ]);
  });

  it("projects fold-award winners across every settled display pot", () => {
    const runtime = new TrainingTableRuntime();
    const created = runtime.createTable({
      ...baseCreateInput(4),
      aiStyles: ["tight", "tight", "tight"] satisfies BotStyle[]
    });
    const raised = runtime.submitUserAction(created.snapshot.tableId, {
      type: "raise",
      amount: 40
    }).snapshot;
    const terminal = runtime.submitUserAction(raised.tableId, {
      type: "bet",
      amount: 20
    }).snapshot;

    expect(terminal.status).toBe("hand_complete");
    expect(terminal.hand.completionReason).toBe("fold");
    expect(terminal.hand.awards).toEqual([
      expect.objectContaining({
        potAmount: 110,
        winnerSeatIndexes: [0],
        share: 110
      })
    ]);
    expect(terminal.hand.displayPots).toEqual([
      expect.objectContaining({
        label: "主池",
        amount: 30,
        winnerSeatIndexes: [0],
        share: 30
      }),
      expect.objectContaining({
        label: "边池 1",
        amount: 60,
        winnerSeatIndexes: [0],
        share: 60
      }),
      expect.objectContaining({
        label: "边池 2",
        amount: 20,
        winnerSeatIndexes: [0],
        share: 20
      })
    ]);
  });

  it("accepts a legal user action, appends public events, and keeps the hand moving", () => {
    const runtime = new TrainingTableRuntime();
    const created = runtime.createTable(baseCreateInput(4));
    const beforeLastSequence = created.snapshot.hand.lastSequence;
    const pushedEvents: string[] = [];
    const unsubscribe = runtime.subscribe(created.snapshot.tableId, (event) => {
      pushedEvents.push(event.type);
    });
    const action = preferPassiveAction(created.snapshot);
    const result = runtime.submitUserAction(created.snapshot.tableId, action);
    unsubscribe();

    expect(result.type).toBe("advanced");
    expect(result.snapshot.hand.lastSequence).toBeGreaterThan(
      beforeLastSequence
    );
    expect(["waiting_for_user", "hand_complete"]).toContain(
      result.snapshot.status
    );
    expect(pushedEvents).toContain("player_action");
    expect(pushedEvents).toContain("runtime_snapshot");

    const replayEvents = runtime.getPublicEvents(
      created.snapshot.tableId,
      beforeLastSequence
    );
    expect(replayEvents.length).toBeGreaterThan(0);
    expect(replayEvents.some((event) => event.type === "player_action")).toBe(
      true
    );
  });

  it("rejects illegal user actions without adding a player_action event", () => {
    const runtime = new TrainingTableRuntime();
    const created = runtime.createTable(baseCreateInput(4));
    const beforeEvents = runtime.getPublicEvents(created.snapshot.tableId);
    const result = runtime.submitUserAction(created.snapshot.tableId, {
      type: "raise",
      amount: 1
    });
    const afterEvents = runtime.getPublicEvents(created.snapshot.tableId);
    const newEvents = afterEvents.slice(beforeEvents.length);

    expect(result.type).toBe("rejected");
    expect(result.snapshot.status).toBe("waiting_for_user");
    expect(newEvents).toHaveLength(1);
    expect(newEvents[0].type).toBe("user_action_rejected");
    expect(newEvents.some((event) => event.type === "player_action")).toBe(
      false
    );
  });

  it("restores the current read model snapshot after public event replay", () => {
    const runtime = new TrainingTableRuntime();
    const created = runtime.createTable(baseCreateInput(9));

    runtime.submitUserAction(
      created.snapshot.tableId,
      preferPassiveAction(created.snapshot)
    );

    const restored = runtime.getTableSnapshot(created.snapshot.tableId);

    expect(restored.tableId).toBe(created.snapshot.tableId);
    expect(restored.hand.handId).toBe(created.snapshot.hand.handId);
    expect(restored.hand.lastSequence).toBe(
      runtime.getPublicEvents(created.snapshot.tableId).at(-1)?.sequence
    );
    expect(
      restored.hand.seats
        .filter((seat) => !seat.isHero)
        .every(
          (seat) =>
            seat.holeCards === null || restored.status === "hand_complete"
        )
    ).toBe(true);
  });

  it("prepares the next hand after the current hand completes", () => {
    const runtime = new TrainingTableRuntime();
    const created = runtime.createTable({
      ...baseCreateInput(4),
      heroSeatIndex: 3,
      aiStyles: ["tight", "tight", "tight"] satisfies BotStyle[]
    });

    let snapshot = created.snapshot;
    let guard = 0;

    while (snapshot.status !== "hand_complete") {
      if (guard++ > 50) {
        throw new Error("Test hand did not complete.");
      }

      const result = runtime.submitUserAction(snapshot.tableId, {
        type: "fold"
      });
      snapshot = result.snapshot;
    }

    const nextHand = runtime.startNextHand(snapshot.tableId).snapshot;

    expect(nextHand.hand.handId).not.toBe(snapshot.hand.handId);
    expect(nextHand.hand.seats).toHaveLength(4);
    expect(["waiting_for_user", "hand_complete"]).toContain(nextHand.status);
  });

  it("ends the training table when the user quits", () => {
    const runtime = new TrainingTableRuntime();
    const created = runtime.createTable(baseCreateInput(4));
    const pushedEvents: string[] = [];
    const unsubscribe = runtime.subscribe(created.snapshot.tableId, (event) => {
      pushedEvents.push(event.type);
    });

    const result = runtime.quitTable(created.snapshot.tableId);
    unsubscribe();

    expect(result.snapshot.status).toBe("training_ended");
    expect(result.snapshot.endReason).toBe("user_quit");
    expect(result.snapshot.hand.currentActorSeat).toBe(
      created.snapshot.config.heroSeatIndex
    );
    expect(result.snapshot.hand.legalActions).toEqual([]);
    expect(
      runtime.getTableSnapshot(created.snapshot.tableId).hand.legalActions
    ).toEqual([]);
    expect(pushedEvents).toContain("training_ended");
    expect(() =>
      runtime.submitUserAction(
        created.snapshot.tableId,
        preferPassiveAction(created.snapshot)
      )
    ).toThrow(TrainingRuntimeError);
  });

  it("ends training when the hero stack reaches zero", () => {
    const runtime = new TrainingTableRuntime();
    const created = runtime.createTable({
      ...baseCreateInput(4),
      smallBlind: 5,
      bigBlind: 10,
      startingStack: 20,
      seed: "elim-0"
    });
    const allIn = created.snapshot.hand.legalActions.find(
      (action) => action.type === "all-in"
    );

    if (!allIn) {
      throw new Error("Expected an all-in action to be legal.");
    }

    const result = runtime.submitUserAction(created.snapshot.tableId, {
      type: "all-in",
      amount: allIn.amount
    });

    expect(result.snapshot.status).toBe("training_ended");
    expect(result.snapshot.endReason).toBe("hero_eliminated");
    expect(result.snapshot.hand.seats[0].stack).toBe(0);
    expect(() => runtime.startNextHand(created.snapshot.tableId)).toThrow(
      TrainingRuntimeError
    );
  });
});

function baseCreateInput(playerCount: 4 | 6 | 9 | 12) {
  return {
    playerCount,
    smallBlind: 10,
    bigBlind: 20,
    startingStack: 200,
    ante: 0,
    heroSeatIndex: 0,
    buttonSeat: 0,
    seed: `runtime-${playerCount}`,
    aiStyles: Array.from(
      { length: playerCount - 1 },
      () => "balanced"
    ) as BotStyle[]
  };
}

function preferPassiveAction(snapshot: TrainingTableSnapshot) {
  const check = snapshot.hand.legalActions.find(
    (action) => action.type === "check"
  );
  if (check) {
    return {
      type: "check" as const
    };
  }

  const call = snapshot.hand.legalActions.find(
    (action) => action.type === "call"
  );
  if (call) {
    return {
      type: "call" as const,
      amount: call.amount
    };
  }

  return {
    type: "fold" as const
  };
}
