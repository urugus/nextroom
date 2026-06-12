import {
  bubbleMessageMaxLength,
  computeBubbleDisplayDurationMs,
  createBubbleMessageGate,
  evaluateBubbleMessage,
  sanitizeBubbleMessageText,
} from "@main/meet/bubbleMessage";
import { describe, expect, it } from "vitest";

describe("bubble message", () => {
  it("trims, collapses newlines, and strips control characters", () => {
    expect(sanitizeBubbleMessageText("  hello\nworld\r\n\u0000now\t  ")).toBe("hello world now");
  });

  it("clamps to 100 characters", () => {
    expect(sanitizeBubbleMessageText("あ".repeat(120))).toHaveLength(bubbleMessageMaxLength);
  });

  it("rejects empty sanitized messages", () => {
    expect(
      evaluateBubbleMessage({
        lastAcceptedAt: undefined,
        now: 1_000,
        speedLevel: 3,
        text: "\n\t",
      })._unsafeUnwrapErr(),
    ).toEqual({
      reason: "empty",
    });
  });

  it("drops messages inside the rate-limit window", () => {
    expect(
      evaluateBubbleMessage({
        lastAcceptedAt: 1_000,
        now: 1_299,
        speedLevel: 3,
        text: "next",
      })._unsafeUnwrapErr(),
    ).toEqual({
      reason: "rate-limited",
    });
  });

  it("accepts sanitized messages outside the rate-limit window", () => {
    expect(
      evaluateBubbleMessage({
        lastAcceptedAt: 1_000,
        now: 1_300,
        speedLevel: 3,
        text: " next ",
      })._unsafeUnwrap(),
    ).toEqual({
      acceptedAt: 1_300,
      durationMs: 3_100,
      text: "next",
    });
  });

  it("computes display duration from code points and speed level", () => {
    expect(computeBubbleDisplayDurationMs(10, 3)).toBe(4_000);
    expect(computeBubbleDisplayDurationMs(0, 5)).toBe(2_000);
    expect(computeBubbleDisplayDurationMs(100, 1)).toBe(20_000);
    expect(computeBubbleDisplayDurationMs(10, 99)).toBe(2_200);
    expect(computeBubbleDisplayDurationMs(10, Number.NaN)).toBe(4_000);
  });

  it("counts emoji by code point for display duration", () => {
    expect(
      evaluateBubbleMessage({
        lastAcceptedAt: undefined,
        now: 1_000,
        speedLevel: 3,
        text: "👍".repeat(10),
      })._unsafeUnwrap(),
    ).toMatchObject({
      durationMs: 4_000,
      text: "👍".repeat(10),
    });
  });

  describe("createBubbleMessageGate", () => {
    it("accepts the first message, rejects within 300ms, and accepts after the interval", () => {
      const gate = createBubbleMessageGate();

      expect(gate.accept(" first ", 1_000, 3)._unsafeUnwrap()).toEqual({
        acceptedAt: 1_000,
        durationMs: 3_250,
        text: "first",
      });
      expect(gate.accept("next", 1_299, 3)._unsafeUnwrapErr()).toEqual({
        reason: "rate-limited",
      });
      expect(gate.accept("next", 1_300, 3)._unsafeUnwrap()).toEqual({
        acceptedAt: 1_300,
        durationMs: 3_100,
        text: "next",
      });
    });

    it("rejects empty text without consuming the rate-limit slot", () => {
      const gate = createBubbleMessageGate();

      expect(gate.accept("\n\t", 1_000, 3)._unsafeUnwrapErr()).toEqual({
        reason: "empty",
      });
      expect(gate.accept("first", 1_001, 3)._unsafeUnwrap()).toEqual({
        acceptedAt: 1_001,
        durationMs: 3_250,
        text: "first",
      });
    });
  });
});
