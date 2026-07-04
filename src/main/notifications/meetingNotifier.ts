import type { MeetEvent, MeetEventsSnapshot } from "@shared/types";

export type NotificationDecision =
  | {
      type: "ignore";
      reason:
        | "already-notified"
        | "cancelled"
        | "declined"
        | "not-time"
        | "notifications-off"
        | "started";
    }
  | { type: "notify"; event: MeetEvent };

export const notificationKeyFor = (event: MeetEvent): string =>
  `${event.occurrenceKey}:${event.startAt}`;

export const decideNotification = (
  event: MeetEvent,
  notifyBeforeMinutes: number,
  notified: Pick<ReadonlySet<string>, "has">,
  now: Date,
): NotificationDecision => {
  if (notifyBeforeMinutes <= 0) return { type: "ignore", reason: "notifications-off" };
  if (event.status === "cancelled") return { type: "ignore", reason: "cancelled" };
  if (event.responseStatus === "declined") return { type: "ignore", reason: "declined" };
  if (notified.has(notificationKeyFor(event))) {
    return { type: "ignore", reason: "already-notified" };
  }

  const startAt = new Date(event.startAt);
  if (!Number.isFinite(startAt.getTime())) return { type: "ignore", reason: "not-time" };
  if (now >= startAt) return { type: "ignore", reason: "started" };

  const notifyAt = new Date(startAt.getTime() - notifyBeforeMinutes * 60_000);
  if (now < notifyAt) return { type: "ignore", reason: "not-time" };

  return { type: "notify", event };
};

export type MeetingNotifier = {
  evaluate: (now?: Date) => void;
  start: () => void;
  stop: () => void;
  updateSnapshot: (snapshot: MeetEventsSnapshot, now?: Date) => void;
};

export const createMeetingNotifier = ({
  getNotifyBeforeMinutes,
  showNotification,
  tickMs = 30_000,
}: {
  getNotifyBeforeMinutes: () => number;
  showNotification: (event: MeetEvent) => void;
  tickMs?: number;
}): MeetingNotifier => {
  let meetings: MeetEvent[] = [];
  const notifiedKeys = new Set<string>();
  let timer: NodeJS.Timeout | undefined;

  const evaluate = (now: Date = new Date()): void => {
    if (meetings.length === 0) return;

    const notifyBeforeMinutes = getNotifyBeforeMinutes();
    const due = meetings.filter(
      (event) =>
        decideNotification(event, notifyBeforeMinutes, notifiedKeys, now).type === "notify",
    );

    for (const event of due) {
      notifiedKeys.add(notificationKeyFor(event));
      showNotification(event);
    }
  };

  const updateSnapshot = (snapshot: MeetEventsSnapshot, now: Date = new Date()): void => {
    meetings = snapshot.meetings;

    // Calendar sync publishes an empty snapshot on transient auth failures and
    // disconnects. Keep notified keys through those so a reconnect inside the
    // notify window does not re-fire notifications for the same occurrence.
    if (meetings.length > 0) {
      const currentKeys = new Set(meetings.map(notificationKeyFor));
      for (const key of notifiedKeys) {
        if (!currentKeys.has(key)) notifiedKeys.delete(key);
      }
    }

    evaluate(now);
  };

  const start = (): void => {
    if (timer !== undefined) return;
    timer = setInterval(() => {
      evaluate();
    }, tickMs);
  };

  const stop = (): void => {
    if (timer === undefined) return;
    clearInterval(timer);
    timer = undefined;
  };

  return { evaluate, start, stop, updateSnapshot };
};
