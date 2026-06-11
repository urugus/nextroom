export type CameraBubbleEnvelope =
  | { kind: "setEnabled"; enabled: boolean }
  | { durationMs: number; kind: "show"; text: string };

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
};

export type CameraBubbleDeps = {
  computeBubbleAlpha: typeof computeBubbleAlpha;
  computeBubbleLayout: typeof computeBubbleLayout;
  computeCanvasSize: typeof computeCanvasSize;
  hasVideoConstraints: typeof hasVideoConstraints;
  parseCameraBubbleEnvelope: typeof parseCameraBubbleEnvelope;
  wrapBubbleLines: typeof wrapBubbleLines;
};

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
  const y = margin;
  const radius = Math.round(fontSize * 0.55);

  return {
    fontSize,
    height,
    lineHeight,
    margin,
    maxBubbleWidth,
    padding,
    radius,
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
    durationMs?: unknown;
    enabled?: unknown;
    kind?: unknown;
    nonce?: unknown;
    text?: unknown;
  };
  if (message.nonce !== expectedNonce) {
    return undefined;
  }

  if (message.kind === "show") {
    const text = String(message.text).trim();
    const durationMs =
      typeof message.durationMs === "number" &&
      Number.isFinite(message.durationMs) &&
      message.durationMs > 0
        ? Math.max(1_000, Math.min(30_000, message.durationMs))
        : 7_000;
    return text.length === 0 ? undefined : { durationMs, kind: "show", text };
  }

  if (message.kind === "setEnabled") {
    return { enabled: message.enabled === true, kind: "setEnabled" };
  }

  return undefined;
};
