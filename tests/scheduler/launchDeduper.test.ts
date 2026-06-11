import { createLaunchDeduper } from "@main/scheduler/launchDeduper";
import { decideAutoJoin, decideLaunch } from "@main/scheduler/meetingScheduler";
import type { AppSettings, MeetEvent } from "@shared/types";
import { describe, expect, it } from "vitest";

const settings: AppSettings = {
  autoJoinEnabled: false,
  autoOpenEnabled: true,
  cameraBubbleEnabled: false,
  cameraBubbleDisplaySpeedLevel: 3,
  joinOffsetSeconds: 0,
  notifyBeforeMinutes: 1,
  openOffsetSeconds: 0,
  menuShortcutAccelerator: "Command+Alt+N",
  launchAtLogin: false,
  calendarId: "primary",
  timezone: "Asia/Tokyo",
};

const event: MeetEvent = {
  eventId: "event-1",
  occurrenceKey: "primary:event-1:2026-05-28T10:00:00+09:00",
  calendarId: "primary",
  summary: "Standup",
  startAt: "2026-05-28T10:00:00+09:00",
  endAt: "2026-05-28T10:30:00+09:00",
  updatedAt: "2026-05-28T09:00:00+09:00",
  meetUrl: "https://meet.google.com/abc-defg-hij",
  status: "confirmed",
};

describe("meeting scheduler", () => {
  it("opens a meeting once it is due", () => {
    const deduper = createLaunchDeduper();
    const result = decideLaunch(event, settings, deduper, new Date("2026-05-28T10:00:00+09:00"));

    expect(result._unsafeUnwrap()).toEqual({ type: "open", event });
  });

  it("deduplicates already launched meetings", () => {
    const deduper = createLaunchDeduper();

    deduper.markLaunched(event, "2026-05-28T10:00:01+09:00");

    const result = decideLaunch(event, settings, deduper, new Date("2026-05-28T10:01:00+09:00"));

    expect(result._unsafeUnwrap()).toEqual({ type: "ignore", reason: "already-launched" });
    expect(deduper.records()).toHaveLength(1);
  });

  it("opens a meeting once its configured offset is due", () => {
    const deduper = createLaunchDeduper();
    const result = decideLaunch(
      event,
      { ...settings, openOffsetSeconds: 10 * 60 },
      deduper,
      new Date("2026-05-28T09:50:00+09:00"),
    );

    expect(result._unsafeUnwrap()).toEqual({ type: "open", event });
  });

  it("auto-joins a meeting once its configured offset is due", () => {
    const deduper = createLaunchDeduper();
    const result = decideAutoJoin(
      event,
      { ...settings, autoJoinEnabled: true, joinOffsetSeconds: 3 * 60 },
      deduper,
      new Date("2026-05-28T09:57:00+09:00"),
    );

    expect(result._unsafeUnwrap()).toEqual({ type: "join", event });
  });

  it("ignores auto-join when it is disabled", () => {
    const result = decideAutoJoin(
      event,
      settings,
      createLaunchDeduper(),
      new Date("2026-05-28T10:00:00+09:00"),
    );

    expect(result._unsafeUnwrap()).toEqual({
      type: "ignore",
      reason: "auto-join-disabled",
    });
  });
});
