import { err, ok, type Result } from "neverthrow";

export type AcceptedBubbleMessage = { acceptedAt: number; text: string };
export type BubbleMessageRejection = { reason: "empty" | "rate-limited" };

export const bubbleMessageMinIntervalMs = 300;
export const bubbleMessageMaxLength = 100;

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

export const evaluateBubbleMessage = ({
  lastAcceptedAt,
  now,
  text,
}: {
  lastAcceptedAt: number | undefined;
  now: number;
  text: string;
}): Result<AcceptedBubbleMessage, BubbleMessageRejection> => {
  const sanitized = sanitizeBubbleMessageText(text);
  if (sanitized.length === 0) {
    return err({ reason: "empty" });
  }

  if (lastAcceptedAt !== undefined && now - lastAcceptedAt < bubbleMessageMinIntervalMs) {
    return err({ reason: "rate-limited" });
  }

  return ok({ acceptedAt: now, text: sanitized });
};

export const createBubbleMessageGate = (): {
  accept: (text: string, now: number) => Result<AcceptedBubbleMessage, BubbleMessageRejection>;
} => {
  // Deliberately contained rate-limit cell; validation remains in evaluateBubbleMessage.
  let lastAcceptedAt: number | undefined;

  return {
    accept: (text, now) =>
      evaluateBubbleMessage({ lastAcceptedAt, now, text }).map((accepted) => {
        lastAcceptedAt = accepted.acceptedAt;
        return accepted;
      }),
  };
};
