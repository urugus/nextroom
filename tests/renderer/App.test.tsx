import { App } from "@renderer/App";
import type { ApiResult, SettingsUpdate } from "@shared/ipc";
import type {
  AccountStatus,
  AppSettings,
  AppUpdateStatus,
  MeetEvent,
  MeetEventsSnapshot,
} from "@shared/types";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const updateStatus: AppUpdateStatus = {
  canCheck: false,
  canRunHomebrewUpdate: false,
  currentVersion: "0.1.0",
  status: "unsupported",
};

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
  onCalendarUpdated: (
    handler: (result: ApiResult<MeetEventsSnapshot>) => void,
  ) => () => void = vi.fn(() => vi.fn()),
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
      getSettings: vi.fn(() => Promise.resolve({ ok: true, value: settings })),
      getUpdateStatus: vi.fn(() => Promise.resolve({ ok: true, value: updateStatus })),
      listUpcomingMeetings: vi.fn(() => Promise.resolve(meetingsResult)),
      onCalendarUpdated,
      onUpdateStatusChanged: vi.fn(() => vi.fn()),
      runHomebrewUpdate: vi.fn(() => Promise.resolve({ ok: true, value: updateStatus })),
      openMeetUrl,
      syncCalendarNow: vi.fn(() => Promise.resolve(meetingsResult)),
      updateSettings: vi.fn((nextSettings: SettingsUpdate) =>
        Promise.resolve({ ok: true, value: { ...settings, ...nextSettings } }),
      ),
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
      getSettings: vi.fn(() => Promise.resolve({ ok: true, value: settings })),
      getUpdateStatus: vi.fn(() => Promise.resolve({ ok: true, value: updateStatus })),
      listUpcomingMeetings: vi.fn(() => Promise.resolve({ ok: true, value: { meetings: [] } })),
      onCalendarUpdated: vi.fn(() => vi.fn()),
      onUpdateStatusChanged: vi.fn(() => vi.fn()),
      runHomebrewUpdate: vi.fn(() => Promise.resolve({ ok: true, value: updateStatus })),
      openMeetUrl: vi.fn(),
      syncCalendarNow: vi.fn(),
      updateSettings: vi.fn((nextSettings: SettingsUpdate) =>
        Promise.resolve({ ok: true, value: { ...settings, ...nextSettings } }),
      ),
      versions: {
        chrome: "test-chrome",
        electron: "test-electron",
      },
    },
  });
};

const okResult: ApiResult<void> = { ok: true, value: undefined };

const activeMeetingFor = (now: Date, overrides: Partial<MeetEvent> = {}): MeetEvent => ({
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
  ...overrides,
});

describe("App", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("opens a meeting through the preload API and shows loading state", async () => {
    let resolveOpen!: (value: ApiResult<void>) => void;
    const now = new Date();
    const activeMeetings: ApiResult<MeetEventsSnapshot> = {
      ok: true,
      value: {
        meetings: [activeMeetingFor(now)],
      },
    };
    const openPromise = new Promise<ApiResult<void>>((resolve) => {
      resolveOpen = resolve;
    });
    const openMeetUrl = vi.fn(() => openPromise);
    installMeetLauncher(openMeetUrl, activeMeetings);

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: /Next meeting is ready/ }));

    const openingButton = await screen.findByRole("button", { name: /Opening/ });
    expect(openingButton).toBeDisabled();

    fireEvent.click(openingButton);
    expect(openMeetUrl).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveOpen(okResult);
      await openPromise;
    });

    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: /Next meeting is ready/ }),
      ).not.toBeInTheDocument(),
    );
    expect(openMeetUrl).toHaveBeenCalledWith("https://meet.google.com/abc-defg-hij");
  });

  it("shows an in-app notification for an active unopened meeting", async () => {
    const now = new Date();
    const activeMeetings: ApiResult<MeetEventsSnapshot> = {
      ok: true,
      value: {
        meetings: [activeMeetingFor(now)],
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

  it("saves the configured Meet window open offset", async () => {
    const openMeetUrl = vi.fn<() => Promise<ApiResult<void>>>(() => Promise.resolve(okResult));
    installMeetLauncher(openMeetUrl);
    const updateSettings = vi.mocked(window.meetLauncher.updateSettings);

    render(<App />);

    const slider = await screen.findByRole("slider", { name: "Meet window open offset" });
    fireEvent.change(slider, { target: { value: "7" } });

    await waitFor(() =>
      expect(updateSettings).toHaveBeenCalledWith({
        joinOffsetSeconds: 0,
        openOffsetSeconds: 420,
      }),
    );
    expect(await screen.findByText("Open 7 min before")).toBeInTheDocument();
  });

  it("keeps the latest Meet window open offset when earlier saves finish later", async () => {
    let resolveFirstSave!: (value: ApiResult<AppSettings>) => void;
    const openMeetUrl = vi.fn<() => Promise<ApiResult<void>>>(() => Promise.resolve(okResult));
    installMeetLauncher(openMeetUrl);
    vi.mocked(window.meetLauncher.updateSettings)
      .mockImplementationOnce(
        (_nextSettings: SettingsUpdate) =>
          new Promise<ApiResult<AppSettings>>((resolve) => {
            resolveFirstSave = resolve;
          }),
      )
      .mockImplementationOnce((nextSettings: SettingsUpdate) =>
        Promise.resolve({ ok: true, value: { ...settings, ...nextSettings } }),
      );

    render(<App />);

    const slider = await screen.findByRole("slider", { name: "Meet window open offset" });
    fireEvent.change(slider, { target: { value: "3" } });
    fireEvent.change(slider, { target: { value: "8" } });

    expect(await screen.findByText("Open 8 min before")).toBeInTheDocument();

    await act(async () => {
      resolveFirstSave({ ok: true, value: { ...settings, openOffsetSeconds: 3 * 60 } });
    });

    expect(screen.getByText("Open 8 min before")).toBeInTheDocument();
  });

  it("saves the configured Meet auto-join settings", async () => {
    const openMeetUrl = vi.fn<() => Promise<ApiResult<void>>>(() => Promise.resolve(okResult));
    installMeetLauncher(openMeetUrl);
    const updateSettings = vi.mocked(window.meetLauncher.updateSettings);

    render(<App />);

    fireEvent.click(await screen.findByRole("checkbox", { name: "Auto-join Meet" }));

    await waitFor(() => expect(updateSettings).toHaveBeenCalledWith({ autoJoinEnabled: true }));

    const openSlider = await screen.findByRole("slider", { name: "Meet window open offset" });
    fireEvent.change(openSlider, { target: { value: "5" } });

    const joinSlider = await screen.findByRole("slider", { name: "Meet auto-join offset" });
    fireEvent.change(joinSlider, { target: { value: "3" } });

    await waitFor(() => expect(updateSettings).toHaveBeenCalledWith({ joinOffsetSeconds: 180 }));
    expect(await screen.findByText("Join 3 min before")).toBeInTheDocument();
  });

  it("clamps the auto-join offset when the Meet window open offset is reduced", async () => {
    const openMeetUrl = vi.fn<() => Promise<ApiResult<void>>>(() => Promise.resolve(okResult));
    installMeetLauncher(openMeetUrl);
    vi.mocked(window.meetLauncher.getSettings).mockResolvedValue({
      ok: true,
      value: {
        ...settings,
        autoJoinEnabled: true,
        joinOffsetSeconds: 5 * 60,
        openOffsetSeconds: 8 * 60,
      },
    });
    const updateSettings = vi.mocked(window.meetLauncher.updateSettings);

    render(<App />);

    const openSlider = await screen.findByRole("slider", { name: "Meet window open offset" });
    fireEvent.change(openSlider, { target: { value: "3" } });

    await waitFor(() =>
      expect(updateSettings).toHaveBeenCalledWith({
        joinOffsetSeconds: 180,
        openOffsetSeconds: 180,
      }),
    );
    expect(await screen.findByText("Join 3 min before")).toBeInTheDocument();
  });

  it("prunes opened meeting records after calendar updates remove them", async () => {
    const now = new Date();
    const activeMeeting = activeMeetingFor(now);
    const activeMeetings: ApiResult<MeetEventsSnapshot> = {
      ok: true,
      value: { meetings: [activeMeeting] },
    };
    let calendarUpdatedHandler!: (result: ApiResult<MeetEventsSnapshot>) => void;
    const openMeetUrl = vi.fn<() => Promise<ApiResult<void>>>(() => Promise.resolve(okResult));

    installMeetLauncher(
      openMeetUrl,
      activeMeetings,
      vi.fn((handler: (result: ApiResult<MeetEventsSnapshot>) => void) => {
        calendarUpdatedHandler = handler;
        return vi.fn();
      }),
    );

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: /Next meeting is ready/ }));
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: /Next meeting is ready/ }),
      ).not.toBeInTheDocument(),
    );

    act(() => {
      calendarUpdatedHandler({ ok: true, value: { meetings: [] } });
    });
    await act(async () => undefined);

    act(() => {
      calendarUpdatedHandler(activeMeetings);
    });

    expect(await screen.findByRole("button", { name: /Next meeting is ready/ })).toBeEnabled();
  });

  it("renders an IPC error response", async () => {
    const now = new Date();
    const activeMeetings: ApiResult<MeetEventsSnapshot> = {
      ok: true,
      value: {
        meetings: [activeMeetingFor(now)],
      },
    };
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
    installMeetLauncher(openMeetUrl, activeMeetings);

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: /Next meeting is ready/ }));

    expect(await screen.findByText("Google Meet window failed: network error")).toBeInTheDocument();
  });

  it("renders thrown preload errors", async () => {
    const now = new Date();
    const activeMeetings: ApiResult<MeetEventsSnapshot> = {
      ok: true,
      value: {
        meetings: [activeMeetingFor(now)],
      },
    };
    const openMeetUrl = vi.fn<() => Promise<ApiResult<void>>>(() =>
      Promise.reject(new Error("preload bridge unavailable")),
    );
    installMeetLauncher(openMeetUrl, activeMeetings);

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: /Next meeting is ready/ }));

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
        getSettings: vi.fn(() => Promise.resolve({ ok: true, value: settings })),
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
        updateSettings: vi.fn((nextSettings: SettingsUpdate) =>
          Promise.resolve({ ok: true, value: { ...settings, ...nextSettings } }),
        ),
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
