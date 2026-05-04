import { describe, expect, it } from "vitest";

import { buildReviewEventLogEntries } from "./persistence";
import type { HandReviewView } from "./types";

describe("training runtime persistence", () => {
  it("orders strategy audit events beside the decision point they describe", () => {
    const entries = buildReviewEventLogEntries({
      handId: "hand-1",
      timeline: [
        handEvent(1, "player_action"),
        handEvent(2, "player_action"),
        handEvent(3, "hand_completed")
      ],
      strategyExecutionEvents: [
        strategyEvent(9, "strategy_auto_action_evaluated", 1),
        strategyEvent(10, "strategy_auto_action_submitted", 1)
      ]
    } as unknown as HandReviewView);

    expect(
      entries.map((event) => [event.sequence, event.eventType])
    ).toEqual([
      [1000, "player_action"],
      [1001, "strategy_auto_action_evaluated"],
      [1002, "strategy_auto_action_submitted"],
      [2000, "player_action"],
      [3000, "hand_completed"]
    ]);
    expect(entries[1].payload).toEqual(
      expect.objectContaining({
        decisionSequence: 1,
        runtimeSequence: 9,
        reviewStreet: "preflop"
      })
    );
  });
});

function handEvent(sequence: number, type: string) {
  return {
    sequence,
    street: "preflop",
    type,
    payload: {}
  };
}

function strategyEvent(sequence: number, type: string, decisionSequence: number) {
  return {
    sequence,
    type,
    createdAt: "2026-05-04T00:00:00.000Z",
    payload: {
      evaluation: {
        decisionPointId: `hand-1:preflop:seat-0:event-${decisionSequence}`
      }
    }
  };
}
