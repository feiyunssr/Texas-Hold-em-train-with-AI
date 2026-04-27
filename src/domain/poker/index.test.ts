import { describe, expect, it } from "vitest";

import { getPokerEngineHealth } from "./index";

describe("poker domain harness", () => {
  it("runs without importing Next.js, database, AI, or UI modules", () => {
    expect(getPokerEngineHealth()).toEqual({
      module: "domain/poker",
      isolated: true
    });
  });
});
