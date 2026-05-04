import { describe, expect, it } from "vitest";

import { chooseBotStrategyAction, normalizeBotStyle } from "./index";
import type { BotSeatStrategyView } from "./index";

describe("bot strategy", () => {
  it("maps legacy styles to expanded M9 styles", () => {
    expect(normalizeBotStyle("tight")).toBe("tight-passive");
    expect(normalizeBotStyle("loose")).toBe("loose-passive");
    expect(normalizeBotStyle("aggressive")).toBe("loose-aggressive");
    expect(normalizeBotStyle("balanced")).toBe("balanced");
  });

  it("uses only the acting bot visible cards and returns a trace", () => {
    const result = chooseBotStrategyAction({
      ...baseView(),
      style: "tight-aggressive",
      seats: [
        visibleSeat(0, ["As", "Ah"]),
        visibleSeat(1, null),
        visibleSeat(2, null),
        visibleSeat(3, null, true)
      ],
      legalActions: [
        { type: "fold" },
        { type: "call", amount: 20, toCall: 20 },
        {
          type: "raise",
          amount: 40,
          minAmount: 40,
          maxAmount: 200,
          totalBetTo: 40
        }
      ]
    });

    expect(["raise", "call", "all-in"]).toContain(result.action.type);
    expect(result.trace.reason).toContain("AA");
    expect(result.trace.selectedAction).toEqual(result.action);
  });

  it("does not reduce every postflop no-pressure decision to check", () => {
    const result = chooseBotStrategyAction({
      ...baseView(),
      handId: "hand-value-bet",
      street: "flop",
      board: ["Ah", "Ad", "7c"],
      currentBet: 0,
      potTotal: 120,
      style: "loose-aggressive",
      seats: [
        visibleSeat(0, ["As", "Ac"]),
        visibleSeat(1, null),
        visibleSeat(2, null),
        visibleSeat(3, null, true)
      ],
      legalActions: [
        { type: "check", amount: 0 },
        {
          type: "bet",
          amount: 20,
          minAmount: 20,
          maxAmount: 200,
          totalBetTo: 20
        },
        { type: "all-in", amount: 200, totalBetTo: 200 }
      ]
    });

    expect(result.action.type).toBe("bet");
    expect(result.trace.bucket).toContain("value-pressure");
  });
});

function baseView(): BotSeatStrategyView {
  return {
    tableId: "table-1",
    handId: "hand-1",
    seatIndex: 0,
    style: "balanced",
    street: "preflop",
    board: [],
    potTotal: 30,
    currentBet: 20,
    currentActorSeat: 0,
    heroSeatIndex: 3,
    buttonSeat: 0,
    smallBlindSeat: 1,
    bigBlindSeat: 2,
    bigBlind: 20,
    seats: [
      visibleSeat(0, ["Ks", "Qs"]),
      visibleSeat(1, null),
      visibleSeat(2, null),
      visibleSeat(3, null, true)
    ],
    legalActions: [],
    visibleActionHistory: []
  };
}

function visibleSeat(
  seatIndex: number,
  holeCards: ["As", "Ah"] | ["Ks", "Qs"] | ["As", "Ac"] | null,
  isHero = false
) {
  return {
    seatIndex,
    stack: 200,
    status: "active" as const,
    streetCommitment: seatIndex === 2 ? 20 : seatIndex === 1 ? 10 : 0,
    totalCommitment: seatIndex === 2 ? 20 : seatIndex === 1 ? 10 : 0,
    isHero,
    style: isHero ? ("hero" as const) : ("balanced" as const),
    holeCards
  };
}
