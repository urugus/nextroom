import type { AppError } from "@shared/errors";
import type { AppSettings, MeetEvent } from "@shared/types";
import { ok, type Result } from "neverthrow";
import type { LaunchDeduper } from "./launchDeduper";

export type LaunchDecision =
  | { type: "ignore"; reason: "auto-open-disabled" | "already-launched" | "not-time" | "ended" }
  | { type: "open"; event: MeetEvent };

export const decideLaunch = (
  event: MeetEvent,
  settings: AppSettings,
  deduper: Pick<LaunchDeduper, "hasLaunched">,
  now: Date,
): Result<LaunchDecision, AppError> => {
  if (!settings.autoOpenEnabled) return ok({ type: "ignore", reason: "auto-open-disabled" });
  if (deduper.hasLaunched(event)) return ok({ type: "ignore", reason: "already-launched" });

  const openAt = new Date(new Date(event.startAt).getTime() - settings.openOffsetSeconds * 1000);
  const endAt = new Date(event.endAt);

  if (now > endAt) return ok({ type: "ignore", reason: "ended" });
  if (now < openAt) return ok({ type: "ignore", reason: "not-time" });

  return ok({ type: "open", event });
};
