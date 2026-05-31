import type { AppError } from "@shared/errors";
import type { AppSettings, MeetEvent, MeetEventsSnapshot } from "@shared/types";
import { err, ok, type Result } from "neverthrow";
import type { LaunchDeduper } from "./launchDeduper";
import { decideLaunch } from "./meetingScheduler";

export type AutoOpenScheduler = {
  evaluate: (snapshot: MeetEventsSnapshot) => Promise<Result<void, AppError>>;
};

type AutoOpenSchedulerInput = {
  activatedAt: Date;
  deduper: LaunchDeduper;
  now?: () => Date;
  openMeetUrl: (meetUrl: string) => Promise<Result<void, AppError>>;
  settings: AppSettings;
};

const autoOpenAtFor = (event: MeetEvent, settings: AppSettings): Date =>
  new Date(new Date(event.startAt).getTime() - settings.openOffsetSeconds * 1000);

const missedBeforeActivation = (
  event: MeetEvent,
  settings: AppSettings,
  activatedAt: Date,
): boolean => autoOpenAtFor(event, settings) < activatedAt;

export const createAutoOpenScheduler = ({
  activatedAt,
  deduper,
  now = () => new Date(),
  openMeetUrl,
  settings,
}: AutoOpenSchedulerInput): AutoOpenScheduler => {
  const opening = new Set<string>();

  const evaluateEvent = async (event: MeetEvent): Promise<Result<void, AppError>> => {
    if (opening.has(event.occurrenceKey)) return ok(undefined);
    if (missedBeforeActivation(event, settings, activatedAt)) return ok(undefined);

    const decision = decideLaunch(event, settings, deduper, now());
    if (decision.isErr()) return err(decision.error);
    if (decision.value.type !== "open") return ok(undefined);

    opening.add(event.occurrenceKey);
    try {
      const result = await openMeetUrl(event.meetUrl);
      if (result.isOk()) {
        return deduper.markLaunched(event, now().toISOString()).map(() => undefined);
      }
      return result;
    } finally {
      opening.delete(event.occurrenceKey);
    }
  };

  return {
    evaluate: async (snapshot) => {
      for (const event of snapshot.meetings) {
        const result = await evaluateEvent(event);
        if (result.isErr()) return result;
      }
      return ok(undefined);
    },
  };
};
