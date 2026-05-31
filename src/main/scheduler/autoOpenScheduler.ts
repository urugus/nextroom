import type { AppError } from "@shared/errors";
import type { AppSettings, MeetEvent, MeetEventsSnapshot } from "@shared/types";
import type { Result } from "neverthrow";
import type { LaunchDeduper } from "./launchDeduper";
import { decideLaunch } from "./meetingScheduler";

export type AutoOpenScheduler = {
  evaluate: (snapshot: MeetEventsSnapshot) => Promise<void>;
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

  const evaluateEvent = async (event: MeetEvent): Promise<void> => {
    if (opening.has(event.occurrenceKey)) return;
    if (missedBeforeActivation(event, settings, activatedAt)) return;

    const decision = decideLaunch(event, settings, deduper, now());
    if (decision.isErr() || decision.value.type !== "open") return;

    opening.add(event.occurrenceKey);
    try {
      const result = await openMeetUrl(event.meetUrl);
      if (result.isOk()) {
        deduper.markLaunched(event, now().toISOString());
      }
    } finally {
      opening.delete(event.occurrenceKey);
    }
  };

  return {
    evaluate: async (snapshot) => {
      for (const event of snapshot.meetings) {
        await evaluateEvent(event);
      }
    },
  };
};
