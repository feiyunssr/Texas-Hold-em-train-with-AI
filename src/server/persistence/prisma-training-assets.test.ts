import { describe, expect, it, vi } from "vitest";

import { PrismaTrainingAssetRepository } from "./prisma-training-assets";

describe("PrismaTrainingAssetRepository read models", () => {
  it("pushes street filtering into the Prisma query before limiting", async () => {
    const prisma = {
      hand: {
        findMany: vi.fn(async () => [])
      }
    };
    const repository = new PrismaTrainingAssetRepository(prisma as never);

    await repository.listHandHistory("demo-user", 20, { street: "river" });

    expect(prisma.hand.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([
            expect.objectContaining({
              OR: expect.arrayContaining([
                expect.objectContaining({
                  labelAssignments: {
                    some: {
                      street: "river"
                    }
                  }
                }),
                expect.objectContaining({
                  eventLogs: {
                    some: {
                      payload: {
                        path: ["reviewStreet"],
                        equals: "river"
                      }
                    }
                  }
                }),
                expect.objectContaining({
                  eventLogs: {
                    some: {
                      payload: {
                        path: ["street"],
                        equals: "river"
                      }
                    }
                  }
                })
              ])
            })
          ])
        }),
        take: 100
      })
    );
  });

  it("computes hero profit from this hand's starting stack", async () => {
    const prisma = {
      hand: {
        findMany: vi.fn(async () => [
          handRecord({
            finalStack: 1100,
            eventLogs: [
              eventRecord(1, "hand_started", {
                playerCount: 4,
                startingStacks: [1200, 1000, 1000, 1000]
              })
            ]
          })
        ])
      }
    };
    const repository = new PrismaTrainingAssetRepository(prisma as never);

    const rows = await repository.listHandHistory("demo-user", 10);

    expect(rows[0]).toEqual(
      expect.objectContaining({
        heroProfit: -100,
        heroProfitBB: -5,
        result: "loss"
      })
    );
  });

  it("seeds replay stacks from the hand_started starting stacks", async () => {
    const prisma = {
      hand: {
        findFirst: vi.fn(async () =>
          handRecord({
            finalStack: 1190,
            eventLogs: [
              eventRecord(1, "hand_started", {
                playerCount: 4,
                startingStacks: [1200, 1000, 1000, 1000]
              }),
              eventRecord(2, "forced_bet_posted", {
                seatIndex: 0,
                kind: "small_blind",
                amount: 10
              })
            ]
          })
        )
      }
    };
    const repository = new PrismaTrainingAssetRepository(prisma as never);

    const replay = await repository.getHandReplay("hand-1", "demo-user");

    expect(replay?.steps.map((step) => step.heroStack)).toEqual([1200, 1190]);
  });
});

function handRecord({
  finalStack,
  eventLogs
}: {
  finalStack: number;
  eventLogs: ReturnType<typeof eventRecord>[];
}) {
  return {
    id: "hand-1",
    tableConfigId: "table-1",
    userId: "demo-user",
    status: "COMPLETED",
    startedAt: new Date("2026-05-04T00:00:00.000Z"),
    completedAt: new Date("2026-05-04T00:01:00.000Z"),
    completionReason: "showdown",
    heroSeatIndex: 0,
    finalStatePayload: {
      seats: [
        {
          seatIndex: 0,
          stack: finalStack
        }
      ]
    },
    tableConfig: {
      playerCount: 4,
      startingStack: 1000,
      buttonSeat: 0,
      smallBlind: 10,
      bigBlind: 20,
      seatProfiles: [
        {
          seatIndex: 0,
          isHero: true,
          styleProfile: {
            position: "button",
            style: "hero"
          }
        },
        {
          seatIndex: 1,
          isHero: false,
          styleProfile: {
            style: "balanced"
          }
        }
      ]
    },
    eventLogs,
    aiArtifacts: [],
    decisionSnapshots: [],
    labelAssignments: []
  };
}

function eventRecord(
  sequence: number,
  eventType: string,
  payload: Record<string, unknown>
) {
  return {
    id: `event-${sequence}`,
    handId: "hand-1",
    sequence,
    eventType,
    payload,
    schemaVersion: 1,
    createdAt: new Date("2026-05-04T00:00:00.000Z")
  };
}
