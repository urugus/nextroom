import { Dashboard } from "@renderer/screens/Dashboard";
import type { AppSettings, AppUpdateStatus } from "@shared/types";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const updateAvailable: AppUpdateStatus = {
  availableVersion: "0.2.0",
  canCheck: true,
  canRunHomebrewUpdate: true,
  currentVersion: "0.1.0",
  status: "available",
};

const updateError: AppUpdateStatus = {
  canCheck: true,
  canRunHomebrewUpdate: false,
  currentVersion: "0.1.0",
  errorMessage: "GitHub Releases request failed",
  status: "error",
};

const updateChecking: AppUpdateStatus = {
  canCheck: false,
  canRunHomebrewUpdate: false,
  currentVersion: "0.1.0",
  status: "checking",
};

const updateHomebrewUpdating: AppUpdateStatus = {
  availableVersion: "0.2.0",
  canCheck: false,
  canRunHomebrewUpdate: false,
  currentVersion: "0.1.0",
  status: "homebrew-updating",
  updateMessage: "Updating with Homebrew. A restart prompt will appear when it is ready.",
};

const updateUnsupported: AppUpdateStatus = {
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
  cameraBubbleDisplaySpeedLevel: 3,
  joinOffsetSeconds: 0,
  notifyBeforeMinutes: 1,
  openOffsetSeconds: 0,
  menuShortcutAccelerator: "Command+Alt+N",
  launchAtLogin: false,
  calendarId: "primary",
  timezone: "Asia/Tokyo",
};

const dashboardActions = () => ({
  onAutoJoinEnabledChange: vi.fn(),
  onCameraBubbleChatMirrorEnabledChange: vi.fn(),
  onCameraBubbleEnabledChange: vi.fn(),
  onCameraBubbleDisplaySpeedLevelChange: vi.fn(),
  onConnectAccount: vi.fn(),
  onDisconnectAccount: vi.fn(),
  onJoinOffsetMinutesChange: vi.fn(),
  onMenuShortcutAcceleratorChange: vi.fn(),
  onOpenMeeting: vi.fn(),
  onOpenOffsetMinutesChange: vi.fn(),
  onSyncCalendar: vi.fn(),
});

describe("Dashboard", () => {
  it("renders disconnected account settings", () => {
    render(
      <Dashboard
        accountStatus={{ connected: false, syncing: false }}
        {...dashboardActions()}
        settings={settings}
      />,
    );

    expect(screen.getByText("Google Calendar not connected")).toBeInTheDocument();
    expect(screen.getByText("Loading")).toBeInTheDocument();
    expect(
      screen.getByText("Connect Google Calendar to enable Meet launching."),
    ).toBeInTheDocument();
    expect(screen.getByText("Bubble display speed")).toBeInTheDocument();
    expect(screen.getByText("1 = slow / 5 = fast")).toBeInTheDocument();
    expect(screen.queryByText("Product sync")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Connect" })).toBeEnabled();
  });

  it("renders an error message", () => {
    render(
      <Dashboard
        accountStatus={{ connected: false, syncing: false }}
        errorMessage="Calendar API failed"
        {...dashboardActions()}
        settings={settings}
      />,
    );

    expect(screen.getByText("Calendar API failed")).toBeInTheDocument();
  });

  it("renders update controls", () => {
    const onCheckForUpdates = vi.fn();
    const onRunHomebrewUpdate = vi.fn();
    render(
      <Dashboard
        accountStatus={{ connected: false, syncing: false }}
        {...dashboardActions()}
        onCheckForUpdates={onCheckForUpdates}
        onRunHomebrewUpdate={onRunHomebrewUpdate}
        settings={settings}
        updateStatus={updateAvailable}
      />,
    );

    expect(
      screen.getByText("Version 0.2.0 is available via Homebrew for ~/Applications."),
    ).toBeInTheDocument();
    expect(screen.getByText("Update available")).toBeInTheDocument();
    expect(screen.getByText("Current version 0.1.0")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Check for updates" }));
    fireEvent.click(screen.getByRole("button", { name: "Update with Homebrew" }));
    expect(onCheckForUpdates).toHaveBeenCalledTimes(1);
    expect(onRunHomebrewUpdate).toHaveBeenCalledTimes(1);
  });

  it("renders update checking as a busy state without progress", () => {
    render(
      <Dashboard
        accountStatus={{ connected: false, syncing: false }}
        {...dashboardActions()}
        onCheckForUpdates={vi.fn()}
        settings={settings}
        updateStatus={updateChecking}
      />,
    );

    const checkButton = screen.getByRole("button", { name: "Checking" });

    expect(screen.getAllByText("Checking")).toHaveLength(2);
    expect(checkButton).toBeDisabled();
    expect(checkButton).toHaveAttribute("aria-busy", "true");
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("renders Homebrew update progress while updating", () => {
    render(
      <Dashboard
        accountStatus={{ connected: false, syncing: false }}
        {...dashboardActions()}
        onCheckForUpdates={vi.fn()}
        onRunHomebrewUpdate={vi.fn()}
        settings={settings}
        updateStatus={updateHomebrewUpdating}
      />,
    );

    const updateButton = screen.getByRole("button", { name: "Updating" });

    expect(screen.getAllByText("Updating")).toHaveLength(2);
    expect(updateButton).toBeDisabled();
    expect(updateButton).toHaveAttribute("aria-busy", "true");
    expect(
      screen.getByRole("progressbar", { name: "Homebrew update progress" }),
    ).toBeInTheDocument();
  });

  it("renders unsupported update status without busy controls", () => {
    render(
      <Dashboard
        accountStatus={{ connected: false, syncing: false }}
        {...dashboardActions()}
        settings={settings}
        updateStatus={updateUnsupported}
      />,
    );

    expect(screen.getByText("Updates unavailable")).toBeInTheDocument();
    expect(screen.getByText("Updates are available in installed app builds.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Check for updates" })).not.toHaveAttribute(
      "aria-busy",
      "true",
    );
  });

  it("renders update errors once in the dedicated error area", () => {
    render(
      <Dashboard
        accountStatus={{ connected: false, syncing: false }}
        {...dashboardActions()}
        settings={settings}
        updateStatus={updateError}
      />,
    );

    expect(screen.getByText("Update check failed.")).toBeInTheDocument();
    expect(screen.getByText("Failed")).toBeInTheDocument();
    expect(screen.getByText("GitHub Releases request failed")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Check for updates" })).toBeDisabled();
  });

  it("renders update bridge errors as failed without stale loading state", () => {
    render(
      <Dashboard
        accountStatus={{ connected: false, syncing: false }}
        {...dashboardActions()}
        settings={settings}
        updateErrorMessage="Update status is unavailable."
      />,
    );

    expect(screen.getByText("Failed")).toBeInTheDocument();
    expect(screen.getByText("Update status is unavailable.")).toBeInTheDocument();
    expect(screen.queryByText("Loading")).not.toBeInTheDocument();
  });

  it("updates the Meet window open offset with a slider", () => {
    const onOpenOffsetMinutesChange = vi.fn();
    render(
      <Dashboard
        accountStatus={{ connected: true, syncing: false }}
        {...dashboardActions()}
        onOpenOffsetMinutesChange={onOpenOffsetMinutesChange}
        settings={{ ...settings, openOffsetSeconds: 5 * 60 }}
      />,
    );

    expect(screen.getByText("Open 5 min before")).toBeInTheDocument();
    const slider = screen.getByRole("slider", { name: "Meet window open offset" });
    expect(slider).toHaveValue("5");

    fireEvent.change(slider, { target: { value: "10" } });

    expect(onOpenOffsetMinutesChange).toHaveBeenCalledWith(10);
  });

  it("updates the Meet auto-join settings", () => {
    const onAutoJoinEnabledChange = vi.fn();
    const onJoinOffsetMinutesChange = vi.fn();
    render(
      <Dashboard
        accountStatus={{ connected: true, syncing: false }}
        {...dashboardActions()}
        onAutoJoinEnabledChange={onAutoJoinEnabledChange}
        onJoinOffsetMinutesChange={onJoinOffsetMinutesChange}
        settings={{
          ...settings,
          autoJoinEnabled: true,
          joinOffsetSeconds: 2 * 60,
          openOffsetSeconds: 5 * 60,
        }}
      />,
    );

    expect(screen.getAllByText("Join 2 min before")).toHaveLength(2);
    const toggle = screen.getByRole("checkbox", { name: "Auto-join Meet" });
    const slider = screen.getByRole("slider", { name: "Meet auto-join offset" });

    expect(toggle).toBeChecked();
    expect(slider).toHaveValue("2");
    expect(slider).toHaveAttribute("max", "5");

    fireEvent.click(toggle);
    fireEvent.change(slider, { target: { value: "4" } });

    expect(onAutoJoinEnabledChange).toHaveBeenCalledWith(false);
    expect(onJoinOffsetMinutesChange).toHaveBeenCalledWith(4);
  });

  it("updates camera bubble chat mirror setting", () => {
    const onCameraBubbleChatMirrorEnabledChange = vi.fn();
    render(
      <Dashboard
        accountStatus={{ connected: true, syncing: false }}
        {...dashboardActions()}
        onCameraBubbleChatMirrorEnabledChange={onCameraBubbleChatMirrorEnabledChange}
        settings={{ ...settings, cameraBubbleEnabled: true }}
      />,
    );

    fireEvent.click(screen.getByRole("checkbox", { name: "Mirror Meet chat" }));

    expect(onCameraBubbleChatMirrorEnabledChange).toHaveBeenCalledWith(true);
    expect(screen.getByText("Also show your sent chat messages on camera")).toBeInTheDocument();
  });

  it("disables camera bubble chat mirror setting while camera bubble is off", () => {
    const { rerender } = render(
      <Dashboard
        accountStatus={{ connected: true, syncing: false }}
        {...dashboardActions()}
        settings={settings}
      />,
    );

    expect(screen.getByRole("checkbox", { name: "Mirror Meet chat" })).toBeDisabled();

    rerender(
      <Dashboard
        accountStatus={{ connected: true, syncing: false }}
        {...dashboardActions()}
        settings={{ ...settings, cameraBubbleEnabled: true }}
      />,
    );

    expect(screen.getByRole("checkbox", { name: "Mirror Meet chat" })).toBeEnabled();
  });

  it("records and clears the menu shortcut", () => {
    const onMenuShortcutAcceleratorChange = vi.fn();
    render(
      <Dashboard
        accountStatus={{ connected: true, syncing: false }}
        {...dashboardActions()}
        onMenuShortcutAcceleratorChange={onMenuShortcutAcceleratorChange}
        settings={settings}
      />,
    );

    expect(screen.getByText("⌘ ⌥ N")).toBeInTheDocument();

    const recordButton = screen.getByRole("button", { name: "Record" });
    fireEvent.click(recordButton);
    fireEvent.keyDown(recordButton, { altKey: true, code: "KeyM", key: "Dead", metaKey: true });

    expect(onMenuShortcutAcceleratorChange).toHaveBeenCalledWith("Command+Alt+M");

    fireEvent.click(screen.getByRole("button", { name: "Clear" }));

    expect(onMenuShortcutAcceleratorChange).toHaveBeenCalledWith(null);
  });

  it("shows when the configured menu shortcut is unavailable", () => {
    render(
      <Dashboard
        accountStatus={{ connected: true, syncing: false }}
        {...dashboardActions()}
        menuShortcutStatus={{
          accelerator: "Command+Alt+N",
          error: {
            message: "Menu shortcut Command+Alt+N could not be registered.",
            recoverable: true,
            type: "ShortcutRegistrationFailed",
          },
          state: "failed",
        }}
        settings={settings}
      />,
    );

    expect(screen.getByText("Shortcut is unavailable. Choose another one.")).toBeInTheDocument();
  });
});
