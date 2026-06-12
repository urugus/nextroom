import { createGoogleCalendarClient } from "@main/calendar/calendarClient";
import { createCalendarSyncService } from "@main/calendar/calendarSyncService";
import type { GoogleAuthService } from "@main/oauth/googleAuthService";
import type { CalendarEvent } from "@shared/types";
import { err, errAsync, ok, okAsync, ResultAsync } from "neverthrow";
import { describe, expect, it, vi } from "vitest";

const createAuthService = (accessToken: string | null): GoogleAuthService => ({
  connect: () => Promise.resolve(ok(undefined)),
  disconnect: () => Promise.resolve(ok(undefined)),
  getAccessToken: () => Promise.resolve(ok(accessToken)),
  isConnected: () => Promise.resolve(ok(accessToken !== null)),
});

const flushMicrotasks = async (): Promise<void> => {
  for (let index = 0; index < 5; index += 1) {
    await Promise.resolve();
  }
};

describe("createCalendarSyncService", () => {
  it("syncs and normalizes upcoming Meet events", async () => {
    const fetchImpl = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            items: [
              {
                id: "event-1",
                summary: "Product sync",
                start: { dateTime: "2026-05-29T10:00:00+09:00" },
                end: { dateTime: "2026-05-29T10:30:00+09:00" },
                updated: "2026-05-29T09:00:00+09:00",
                hangoutLink: "https://meet.google.com/abc-defg-hij",
              },
              {
                id: "event-2",
                summary: "No Meet",
                start: { dateTime: "2026-05-29T11:00:00+09:00" },
                end: { dateTime: "2026-05-29T11:30:00+09:00" },
              },
            ],
          }),
        ),
      ),
    );
    const service = createCalendarSyncService({
      authService: createAuthService("access-token"),
      calendarClient: createGoogleCalendarClient(fetchImpl),
      now: () => new Date("2026-05-29T00:00:00Z"),
    });

    const result = await service.syncNow();

    expect(result._unsafeUnwrap().meetings).toHaveLength(1);
    expect(result._unsafeUnwrap().meetings[0]).toMatchObject({
      eventId: "event-1",
      summary: "Product sync",
      meetUrl: "https://meet.google.com/abc-defg-hij",
    });
  });

  it("clears account state when Calendar returns 401", async () => {
    const disconnect = vi.fn(() => Promise.resolve(ok(undefined)));
    const authService: GoogleAuthService = {
      connect: () => Promise.resolve(ok(undefined)),
      disconnect,
      getAccessToken: () => Promise.resolve(ok("access-token")),
      isConnected: () => Promise.resolve(ok(true)),
    };
    const calendarClient = {
      listUpcomingEvents: () =>
        errAsync({
          type: "CalendarApiFailed" as const,
          status: 401,
          cause: "unauthorized",
        }),
    };
    const service = createCalendarSyncService({ authService, calendarClient });

    const result = await service.syncNow();

    expect(result._unsafeUnwrapErr()).toMatchObject({ type: "CalendarApiFailed", status: 401 });
    expect(disconnect).toHaveBeenCalled();
  });

  it("returns the cached snapshot while a sync is already running", async () => {
    let resolveEvents!: (events: CalendarEvent[]) => void;
    const eventsPromise = new Promise<CalendarEvent[]>((resolve) => {
      resolveEvents = resolve;
    });
    const calendarClient = {
      listUpcomingEvents: vi.fn(() =>
        ResultAsync.fromPromise(eventsPromise, (cause) => ({
          type: "CalendarApiFailed" as const,
          cause,
        })),
      ),
    };
    const service = createCalendarSyncService({
      authService: createAuthService("access-token"),
      calendarClient,
      now: () => new Date("2026-05-29T00:00:00Z"),
    });

    const firstSync = service.syncNow();
    const secondSync = await service.syncNow();

    expect(secondSync._unsafeUnwrap()).toEqual({ meetings: [] });
    expect(calendarClient.listUpcomingEvents).toHaveBeenCalledTimes(1);

    resolveEvents([
      {
        id: "event-1",
        summary: "Product sync",
        start: { dateTime: "2026-05-29T10:00:00+09:00" },
        end: { dateTime: "2026-05-29T10:30:00+09:00" },
        hangoutLink: "https://meet.google.com/abc-defg-hij",
      },
    ]);

    expect((await firstSync)._unsafeUnwrap().meetings).toHaveLength(1);
  });

  it("clears cached meetings when refresh token is no longer connected", async () => {
    let connected = true;
    const authService: GoogleAuthService = {
      connect: () => Promise.resolve(ok(undefined)),
      disconnect: () => Promise.resolve(ok(undefined)),
      getAccessToken: () => {
        connected = false;
        return Promise.resolve(err({ type: "TokenRefreshFailed", cause: "invalid_grant" }));
      },
      isConnected: () => Promise.resolve(ok(connected)),
    };
    const calendarClient = createGoogleCalendarClient(vi.fn<typeof fetch>());
    const service = createCalendarSyncService({ authService, calendarClient });
    const snapshots: unknown[] = [];
    service.subscribe((snapshot) => {
      snapshots.push(snapshot);
    });

    const result = await service.syncNow();

    expect(result._unsafeUnwrapErr()).toMatchObject({ type: "TokenRefreshFailed" });
    expect(snapshots).toEqual([{ meetings: [] }]);
  });

  it("returns a serialized connection error when connect fails", async () => {
    const authService: GoogleAuthService = {
      connect: () => Promise.resolve(err({ type: "OAuthDenied" })),
      disconnect: () => Promise.resolve(ok(undefined)),
      getAccessToken: () => Promise.resolve(ok("access-token")),
      isConnected: () => Promise.resolve(ok(false)),
    };
    const service = createCalendarSyncService({
      authService,
      calendarClient: createGoogleCalendarClient(vi.fn<typeof fetch>()),
    });

    const result = await service.connectAccount();

    expect(result._unsafeUnwrapErr()).toEqual({ type: "OAuthDenied" });
    expect((await service.getAccountStatus())._unsafeUnwrap()).toEqual({
      connected: false,
      syncing: false,
      error: {
        message: "Google authorization was denied.",
        recoverable: true,
        type: "OAuthDenied",
      },
    });
  });

  it("surfaces disconnect failures without clearing cached meetings", async () => {
    const authService: GoogleAuthService = {
      connect: () => Promise.resolve(ok(undefined)),
      disconnect: () =>
        Promise.resolve(err({ type: "KeychainUnavailable", cause: "keychain locked" })),
      getAccessToken: () => Promise.resolve(ok("access-token")),
      isConnected: () => Promise.resolve(ok(true)),
    };
    const calendarClient = {
      listUpcomingEvents: vi.fn(() =>
        okAsync([
          {
            id: "event-1",
            summary: "Product sync",
            start: { dateTime: "2026-05-29T10:00:00+09:00" },
            end: { dateTime: "2026-05-29T10:30:00+09:00" },
            hangoutLink: "https://meet.google.com/abc-defg-hij",
          },
        ]),
      ),
    };
    const service = createCalendarSyncService({ authService, calendarClient });

    await service.syncNow();
    const result = await service.disconnectAccount();

    expect(result._unsafeUnwrapErr()).toMatchObject({ type: "KeychainUnavailable" });
    expect(service.listUpcomingMeetings()._unsafeUnwrap().meetings).toHaveLength(1);
  });

  it("clears meetings and notifies listeners after disconnect succeeds", async () => {
    const authService: GoogleAuthService = {
      connect: () => Promise.resolve(ok(undefined)),
      disconnect: () => Promise.resolve(ok(undefined)),
      getAccessToken: () => Promise.resolve(ok("access-token")),
      isConnected: () => Promise.resolve(ok(false)),
    };
    const calendarClient = {
      listUpcomingEvents: vi.fn(() =>
        okAsync([
          {
            id: "event-1",
            summary: "Product sync",
            start: { dateTime: "2026-05-29T10:00:00+09:00" },
            end: { dateTime: "2026-05-29T10:30:00+09:00" },
            hangoutLink: "https://meet.google.com/abc-defg-hij",
          },
        ]),
      ),
    };
    const service = createCalendarSyncService({ authService, calendarClient });
    const listener = vi.fn();
    service.subscribe(listener);

    await service.syncNow();
    listener.mockClear();
    const result = await service.disconnectAccount();

    expect(result._unsafeUnwrap()).toEqual({ connected: false, syncing: false });
    expect(listener).toHaveBeenCalledWith({ meetings: [] });
    expect(service.listUpcomingMeetings()._unsafeUnwrap()).toEqual({ meetings: [] });
  });

  it("backs off polling failures and caps the retry delay", async () => {
    const callbacks: Array<() => void> = [];
    const delays: number[] = [];
    const clearTimeoutFn = vi.fn();
    const setTimeoutFn = vi.fn((handler: TimerHandler, timeout?: number) => {
      callbacks.push(handler as () => void);
      delays.push(timeout ?? 0);
      return callbacks.length as unknown as ReturnType<typeof setTimeout>;
    }) as unknown as typeof setTimeout;
    const logger = {
      child: vi.fn(),
      debug: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
    };
    logger.child.mockReturnValue(logger);
    const authService: GoogleAuthService = {
      connect: () => Promise.resolve(ok(undefined)),
      disconnect: () => Promise.resolve(ok(undefined)),
      getAccessToken: () => Promise.resolve(ok("access-token")),
      isConnected: () => Promise.resolve(ok(true)),
    };
    const calendarClient = {
      listUpcomingEvents: vi.fn(() =>
        errAsync({ type: "CalendarApiFailed" as const, cause: "network" }),
      ),
    };
    const service = createCalendarSyncService({
      authService,
      calendarClient,
      clearTimeoutFn,
      logger,
      setTimeoutFn,
    });

    service.startPolling();
    await flushMicrotasks();

    for (let index = 0; index < 6; index += 1) {
      callbacks.at(-1)?.();
      await flushMicrotasks();
    }

    expect(delays).toEqual([30_000, 60_000, 120_000, 240_000, 300_000, 300_000, 300_000]);
    expect(clearTimeoutFn).toHaveBeenCalledTimes(6);
    expect(logger.error).toHaveBeenCalledWith("sync failed", {
      error: { type: "CalendarApiFailed", cause: "network" },
      backoffSeconds: 300,
    });
  });

  it("schedules normal polling after a successful polling sync and clears it when stopped", async () => {
    const clearTimeoutFn = vi.fn();
    const setTimeoutFn = vi.fn(
      (_handler: TimerHandler, _timeout?: number) =>
        123 as unknown as ReturnType<typeof setTimeout>,
    ) as unknown as typeof setTimeout;
    const authService: GoogleAuthService = {
      connect: () => Promise.resolve(ok(undefined)),
      disconnect: () => Promise.resolve(ok(undefined)),
      getAccessToken: () => Promise.resolve(ok("access-token")),
      isConnected: () => Promise.resolve(ok(true)),
    };
    const calendarClient = {
      listUpcomingEvents: vi.fn(() => okAsync([])),
    };
    const service = createCalendarSyncService({
      authService,
      calendarClient,
      clearTimeoutFn,
      setTimeoutFn,
    });

    service.startPolling();
    await flushMicrotasks();
    service.stopPolling();

    expect(setTimeoutFn).toHaveBeenCalledWith(expect.any(Function), 60_000);
    expect(clearTimeoutFn).toHaveBeenCalledWith(123);
  });

  it("does not schedule a poll when stopped before the polling sync finishes", async () => {
    let resolveEvents!: (events: []) => void;
    const events = new Promise<[]>((resolve) => {
      resolveEvents = resolve;
    });
    const setTimeoutFn = vi.fn() as unknown as typeof setTimeout;
    const service = createCalendarSyncService({
      authService: createAuthService("access-token"),
      calendarClient: {
        listUpcomingEvents: vi.fn(() =>
          ResultAsync.fromPromise(events, (cause) => ({
            type: "CalendarApiFailed" as const,
            cause,
          })),
        ),
      },
      setTimeoutFn,
    });

    service.startPolling();
    service.stopPolling();
    resolveEvents([]);
    await flushMicrotasks();

    expect(setTimeoutFn).not.toHaveBeenCalled();
  });

  it("ignores duplicate startPolling calls while polling is already active", async () => {
    const service = createCalendarSyncService({
      authService: createAuthService("access-token"),
      calendarClient: {
        listUpcomingEvents: vi.fn(() => okAsync([])),
      },
    });

    service.startPolling();
    service.startPolling();
    await flushMicrotasks();

    expect(service.listUpcomingMeetings()._unsafeUnwrap()).toEqual({
      meetings: [],
      syncedAt: expect.any(String),
    });
  });

  it("returns account status errors from the auth service", async () => {
    const authService: GoogleAuthService = {
      connect: () => Promise.resolve(ok(undefined)),
      disconnect: () => Promise.resolve(ok(undefined)),
      getAccessToken: () => Promise.resolve(ok(null)),
      isConnected: () => Promise.resolve(err({ type: "KeychainUnavailable", cause: "locked" })),
    };
    const service = createCalendarSyncService({
      authService,
      calendarClient: createGoogleCalendarClient(vi.fn<typeof fetch>()),
    });

    expect((await service.getAccountStatus())._unsafeUnwrapErr()).toMatchObject({
      type: "KeychainUnavailable",
    });
  });

  it("logs initial sync failures but still returns account status after connecting", async () => {
    const logger = {
      child: vi.fn(),
      debug: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
    };
    logger.child.mockReturnValue(logger);
    const authService: GoogleAuthService = {
      connect: () => Promise.resolve(ok(undefined)),
      disconnect: () => Promise.resolve(ok(undefined)),
      getAccessToken: () => Promise.resolve(ok("access-token")),
      isConnected: () => Promise.resolve(ok(true)),
    };
    const service = createCalendarSyncService({
      authService,
      calendarClient: {
        listUpcomingEvents: vi.fn(() =>
          errAsync({ type: "CalendarApiFailed" as const, cause: "network" }),
        ),
      },
      logger,
      setTimeoutFn: vi.fn() as unknown as typeof setTimeout,
    });

    const result = await service.connectAccount();

    expect(result._unsafeUnwrap()).toMatchObject({
      connected: true,
      error: {
        message: "Google Calendar API failed: network",
        recoverable: true,
        type: "CalendarApiFailed",
      },
    });
    expect(logger.warn).toHaveBeenCalledWith("initial sync failed", {
      error: { type: "CalendarApiFailed", cause: "network" },
    });
  });

  it("logs when a later successful sync recovers from an earlier error", async () => {
    const logger = {
      child: vi.fn(),
      debug: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
    };
    logger.child.mockReturnValue(logger);
    const calendarClient = {
      listUpcomingEvents: vi
        .fn()
        .mockReturnValueOnce(errAsync({ type: "CalendarApiFailed" as const, cause: "network" }))
        .mockReturnValueOnce(okAsync([])),
    };
    const service = createCalendarSyncService({
      authService: createAuthService("access-token"),
      calendarClient,
      logger,
    });

    expect((await service.syncNow()).isErr()).toBe(true);
    expect((await service.syncNow()).isOk()).toBe(true);

    expect(logger.info).toHaveBeenCalledWith("sync recovered");
  });

  it("clears a scheduled connect poll when disconnecting", async () => {
    const clearTimeoutFn = vi.fn();
    const setTimeoutFn = vi.fn(
      (_handler: TimerHandler, _timeout?: number) =>
        456 as unknown as ReturnType<typeof setTimeout>,
    ) as unknown as typeof setTimeout;
    const service = createCalendarSyncService({
      authService: createAuthService("access-token"),
      calendarClient: {
        listUpcomingEvents: vi.fn(() => okAsync([])),
      },
      clearTimeoutFn,
      setTimeoutFn,
    });

    await service.connectAccount();
    await service.disconnectAccount();

    expect(clearTimeoutFn).toHaveBeenCalledWith(456);
  });

  it("stops notifying an unsubscribed listener", async () => {
    const service = createCalendarSyncService({
      authService: createAuthService("access-token"),
      calendarClient: {
        listUpcomingEvents: vi.fn(() => okAsync([])),
      },
    });
    const listener = vi.fn();
    const unsubscribe = service.subscribe(listener);

    unsubscribe();
    await service.syncNow();

    expect(listener).not.toHaveBeenCalled();
  });

  it("polling reads the refresh token once and stops when the account is disconnected", async () => {
    const getAccessToken = vi.fn(() => Promise.resolve(ok(null)));
    const isConnected = vi.fn(() => Promise.resolve(ok(false)));
    let scheduled = false;
    const setTimeoutFn = ((handler: TimerHandler, timeout?: number) => {
      scheduled = true;
      const timer = globalThis.setTimeout(handler, timeout) as unknown as ReturnType<
        typeof setTimeout
      > & { unref?: () => void };
      timer.unref?.();
      return timer;
    }) as unknown as typeof setTimeout;
    const authService: GoogleAuthService = {
      connect: () => Promise.resolve(ok(undefined)),
      disconnect: () => Promise.resolve(ok(undefined)),
      getAccessToken,
      isConnected,
    };
    const calendarClient = createGoogleCalendarClient(vi.fn<typeof fetch>());
    const service = createCalendarSyncService({ authService, calendarClient, setTimeoutFn });

    service.startPolling();
    await Promise.resolve();
    await Promise.resolve();

    expect(getAccessToken).toHaveBeenCalledTimes(1);
    expect(isConnected).not.toHaveBeenCalled();
    expect(scheduled).toBe(false);
  });

  it("surfaces normalizer failures from the calendar sync boundary", async () => {
    vi.resetModules();
    vi.doMock("@main/calendar/eventNormalizer", () => ({
      normalizeUpcomingMeetEvents: vi.fn(() =>
        err({ type: "MeetUrlNotFound", eventId: "event-1" }),
      ),
    }));
    const { createCalendarSyncService: createCalendarSyncServiceWithMockedNormalizer } =
      await import("@main/calendar/calendarSyncService");
    const service = createCalendarSyncServiceWithMockedNormalizer({
      authService: createAuthService("access-token"),
      calendarClient: {
        listUpcomingEvents: vi.fn(() =>
          okAsync([
            {
              id: "event-1",
              start: { dateTime: "2026-05-29T10:00:00+09:00" },
              end: { dateTime: "2026-05-29T10:30:00+09:00" },
            },
          ]),
        ),
      },
    });

    const result = await service.syncNow();

    expect(result._unsafeUnwrapErr()).toEqual({
      eventId: "event-1",
      type: "MeetUrlNotFound",
    });

    vi.doUnmock("@main/calendar/eventNormalizer");
    vi.resetModules();
  });
});
