import { App } from "@renderer/App";
import type { ApiResult } from "@shared/ipc";
import type { AccountStatus, AppUpdateStatus, MeetEventsSnapshot } from "@shared/types";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const updateStatus: AppUpdateStatus = {
  canCheck: false,
  canRunHomebrewUpdate: false,
  currentVersion: "0.1.0",
  status: "unsupported",
};

const meetings: ApiResult<MeetEventsSnapshot> = {
  ok: true,
  value: {
    meetings: [
      {
        eventId: "event-1",
        occurrenceKey: "primary:event-1:2026-05-28T10:00:00+09:00",
        calendarId: "primary",
        summary: "Product sync",
        startAt: "2026-05-28T10:00:00+09:00",
        endAt: "2026-05-28T10:30:00+09:00",
        updatedAt: "2026-05-28T09:00:00+09:00",
        meetUrl: "https://meet.google.com/abc-defg-hij",
        meetCode: "abc-defg-hij",
        responseStatus: "accepted",
        status: "confirmed",
      },
    ],
  },
};

const installMeetLauncher = (
  openMeetUrl: ReturnType<typeof vi.fn>,
  meetingsResult: ApiResult<MeetEventsSnapshot> = meetings,
) => {
  const status: ApiResult<AccountStatus> = {
    ok: true,
    value: { connected: true, syncing: false },
  };

  Object.defineProperty(window, "meetLauncher", {
    configurable: true,
    value: {
      checkForUpdates: vi.fn(() => Promise.resolve({ ok: true, value: updateStatus })),
      connectGoogleAccount: vi.fn(() => Promise.resolve(status)),
      disconnectGoogleAccount: vi.fn(() =>
        Promise.resolve({ ok: true, value: { connected: false, syncing: false } }),
      ),
      getAccountStatus: vi.fn(() => Promise.resolve(status)),
      getUpdateStatus: vi.fn(() => Promise.resolve({ ok: true, value: updateStatus })),
      listUpcomingMeetings: vi.fn(() => Promise.resolve(meetingsResult)),
      onCalendarUpdated: vi.fn(() => vi.fn()),
      onUpdateStatusChanged: vi.fn(() => vi.fn()),
      runHomebrewUpdate: vi.fn(() => Promise.resolve({ ok: true, value: updateStatus })),
      openMeetUrl,
      syncCalendarNow: vi.fn(() => Promise.resolve(meetingsResult)),
      versions: {
        chrome: "test-chrome",
        electron: "test-electron",
      },
    },
  });
};

const installMeetLauncherWithStatus = (status: ApiResult<AccountStatus>) => {
  Object.defineProperty(window, "meetLauncher", {
    configurable: true,
    value: {
      checkForUpdates: vi.fn(() => Promise.resolve({ ok: true, value: updateStatus })),
      connectGoogleAccount: vi.fn(() => Promise.resolve(status)),
      disconnectGoogleAccount: vi.fn(),
      getAccountStatus: vi.fn(() =>
        Promise.resolve({ ok: true, value: { connected: false, syncing: false } }),
      ),
      getUpdateStatus: vi.fn(() => Promise.resolve({ ok: true, value: updateStatus })),
      listUpcomingMeetings: vi.fn(() => Promise.resolve({ ok: true, value: { meetings: [] } })),
      onCalendarUpdated: vi.fn(() => vi.fn()),
      onUpdateStatusChanged: vi.fn(() => vi.fn()),
      runHomebrewUpdate: vi.fn(() => Promise.resolve({ ok: true, value: updateStatus })),
      openMeetUrl: vi.fn(),
      syncCalendarNow: vi.fn(),
      versions: {
        chrome: "test-chrome",
        electron: "test-electron",
      },
    },
  });
};

const okResult: ApiResult<void> = { ok: true, value: undefined };

describe("App", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("opens a meeting through the preload API and shows loading state", async () => {
    let resolveOpen!: (value: ApiResult<void>) => void;
    const openPromise = new Promise<ApiResult<void>>((resolve) => {
      resolveOpen = resolve;
    });
    const openMeetUrl = vi.fn(() => openPromise);
    installMeetLauncher(openMeetUrl);

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Join" }));

    const openingButton = await screen.findByRole("button", { name: "Opening" });
    expect(openingButton).toBeDisabled();

    fireEvent.click(openingButton);
    expect(openMeetUrl).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveOpen(okResult);
      await openPromise;
    });

    await waitFor(() => expect(screen.getByRole("button", { name: "Join" })).toBeEnabled());
    expect(openMeetUrl).toHaveBeenCalledWith("https://meet.google.com/abc-defg-hij");
  });

  it("shows an in-app notification for an active unopened meeting", async () => {
    const now = new Date();
    const activeMeetings: ApiResult<MeetEventsSnapshot> = {
      ok: true,
      value: {
        meetings: [
          {
            eventId: "event-1",
            occurrenceKey: `primary:event-1:${now.toISOString()}`,
            calendarId: "primary",
            summary: "Product sync",
            startAt: new Date(now.getTime() - 60_000).toISOString(),
            endAt: new Date(now.getTime() + 10 * 60_000).toISOString(),
            updatedAt: now.toISOString(),
            meetUrl: "https://meet.google.com/abc-defg-hij",
            meetCode: "abc-defg-hij",
            responseStatus: "accepted",
            status: "confirmed",
          },
        ],
      },
    };
    const openMeetUrl = vi.fn<() => Promise<ApiResult<void>>>(() => Promise.resolve(okResult));
    installMeetLauncher(openMeetUrl, activeMeetings);

    render(<App />);

    const notification = await screen.findByRole("button", { name: /Next meeting is ready/ });

    fireEvent.click(notification);

    await waitFor(() =>
      expect(openMeetUrl).toHaveBeenCalledWith("https://meet.google.com/abc-defg-hij"),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: /Next meeting is ready/ }),
      ).not.toBeInTheDocument(),
    );
  });

  it("renders an IPC error response", async () => {
    const openMeetUrl = vi.fn<() => Promise<ApiResult<void>>>(() =>
      Promise.resolve({
        ok: false,
        error: {
          message: "Google Meet window failed: network error",
          recoverable: true,
          type: "MeetWindowFailed",
        },
      }),
    );
    installMeetLauncher(openMeetUrl);

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Join" }));

    expect(await screen.findByText("Google Meet window failed: network error")).toBeInTheDocument();
  });

  it("renders thrown preload errors", async () => {
    const openMeetUrl = vi.fn<() => Promise<ApiResult<void>>>(() =>
      Promise.reject(new Error("preload bridge unavailable")),
    );
    installMeetLauncher(openMeetUrl);

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Join" }));

    expect(await screen.findByText("preload bridge unavailable")).toBeInTheDocument();
  });

  it("renders account status errors returned after connect", async () => {
    installMeetLauncherWithStatus({
      ok: true,
      value: {
        connected: true,
        syncing: false,
        error: {
          message: "Google Calendar API failed: unavailable",
          recoverable: true,
          type: "CalendarApiFailed",
        },
      },
    });

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Connect" }));

    expect(await screen.findByText("Google Calendar API failed: unavailable")).toBeInTheDocument();
  });

  it("clears account status errors after a later successful status", async () => {
    let calendarUpdatedHandler!: (result: ApiResult<MeetEventsSnapshot>) => void;
    Object.defineProperty(window, "meetLauncher", {
      configurable: true,
      value: {
        checkForUpdates: vi.fn(() => Promise.resolve({ ok: true, value: updateStatus })),
        connectGoogleAccount: vi.fn(),
        disconnectGoogleAccount: vi.fn(),
        getAccountStatus: vi
          .fn()
          .mockResolvedValueOnce({
            ok: true,
            value: {
              connected: true,
              syncing: false,
              error: {
                message: "Google Calendar API failed: unavailable",
                recoverable: true,
                type: "CalendarApiFailed",
              },
            },
          })
          .mockResolvedValue({
            ok: true,
            value: { connected: true, syncing: false },
          }),
        getUpdateStatus: vi.fn(() => Promise.resolve({ ok: true, value: updateStatus })),
        listUpcomingMeetings: vi.fn(() => Promise.resolve({ ok: true, value: { meetings: [] } })),
        onCalendarUpdated: vi.fn((handler: (result: ApiResult<MeetEventsSnapshot>) => void) => {
          calendarUpdatedHandler = handler;
          return vi.fn();
        }),
        onUpdateStatusChanged: vi.fn(() => vi.fn()),
        runHomebrewUpdate: vi.fn(() => Promise.resolve({ ok: true, value: updateStatus })),
        openMeetUrl: vi.fn(),
        syncCalendarNow: vi.fn(),
        versions: {
          chrome: "test-chrome",
          electron: "test-electron",
        },
      },
    });

    render(<App />);

    expect(await screen.findByText("Google Calendar API failed: unavailable")).toBeInTheDocument();
    act(() => {
      calendarUpdatedHandler({ ok: true, value: { meetings: [] } });
    });
    await waitFor(() =>
      expect(screen.queryByText("Google Calendar API failed: unavailable")).not.toBeInTheDocument(),
    );
  });
});
