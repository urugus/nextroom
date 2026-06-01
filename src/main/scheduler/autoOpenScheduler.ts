import type { AppError } from "@shared/errors";
import type { AppSettings, MeetEvent, MeetEventsSnapshot } from "@shared/types";
import { err, ok, type Result } from "neverthrow";
import type { LaunchDeduper } from "./launchDeduper";
import { decideAutoJoin, decideLaunch } from "./meetingScheduler";

export type AutoOpenScheduler = {
  evaluate: (snapshot: MeetEventsSnapshot) => Promise<Result<void, AppError>>;
  handleMeetWindowClosed: (meetUrl: string) => void;
};

type AutoOpenSchedulerInput = {
  activatedAt: Date;
  deduper: LaunchDeduper;
  hasBlockingMeetWindow: (meetUrl: string) => boolean;
  joinDeduper: LaunchDeduper;
  now?: () => Date;
  autoJoinMeetUrl: (meetUrl: string) => Promise<Result<void, AppError>>;
  openMeetUrl: (meetUrl: string) => Promise<Result<void, AppError>>;
  settings: AppSettings;
};

const autoOpenAtFor = (event: MeetEvent, settings: AppSettings): Date =>
  new Date(new Date(event.startAt).getTime() - settings.openOffsetSeconds * 1000);

const autoJoinAtFor = (event: MeetEvent, settings: AppSettings): Date =>
  new Date(new Date(event.startAt).getTime() - settings.joinOffsetSeconds * 1000);

const missedBeforeActivation = (
  event: MeetEvent,
  actionAtFor: (event: MeetEvent, settings: AppSettings) => Date,
  settings: AppSettings,
  activatedAt: Date,
): boolean => actionAtFor(event, settings) < activatedAt;

const compareByStartAt = (left: MeetEvent, right: MeetEvent): number =>
  new Date(left.startAt).getTime() - new Date(right.startAt).getTime();

const sortedByStartAt = (meetings: MeetEvent[]): MeetEvent[] => {
  const sortedMeetings: MeetEvent[] = [];

  for (const event of meetings) {
    const insertAt = sortedMeetings.findIndex(
      (candidate) => compareByStartAt(event, candidate) < 0,
    );

    if (insertAt === -1) {
      sortedMeetings.push(event);
    } else {
      sortedMeetings.splice(insertAt, 0, event);
    }
  }

  return sortedMeetings;
};

export const createAutoOpenScheduler = ({
  activatedAt,
  autoJoinMeetUrl,
  deduper,
  hasBlockingMeetWindow,
  joinDeduper,
  now = () => new Date(),
  openMeetUrl,
  settings,
}: AutoOpenSchedulerInput): AutoOpenScheduler => {
  const opening = new Set<string>();
  const joining = new Set<string>();
  const failedAutoJoinKeys = new Set<string>();
  let activeAutoJoinMeetUrl: string | undefined;
  let activeAutoJoinOccurrenceKey: string | undefined;
  let queuedJoinEvent: MeetEvent | undefined;
  let drainingQueuedJoin = false;
  let evaluationQueue = Promise.resolve();

  const queueJoin = (event: MeetEvent): void => {
    if (queuedJoinEvent === undefined || compareByStartAt(event, queuedJoinEvent) < 0) {
      queuedJoinEvent = event;
    }
  };

  const evaluateEvent = async (event: MeetEvent): Promise<Result<void, AppError>> => {
    if (opening.has(event.occurrenceKey)) return ok(undefined);
    if (missedBeforeActivation(event, autoOpenAtFor, settings, activatedAt)) return ok(undefined);

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

  const evaluateJoinEvent = async (event: MeetEvent): Promise<Result<void, AppError>> => {
    if (joining.has(event.occurrenceKey)) return ok(undefined);
    if (failedAutoJoinKeys.has(event.occurrenceKey)) return ok(undefined);
    if (missedBeforeActivation(event, autoJoinAtFor, settings, activatedAt)) return ok(undefined);

    const decision = decideAutoJoin(event, settings, joinDeduper, now());
    if (decision.isErr()) return err(decision.error);
    if (decision.value.type !== "join") return ok(undefined);

    if (
      activeAutoJoinOccurrenceKey !== undefined ||
      joining.size > 0 ||
      hasBlockingMeetWindow(event.meetUrl)
    ) {
      queueJoin(event);
      return ok(undefined);
    }

    joining.add(event.occurrenceKey);
    try {
      const result = await autoJoinMeetUrl(event.meetUrl);
      if (result.isErr()) {
        failedAutoJoinKeys.add(event.occurrenceKey);
        return result;
      }

      activeAutoJoinMeetUrl = event.meetUrl;
      activeAutoJoinOccurrenceKey = event.occurrenceKey;
      return joinDeduper.markLaunched(event, now().toISOString()).map(() => undefined);
    } finally {
      joining.delete(event.occurrenceKey);
    }
  };

  const evaluateSnapshot = async (
    snapshot: MeetEventsSnapshot,
  ): Promise<Result<void, AppError>> => {
    let firstError: AppError | undefined;

    queuedJoinEvent = undefined;
    for (const event of sortedByStartAt(snapshot.meetings)) {
      const result = await evaluateEvent(event);
      if (result.isErr()) {
        firstError ??= result.error;
        continue;
      }

      const joinResult = await evaluateJoinEvent(event);
      if (joinResult.isErr()) {
        firstError ??= joinResult.error;
      }
    }

    return firstError === undefined ? ok(undefined) : err(firstError);
  };

  const drainQueuedJoin = async (): Promise<void> => {
    if (drainingQueuedJoin || queuedJoinEvent === undefined) return;

    drainingQueuedJoin = true;
    const event = queuedJoinEvent;
    queuedJoinEvent = undefined;

    try {
      await evaluateJoinEvent(event);
    } finally {
      drainingQueuedJoin = false;
    }
  };

  return {
    evaluate: (snapshot) => {
      const result = evaluationQueue.then(() => evaluateSnapshot(snapshot));
      evaluationQueue = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    },
    handleMeetWindowClosed: (meetUrl) => {
      if (activeAutoJoinMeetUrl === meetUrl) {
        activeAutoJoinMeetUrl = undefined;
        activeAutoJoinOccurrenceKey = undefined;
      }

      void drainQueuedJoin();
    },
  };
};
