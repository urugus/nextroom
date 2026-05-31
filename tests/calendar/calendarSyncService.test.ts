import { createGoogleCalendarClient } from "@main/calendar/calendarClient";
import { createCalendarSyncService } from "@main/calendar/calendarSyncService";
import type { GoogleAuthService } from "@main/oauth/googleAuthService";
import { err, errAsync, ok } from "neverthrow";
import { describe, expect, it, vi } from "vitest";

const createAuthService = (accessToken: string | null): GoogleAuthService => ({
  connect: () => Promise.resolve(ok(undefined)),
  disconnect: () => Promise.resolve(ok(undefined)),
  getAccessToken: () => Promise.resolve(ok(accessToken)),
  isConnected: () => Promise.resolve(ok(accessToken !== null)),
});

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
});
