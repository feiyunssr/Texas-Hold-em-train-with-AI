import { describe, expect, it } from "vitest";

import {
  classifyStartingHand,
  evaluatePreflopStrategy,
  type PreflopStrategyConfig,
  type PreflopStrategyContext
} from "./index";

describe("preflop strategy", () => {
  it("classifies pair, suited and offsuit starting hands", () => {
    expect(classifyStartingHand(["As", "Ah"])).toBe("AA");
    expect(classifyStartingHand(["Ks", "As"])).toBe("AKs");
    expect(classifyStartingHand(["2d", "Ac"])).toBe("A2o");
  });

  it("maps an unopened premium range to a legal open raise", () => {
    const evaluation = evaluatePreflopStrategy(premiumOpenConfig(), {
      ...baseContext(),
      heroHoleCards: ["As", "Ah"],
      facing: "unopened",
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

    expect(evaluation.status).toBe("matched");
    if (evaluation.status === "matched") {
      expect(evaluation.startingHand).toBe("AA");
      expect(evaluation.action).toEqual({
        seatIndex: 0,
        type: "raise",
        amount: 50
      });
    }
  });

  it("uses deterministic mix selection for the same decision point", () => {
    const config = premiumOpenConfig();
    config.rules[0].action = {
      kind: "mix",
      options: [
        { weight: 70, action: { kind: "open_raise", raiseToBb: 2.5 } },
        { weight: 30, action: { kind: "fold" } }
      ]
    };
    const context = {
      ...baseContext(),
      heroHoleCards: ["As", "Ks"] as ["As", "Ks"]
    };

    expect(evaluatePreflopStrategy(config, context)).toEqual(
      evaluatePreflopStrategy(config, context)
    );
  });

  it("skips safely when configured raise size is outside legal bounds", () => {
    const evaluation = evaluatePreflopStrategy(premiumOpenConfig(), {
      ...baseContext(),
      legalActions: [
        { type: "fold" },
        { type: "call", amount: 20, toCall: 20 },
        {
          type: "raise",
          amount: 40,
          minAmount: 40,
          maxAmount: 45,
          totalBetTo: 40
        }
      ]
    });

    expect(evaluation).toEqual(
      expect.objectContaining({
        status: "skipped",
        reason: "raise_amount_out_of_legal_range"
      })
    );
  });
});

function premiumOpenConfig(): PreflopStrategyConfig {
  return {
    id: "premium-open",
    name: "Premium open",
    version: "test",
    mode: "auto",
    rules: [
      {
        id: "open-premium",
        label: "强牌开池",
        facing: "unopened",
        matrix: {
          AA: true,
          AKs: true
        },
        action: {
          kind: "open_raise",
          raiseToBb: 2.5
        }
      }
    ],
    defaultAction: { kind: "fold" }
  };
}

function baseContext(): PreflopStrategyContext {
  return {
    handId: "hand-1",
    decisionPointId: "hand-1:preflop:seat-0:event-10",
    heroSeatIndex: 0,
    heroHoleCards: ["As", "Ah"],
    position: "button",
    effectiveStackBb: 100,
    facing: "unopened",
    previousRaiseSizeBb: null,
    hasStraddle: false,
    tableSize: 6,
    bigBlind: 20,
    streetCommitment: 0,
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
  };
}
