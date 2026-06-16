import { describe, expect, it } from "vitest";
import {
  computeBubbleAlpha,
  computeBubbleAnimation,
  computeBubbleDisplayDurationMs,
  computeBubbleLayout,
  computeCanvasSize,
  computeDanmakuLane,
  computeDanmakuPosition,
  computeDanmakuTextStyle,
  computeOverlayBox,
  hasVideoConstraints,
  isDisplayCaptureLike,
  parseCameraBubbleEnvelope,
  sanitizeBubbleText,
  scoreSelfViewCandidate,
  shouldMirrorChatKey,
  wrapBubbleLines,
} from "../../src/preload/cameraBubblePure";

const measureByCodePoint = (text: string): number => [...text].length * 10;
const expectedNonce = "nonce-1";

describe("camera bubble pure functions", () => {
  describe("sanitizeBubbleText", () => {
    it("trims, collapses newlines, strips control characters, and clamps to 100 code points", () => {
      expect(sanitizeBubbleText("  hello\nworld\r\n\u0000now\t  ")).toBe("hello world now");
      expect([...sanitizeBubbleText("👍".repeat(120))]).toHaveLength(100);
    });
  });

  describe("computeBubbleDisplayDurationMs", () => {
    it("computes display duration from code points and speed level", () => {
      expect(computeBubbleDisplayDurationMs(10, 3)).toBe(4_000);
      expect(computeBubbleDisplayDurationMs(0, 5)).toBe(2_000);
      expect(computeBubbleDisplayDurationMs(100, 1)).toBe(20_000);
      expect(computeBubbleDisplayDurationMs(10, 99)).toBe(2_200);
      expect(computeBubbleDisplayDurationMs(10, Number.NaN)).toBe(4_000);
    });
  });

  describe("computeBubbleAnimation", () => {
    it("eases the bubble in and fades it out near expiry", () => {
      expect(
        computeBubbleAnimation({
          enterDurationMs: 260,
          expiresAt: 5_000,
          fadeDurationMs: 500,
          now: 1_000,
          startedAt: 1_000,
        }),
      ).toEqual({ opacity: 0, scale: 0.96, translateY: 10 });

      const entered = computeBubbleAnimation({
        enterDurationMs: 260,
        expiresAt: 5_000,
        fadeDurationMs: 500,
        now: 1_260,
        startedAt: 1_000,
      });
      expect(entered.opacity).toBe(1);
      expect(entered.scale).toBe(1);
      expect(entered.translateY).toBe(0);

      expect(
        computeBubbleAnimation({
          enterDurationMs: 260,
          expiresAt: 5_000,
          fadeDurationMs: 500,
          now: 4_750,
          startedAt: 1_000,
        }).opacity,
      ).toBe(0.5);
      expect(
        computeBubbleAnimation({
          enterDurationMs: 260,
          expiresAt: undefined,
          fadeDurationMs: 500,
          now: 60_000,
          startedAt: 1_000,
        }).opacity,
      ).toBe(1);
    });
  });

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
    it("detects display capture from settings only", () => {
      expect(isDisplayCaptureLike({ displaySurface: "browser" })).toBe(true);
      expect(isDisplayCaptureLike({})).toBe(false);
    });

    it("does not classify camera labels as display capture without displaySurface", () => {
      const track = {
        getSettings: () => ({}),
        label: "Windows HD Camera",
      };

      expect(track.label).toBe("Windows HD Camera");
      expect(isDisplayCaptureLike(track.getSettings())).toBe(false);
    });
  });

  describe("scoreSelfViewCandidate", () => {
    it("rejects invisible candidates and accepts strong self-view signals at score four or more", () => {
      expect(
        scoreSelfViewCandidate({
          aspectDelta: 0,
          isDisplayCapture: false,
          isPipelineSource: true,
          muted: true,
          playsInline: true,
          visible: false,
        }),
      ).toBe(0);
      expect(
        scoreSelfViewCandidate({
          aspectDelta: 0.1,
          isDisplayCapture: false,
          isPipelineSource: true,
          muted: true,
          playsInline: true,
          visible: true,
        }),
      ).toBe(10);
      expect(
        scoreSelfViewCandidate({
          aspectDelta: 0.5,
          isDisplayCapture: true,
          isPipelineSource: false,
          muted: false,
          playsInline: false,
          visible: true,
        }),
      ).toBe(2);
    });
  });

  describe("computeOverlayBox", () => {
    it("places the overlay at the right side and vertical center of the video rectangle", () => {
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
        shadowBlur: 8,
        shadowOffsetY: 2,
        top: 150,
      });
    });

    it("keeps overlay shadow offsets at least one pixel for tiny inputs", () => {
      expect(
        computeOverlayBox({
          rectHeight: 1,
          rectLeft: 0,
          rectTop: 0,
          rectWidth: 1,
        }).shadowOffsetY,
      ).toBeGreaterThanOrEqual(1);
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
      expect(layout.shadowBlur).toBe(24);
      expect(layout.shadowOffsetY).toBe(6);
      expect(layout.width).toBe(layout.maxBubbleWidth);
      expect(layout.x).toBeGreaterThanOrEqual(layout.margin);
      expect(layout.y).toBe(291);
    });

    it("keeps canvas bubble shadow offsets at least one pixel for tiny inputs", () => {
      expect(
        computeBubbleLayout({
          canvasHeight: 1,
          canvasWidth: 1,
          lineCount: 1,
          maxLineWidth: 0,
        }).shadowOffsetY,
      ).toBeGreaterThanOrEqual(1);
    });

    it("centers the canvas bubble vertically when it fits", () => {
      const layout = computeBubbleLayout({
        canvasHeight: 100,
        canvasWidth: 100,
        lineCount: 1,
        maxLineWidth: 20,
      });

      expect(layout.y).toBe(30);
    });

    it("clamps tall canvas bubbles to the top margin", () => {
      const layout = computeBubbleLayout({
        canvasHeight: 100,
        canvasWidth: 100,
        lineCount: 4,
        maxLineWidth: 20,
      });

      expect(layout.y).toBe(layout.margin);
    });
  });

  describe("danmaku helpers", () => {
    it("computes screen share comment text style from canvas height", () => {
      expect(computeDanmakuTextStyle({ canvasHeight: 720 })).toEqual({
        fontSize: 37,
        lineHeight: 50,
        strokeWidth: 4,
      });
      expect(computeDanmakuTextStyle({ canvasHeight: 1 }).fontSize).toBe(24);
    });

    it("assigns comments to bounded lanes", () => {
      expect(computeDanmakuLane({ laneCount: 3, sequence: 0 })).toBe(0);
      expect(computeDanmakuLane({ laneCount: 3, sequence: 4 })).toBe(1);
      expect(computeDanmakuLane({ laneCount: 0, sequence: 4 })).toBe(0);
    });

    it("moves danmaku text from right to left and fades at the edges", () => {
      expect(
        computeDanmakuPosition({
          canvasWidth: 1_280,
          durationMs: 4_000,
          elapsedMs: 0,
          lane: 2,
          lineHeight: 50,
          textWidth: 200,
        }),
      ).toEqual({ alpha: 0, x: 1_280, y: 150 });
      expect(
        computeDanmakuPosition({
          canvasWidth: 1_280,
          durationMs: 4_000,
          elapsedMs: 2_000,
          lane: 2,
          lineHeight: 50,
          textWidth: 200,
        }),
      ).toEqual({ alpha: 1, x: 540, y: 150 });
      expect(
        computeDanmakuPosition({
          canvasWidth: 1_280,
          durationMs: 4_000,
          elapsedMs: 4_000,
          lane: 2,
          lineHeight: 50,
          textWidth: 200,
        }),
      ).toEqual({ alpha: 0, x: -200, y: 150 });
    });
  });

  describe("parseCameraBubbleEnvelope", () => {
    it("accepts show messages with trimmed string text", () => {
      expect(
        parseCameraBubbleEnvelope(
          {
            __nextroomCameraBubble: { kind: "show", nonce: expectedNonce, text: " 発言中です " },
          },
          expectedNonce,
        ),
      ).toEqual({ durationMs: 7_000, kind: "show", pinned: false, text: "発言中です" });
    });

    it("rejects show messages with missing or non-string text", () => {
      expect(
        parseCameraBubbleEnvelope(
          {
            __nextroomCameraBubble: { kind: "show", nonce: expectedNonce },
          },
          expectedNonce,
        ),
      ).toBeUndefined();
      expect(
        parseCameraBubbleEnvelope(
          {
            __nextroomCameraBubble: { kind: "show", nonce: expectedNonce, text: 123 },
          },
          expectedNonce,
        ),
      ).toBeUndefined();
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
      ).toEqual({ durationMs: 2_345, kind: "show", pinned: false, text: "hello" });
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
      ).toEqual({ durationMs: 2_000, kind: "show", pinned: false, text: "hello" });
      expect(
        parseCameraBubbleEnvelope(
          {
            __nextroomCameraBubble: {
              durationMs: 70_000,
              kind: "show",
              nonce: expectedNonce,
              text: "hello",
            },
          },
          expectedNonce,
        ),
      ).toEqual({ durationMs: 60_000, kind: "show", pinned: false, text: "hello" });
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
      ).toEqual({ durationMs: 7_000, kind: "show", pinned: false, text: "hello" });
    });

    it("accepts pinned and hide messages", () => {
      expect(
        parseCameraBubbleEnvelope(
          {
            __nextroomCameraBubble: {
              durationMs: 2_000,
              kind: "show",
              nonce: expectedNonce,
              pinned: true,
              text: "keep showing",
            },
          },
          expectedNonce,
        ),
      ).toEqual({
        durationMs: undefined,
        kind: "show",
        pinned: true,
        text: "keep showing",
      });
      expect(
        parseCameraBubbleEnvelope(
          {
            __nextroomCameraBubble: {
              kind: "hide",
              nonce: expectedNonce,
            },
          },
          expectedNonce,
        ),
      ).toEqual({ kind: "hide" });
    });

    it("accepts config with strict booleans and normalized display speed", () => {
      expect(
        parseCameraBubbleEnvelope(
          {
            __nextroomCameraBubble: {
              chatMirrorEnabled: true,
              displaySpeedLevel: 5,
              enabled: true,
              kind: "config",
              nonce: expectedNonce,
              screenShareDanmakuEnabled: true,
            },
          },
          expectedNonce,
        ),
      ).toEqual({
        chatMirrorEnabled: true,
        displaySpeedLevel: 5,
        enabled: true,
        kind: "config",
        screenShareDanmakuEnabled: true,
      });
      expect(
        parseCameraBubbleEnvelope(
          {
            __nextroomCameraBubble: {
              chatMirrorEnabled: "true",
              displaySpeedLevel: 99,
              enabled: "true",
              kind: "config",
              nonce: expectedNonce,
              screenShareDanmakuEnabled: "true",
            },
          },
          expectedNonce,
        ),
      ).toEqual({
        chatMirrorEnabled: false,
        displaySpeedLevel: 5,
        enabled: false,
        kind: "config",
        screenShareDanmakuEnabled: false,
      });
      expect(
        parseCameraBubbleEnvelope(
          {
            __nextroomCameraBubble: {
              chatMirrorEnabled: true,
              displaySpeedLevel: Number.NaN,
              enabled: true,
              kind: "config",
              nonce: expectedNonce,
              screenShareDanmakuEnabled: true,
            },
          },
          expectedNonce,
        ),
      ).toEqual({
        chatMirrorEnabled: true,
        displaySpeedLevel: 3,
        enabled: true,
        kind: "config",
        screenShareDanmakuEnabled: true,
      });
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
            __nextroomCameraBubble: {
              chatMirrorEnabled: true,
              displaySpeedLevel: 3,
              enabled: true,
              kind: "config",
              nonce: "other",
            },
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

  describe("shouldMirrorChatKey", () => {
    const acceptedInput = {
      altKey: false,
      ctrlKey: false,
      disabled: false,
      isComposing: false,
      isEditable: true,
      key: "Enter",
      keyCode: 13,
      metaKey: false,
      readOnly: false,
      shiftKey: false,
    };

    it("accepts plain Enter in an enabled writable textarea", () => {
      expect(shouldMirrorChatKey(acceptedInput)).toBe(true);
    });

    it("rejects modifiers, composition, non-textareas, disabled/read-only, and wrong keys", () => {
      [
        { shiftKey: true },
        { metaKey: true },
        { ctrlKey: true },
        { altKey: true },
        { isComposing: true },
        { keyCode: 229 },
        { isEditable: false },
        { disabled: true },
        { readOnly: true },
        { key: "Escape" },
      ].forEach((override) => {
        expect(shouldMirrorChatKey({ ...acceptedInput, ...override })).toBe(false);
      });
    });
  });
});
