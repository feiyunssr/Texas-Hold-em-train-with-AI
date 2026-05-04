import { describe, expect, it } from "vitest";

import type { HeroCoachView } from "@/server/training-runtime/types";

import { validateHeroCoachAdvice } from "./hero-coach";

describe("validateHeroCoachAdvice", () => {
  it("rejects bet and raise amounts outside the legal range", () => {
    expect(() =>
      validateHeroCoachAdvice(
        {
          ...validAdvice(),
          primaryAction: "raise",
          suggestedBetAmount: 20
        },
        coachView()
      )
    ).toThrow("suggestedBetAmount must be between 40 and 120 for raise.");
  });

  it("rejects exact-amount actions with mismatched supplied amounts", () => {
    expect(() =>
      validateHeroCoachAdvice(
        {
          ...validAdvice(),
          primaryAction: "call",
          suggestedBetAmount: 30
        },
        coachView()
      )
    ).toThrow("suggestedBetAmount must be exactly 25 for call.");

    expect(() =>
      validateHeroCoachAdvice(
        {
          ...validAdvice(),
          acceptableAlternatives: [
            {
              action: "all-in",
              amount: 119,
              reason: "pressure"
            }
          ]
        },
        coachView()
      )
    ).toThrow("alternative.amount must be exactly 120 for all-in.");
  });

  it("accepts legal ranged and exact supplied amounts", () => {
    const advice = validateHeroCoachAdvice(
      {
        ...validAdvice(),
        primaryAction: "raise",
        suggestedBetAmount: 80,
        acceptableAlternatives: [
          {
            action: "call",
            amount: 25,
            reason: "close pot odds"
          },
          {
            action: "all-in",
            amount: 120,
            reason: "maximum pressure"
          }
        ]
      },
      coachView()
    );

    expect(advice.primaryAction).toBe("raise");
    expect(advice.suggestedBetAmount).toBe(80);
  });
});

function validAdvice() {
  return {
    primaryAction: "call",
    suggestedBetAmount: null,
    acceptableAlternatives: [
      {
        action: "fold",
        amount: null,
        reason: "avoid marginal spot"
      }
    ],
    keyFactors: ["pot odds", "position"],
    riskNote: "Current street only."
  };
}

function coachView(): HeroCoachView {
  return {
    tableId: "table-1",
    handId: "hand-1",
    decisionPointId: "hand-1:10",
    actingSeatIndex: 0,
    tableConfig: {
      playerCount: 4,
      smallBlind: 10,
      bigBlind: 20,
      startingStack: 200,
      heroSeatIndex: 0,
      buttonSeat: 0,
      ante: 0,
      aiStyles: [
        "balanced",
        "tight-passive",
        "loose-passive",
        "loose-aggressive"
      ],
      tableMode: "standard"
    },
    street: "preflop",
    board: [],
    heroHoleCards: ["As", "Ah"],
    potTotal: 70,
    pots: [
      {
        amount: 70,
        eligibleSeatIndexes: [0, 1, 2, 3]
      }
    ],
    currentBet: 25,
    eventSequence: 10,
    legalActions: [
      { type: "fold" },
      { type: "call", amount: 25, toCall: 25 },
      {
        type: "raise",
        amount: 40,
        minAmount: 40,
        maxAmount: 120,
        totalBetTo: 65
      },
      { type: "all-in", amount: 120, totalBetTo: 145 }
    ],
    seats: [
      {
        seatIndex: 0,
        playerId: "hero",
        displayName: "Hero",
        isHero: true,
        style: "hero",
        colorTag: "none",
        note: "",
        stack: 120,
        effectiveStackAgainstHero: 120,
        status: "active",
        streetCommitment: 25,
        totalCommitment: 25,
        position: "button"
      }
    ],
    bettingHistory: []
  };
}
