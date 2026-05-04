import { describe, expect, it, vi } from "vitest";

import { TrainingRuntimeError, TrainingTableRuntime } from "./index";
import type { BotStyle, HandReviewView, TrainingTableSnapshot } from "./types";

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
      aiStyles: [
        "balanced",
        "tight-passive",
        "loose-passive",
        "loose-aggressive",
        "balanced"
      ]
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
    expect(snapshot.currentDecisionPointId).toBe(view.decisionPointId);
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

  it("tracks session HUD stats without exposing hidden opponent cards", () => {
    const runtime = new TrainingTableRuntime();
    const { snapshot } = runtime.createTable({
      ...baseCreateInput(4),
      aiStyles: [
        "loose-aggressive",
        "tight-aggressive",
        "balanced"
      ] satisfies BotStyle[]
    });
    const initialHeroHud = snapshot.hand.seats[0].hud;

    expect(initialHeroHud.hands).toBe(1);
    expect(snapshot.hand.seats[1].holeCards).toBeNull();
    expect(
      runtime
        .getPublicEvents(snapshot.tableId)
        .some((event) => event.type === "hud_stats_updated")
    ).toBe(true);

    const raised = runtime.submitUserAction(snapshot.tableId, {
      type: "raise",
      amount: snapshot.hand.legalActions.find(
        (action) => action.type === "raise"
      )?.amount
    }).snapshot;

    expect(raised.hand.seats[0].hud.vpip).toBe(1);
    expect(raised.hand.seats[0].hud.pfr).toBe(1);
    expect(raised.hand.seats[0].hud.vpipPct).toBe(100);
    expect(
      raised.hand.seats
        .filter((seat) => !seat.isHero)
        .every(
          (seat) => seat.holeCards === null || raised.status === "hand_complete"
        )
    ).toBe(true);
  });

  it("reports ATS as steal attempts divided by steal opportunities", () => {
    const runtime = createRuntimeWithTableId("tbl_ats_test_0");
    const { snapshot } = runtime.createTable({
      ...baseCreateInput(4),
      seed: "ats-fixed-0",
      aiStyles: [
        "tight-passive",
        "tight-passive",
        "tight-passive"
      ] satisfies BotStyle[]
    });
    const raise = snapshot.hand.legalActions.find(
      (action) => action.type === "raise"
    );

    if (!raise) {
      throw new Error("Expected a steal raise to be legal.");
    }

    const firstHand = runtime.submitUserAction(snapshot.tableId, {
      type: "raise",
      amount: raise.amount
    }).snapshot;
    const nextHand = runtime.startNextHand(firstHand.tableId).snapshot;

    expect(firstHand.status).toBe("hand_complete");
    expect(nextHand.hand.seats[0].hud.hands).toBe(2);
    expect(nextHand.hand.seats[0].hud.ats).toBe(1);
    expect(nextHand.hand.seats[0].hud.atsPct).toBe(100);
  });

  it("reports 3Bet as three-bets divided by three-bet opportunities", () => {
    const runtime = createRuntimeWithTableId("tbl_three_bet_test_58");
    const { snapshot } = runtime.createTable({
      ...baseCreateInput(4),
      startingStack: 1000,
      seed: "three-fixed-58",
      aiStyles: [
        "loose-aggressive",
        "loose-aggressive",
        "loose-aggressive"
      ] satisfies BotStyle[]
    });
    const threeBet = snapshot.hand.legalActions.find(
      (action) => action.type === "raise"
    );

    if (!threeBet) {
      throw new Error("Expected a 3Bet raise to be legal.");
    }

    let current = runtime.submitUserAction(snapshot.tableId, {
      type: "raise",
      amount: threeBet.amount
    }).snapshot;

    expect(current.hand.seats[0].hud.threeBet).toBe(1);

    current = completeHandWithPassiveActions(runtime, current);

    const nextHand = runtime.startNextHand(current.tableId).snapshot;

    expect(nextHand.hand.seats[0].hud.hands).toBe(2);
    expect(nextHand.hand.seats[0].hud.threeBet).toBe(1);
    expect(nextHand.hand.seats[0].hud.threeBetPct).toBe(100);
  });

  it("updates AI seat color tags and notes in the public snapshot", () => {
    const runtime = new TrainingTableRuntime();
    const { snapshot } = runtime.createTable(baseCreateInput(4));
    const updated = runtime.updateSeatProfile(snapshot.tableId, 1, {
      colorTag: "purple",
      note: "过度跟注"
    });

    expect(updated.snapshot.hand.seats[1]).toEqual(
      expect.objectContaining({
        colorTag: "purple",
        note: "过度跟注"
      })
    );
    expect(
      runtime
        .getPublicEvents(snapshot.tableId)
        .some((event) => event.type === "seat_profile_updated")
    ).toBe(true);
  });

  it("does not derive live side pots from unmatched current commitments", () => {
    const runtime = new TrainingTableRuntime();
    const { snapshot } = runtime.createTable(baseCreateInput(6));

    expect(snapshot.status).toBe("waiting_for_user");
    expect(snapshot.hand.pots).toEqual([]);
    expect(snapshot.hand.displayPots).toEqual([
      expect.objectContaining({
        label: "主池",
        amount: snapshot.hand.potTotal,
        eligibleSeatIndexes: expect.arrayContaining([0]),
        winnerSeatIndexes: [],
        share: null
      })
    ]);
  });

  it("projects fold-award winners across every settled display pot", () => {
    const runtime = new TrainingTableRuntime();
    const created = runtime.createTable({
      ...baseCreateInput(4),
      aiStyles: [
        "tight-passive",
        "tight-passive",
        "tight-passive"
      ] satisfies BotStyle[]
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
    expect(terminal.hand.awards[0]).toEqual(
      expect.objectContaining({
        winnerSeatIndexes: [0],
        share: terminal.hand.awards[0].potAmount
      })
    );
    expect(terminal.hand.displayPots.length).toBeGreaterThan(0);
    expect(
      terminal.hand.displayPots.every(
        (pot) => pot.winnerSeatIndexes[0] === 0 && pot.share === pot.amount
      )
    ).toBe(true);
    expect(
      terminal.hand.displayPots.reduce((sum, pot) => sum + pot.amount, 0)
    ).toBe(terminal.hand.awards[0].potAmount);
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

  it("auto-executes a matched hero preflop strategy through the legal action path", () => {
    const runtime = new TrainingTableRuntime();
    const created = runtime.createTable({
      ...baseCreateInput(4),
      heroPreflopStrategy: {
        id: "auto-fold-all",
        name: "Auto fold all",
        version: "test",
        mode: "auto",
        rules: [
          {
            id: "all-hands",
            label: "全部弃牌",
            facing: "any",
            handClasses: ["pair", "suited", "offsuit"],
            action: { kind: "fold" }
          }
        ]
      }
    });
    const events = runtime.getPublicEvents(created.snapshot.tableId);

    expect(created.snapshot.status).not.toBe("waiting_for_user");
    expect(
      events.some((event) => event.type === "strategy_auto_action_evaluated")
    ).toBe(true);
    expect(
      events.some((event) => event.type === "strategy_auto_action_submitted")
    ).toBe(true);
    expect(
      events.some(
        (event) =>
          event.type === "player_action" &&
          (event.payload as { seatIndex?: number; action?: string })
            .seatIndex === 0 &&
          (event.payload as { seatIndex?: number; action?: string }).action ===
            "fold"
      )
    ).toBe(true);
  });

  it("starts the next hand immediately after a hero fold in fast-fold mode", () => {
    const runtime = new TrainingTableRuntime();
    const created = runtime.createTable({
      ...baseCreateInput(4),
      tableMode: "fast_fold",
      aiStyles: [
        "tight-passive",
        "tight-passive",
        "tight-passive"
      ] satisfies BotStyle[]
    });
    const folded = runtime.submitUserAction(created.snapshot.tableId, {
      type: "fold"
    }).snapshot;
    const events = runtime.getPublicEvents(created.snapshot.tableId);
    const abandoned = events.find(
      (event) => event.type === "fast_fold_abandoned"
    );
    const fastFoldHandStarted = events.find(
      (event) =>
        event.type === "hand_started" &&
        (event.payload as { startReason?: unknown }).startReason === "fast_fold"
    );

    expect(folded.config.tableMode).toBe("fast_fold");
    expect(folded.hand.handId).not.toBe(created.snapshot.hand.handId);
    expect(abandoned?.payload).toEqual(
      expect.objectContaining({
        handId: created.snapshot.hand.handId,
        reason: "hero_fold",
        lifecycle: "fast_fold_abandoned"
      })
    );
    expect(fastFoldHandStarted?.payload).toEqual(
      expect.objectContaining({
        startReason: "fast_fold",
        tableMode: "fast_fold"
      })
    );
    expect(
      folded.hand.seats
        .filter((seat) => !seat.isHero)
        .some((seat) => /^pool-\d+-\d+$/.test(seat.playerId))
    ).toBe(true);
    expect(folded.hand.seats[0].hud.hands).toBe(2);
    expect(
      folded.hand.seats
        .filter((seat) => !seat.isHero)
        .every((seat) => seat.hud.hands === 1)
    ).toBe(true);
  });

  it("keeps abandoned fast-fold hands reviewable after starting the next hand", () => {
    const runtime = new TrainingTableRuntime();
    const created = runtime.createTable({
      ...baseCreateInput(4),
      tableMode: "fast_fold",
      aiStyles: [
        "tight-passive",
        "tight-passive",
        "tight-passive"
      ] satisfies BotStyle[]
    });
    const abandonedHandId = created.snapshot.hand.handId;

    const folded = runtime.submitUserAction(created.snapshot.tableId, {
      type: "fold"
    }).snapshot;
    const review = runtime.getHandReviewView(created.snapshot.tableId);

    expect(folded.hand.handId).not.toBe(abandonedHandId);
    expect(review.handId).toBe(abandonedHandId);
    expect(review.lifecycle).toBe("fast_fold_abandoned");
    expect(review.completionReason).toBe("fast_fold_abandoned");
    expect(
      review.timeline.some((event) => {
        const payload = event.payload as {
          seatIndex?: unknown;
          action?: unknown;
        };

        return (
          event.type === "player_action" &&
          payload.seatIndex === created.snapshot.config.heroSeatIndex &&
          payload.action === "fold"
        );
      })
    ).toBe(true);
    expect(
      review.seats
        .filter((seat) => !seat.isHero)
        .every((seat) => seat.holeCards.length === 0)
    ).toBe(true);
  });

  it("links auto-fold preflop strategy to fast-fold without looping forever", () => {
    const runtime = new TrainingTableRuntime();
    const created = runtime.createTable({
      ...baseCreateInput(4),
      tableMode: "fast_fold",
      heroPreflopStrategy: {
        id: "fast-auto-fold-all",
        name: "Fast auto fold all",
        version: "test",
        mode: "auto",
        rules: [
          {
            id: "all-hands",
            label: "全部弃牌",
            facing: "any",
            handClasses: ["pair", "suited", "offsuit"],
            action: { kind: "fold" }
          }
        ]
      }
    });
    const events = runtime.getPublicEvents(created.snapshot.tableId);
    const fastFoldEvents = events.filter(
      (event) => event.type === "fast_fold_abandoned"
    );

    expect(fastFoldEvents.length).toBeGreaterThan(0);
    expect(fastFoldEvents.length).toBeLessThanOrEqual(21);
    expect(created.snapshot.hand.handId).not.toBe(
      `${created.snapshot.tableId}-hand_000001`
    );
    expect(
      events.some((event) => event.type === "strategy_auto_action_submitted")
    ).toBe(true);
  });

  it("scopes hand review strategy execution events to the reviewed hand", () => {
    const runtime = new TrainingTableRuntime();
    const created = runtime.createTable({
      ...baseCreateInput(4),
      heroPreflopStrategy: {
        id: "auto-fold-all-hands",
        name: "Auto fold all hands",
        version: "test",
        mode: "auto",
        rules: [
          {
            id: "all-hands",
            label: "全部弃牌",
            facing: "any",
            handClasses: ["pair", "suited", "offsuit"],
            action: { kind: "fold" }
          }
        ]
      }
    });

    expect(created.snapshot.status).toBe("hand_complete");

    const firstReview = runtime.getHandReviewView(created.snapshot.tableId);
    const secondHand = runtime.startNextHand(created.snapshot.tableId).snapshot;

    expect(secondHand.status).toBe("hand_complete");

    const secondReview = runtime.getHandReviewView(secondHand.tableId);
    const firstDecisionPointIds = strategyDecisionPointIds(firstReview);
    const secondDecisionPointIds = strategyDecisionPointIds(secondReview);

    expect(firstDecisionPointIds.length).toBeGreaterThan(0);
    expect(secondDecisionPointIds.length).toBeGreaterThan(0);
    expect(
      firstDecisionPointIds.every((decisionPointId) =>
        decisionPointId.startsWith(`${firstReview.handId}:`)
      )
    ).toBe(true);
    expect(
      secondDecisionPointIds.every((decisionPointId) =>
        decisionPointId.startsWith(`${secondReview.handId}:`)
      )
    ).toBe(true);
    expect(
      secondDecisionPointIds.some((decisionPointId) =>
        decisionPointId.startsWith(`${firstReview.handId}:`)
      )
    ).toBe(false);
  });

  it("records preflop strategy suggestions without submitting when mode is suggest", () => {
    const runtime = new TrainingTableRuntime();
    const created = runtime.createTable({
      ...baseCreateInput(4),
      heroPreflopStrategy: {
        id: "suggest-fold-all",
        name: "Suggest fold all",
        version: "test",
        mode: "suggest",
        rules: [
          {
            id: "all-hands",
            label: "全部弃牌",
            facing: "any",
            handClasses: ["pair", "suited", "offsuit"],
            action: { kind: "fold" }
          }
        ]
      }
    });
    const events = runtime.getPublicEvents(created.snapshot.tableId);

    expect(created.snapshot.status).toBe("waiting_for_user");
    expect(created.snapshot.heroPreflopStrategy.current).toEqual(
      expect.objectContaining({
        status: "matched",
        ruleId: "all-hands"
      })
    );
    expect(
      events.some((event) => event.type === "strategy_auto_action_evaluated")
    ).toBe(true);
    expect(
      events.some((event) => event.type === "strategy_auto_action_submitted")
    ).toBe(false);
  });

  it("skips auto strategy while a hero coach request locks the decision point", () => {
    const runtime = new TrainingTableRuntime();
    const created = runtime.createTable({
      ...baseCreateInput(4),
      heroPreflopStrategy: {
        id: "manual-start",
        name: "Manual start",
        version: "test",
        mode: "off",
        rules: []
      }
    });
    const coach = runtime.beginHeroCoachRequest(created.snapshot.tableId);

    expect(coach.status).toBe("locked");

    const updated = runtime.updateHeroPreflopStrategy(
      created.snapshot.tableId,
      {
        config: {
          id: "auto-fold-after-lock",
          name: "Auto fold after lock",
          version: "test",
          mode: "auto",
          rules: [
            {
              id: "all-hands",
              label: "全部弃牌",
              facing: "any",
              handClasses: ["pair", "suited", "offsuit"],
              action: { kind: "fold" }
            }
          ]
        }
      }
    );

    expect(updated.snapshot.status).toBe("waiting_for_user");
    expect(updated.snapshot.heroPreflopStrategy.current).toBeNull();
    expect(
      runtime
        .getPublicEvents(created.snapshot.tableId)
        .some((event) => event.type === "strategy_auto_action_submitted")
    ).toBe(false);
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
      aiStyles: [
        "tight-passive",
        "tight-passive",
        "tight-passive"
      ] satisfies BotStyle[]
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

function createRuntimeWithTableId(tableId: string): TrainingTableRuntime {
  const runtime = new TrainingTableRuntime();

  vi.spyOn(
    runtime as unknown as { createTableId: () => string },
    "createTableId"
  ).mockReturnValue(tableId);

  return runtime;
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

function completeHandWithPassiveActions(
  runtime: TrainingTableRuntime,
  snapshot: TrainingTableSnapshot
): TrainingTableSnapshot {
  let current = snapshot;
  let guard = 0;

  while (current.status === "waiting_for_user") {
    if (guard++ > 50) {
      throw new Error("Test hand did not complete.");
    }

    current = runtime.submitUserAction(
      current.tableId,
      preferPassiveAction(current)
    ).snapshot;
  }

  expect(current.status).toBe("hand_complete");
  return current;
}

function strategyDecisionPointIds(view: HandReviewView): string[] {
  return view.strategyExecutionEvents.map((event) => {
    const evaluation = event.payload.evaluation as
      | { decisionPointId?: unknown }
      | undefined;

    return typeof evaluation?.decisionPointId === "string"
      ? evaluation.decisionPointId
      : "";
  });
}
