import { Dashboard } from "@renderer/screens/Dashboard";
import type { AppSettings, AppUpdateStatus, MeetEvent } from "@shared/types";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const meeting: MeetEvent = {
  eventId: "event-1",
  occurrenceKey: "primary:event-1:2026-05-28T10:00:00+09:00",
  calendarId: "primary",
  summary: "Product sync",
  startAt: "2026-05-28T10:00:00+09:00",
  endAt: "2026-05-28T10:30:00+09:00",
  updatedAt: "2026-05-28T09:00:00+09:00",
  meetUrl: "https://meet.google.com/abc-defg-hij",
  status: "confirmed",
};

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
  autoOpenEnabled: true,
  notifyBeforeMinutes: 1,
  openOffsetSeconds: 0,
  launchAtLogin: false,
  calendarId: "primary",
  timezone: "Asia/Tokyo",
};

describe("Dashboard", () => {
  it("renders disconnected state and upcoming meetings", () => {
    const onOpenMeeting = vi.fn();
    render(
      <Dashboard
        accountStatus={{ connected: false, syncing: false }}
        meetings={[meeting]}
        onConnectAccount={vi.fn()}
        onDisconnectAccount={vi.fn()}
        onOpenMeeting={onOpenMeeting}
        onOpenOffsetMinutesChange={vi.fn()}
        onSyncCalendar={vi.fn()}
        settings={settings}
      />,
    );

    expect(screen.getByText("Google Calendar not connected")).toBeInTheDocument();
    expect(screen.getByText("Loading")).toBeInTheDocument();
    expect(
      screen.getByText("Connect Google Calendar to load upcoming meetings."),
    ).toBeInTheDocument();
    expect(screen.getByText("Product sync")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Join" }));
    expect(onOpenMeeting).toHaveBeenCalledWith(meeting);
    expect(screen.getByRole("button", { name: "Connect" })).toBeEnabled();
  });

  it("renders an error message", () => {
    render(
      <Dashboard
        accountStatus={{ connected: false, syncing: false }}
        errorMessage="Calendar API failed"
        meetings={[]}
        onConnectAccount={vi.fn()}
        onDisconnectAccount={vi.fn()}
        onOpenMeeting={vi.fn()}
        onOpenOffsetMinutesChange={vi.fn()}
        onSyncCalendar={vi.fn()}
        settings={settings}
      />,
    );

    expect(screen.getByText("Calendar API failed")).toBeInTheDocument();
    expect(screen.getByText("No upcoming Google Meet meetings.")).toBeInTheDocument();
  });

  it("renders update controls", () => {
    const onCheckForUpdates = vi.fn();
    const onRunHomebrewUpdate = vi.fn();
    render(
      <Dashboard
        accountStatus={{ connected: false, syncing: false }}
        meetings={[]}
        onCheckForUpdates={onCheckForUpdates}
        onConnectAccount={vi.fn()}
        onDisconnectAccount={vi.fn()}
        onRunHomebrewUpdate={onRunHomebrewUpdate}
        onOpenMeeting={vi.fn()}
        onOpenOffsetMinutesChange={vi.fn()}
        onSyncCalendar={vi.fn()}
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
        meetings={[]}
        onCheckForUpdates={vi.fn()}
        onConnectAccount={vi.fn()}
        onDisconnectAccount={vi.fn()}
        onOpenMeeting={vi.fn()}
        onOpenOffsetMinutesChange={vi.fn()}
        onSyncCalendar={vi.fn()}
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
        meetings={[]}
        onCheckForUpdates={vi.fn()}
        onConnectAccount={vi.fn()}
        onDisconnectAccount={vi.fn()}
        onOpenMeeting={vi.fn()}
        onOpenOffsetMinutesChange={vi.fn()}
        onRunHomebrewUpdate={vi.fn()}
        onSyncCalendar={vi.fn()}
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
        meetings={[]}
        onConnectAccount={vi.fn()}
        onDisconnectAccount={vi.fn()}
        onOpenMeeting={vi.fn()}
        onOpenOffsetMinutesChange={vi.fn()}
        onSyncCalendar={vi.fn()}
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
        meetings={[]}
        onConnectAccount={vi.fn()}
        onDisconnectAccount={vi.fn()}
        onOpenMeeting={vi.fn()}
        onOpenOffsetMinutesChange={vi.fn()}
        onSyncCalendar={vi.fn()}
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
        meetings={[]}
        onConnectAccount={vi.fn()}
        onDisconnectAccount={vi.fn()}
        onOpenMeeting={vi.fn()}
        onOpenOffsetMinutesChange={vi.fn()}
        onSyncCalendar={vi.fn()}
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
        meetings={[]}
        onConnectAccount={vi.fn()}
        onDisconnectAccount={vi.fn()}
        onOpenMeeting={vi.fn()}
        onOpenOffsetMinutesChange={onOpenOffsetMinutesChange}
        onSyncCalendar={vi.fn()}
        settings={{ ...settings, openOffsetSeconds: 5 * 60 }}
      />,
    );

    expect(screen.getByText("Open 5 min before")).toBeInTheDocument();
    const slider = screen.getByRole("slider", { name: "Meet window open offset" });
    expect(slider).toHaveValue("5");

    fireEvent.change(slider, { target: { value: "10" } });

    expect(onOpenOffsetMinutesChange).toHaveBeenCalledWith(10);
  });
});
