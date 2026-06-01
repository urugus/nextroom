import { createAutoOpenScheduler } from "@main/scheduler/autoOpenScheduler";
import { createLaunchDeduper, type LaunchDeduper } from "@main/scheduler/launchDeduper";
import type { AppError } from "@shared/errors";
import type { AppSettings, LaunchRecord, MeetEvent, MeetEventsSnapshot } from "@shared/types";
import { err, ok, type Result } from "neverthrow";
import { describe, expect, it, vi } from "vitest";

const settings: AppSettings = {
  autoJoinEnabled: false,
  autoOpenEnabled: true,
  joinOffsetSeconds: 0,
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

const schedulerDefaults = () => ({
  autoJoinMeetUrl: vi.fn(() => Promise.resolve(ok(undefined))),
  hasBlockingMeetWindow: vi.fn(() => false),
  joinDeduper: createLaunchDeduper(),
});

describe("createAutoOpenScheduler", () => {
  it("opens a due meeting once and records the launch", async () => {
    const deduper = createLaunchDeduper();
    const openMeetUrl = vi.fn(() => Promise.resolve(ok(undefined)));
    const scheduler = createAutoOpenScheduler({
      activatedAt: new Date("2026-05-28T09:59:00+09:00"),
      ...schedulerDefaults(),
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
      ...schedulerDefaults(),
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
      ...schedulerDefaults(),
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
      ...schedulerDefaults(),
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
      ...schedulerDefaults(),
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
      ...schedulerDefaults(),
      deduper: createLaunchDeduper(),
      now: () => new Date("2026-05-28T10:00:00+09:00"),
      openMeetUrl,
      settings,
    });

    const firstEvaluate = scheduler.evaluate(snapshot);
    await Promise.resolve();
    const secondEvaluate = scheduler.evaluate(snapshot);
    resolveOpen(ok(undefined));
    await firstEvaluate;
    await secondEvaluate;

    expect(openMeetUrl).toHaveBeenCalledTimes(1);
  });

  it("respects disabled auto-open settings", async () => {
    const openMeetUrl = vi.fn(() => Promise.resolve(ok(undefined)));
    const scheduler = createAutoOpenScheduler({
      activatedAt: new Date("2026-05-28T09:59:00+09:00"),
      ...schedulerDefaults(),
      deduper: createLaunchDeduper(),
      now: () => new Date("2026-05-28T10:00:00+09:00"),
      openMeetUrl,
      settings: { ...settings, autoOpenEnabled: false },
    });

    await scheduler.evaluate(snapshot);

    expect(openMeetUrl).not.toHaveBeenCalled();
  });

  it("auto-joins a due meeting once and records the join separately from opening", async () => {
    const deduper = createLaunchDeduper();
    const joinDeduper = createLaunchDeduper();
    const openMeetUrl = vi.fn(() => Promise.resolve(ok(undefined)));
    const autoJoinMeetUrl = vi.fn(() => Promise.resolve(ok(undefined)));
    const scheduler = createAutoOpenScheduler({
      activatedAt: new Date("2026-05-28T09:59:00+09:00"),
      autoJoinMeetUrl,
      deduper,
      hasBlockingMeetWindow: vi.fn(() => false),
      joinDeduper,
      now: () => new Date("2026-05-28T10:00:00+09:00"),
      openMeetUrl,
      settings: { ...settings, autoJoinEnabled: true },
    });

    await scheduler.evaluate(snapshot);
    await scheduler.evaluate(snapshot);

    expect(openMeetUrl).toHaveBeenCalledTimes(1);
    expect(autoJoinMeetUrl).toHaveBeenCalledTimes(1);
    expect(deduper.records()).toHaveLength(1);
    expect(joinDeduper.records()).toHaveLength(1);
  });

  it("queues auto-join behind another open Meet window and drains when it closes", async () => {
    let blocking = true;
    const autoJoinMeetUrl = vi.fn(() => Promise.resolve(ok(undefined)));
    const scheduler = createAutoOpenScheduler({
      activatedAt: new Date("2026-05-28T09:59:00+09:00"),
      autoJoinMeetUrl,
      deduper: createLaunchDeduper(),
      hasBlockingMeetWindow: vi.fn(() => blocking),
      joinDeduper: createLaunchDeduper(),
      now: () => new Date("2026-05-28T10:00:00+09:00"),
      openMeetUrl: vi.fn(() => Promise.resolve(ok(undefined))),
      settings: { ...settings, autoJoinEnabled: true },
    });

    await scheduler.evaluate(snapshot);

    expect(autoJoinMeetUrl).not.toHaveBeenCalled();

    blocking = false;
    scheduler.handleMeetWindowClosed("https://meet.google.com/other-meet");
    await Promise.resolve();

    expect(autoJoinMeetUrl).toHaveBeenCalledWith("https://meet.google.com/abc-defg-hij");
  });

  it("does not run two auto-joins in one evaluation pass", async () => {
    const laterEvent: MeetEvent = {
      ...event,
      eventId: "event-2",
      occurrenceKey: "primary:event-2:2026-05-28T10:01:00+09:00",
      startAt: "2026-05-28T10:01:00+09:00",
      endAt: "2026-05-28T10:31:00+09:00",
      meetUrl: "https://meet.google.com/xyz-abcd-efg",
    };
    const autoJoinMeetUrl = vi.fn(() => Promise.resolve(ok(undefined)));
    const scheduler = createAutoOpenScheduler({
      activatedAt: new Date("2026-05-28T09:59:00+09:00"),
      autoJoinMeetUrl,
      deduper: createLaunchDeduper(),
      hasBlockingMeetWindow: vi.fn(() => false),
      joinDeduper: createLaunchDeduper(),
      now: () => new Date("2026-05-28T10:01:00+09:00"),
      openMeetUrl: vi.fn(() => Promise.resolve(ok(undefined))),
      settings: { ...settings, autoJoinEnabled: true },
    });

    await scheduler.evaluate({ meetings: [laterEvent, event] });

    expect(autoJoinMeetUrl).toHaveBeenCalledTimes(1);
    expect(autoJoinMeetUrl).toHaveBeenCalledWith("https://meet.google.com/abc-defg-hij");
  });

  it("suppresses repeated auto-join attempts after a join failure", async () => {
    const autoJoinMeetUrl = vi.fn(() =>
      Promise.resolve(err({ type: "MeetWindowFailed" as const, cause: "Meet login is required." })),
    );
    const scheduler = createAutoOpenScheduler({
      activatedAt: new Date("2026-05-28T09:59:00+09:00"),
      autoJoinMeetUrl,
      deduper: createLaunchDeduper(),
      hasBlockingMeetWindow: vi.fn(() => false),
      joinDeduper: createLaunchDeduper(),
      now: () => new Date("2026-05-28T10:00:00+09:00"),
      openMeetUrl: vi.fn(() => Promise.resolve(ok(undefined))),
      settings: { ...settings, autoJoinEnabled: true },
    });

    await scheduler.evaluate(snapshot);
    await scheduler.evaluate(snapshot);

    expect(autoJoinMeetUrl).toHaveBeenCalledTimes(1);
  });

  it("continues evaluating later meetings after an auto-join failure", async () => {
    const laterEvent: MeetEvent = {
      ...event,
      eventId: "event-2",
      occurrenceKey: "primary:event-2:2026-05-28T10:01:00+09:00",
      startAt: "2026-05-28T10:01:00+09:00",
      endAt: "2026-05-28T10:31:00+09:00",
      meetUrl: "https://meet.google.com/xyz-abcd-efg",
    };
    const openMeetUrl = vi.fn(() => Promise.resolve(ok(undefined)));
    const autoJoinMeetUrl = vi
      .fn()
      .mockResolvedValueOnce(err({ type: "MeetWindowFailed", cause: "join failed" }))
      .mockResolvedValueOnce(ok(undefined));
    const scheduler = createAutoOpenScheduler({
      activatedAt: new Date("2026-05-28T09:59:00+09:00"),
      autoJoinMeetUrl,
      deduper: createLaunchDeduper(),
      hasBlockingMeetWindow: vi.fn(() => false),
      joinDeduper: createLaunchDeduper(),
      now: () => new Date("2026-05-28T10:01:00+09:00"),
      openMeetUrl,
      settings: { ...settings, autoJoinEnabled: true },
    });

    const result = await scheduler.evaluate({ meetings: [event, laterEvent] });

    expect(result._unsafeUnwrapErr()).toMatchObject({ type: "MeetWindowFailed" });
    expect(openMeetUrl).toHaveBeenCalledWith("https://meet.google.com/xyz-abcd-efg");
    expect(autoJoinMeetUrl).toHaveBeenCalledTimes(2);
  });

  it("clears a successful active auto-join after its window closes", async () => {
    const laterEvent: MeetEvent = {
      ...event,
      eventId: "event-2",
      occurrenceKey: "primary:event-2:2026-05-28T10:01:00+09:00",
      startAt: "2026-05-28T10:01:00+09:00",
      endAt: "2026-05-28T10:31:00+09:00",
      meetUrl: "https://meet.google.com/xyz-abcd-efg",
    };
    const autoJoinMeetUrl = vi.fn(() => Promise.resolve(ok(undefined)));
    const scheduler = createAutoOpenScheduler({
      activatedAt: new Date("2026-05-28T09:59:00+09:00"),
      autoJoinMeetUrl,
      deduper: createLaunchDeduper(),
      hasBlockingMeetWindow: vi.fn(() => false),
      joinDeduper: createLaunchDeduper(),
      now: () => new Date("2026-05-28T10:01:00+09:00"),
      openMeetUrl: vi.fn(() => Promise.resolve(ok(undefined))),
      settings: { ...settings, autoJoinEnabled: true },
    });

    await scheduler.evaluate({ meetings: [event, laterEvent] });

    expect(autoJoinMeetUrl).toHaveBeenCalledTimes(1);

    scheduler.handleMeetWindowClosed("https://meet.google.com/abc-defg-hij");
    await Promise.resolve();

    expect(autoJoinMeetUrl).toHaveBeenCalledWith("https://meet.google.com/xyz-abcd-efg");
  });
});
