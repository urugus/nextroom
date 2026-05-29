import { Dashboard } from "@renderer/screens/Dashboard";
import type { AppUpdateStatus, MeetEvent } from "@shared/types";
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
  canDownload: true,
  canInstall: false,
  currentVersion: "0.1.0",
  status: "available",
};

const updateError: AppUpdateStatus = {
  canCheck: true,
  canDownload: false,
  canInstall: false,
  currentVersion: "0.1.0",
  errorMessage: "GitHub Releases request failed",
  status: "error",
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
        onSyncCalendar={vi.fn()}
      />,
    );

    expect(screen.getByText("Google Calendar not connected")).toBeInTheDocument();
    expect(
      screen.getByText("Connect Google Calendar to load upcoming meetings."),
    ).toBeInTheDocument();
    expect(screen.getByText("Product sync")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Join" }));
    expect(onOpenMeeting).toHaveBeenCalledWith("https://meet.google.com/abc-defg-hij");
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
        onSyncCalendar={vi.fn()}
      />,
    );

    expect(screen.getByText("Calendar API failed")).toBeInTheDocument();
    expect(screen.getByText("No upcoming Google Meet meetings.")).toBeInTheDocument();
  });

  it("renders update controls", () => {
    const onCheckForUpdates = vi.fn();
    const onDownloadUpdate = vi.fn();
    render(
      <Dashboard
        accountStatus={{ connected: false, syncing: false }}
        meetings={[]}
        onCheckForUpdates={onCheckForUpdates}
        onConnectAccount={vi.fn()}
        onDisconnectAccount={vi.fn()}
        onDownloadUpdate={onDownloadUpdate}
        onOpenMeeting={vi.fn()}
        onSyncCalendar={vi.fn()}
        updateStatus={updateAvailable}
      />,
    );

    expect(screen.getByText("Version 0.2.0 is available.")).toBeInTheDocument();
    expect(screen.getByText("Current version 0.1.0")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Check for updates" }));
    fireEvent.click(screen.getByRole("button", { name: "Download update" }));
    expect(onCheckForUpdates).toHaveBeenCalledTimes(1);
    expect(onDownloadUpdate).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Restart to update" })).toBeDisabled();
  });

  it("renders update errors once in the dedicated error area", () => {
    render(
      <Dashboard
        accountStatus={{ connected: false, syncing: false }}
        meetings={[]}
        onConnectAccount={vi.fn()}
        onDisconnectAccount={vi.fn()}
        onOpenMeeting={vi.fn()}
        onSyncCalendar={vi.fn()}
        updateStatus={updateError}
      />,
    );

    expect(screen.getByText("Update check failed.")).toBeInTheDocument();
    expect(screen.getByText("GitHub Releases request failed")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Check for updates" })).toBeDisabled();
  });
});
