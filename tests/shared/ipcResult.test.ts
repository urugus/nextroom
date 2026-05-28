import { toApiResult } from "@shared/ipc";
import { err, ok } from "neverthrow";
import { describe, expect, it } from "vitest";

describe("toApiResult", () => {
  it("serializes Ok values for IPC", () => {
    expect(toApiResult(ok({ connected: true }))).toEqual({
      ok: true,
      value: { connected: true },
    });
  });

  it("serializes AppError values for IPC", () => {
    const result = toApiResult(err({ type: "MeetUrlNotFound", eventId: "event-1" }));

    expect(result).toEqual({
      ok: false,
      error: {
        type: "MeetUrlNotFound",
        message: "No Google Meet URL was found for event event-1.",
        recoverable: false,
      },
    });
  });
});
