import {
  bubbleMessageMaxLength,
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
        text: "\n\t",
      })._unsafeUnwrapErr(),
    ).toEqual({
      reason: "empty",
    });
  });

  it("drops messages inside the rate-limit window", () => {
    expect(
      evaluateBubbleMessage({ lastAcceptedAt: 1_000, now: 1_299, text: "next" })._unsafeUnwrapErr(),
    ).toEqual({
      reason: "rate-limited",
    });
  });

  it("accepts sanitized messages outside the rate-limit window", () => {
    expect(
      evaluateBubbleMessage({ lastAcceptedAt: 1_000, now: 1_300, text: " next " })._unsafeUnwrap(),
    ).toEqual({
      acceptedAt: 1_300,
      text: "next",
    });
  });

  describe("createBubbleMessageGate", () => {
    it("accepts the first message, rejects within 300ms, and accepts after the interval", () => {
      const gate = createBubbleMessageGate();

      expect(gate.accept(" first ", 1_000)._unsafeUnwrap()).toEqual({
        acceptedAt: 1_000,
        text: "first",
      });
      expect(gate.accept("next", 1_299)._unsafeUnwrapErr()).toEqual({
        reason: "rate-limited",
      });
      expect(gate.accept("next", 1_300)._unsafeUnwrap()).toEqual({
        acceptedAt: 1_300,
        text: "next",
      });
    });

    it("rejects empty text without consuming the rate-limit slot", () => {
      const gate = createBubbleMessageGate();

      expect(gate.accept("\n\t", 1_000)._unsafeUnwrapErr()).toEqual({
        reason: "empty",
      });
      expect(gate.accept("first", 1_001)._unsafeUnwrap()).toEqual({
        acceptedAt: 1_001,
        text: "first",
      });
    });
  });
});
