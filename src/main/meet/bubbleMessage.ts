import { err, ok, type Result } from "neverthrow";

export type AcceptedBubbleMessage = { acceptedAt: number; durationMs: number; text: string };
export type BubbleMessageRejection = { reason: "empty" | "rate-limited" };

export const bubbleMessageMinIntervalMs = 300;
export const bubbleMessageMaxLength = 100;
const bubbleDisplayDurationMinMs = 2_000;
const bubbleDisplayDurationMaxMs = 20_000;
const bubbleDisplayDurationBaseMs = 2_500;
const bubbleDisplayDurationPerCodePointMs = 150;
const bubbleDisplayDurationFactors = {
  1: 1.75,
  2: 1.35,
  3: 1,
  4: 0.75,
  5: 0.55,
} as const;

const isControlCharacter = (value: string): boolean => {
  const codePoint = value.codePointAt(0);
  if (codePoint === undefined) return false;

  return codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f);
};

export const sanitizeBubbleMessageText = (value: string): string =>
  [...value.replace(/[\r\n]+/g, " ").trim()]
    .filter((character) => !isControlCharacter(character))
    .slice(0, bubbleMessageMaxLength)
    .join("");

export const computeBubbleDisplayDurationMs = (textLength: number, speedLevel: number): number => {
  const integerSpeedLevel = Number.isFinite(speedLevel) ? Math.floor(speedLevel) : 3;
  const normalizedSpeedLevel = Math.max(1, Math.min(5, integerSpeedLevel));
  const factor =
    bubbleDisplayDurationFactors[normalizedSpeedLevel as keyof typeof bubbleDisplayDurationFactors];
  const boundedTextLength = Math.max(0, Math.floor(textLength));
  const rawDuration =
    (bubbleDisplayDurationBaseMs + bubbleDisplayDurationPerCodePointMs * boundedTextLength) *
    factor;

  return Math.round(
    Math.max(bubbleDisplayDurationMinMs, Math.min(bubbleDisplayDurationMaxMs, rawDuration)),
  );
};

export const evaluateBubbleMessage = ({
  lastAcceptedAt,
  now,
  speedLevel,
  text,
}: {
  lastAcceptedAt: number | undefined;
  now: number;
  speedLevel: number;
  text: string;
}): Result<AcceptedBubbleMessage, BubbleMessageRejection> => {
  const sanitized = sanitizeBubbleMessageText(text);
  const textLength = [...sanitized].length;
  if (textLength === 0) {
    return err({ reason: "empty" });
  }

  if (lastAcceptedAt !== undefined && now - lastAcceptedAt < bubbleMessageMinIntervalMs) {
    return err({ reason: "rate-limited" });
  }

  return ok({
    acceptedAt: now,
    durationMs: computeBubbleDisplayDurationMs(textLength, speedLevel),
    text: sanitized,
  });
};

export const createBubbleMessageGate = (): {
  accept: (
    text: string,
    now: number,
    speedLevel: number,
  ) => Result<AcceptedBubbleMessage, BubbleMessageRejection>;
} => {
  // Deliberately contained rate-limit cell; validation remains in evaluateBubbleMessage.
  let lastAcceptedAt: number | undefined;

  return {
    accept: (text, now, speedLevel) =>
      evaluateBubbleMessage({ lastAcceptedAt, now, speedLevel, text }).map((accepted) => {
        lastAcceptedAt = accepted.acceptedAt;
        return accepted;
      }),
  };
};
