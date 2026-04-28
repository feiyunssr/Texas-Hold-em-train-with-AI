import { describe, expect, it } from "vitest";

import { resolveReplayAfterSequence } from "./route";

describe("training table SSE route", () => {
  it("uses Last-Event-ID before the query cursor for EventSource reconnects", () => {
    const request = new Request(
      "http://localhost/api/training/tables/t/events",
      {
        headers: {
          "Last-Event-ID": "17"
        }
      }
    );
    const url = new URL(
      "http://localhost/api/training/tables/t/events?after=3"
    );

    expect(resolveReplayAfterSequence(request, url)).toBe(17);
  });

  it("falls back to the query cursor and ignores invalid replay cursors", () => {
    const queryOnlyRequest = new Request(
      "http://localhost/api/training/tables/t/events"
    );
    const invalidHeaderRequest = new Request(
      "http://localhost/api/training/tables/t/events",
      {
        headers: {
          "Last-Event-ID": "not-a-sequence"
        }
      }
    );
    const url = new URL(
      "http://localhost/api/training/tables/t/events?after=9"
    );

    expect(resolveReplayAfterSequence(queryOnlyRequest, url)).toBe(9);
    expect(resolveReplayAfterSequence(invalidHeaderRequest, url)).toBe(9);
  });
});
