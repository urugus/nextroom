import {
  createMeetingNotifier,
  decideNotification,
  notificationKeyFor,
} from "@main/notifications/meetingNotifier";
import type { MeetEvent } from "@shared/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const meetingAt = (startAt: string, overrides: Partial<MeetEvent> = {}): MeetEvent => ({
  eventId: "event-1",
  occurrenceKey: "event-1:2026-07-02T10:00:00.000Z",
  calendarId: "primary",
  summary: "Weekly sync",
  startAt,
  endAt: new Date(new Date(startAt).getTime() + 30 * 60_000).toISOString(),
  updatedAt: "2026-07-01T00:00:00.000Z",
  meetUrl: "https://meet.google.com/abc-defg-hij",
  status: "confirmed",
  ...overrides,
});

describe("decideNotification", () => {
  const now = new Date("2026-07-02T09:56:00.000Z");
  const meeting = meetingAt("2026-07-02T10:00:00.000Z");

  it("notifies inside the pre-meeting window", () => {
    expect(decideNotification(meeting, 5, new Set(), now)).toEqual({
      type: "notify",
      event: meeting,
    });
  });

  it("ignores when notifications are turned off", () => {
    expect(decideNotification(meeting, 0, new Set(), now)).toEqual({
      type: "ignore",
      reason: "notifications-off",
    });
  });

  it("ignores before the notification window opens", () => {
    expect(decideNotification(meeting, 2, new Set(), now)).toEqual({
      type: "ignore",
      reason: "not-time",
    });
  });

  it("ignores meetings that already started", () => {
    expect(decideNotification(meeting, 5, new Set(), new Date("2026-07-02T10:00:00.000Z"))).toEqual(
      { type: "ignore", reason: "started" },
    );
  });

  it("ignores meetings that were already notified", () => {
    expect(decideNotification(meeting, 5, new Set([notificationKeyFor(meeting)]), now)).toEqual({
      type: "ignore",
      reason: "already-notified",
    });
  });

  it("ignores cancelled and declined meetings", () => {
    expect(
      decideNotification(meetingAt(meeting.startAt, { status: "cancelled" }), 5, new Set(), now),
    ).toEqual({
      type: "ignore",
      reason: "cancelled",
    });
    expect(
      decideNotification(
        meetingAt(meeting.startAt, { responseStatus: "declined" }),
        5,
        new Set(),
        now,
      ),
    ).toEqual({ type: "ignore", reason: "declined" });
  });

  it("ignores meetings with an invalid start time", () => {
    const invalidStart = meetingAt(meeting.startAt, { startAt: "not-a-date" });
    expect(decideNotification(invalidStart, 5, new Set(), now)).toEqual({
      type: "ignore",
      reason: "not-time",
    });
  });
});

describe("createMeetingNotifier", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-02T09:50:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("notifies once per occurrence across snapshot updates and ticks", () => {
    const showNotification = vi.fn();
    const notifier = createMeetingNotifier({
      getNotifyBeforeMinutes: () => 5,
      showNotification,
    });
    const meeting = meetingAt("2026-07-02T10:00:00.000Z");

    notifier.updateSnapshot({ meetings: [meeting] }, new Date("2026-07-02T09:50:00.000Z"));
    expect(showNotification).not.toHaveBeenCalled();

    notifier.evaluate(new Date("2026-07-02T09:55:00.000Z"));
    expect(showNotification).toHaveBeenCalledTimes(1);
    expect(showNotification).toHaveBeenCalledWith(meeting);

    notifier.evaluate(new Date("2026-07-02T09:56:00.000Z"));
    notifier.updateSnapshot({ meetings: [meeting] }, new Date("2026-07-02T09:57:00.000Z"));
    expect(showNotification).toHaveBeenCalledTimes(1);
  });

  it("keeps notified keys through a transient empty snapshot", () => {
    const showNotification = vi.fn();
    const notifier = createMeetingNotifier({
      getNotifyBeforeMinutes: () => 5,
      showNotification,
    });
    const meeting = meetingAt("2026-07-02T10:00:00.000Z");

    notifier.updateSnapshot({ meetings: [meeting] }, new Date("2026-07-02T09:55:00.000Z"));
    expect(showNotification).toHaveBeenCalledTimes(1);

    notifier.updateSnapshot({ meetings: [] }, new Date("2026-07-02T09:56:00.000Z"));
    notifier.updateSnapshot({ meetings: [meeting] }, new Date("2026-07-02T09:57:00.000Z"));
    expect(showNotification).toHaveBeenCalledTimes(1);
  });

  it("notifies again when a notified meeting is rescheduled", () => {
    const showNotification = vi.fn();
    const notifier = createMeetingNotifier({
      getNotifyBeforeMinutes: () => 5,
      showNotification,
    });
    const meeting = meetingAt("2026-07-02T10:00:00.000Z");

    notifier.updateSnapshot({ meetings: [meeting] }, new Date("2026-07-02T09:55:00.000Z"));
    expect(showNotification).toHaveBeenCalledTimes(1);

    const rescheduled = meetingAt("2026-07-02T11:00:00.000Z", {
      occurrenceKey: meeting.occurrenceKey,
    });
    notifier.updateSnapshot({ meetings: [rescheduled] }, new Date("2026-07-02T10:56:00.000Z"));
    expect(showNotification).toHaveBeenCalledTimes(2);
    expect(showNotification).toHaveBeenLastCalledWith(rescheduled);
  });

  it("evaluates on the interval after start and stops cleanly", () => {
    const showNotification = vi.fn();
    const notifier = createMeetingNotifier({
      getNotifyBeforeMinutes: () => 5,
      showNotification,
      tickMs: 30_000,
    });
    const meeting = meetingAt("2026-07-02T10:00:00.000Z");

    notifier.updateSnapshot({ meetings: [meeting] });
    notifier.start();
    expect(showNotification).not.toHaveBeenCalled();

    vi.advanceTimersByTime(5 * 60_000 + 30_000);
    expect(showNotification).toHaveBeenCalledTimes(1);

    notifier.stop();
    vi.setSystemTime(new Date("2026-07-02T10:30:00.000Z"));
    vi.advanceTimersByTime(10 * 60_000);
    expect(showNotification).toHaveBeenCalledTimes(1);
  });

  it("respects the latest notifyBeforeMinutes setting", () => {
    let notifyBeforeMinutes = 0;
    const showNotification = vi.fn();
    const notifier = createMeetingNotifier({
      getNotifyBeforeMinutes: () => notifyBeforeMinutes,
      showNotification,
    });
    const meeting = meetingAt("2026-07-02T10:00:00.000Z");

    notifier.updateSnapshot({ meetings: [meeting] }, new Date("2026-07-02T09:59:00.000Z"));
    expect(showNotification).not.toHaveBeenCalled();

    notifyBeforeMinutes = 5;
    notifier.evaluate(new Date("2026-07-02T09:59:00.000Z"));
    expect(showNotification).toHaveBeenCalledTimes(1);
  });
});
