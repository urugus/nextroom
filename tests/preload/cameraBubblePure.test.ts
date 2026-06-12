import { describe, expect, it } from "vitest";
import {
  computeBubbleAlpha,
  computeBubbleLayout,
  computeCanvasSize,
  computeOverlayBox,
  hasVideoConstraints,
  isDisplayCaptureLike,
  parseCameraBubbleEnvelope,
  scoreSelfViewCandidate,
  wrapBubbleLines,
} from "../../src/preload/cameraBubblePure";

const measureByCodePoint = (text: string): number => [...text].length * 10;
const expectedNonce = "nonce-1";

describe("camera bubble pure functions", () => {
  describe("hasVideoConstraints", () => {
    it("accepts present video constraints and rejects absent or disabled video", () => {
      expect(hasVideoConstraints({ video: true })).toBe(true);
      expect(hasVideoConstraints({ video: { width: 640 } })).toBe(true);
      expect(hasVideoConstraints({ audio: true })).toBe(false);
      expect(hasVideoConstraints({ video: false })).toBe(false);
      expect(hasVideoConstraints({ video: undefined })).toBe(false);
    });
  });

  describe("computeCanvasSize", () => {
    it("uses positive track settings and falls back for missing or invalid values", () => {
      expect(computeCanvasSize({ height: 360, width: 640 })).toEqual({ height: 360, width: 640 });
      expect(computeCanvasSize({ height: 0, width: -1 })).toEqual({ height: 720, width: 1280 });
      expect(computeCanvasSize({})).toEqual({ height: 720, width: 1280 });
    });
  });

  describe("isDisplayCaptureLike", () => {
    it("detects display capture from settings and conservative label heuristics", () => {
      expect(isDisplayCaptureLike({ displaySurface: "browser" }, "Camera")).toBe(true);
      expect(isDisplayCaptureLike({}, "Main Screen")).toBe(true);
      expect(isDisplayCaptureLike({}, "Window Capture")).toBe(true);
      expect(isDisplayCaptureLike({}, "Display 1")).toBe(true);
      expect(isDisplayCaptureLike({}, "FaceTime HD Camera")).toBe(false);
    });
  });

  describe("scoreSelfViewCandidate", () => {
    it("rejects invisible candidates and accepts strong self-view signals at score four or more", () => {
      expect(
        scoreSelfViewCandidate({
          aspectDelta: 0,
          hasDisplaySurface: false,
          isPipelineSource: true,
          muted: true,
          playsInline: true,
          visible: false,
        }),
      ).toBe(0);
      expect(
        scoreSelfViewCandidate({
          aspectDelta: 0.1,
          hasDisplaySurface: false,
          isPipelineSource: true,
          muted: true,
          playsInline: true,
          visible: true,
        }),
      ).toBe(10);
      expect(
        scoreSelfViewCandidate({
          aspectDelta: 0.5,
          hasDisplaySurface: true,
          isPipelineSource: false,
          muted: false,
          playsInline: false,
          visible: true,
        }),
      ).toBe(2);
    });
  });

  describe("computeOverlayBox", () => {
    it("places the overlay inside the top-right of the video rectangle", () => {
      expect(
        computeOverlayBox({
          rectHeight: 200,
          rectLeft: 100,
          rectTop: 50,
          rectWidth: 400,
        }),
      ).toEqual({
        fontSize: 14,
        left: 252,
        maxWidth: 240,
        right: 492,
        top: 58,
      });
    });
  });

  describe("wrapBubbleLines", () => {
    it("wraps Japanese text without spaces", () => {
      expect(wrapBubbleLines(measureByCodePoint, "こんにちは世界", 30, 3)).toEqual([
        "こんに",
        "ちは世",
        "界",
      ]);
    });

    it("wraps emoji by code point without dropping or duplicating characters", () => {
      const lines = wrapBubbleLines(measureByCodePoint, "👍".repeat(6), 20, 6);

      expect(lines).toEqual(["👍👍", "👍👍", "👍👍"]);
      expect(lines.join("")).toBe("👍".repeat(6));
    });

    it("adds an ellipsis on overflow without splitting surrogate pairs", () => {
      expect(wrapBubbleLines(measureByCodePoint, "👍".repeat(8), 20, 3)).toEqual([
        "👍👍",
        "👍👍",
        "👍…",
      ]);
    });

    it("caps output at maxLines", () => {
      expect(wrapBubbleLines(measureByCodePoint, "abcdef", 10, 2)).toEqual(["a", "…"]);
    });

    it("trims the final line until the ellipsis fits", () => {
      expect(wrapBubbleLines(measureByCodePoint, "abcd", 30, 1)).toEqual(["ab…"]);
    });
  });

  describe("computeBubbleAlpha", () => {
    it("returns full alpha before fade, partial alpha during fade, and zero when expired", () => {
      expect(computeBubbleAlpha(1_000, 2_000, 500)).toBe(1);
      expect(computeBubbleAlpha(1_750, 2_000, 500)).toBe(0.5);
      expect(computeBubbleAlpha(2_000, 2_000, 500)).toBe(0);
      expect(computeBubbleAlpha(2_001, 2_000, 500)).toBe(0);
    });
  });

  describe("computeBubbleLayout", () => {
    it("matches the camera bubble geometry and clamps width and x", () => {
      const layout = computeBubbleLayout({
        canvasHeight: 720,
        canvasWidth: 1280,
        lineCount: 2,
        maxLineWidth: 1_000,
      });

      expect(layout.fontSize).toBe(40);
      expect(layout.padding).toBe(20);
      expect(layout.lineHeight).toBe(49);
      expect(layout.margin).toBe(29);
      expect(layout.maxBubbleWidth).toBe(576);
      expect(layout.textMaxWidth).toBe(536);
      expect(layout.width).toBe(layout.maxBubbleWidth);
      expect(layout.x).toBeGreaterThanOrEqual(layout.margin);
    });
  });

  describe("parseCameraBubbleEnvelope", () => {
    it("accepts show messages with coerced trimmed text", () => {
      expect(
        parseCameraBubbleEnvelope(
          {
            __nextroomCameraBubble: { kind: "show", nonce: expectedNonce, text: " 発言中です " },
          },
          expectedNonce,
        ),
      ).toEqual({ durationMs: 7_000, kind: "show", text: "発言中です" });
      expect(
        parseCameraBubbleEnvelope(
          {
            __nextroomCameraBubble: { kind: "show", nonce: expectedNonce, text: 123 },
          },
          expectedNonce,
        ),
      ).toEqual({ durationMs: 7_000, kind: "show", text: "123" });
    });

    it("accepts, clamps, and falls back show message duration", () => {
      expect(
        parseCameraBubbleEnvelope(
          {
            __nextroomCameraBubble: {
              durationMs: 2_345,
              kind: "show",
              nonce: expectedNonce,
              text: "hello",
            },
          },
          expectedNonce,
        ),
      ).toEqual({ durationMs: 2_345, kind: "show", text: "hello" });
      expect(
        parseCameraBubbleEnvelope(
          {
            __nextroomCameraBubble: {
              durationMs: 999,
              kind: "show",
              nonce: expectedNonce,
              text: "hello",
            },
          },
          expectedNonce,
        ),
      ).toEqual({ durationMs: 2_000, kind: "show", text: "hello" });
      expect(
        parseCameraBubbleEnvelope(
          {
            __nextroomCameraBubble: {
              durationMs: 30_001,
              kind: "show",
              nonce: expectedNonce,
              text: "hello",
            },
          },
          expectedNonce,
        ),
      ).toEqual({ durationMs: 20_000, kind: "show", text: "hello" });
      expect(
        parseCameraBubbleEnvelope(
          {
            __nextroomCameraBubble: {
              durationMs: Number.NaN,
              kind: "show",
              nonce: expectedNonce,
              text: "hello",
            },
          },
          expectedNonce,
        ),
      ).toEqual({ durationMs: 7_000, kind: "show", text: "hello" });
    });

    it("accepts setEnabled with strict true and coerces all other values to false", () => {
      expect(
        parseCameraBubbleEnvelope(
          {
            __nextroomCameraBubble: { enabled: true, kind: "setEnabled", nonce: expectedNonce },
          },
          expectedNonce,
        ),
      ).toEqual({ enabled: true, kind: "setEnabled" });
      expect(
        parseCameraBubbleEnvelope(
          {
            __nextroomCameraBubble: { enabled: "true", kind: "setEnabled", nonce: expectedNonce },
          },
          expectedNonce,
        ),
      ).toEqual({ enabled: false, kind: "setEnabled" });
    });

    it("rejects missing or mismatched nonces", () => {
      expect(
        parseCameraBubbleEnvelope(
          {
            __nextroomCameraBubble: { kind: "show", text: "hello" },
          },
          expectedNonce,
        ),
      ).toBeUndefined();
      expect(
        parseCameraBubbleEnvelope(
          {
            __nextroomCameraBubble: { kind: "show", nonce: "other", text: "hello" },
          },
          expectedNonce,
        ),
      ).toBeUndefined();
      expect(
        parseCameraBubbleEnvelope(
          {
            __nextroomCameraBubble: { kind: "show", nonce: expectedNonce, text: "hello" },
          },
          undefined as unknown as string,
        ),
      ).toBeUndefined();
    });

    it("rejects missing envelopes, unknown kinds, and empty text", () => {
      expect(parseCameraBubbleEnvelope(null, expectedNonce)).toBeUndefined();
      expect(parseCameraBubbleEnvelope({}, expectedNonce)).toBeUndefined();
      expect(
        parseCameraBubbleEnvelope({ __nextroomCameraBubble: null }, expectedNonce),
      ).toBeUndefined();
      expect(
        parseCameraBubbleEnvelope(
          {
            __nextroomCameraBubble: { kind: "show", nonce: expectedNonce, text: "   " },
          },
          expectedNonce,
        ),
      ).toBeUndefined();
      expect(
        parseCameraBubbleEnvelope(
          {
            __nextroomCameraBubble: { kind: "unknown", nonce: expectedNonce, text: "hello" },
          },
          expectedNonce,
        ),
      ).toBeUndefined();
    });
  });
});
