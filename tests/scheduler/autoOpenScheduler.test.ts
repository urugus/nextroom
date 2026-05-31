import { createAutoOpenScheduler } from "@main/scheduler/autoOpenScheduler";
import { createLaunchDeduper, type LaunchDeduper } from "@main/scheduler/launchDeduper";
import type { AppError } from "@shared/errors";
import type { AppSettings, LaunchRecord, MeetEvent, MeetEventsSnapshot } from "@shared/types";
import { err, ok, type Result } from "neverthrow";
import { describe, expect, it, vi } from "vitest";

const settings: AppSettings = {
  autoOpenEnabled: true,
  notifyBeforeMinutes: 1,
  openOffsetSeconds: 0,
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

const snapshot: MeetEventsSnapshot = { meetings: [event] };

describe("createAutoOpenScheduler", () => {
  it("opens a due meeting once and records the launch", async () => {
    const deduper = createLaunchDeduper();
    const openMeetUrl = vi.fn(() => Promise.resolve(ok(undefined)));
    const scheduler = createAutoOpenScheduler({
      activatedAt: new Date("2026-05-28T09:59:00+09:00"),
      deduper,
      now: () => new Date("2026-05-28T10:00:00+09:00"),
      openMeetUrl,
      settings,
    });

    await scheduler.evaluate(snapshot);
    await scheduler.evaluate(snapshot);

    expect(openMeetUrl).toHaveBeenCalledTimes(1);
    expect(openMeetUrl).toHaveBeenCalledWith("https://meet.google.com/abc-defg-hij");
    expect(deduper.records()).toHaveLength(1);
  });

  it("does not open meetings that are not due yet", async () => {
    const openMeetUrl = vi.fn(() => Promise.resolve(ok(undefined)));
    const scheduler = createAutoOpenScheduler({
      activatedAt: new Date("2026-05-28T09:50:00+09:00"),
      deduper: createLaunchDeduper(),
      now: () => new Date("2026-05-28T09:59:59+09:00"),
      openMeetUrl,
      settings,
    });

    await scheduler.evaluate(snapshot);

    expect(openMeetUrl).not.toHaveBeenCalled();
  });

  it("does not open meetings whose auto-open time was before app activation", async () => {
    const openMeetUrl = vi.fn(() => Promise.resolve(ok(undefined)));
    const scheduler = createAutoOpenScheduler({
      activatedAt: new Date("2026-05-28T10:01:00+09:00"),
      deduper: createLaunchDeduper(),
      now: () => new Date("2026-05-28T10:01:00+09:00"),
      openMeetUrl,
      settings,
    });

    await scheduler.evaluate(snapshot);

    expect(openMeetUrl).not.toHaveBeenCalled();
  });

  it("does not record a launch when opening fails so a later sync can retry", async () => {
    const deduper = createLaunchDeduper();
    const openMeetUrl = vi
      .fn()
      .mockResolvedValueOnce(err({ type: "MeetWindowFailed", cause: "load failed" }))
      .mockResolvedValueOnce(ok(undefined));
    const scheduler = createAutoOpenScheduler({
      activatedAt: new Date("2026-05-28T09:59:00+09:00"),
      deduper,
      now: () => new Date("2026-05-28T10:00:00+09:00"),
      openMeetUrl,
      settings,
    });

    await scheduler.evaluate(snapshot);
    await scheduler.evaluate(snapshot);

    expect(openMeetUrl).toHaveBeenCalledTimes(2);
    expect(deduper.records()).toHaveLength(1);
  });

  it("returns an error when marking a successful launch fails", async () => {
    const markLaunched = vi.fn<LaunchDeduper["markLaunched"]>(() =>
      err({ type: "DatabaseFailed", cause: "write failed" }),
    );
    const deduper: LaunchDeduper = {
      hasLaunched: () => false,
      markLaunched,
      records: (): LaunchRecord[] => [],
    };
    const scheduler = createAutoOpenScheduler({
      activatedAt: new Date("2026-05-28T09:59:00+09:00"),
      deduper,
      now: () => new Date("2026-05-28T10:00:00+09:00"),
      openMeetUrl: vi.fn(() => Promise.resolve(ok(undefined))),
      settings,
    });

    const result = await scheduler.evaluate(snapshot);

    expect(result._unsafeUnwrapErr()).toMatchObject({ type: "DatabaseFailed" });
    expect(markLaunched).toHaveBeenCalledTimes(1);
  });

  it("does not duplicate a launch while the same occurrence is already opening", async () => {
    let resolveOpen!: (value: Result<void, AppError>) => void;
    const openMeetUrl = vi.fn(
      () =>
        new Promise<Result<void, AppError>>((resolve) => {
          resolveOpen = resolve;
        }),
    );
    const scheduler = createAutoOpenScheduler({
      activatedAt: new Date("2026-05-28T09:59:00+09:00"),
      deduper: createLaunchDeduper(),
      now: () => new Date("2026-05-28T10:00:00+09:00"),
      openMeetUrl,
      settings,
    });

    const firstEvaluate = scheduler.evaluate(snapshot);
    await Promise.resolve();
    await scheduler.evaluate(snapshot);
    resolveOpen(ok(undefined));
    await firstEvaluate;

    expect(openMeetUrl).toHaveBeenCalledTimes(1);
  });

  it("respects disabled auto-open settings", async () => {
    const openMeetUrl = vi.fn(() => Promise.resolve(ok(undefined)));
    const scheduler = createAutoOpenScheduler({
      activatedAt: new Date("2026-05-28T09:59:00+09:00"),
      deduper: createLaunchDeduper(),
      now: () => new Date("2026-05-28T10:00:00+09:00"),
      openMeetUrl,
      settings: { ...settings, autoOpenEnabled: false },
    });

    await scheduler.evaluate(snapshot);

    expect(openMeetUrl).not.toHaveBeenCalled();
  });
});
