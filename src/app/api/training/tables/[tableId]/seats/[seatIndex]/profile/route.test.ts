import { describe, expect, it } from "vitest";

import { TrainingRuntimeError } from "@/server/training-runtime";

import { parseSeatIndexRouteSegment } from "./route";

describe("training seat profile route", () => {
  it("parses complete integer seat route segments", () => {
    expect(parseSeatIndexRouteSegment("0")).toBe(0);
    expect(parseSeatIndexRouteSegment("12")).toBe(12);
  });

  it("rejects partially parsed seat route segments", () => {
    expect(() => parseSeatIndexRouteSegment("1abc")).toThrow(
      TrainingRuntimeError
    );
    expect(() => parseSeatIndexRouteSegment("-1")).toThrow(
      TrainingRuntimeError
    );
  });
});
