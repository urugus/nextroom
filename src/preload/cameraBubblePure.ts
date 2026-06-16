export type CameraBubbleEnvelope =
  | {
      kind: "config";
      chatMirrorEnabled: boolean;
      displaySpeedLevel: number;
      enabled: boolean;
      screenShareDanmakuEnabled: boolean;
    }
  | { durationMs: number | undefined; kind: "show"; pinned: boolean; text: string }
  | { kind: "hide" };

export type CameraBubbleAnimation = {
  opacity: number;
  scale: number;
  translateY: number;
};

export type CameraBubbleLayout = {
  fontSize: number;
  padding: number;
  lineHeight: number;
  margin: number;
  maxBubbleWidth: number;
  textMaxWidth: number;
  x: number;
  y: number;
  width: number;
  height: number;
  radius: number;
  shadowBlur: number;
  shadowOffsetY: number;
};

export type CameraBubbleDeps = {
  computeBubbleAnimation: typeof computeBubbleAnimation;
  computeBubbleLayout: typeof computeBubbleLayout;
  computeDanmakuLane: typeof computeDanmakuLane;
  computeDanmakuPosition: typeof computeDanmakuPosition;
  computeDanmakuTextStyle: typeof computeDanmakuTextStyle;
  computeOverlayBox: typeof computeOverlayBox;
  computeCanvasSize: typeof computeCanvasSize;
  hasVideoConstraints: typeof hasVideoConstraints;
  isDisplayCaptureLike: typeof isDisplayCaptureLike;
  parseCameraBubbleEnvelope: typeof parseCameraBubbleEnvelope;
  sanitizeBubbleText: typeof sanitizeBubbleText;
  scoreSelfViewCandidate: typeof scoreSelfViewCandidate;
  shouldMirrorChatKey: typeof shouldMirrorChatKey;
  computeBubbleDisplayDurationMs: typeof computeBubbleDisplayDurationMs;
  wrapBubbleLines: typeof wrapBubbleLines;
};

export const computeBubbleAnimation = ({
  enterDurationMs,
  expiresAt,
  fadeDurationMs,
  now,
  startedAt,
}: {
  enterDurationMs: number;
  expiresAt: number | undefined;
  fadeDurationMs: number;
  now: number;
  startedAt: number;
}): CameraBubbleAnimation => {
  const remainingMs = expiresAt === undefined ? Number.POSITIVE_INFINITY : expiresAt - now;
  const fadeOpacity =
    expiresAt !== undefined && now >= expiresAt
      ? 0
      : expiresAt === undefined || fadeDurationMs <= 0 || remainingMs >= fadeDurationMs
        ? 1
        : Math.max(0, Math.min(1, remainingMs / fadeDurationMs));
  const enterProgress =
    enterDurationMs <= 0 ? 1 : Math.max(0, Math.min(1, (now - startedAt) / enterDurationMs));
  const easedEnter = 1 - (1 - enterProgress) ** 3;

  return {
    opacity: fadeOpacity * easedEnter,
    scale: 0.96 + 0.04 * easedEnter,
    translateY: Math.round((1 - easedEnter) * 10),
  };
};

export const sanitizeBubbleText = (value: string): string => {
  return [...value.replace(/[\r\n]+/g, " ").trim()]
    .filter((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint === undefined
        ? true
        : !(codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f));
    })
    .slice(0, 100)
    .join("");
};

export const computeBubbleDisplayDurationMs = (textLength: number, speedLevel: number): number => {
  const factors = {
    1: 1.75,
    2: 1.35,
    3: 1,
    4: 0.75,
    5: 0.55,
  } as const;
  const integerSpeedLevel = Number.isFinite(speedLevel) ? Math.floor(speedLevel) : 3;
  const normalizedSpeedLevel = Math.max(1, Math.min(5, integerSpeedLevel));
  const factor = factors[normalizedSpeedLevel as keyof typeof factors];
  const boundedTextLength = Math.max(0, Math.floor(textLength));
  const rawDuration = (2_500 + 150 * boundedTextLength) * factor;

  return Math.round(Math.max(2_000, Math.min(20_000, rawDuration)));
};

export const computeDanmakuTextStyle = ({
  canvasHeight,
}: {
  canvasHeight: number;
}): {
  fontSize: number;
  lineHeight: number;
  strokeWidth: number;
} => {
  const fontSize = Math.max(24, Math.round(canvasHeight * 0.052));
  return {
    fontSize,
    lineHeight: Math.round(fontSize * 1.35),
    strokeWidth: Math.max(3, Math.round(fontSize * 0.12)),
  };
};

export const computeDanmakuLane = ({
  laneCount,
  sequence,
}: {
  laneCount: number;
  sequence: number;
}): number => {
  const normalizedLaneCount = Math.max(1, Math.floor(laneCount));
  const normalizedSequence = Math.max(0, Math.floor(sequence));
  return normalizedSequence % normalizedLaneCount;
};

export const computeDanmakuPosition = ({
  canvasWidth,
  durationMs,
  elapsedMs,
  lane,
  lineHeight,
  textWidth,
}: {
  canvasWidth: number;
  durationMs: number;
  elapsedMs: number;
  lane: number;
  lineHeight: number;
  textWidth: number;
}): { alpha: number; x: number; y: number } => {
  const boundedDurationMs = Math.max(1, durationMs);
  const progress = Math.max(0, Math.min(1, elapsedMs / boundedDurationMs));
  const travelDistance = canvasWidth + textWidth;
  const x = Math.round(canvasWidth - travelDistance * progress);
  const y = Math.round(lineHeight * (Math.max(0, Math.floor(lane)) + 1));
  const edgeFadeProgress = Math.min(progress, 1 - progress);
  const alpha = Math.max(0, Math.min(1, edgeFadeProgress / 0.08));

  return { alpha, x, y };
};

export const shouldMirrorChatKey = (input: {
  altKey: boolean;
  ctrlKey: boolean;
  disabled: boolean;
  isComposing: boolean;
  isEditable: boolean;
  key: string;
  keyCode: number;
  metaKey: boolean;
  readOnly: boolean;
  shiftKey: boolean;
}): boolean =>
  input.key === "Enter" &&
  !input.altKey &&
  !input.ctrlKey &&
  !input.metaKey &&
  !input.shiftKey &&
  !input.isComposing &&
  input.keyCode !== 229 &&
  input.isEditable &&
  !input.disabled &&
  !input.readOnly;

export const hasVideoConstraints = (constraints?: MediaStreamConstraints): boolean =>
  typeof constraints === "object" &&
  constraints !== null &&
  "video" in constraints &&
  constraints.video !== false &&
  constraints.video !== undefined;

export const computeCanvasSize = (settings: {
  height?: number;
  width?: number;
}): { height: number; width: number } => {
  const width = typeof settings.width === "number" && settings.width > 0 ? settings.width : 1280;
  const height = typeof settings.height === "number" && settings.height > 0 ? settings.height : 720;
  return { height, width };
};

export const isDisplayCaptureLike = (settings: { displaySurface?: unknown }): boolean =>
  // Chromium exposes displaySurface on getDisplayMedia tracks; label heuristics cause false
  // positives that silently disable bubbling for real cameras.
  settings.displaySurface !== undefined;

export const scoreSelfViewCandidate = ({
  aspectDelta,
  isDisplayCapture,
  isPipelineSource,
  muted,
  playsInline,
  visible,
}: {
  aspectDelta: number;
  isDisplayCapture: boolean;
  isPipelineSource: boolean;
  muted: boolean;
  playsInline: boolean;
  visible: boolean;
}): number => {
  if (!visible) return 0;

  return (
    2 +
    (isPipelineSource ? 4 : 0) +
    (muted ? 1 : 0) +
    (playsInline ? 1 : 0) +
    (isDisplayCapture ? 0 : 1) +
    (aspectDelta < 0.2 ? 1 : 0)
  );
};

// Pipeline-source self-view candidates are accepted at score >= 4 in the hook.
export const computeOverlayBox = ({
  rectHeight,
  rectLeft,
  rectTop,
  rectWidth,
}: {
  rectHeight: number;
  rectLeft: number;
  rectTop: number;
  rectWidth: number;
}): {
  fontSize: number;
  left: number;
  maxWidth: number;
  right: number;
  shadowBlur: number;
  shadowOffsetY: number;
  top: number;
} => {
  const margin = Math.round(Math.min(rectWidth, rectHeight) * 0.04);
  const fontSize = Math.max(12, Math.round(rectHeight * 0.07));
  const maxWidth = Math.round(rectWidth * 0.6);
  const right = rectLeft + rectWidth - margin;
  const left = Math.max(rectLeft + margin, right - maxWidth);
  const top = rectTop + rectHeight / 2;
  const shadowBlur = Math.round(fontSize * 0.6);
  const shadowOffsetY = Math.max(1, Math.round(fontSize * 0.15));

  return { fontSize, left, maxWidth, right, shadowBlur, shadowOffsetY, top };
};

export const wrapBubbleLines = (
  measure: (text: string) => number,
  text: string,
  maxWidth: number,
  maxLines: number,
): string[] => {
  const characters = [...text];
  const boundedMaxLines = Math.max(0, Math.floor(maxLines));
  if (characters.length === 0 || boundedMaxLines === 0) return [];

  const ellipsis = "…";
  const ellipsizeCharacters = (valueCharacters: string[]): string => {
    if (valueCharacters.length === 0) return ellipsis;

    const candidate = `${valueCharacters.join("")}${ellipsis}`;
    return measure(candidate) <= maxWidth
      ? candidate
      : ellipsizeCharacters(valueCharacters.slice(0, -1));
  };
  const ellipsize = (value: string): string => ellipsizeCharacters([...value]);
  const takeLine = (
    remainingCharacters: string[],
    currentCharacters: string[],
  ): { current: string; rest: string[] } => {
    if (remainingCharacters.length === 0) {
      return { current: currentCharacters.join(""), rest: remainingCharacters };
    }

    const [nextCharacter, ...restCharacters] = remainingCharacters;
    const candidate = `${currentCharacters.join("")}${nextCharacter}`;
    if (currentCharacters.length > 0 && measure(candidate) > maxWidth) {
      return { current: currentCharacters.join(""), rest: remainingCharacters };
    }

    return takeLine(restCharacters, [...currentCharacters, nextCharacter]);
  };
  const buildLines = (remainingCharacters: string[], lines: string[]): string[] => {
    if (remainingCharacters.length === 0 || lines.length >= boundedMaxLines) return lines;

    const line = takeLine(remainingCharacters, []);
    if (lines.length === boundedMaxLines - 1 && line.rest.length > 0) {
      return [...lines, ellipsize(`${line.current}${line.rest.join("")}`)];
    }

    return buildLines(line.rest, [...lines, line.current]);
  };

  return buildLines(characters, []);
};

export const computeBubbleAlpha = (
  now: number,
  expiresAt: number,
  fadeDurationMs: number,
): number => {
  if (now >= expiresAt) return 0;
  if (fadeDurationMs <= 0) return 1;

  const remainingMs = expiresAt - now;
  if (remainingMs >= fadeDurationMs) return 1;

  return Math.max(0, Math.min(1, remainingMs / fadeDurationMs));
};

export const computeBubbleLayout = ({
  canvasHeight,
  canvasWidth,
  lineCount,
  maxLineWidth,
}: {
  canvasHeight: number;
  canvasWidth: number;
  lineCount: number;
  maxLineWidth: number;
}): CameraBubbleLayout => {
  const fontSize = Math.max(18, Math.round(canvasHeight * 0.055));
  const padding = Math.round(fontSize * 0.5);
  const lineHeight = Math.round(fontSize * 1.22);
  const margin = Math.round(Math.min(canvasWidth, canvasHeight) * 0.04);
  const maxBubbleWidth = Math.round(canvasWidth * 0.45);
  const textMaxWidth = Math.max(fontSize * 4, maxBubbleWidth - padding * 2);
  const measuredWidth = Math.max(maxLineWidth, fontSize);
  const width = Math.min(maxBubbleWidth, Math.ceil(measuredWidth) + padding * 2);
  const height = lineHeight * lineCount + padding * 2;
  const x = Math.max(margin, canvasWidth - margin - width);
  const maxY = Math.max(margin, canvasHeight - margin - height);
  const y = Math.max(margin, Math.min(maxY, Math.round((canvasHeight - height) / 2)));
  const radius = Math.round(fontSize * 0.55);
  const shadowBlur = Math.round(fontSize * 0.6);
  const shadowOffsetY = Math.max(1, Math.round(fontSize * 0.15));

  return {
    fontSize,
    height,
    lineHeight,
    margin,
    maxBubbleWidth,
    padding,
    radius,
    shadowBlur,
    shadowOffsetY,
    textMaxWidth,
    width,
    x,
    y,
  };
};

export const parseCameraBubbleEnvelope = (
  data: unknown,
  expectedNonce: string,
): CameraBubbleEnvelope | undefined => {
  if (typeof expectedNonce !== "string" || expectedNonce.length === 0) {
    return undefined;
  }

  if (typeof data !== "object" || data === null || !("__nextroomCameraBubble" in data)) {
    return undefined;
  }

  const envelope = (data as { __nextroomCameraBubble?: unknown }).__nextroomCameraBubble;
  if (typeof envelope !== "object" || envelope === null || !("kind" in envelope)) {
    return undefined;
  }

  const message = envelope as {
    chatMirrorEnabled?: unknown;
    displaySpeedLevel?: unknown;
    durationMs?: unknown;
    enabled?: unknown;
    kind?: unknown;
    nonce?: unknown;
    pinned?: unknown;
    screenShareDanmakuEnabled?: unknown;
    text?: unknown;
  };
  if (message.nonce !== expectedNonce) {
    return undefined;
  }

  if (message.kind === "show") {
    if (typeof message.text !== "string") {
      return undefined;
    }

    const text = message.text.trim();
    const pinned = message.pinned === true;
    const durationMs = pinned
      ? undefined
      : typeof message.durationMs === "number" &&
          Number.isFinite(message.durationMs) &&
          message.durationMs > 0
        ? Math.max(2_000, Math.min(60_000, message.durationMs))
        : 7_000;
    return text.length === 0 ? undefined : { durationMs, kind: "show", pinned, text };
  }

  if (message.kind === "hide") {
    return { kind: "hide" };
  }

  if (message.kind === "config") {
    const speedLevel =
      typeof message.displaySpeedLevel === "number" && Number.isFinite(message.displaySpeedLevel)
        ? Math.max(1, Math.min(5, Math.floor(message.displaySpeedLevel)))
        : 3;

    return {
      chatMirrorEnabled: message.chatMirrorEnabled === true,
      displaySpeedLevel: speedLevel,
      enabled: message.enabled === true,
      kind: "config",
      screenShareDanmakuEnabled: message.screenShareDanmakuEnabled === true,
    };
  }

  return undefined;
};
