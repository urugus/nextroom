import { decideAutoJoin, decideLaunch } from "@main/scheduler/meetingScheduler";
import type { AppSettings, MeetEvent } from "@shared/types";
import { describe, expect, it } from "vitest";

const settings: AppSettings = {
  autoJoinEnabled: false,
  autoOpenEnabled: true,
  cameraBubbleChatMirrorEnabled: false,
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

const neverLaunched = { hasLaunched: () => false };
const alreadyLaunched = { hasLaunched: () => true };

describe("decideLaunch", () => {
  it("ignores a meeting after it has ended", () => {
    const result = decideLaunch(
      event,
      settings,
      neverLaunched,
      new Date("2026-05-28T10:30:01+09:00"),
    );

    expect(result._unsafeUnwrap()).toEqual({ type: "ignore", reason: "ended" });
  });

  it("waits until the open time", () => {
    const result = decideLaunch(
      event,
      settings,
      neverLaunched,
      new Date("2026-05-28T09:59:59+09:00"),
    );

    expect(result._unsafeUnwrap()).toEqual({ type: "ignore", reason: "not-time" });
  });

  it("opens a meeting at the exact end time", () => {
    const result = decideLaunch(
      event,
      settings,
      neverLaunched,
      new Date("2026-05-28T10:30:00+09:00"),
    );

    expect(result._unsafeUnwrap()).toEqual({ type: "open", event });
  });

  it("short-circuits disabled auto-open before checking deduplication", () => {
    const result = decideLaunch(
      event,
      { ...settings, autoOpenEnabled: false },
      alreadyLaunched,
      new Date("2026-05-28T10:00:00+09:00"),
    );

    expect(result._unsafeUnwrap()).toEqual({
      type: "ignore",
      reason: "auto-open-disabled",
    });
  });

  it("ignores a meeting that has already launched", () => {
    const result = decideLaunch(
      event,
      settings,
      alreadyLaunched,
      new Date("2026-05-28T10:00:00+09:00"),
    );

    expect(result._unsafeUnwrap()).toEqual({ type: "ignore", reason: "already-launched" });
  });
});

describe("decideAutoJoin", () => {
  const autoJoinSettings: AppSettings = { ...settings, autoJoinEnabled: true };

  it("ignores a meeting that has already launched", () => {
    const result = decideAutoJoin(
      event,
      autoJoinSettings,
      alreadyLaunched,
      new Date("2026-05-28T10:00:00+09:00"),
    );

    expect(result._unsafeUnwrap()).toEqual({ type: "ignore", reason: "already-launched" });
  });

  it("ignores a meeting after it has ended", () => {
    const result = decideAutoJoin(
      event,
      autoJoinSettings,
      neverLaunched,
      new Date("2026-05-28T10:30:01+09:00"),
    );

    expect(result._unsafeUnwrap()).toEqual({ type: "ignore", reason: "ended" });
  });

  it("waits until the join time", () => {
    const result = decideAutoJoin(
      event,
      autoJoinSettings,
      neverLaunched,
      new Date("2026-05-28T09:59:59+09:00"),
    );

    expect(result._unsafeUnwrap()).toEqual({ type: "ignore", reason: "not-time" });
  });

  it("joins a meeting at the exact end time", () => {
    const result = decideAutoJoin(
      event,
      autoJoinSettings,
      neverLaunched,
      new Date("2026-05-28T10:30:00+09:00"),
    );

    expect(result._unsafeUnwrap()).toEqual({ type: "join", event });
  });
});
