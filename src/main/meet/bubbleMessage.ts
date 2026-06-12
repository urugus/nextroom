import { err, ok, type Result } from "neverthrow";
import { computeBubbleDisplayDurationMs, sanitizeBubbleText } from "../../preload/cameraBubblePure";

export type AcceptedBubbleMessage = { acceptedAt: number; durationMs: number; text: string };
export type BubbleMessageRejection = { reason: "empty" | "rate-limited" };

export const bubbleMessageMinIntervalMs = 300;
export const bubbleMessageMaxLength = 100;
export { computeBubbleDisplayDurationMs };

export const sanitizeBubbleMessageText = sanitizeBubbleText;

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
