import { App } from "@renderer/App";
import type { ApiResult, SettingsUpdate } from "@shared/ipc";
import type {
  AccountStatus,
  AppSettings,
  AppUpdateStatus,
  MeetEvent,
  MeetEventsSnapshot,
  MenuShortcutStatus,
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
  cameraBubbleChatMirrorEnabled: false,
  cameraBubbleEnabled: false,
  cameraBubbleScreenShareDanmakuEnabled: false,
  cameraBubbleSidebarHidden: false,
  cameraBubbleDisplaySpeedLevel: 3,
  joinOffsetSeconds: 0,
  notifyBeforeMinutes: 1,
  openOffsetSeconds: 0,
  menuShortcutAccelerator: "Command+Alt+N",
  launchAtLogin: false,
  calendarId: "primary",
  timezone: "Asia/Tokyo",
};

const menuShortcutStatus: MenuShortcutStatus = {
  accelerator: "Command+Alt+N",
  state: "registered",
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
      getMenuShortcutStatus: vi.fn(() => Promise.resolve({ ok: true, value: menuShortcutStatus })),
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
      getMenuShortcutStatus: vi.fn(() => Promise.resolve({ ok: true, value: menuShortcutStatus })),
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

    const openingButton = await screen.findByRole("button", {
      name: /Next meeting is ready.*Opening/,
    });
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

  it("saves the camera bubble setting", async () => {
    const openMeetUrl = vi.fn<() => Promise<ApiResult<void>>>(() => Promise.resolve(okResult));
    installMeetLauncher(openMeetUrl);
    const updateSettings = vi.mocked(window.meetLauncher.updateSettings);

    render(<App />);

    fireEvent.click(await screen.findByRole("checkbox", { name: "Camera bubble" }));

    await waitFor(() => expect(updateSettings).toHaveBeenCalledWith({ cameraBubbleEnabled: true }));
  });

  it("saves the camera bubble chat mirror setting", async () => {
    const openMeetUrl = vi.fn<() => Promise<ApiResult<void>>>(() => Promise.resolve(okResult));
    installMeetLauncher(openMeetUrl);
    const updateSettings = vi.mocked(window.meetLauncher.updateSettings);

    vi.mocked(window.meetLauncher.getSettings).mockResolvedValue({
      ok: true,
      value: { ...settings, cameraBubbleEnabled: true },
    });

    render(<App />);

    fireEvent.click(await screen.findByRole("checkbox", { name: "Mirror Meet chat" }));

    await waitFor(() =>
      expect(updateSettings).toHaveBeenCalledWith({ cameraBubbleChatMirrorEnabled: true }),
    );
  });

  it("saves the screen share comments setting", async () => {
    const openMeetUrl = vi.fn<() => Promise<ApiResult<void>>>(() => Promise.resolve(okResult));
    installMeetLauncher(openMeetUrl);
    const updateSettings = vi.mocked(window.meetLauncher.updateSettings);

    vi.mocked(window.meetLauncher.getSettings).mockResolvedValue({
      ok: true,
      value: { ...settings, cameraBubbleEnabled: true },
    });

    render(<App />);

    fireEvent.click(await screen.findByRole("checkbox", { name: "Screen share comments" }));

    await waitFor(() =>
      expect(updateSettings).toHaveBeenCalledWith({
        cameraBubbleScreenShareDanmakuEnabled: true,
      }),
    );
  });

  it("saves the camera bubble display speed setting", async () => {
    const openMeetUrl = vi.fn<() => Promise<ApiResult<void>>>(() => Promise.resolve(okResult));
    installMeetLauncher(openMeetUrl);
    const updateSettings = vi.mocked(window.meetLauncher.updateSettings);

    render(<App />);

    const slider = await screen.findByRole("slider", { name: "Bubble display speed" });
    fireEvent.change(slider, { target: { value: "5" } });

    await waitFor(() =>
      expect(updateSettings).toHaveBeenCalledWith({ cameraBubbleDisplaySpeedLevel: 5 }),
    );
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

  it("does not notify for meetings with invalid active-time dates", async () => {
    const invalidMeetings: ApiResult<MeetEventsSnapshot> = {
      ok: true,
      value: {
        meetings: [
          activeMeetingFor(new Date(), {
            endAt: "also-invalid",
            startAt: "not-a-date",
          }),
        ],
      },
    };
    installMeetLauncher(vi.fn(), invalidMeetings);

    render(<App />);

    await waitFor(() => expect(window.meetLauncher.listUpcomingMeetings).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: /Next meeting is ready/ })).not.toBeInTheDocument();
  });

  it("renders update action errors and clears them after a status event", async () => {
    let updateStatusHandler!: (status: AppUpdateStatus) => void;
    const availableUpdate: AppUpdateStatus = {
      availableVersion: "0.2.0",
      canCheck: true,
      canRunHomebrewUpdate: true,
      currentVersion: "0.1.0",
      status: "available",
    };
    installMeetLauncher(vi.fn());
    vi.mocked(window.meetLauncher.getUpdateStatus).mockResolvedValue({
      ok: true,
      value: availableUpdate,
    });
    vi.mocked(window.meetLauncher.onUpdateStatusChanged).mockImplementation((handler) => {
      updateStatusHandler = handler;
      return vi.fn();
    });
    vi.mocked(window.meetLauncher.checkForUpdates).mockResolvedValue({
      ok: false,
      error: {
        message: "Update check failed remotely",
        recoverable: true,
        type: "UpdateFailed",
      },
    });
    vi.mocked(window.meetLauncher.runHomebrewUpdate).mockRejectedValue(new Error("brew failed"));

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Check for updates" }));
    expect(await screen.findByText("Update check failed remotely")).toBeInTheDocument();

    act(() => {
      updateStatusHandler({ ...availableUpdate, status: "checking" });
    });
    await waitFor(() =>
      expect(screen.queryByText("Update check failed remotely")).not.toBeInTheDocument(),
    );

    act(() => {
      updateStatusHandler(availableUpdate);
    });
    fireEvent.click(await screen.findByRole("button", { name: "Update with Homebrew" }));
    expect(await screen.findByText("brew failed")).toBeInTheDocument();
  });

  it("updates meetings and status after a successful manual sync", async () => {
    const syncedMeetings: ApiResult<MeetEventsSnapshot> = {
      ok: true,
      value: {
        meetings: [],
        syncedAt: "2026-05-28T09:30:00+09:00",
      },
    };
    installMeetLauncher(vi.fn());
    vi.mocked(window.meetLauncher.syncCalendarNow).mockResolvedValue(syncedMeetings);

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Sync" }));

    await waitFor(() => expect(window.meetLauncher.syncCalendarNow).toHaveBeenCalledTimes(1));
    expect(window.meetLauncher.getAccountStatus).toHaveBeenCalled();
    expect(await screen.findByText(/Last synced/)).toBeInTheDocument();
  });

  it("updates active meeting notifications on the interval tick", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-28T09:59:00+09:00"));
    const tickingMeetings: ApiResult<MeetEventsSnapshot> = {
      ok: true,
      value: {
        meetings: [
          activeMeetingFor(new Date("2026-05-28T10:00:00+09:00"), {
            startAt: "2026-05-28T10:00:00+09:00",
            endAt: "2026-05-28T10:30:00+09:00",
          }),
        ],
      },
    };
    installMeetLauncher(vi.fn(), tickingMeetings);

    render(<App />);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(window.meetLauncher.listUpcomingMeetings).toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /Next meeting is ready/ })).not.toBeInTheDocument();

    await act(async () => {
      vi.setSystemTime(new Date("2026-05-28T10:00:00+09:00"));
      vi.advanceTimersByTime(30_000);
      await Promise.resolve();
    });

    expect(screen.getByRole("button", { name: /Next meeting is ready/ })).toBeEnabled();
  });

  it("updates the rendered update status after a successful manual check", async () => {
    const availableUpdate: AppUpdateStatus = {
      availableVersion: "0.2.0",
      canCheck: true,
      canRunHomebrewUpdate: true,
      currentVersion: "0.1.0",
      status: "available",
    };
    const updatedStatus: AppUpdateStatus = {
      canCheck: true,
      canRunHomebrewUpdate: false,
      currentVersion: "0.1.0",
      status: "not-available",
    };
    installMeetLauncher(vi.fn());
    vi.mocked(window.meetLauncher.getUpdateStatus).mockResolvedValue({
      ok: true,
      value: availableUpdate,
    });
    vi.mocked(window.meetLauncher.checkForUpdates).mockResolvedValue({
      ok: true,
      value: updatedStatus,
    });

    render(<App />);

    expect(await screen.findByText("Update available")).toBeInTheDocument();
    const checkButton = screen.getByRole("button", { name: "Check for updates" });
    await waitFor(() => expect(checkButton).toBeEnabled());

    await act(async () => {
      fireEvent.click(checkButton);
      await Promise.resolve();
    });

    await waitFor(() => expect(window.meetLauncher.checkForUpdates).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("Up to date")).toBeInTheDocument();
    expect(screen.getByText("You are on the latest version.")).toBeInTheDocument();
  });

  it("refreshes menu shortcut status after recording a shortcut", async () => {
    installMeetLauncher(vi.fn());

    render(<App />);

    await waitFor(() => expect(window.meetLauncher.getMenuShortcutStatus).toHaveBeenCalled());
    vi.mocked(window.meetLauncher.getMenuShortcutStatus).mockClear();

    const recordButton = await screen.findByRole("button", { name: "Record" });
    fireEvent.click(recordButton);
    fireEvent.keyDown(recordButton, {
      altKey: true,
      code: "KeyM",
      key: "m",
      metaKey: true,
    });

    await waitFor(() =>
      expect(window.meetLauncher.updateSettings).toHaveBeenCalledWith({
        menuShortcutAccelerator: "Command+Alt+M",
      }),
    );
    await waitFor(() => expect(window.meetLauncher.getMenuShortcutStatus).toHaveBeenCalledTimes(1));
  });

  it("renders connect, sync, and disconnect bridge failures", async () => {
    installMeetLauncher(vi.fn());
    vi.mocked(window.meetLauncher.connectGoogleAccount).mockRejectedValue("popup closed");
    vi.mocked(window.meetLauncher.syncCalendarNow).mockRejectedValue(new Error("sync exploded"));
    vi.mocked(window.meetLauncher.disconnectGoogleAccount).mockRejectedValue("disconnect failed");

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Sync" }));
    expect(await screen.findByText("sync exploded")).toBeInTheDocument();

    fireEvent.click(await screen.findByRole("button", { name: "Disconnect" }));
    expect(await screen.findByText("Google disconnect failed.")).toBeInTheDocument();

    vi.mocked(window.meetLauncher.getAccountStatus).mockResolvedValue({
      ok: true,
      value: { connected: false, syncing: false },
    });
    act(() => {
      vi.mocked(window.meetLauncher.onCalendarUpdated).mock.calls.at(0)?.[0]({
        ok: true,
        value: { meetings: [] },
      });
    });
    fireEvent.click(await screen.findByRole("button", { name: "Connect" }));
    expect(await screen.findByText("Google authorization failed.")).toBeInTheDocument();
  });

  it("clears meetings and opened records after disconnect succeeds", async () => {
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

    fireEvent.click(await screen.findByRole("button", { name: /Next meeting is ready/ }));
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: /Next meeting is ready/ }),
      ).not.toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));

    expect(await screen.findByText("Google Calendar not connected")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Next meeting is ready/ })).not.toBeInTheDocument();
  });

  it("rolls settings back after failed and rejected saves", async () => {
    installMeetLauncher(vi.fn());
    vi.mocked(window.meetLauncher.updateSettings)
      .mockResolvedValueOnce({
        ok: false,
        error: {
          message: "Settings update rejected",
          recoverable: true,
          type: "DatabaseFailed",
        },
      })
      .mockRejectedValueOnce("write failed");
    vi.mocked(window.meetLauncher.getSettings).mockResolvedValue({
      ok: true,
      value: settings,
    });

    render(<App />);

    const openSlider = await screen.findByRole("slider", { name: "Meet window open offset" });
    fireEvent.change(openSlider, { target: { value: "4" } });

    expect(await screen.findByText("Settings update rejected")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("Open at start time")).toBeInTheDocument());

    const speedSlider = await screen.findByRole("slider", { name: "Bubble display speed" });
    fireEvent.change(speedSlider, { target: { value: "5" } });

    expect(await screen.findByText("Settings update failed.")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("3 / 5")).toBeInTheDocument());
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

  it("renders initial API and update status errors", async () => {
    installMeetLauncher(vi.fn());
    vi.mocked(window.meetLauncher.getAccountStatus).mockResolvedValue({
      ok: false,
      error: {
        message: "Account status unavailable",
        recoverable: true,
        type: "KeychainUnavailable",
      },
    });
    vi.mocked(window.meetLauncher.getUpdateStatus).mockResolvedValue({
      ok: false,
      error: {
        message: "Update status failed",
        recoverable: true,
        type: "UpdateFailed",
      },
    });

    render(<App />);

    expect(await screen.findByText("Account status unavailable")).toBeInTheDocument();
    expect(await screen.findByText("Update status failed")).toBeInTheDocument();
  });

  it("renders thrown initial update status errors", async () => {
    installMeetLauncher(vi.fn());
    vi.mocked(window.meetLauncher.getUpdateStatus).mockRejectedValue(
      new Error("update bridge unavailable"),
    );

    render(<App />);

    expect(await screen.findByText("update bridge unavailable")).toBeInTheDocument();
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
        getMenuShortcutStatus: vi.fn(() =>
          Promise.resolve({ ok: true, value: menuShortcutStatus }),
        ),
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
