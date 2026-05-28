import { Dashboard } from "@renderer/screens/Dashboard";
import type { MeetEvent } from "@shared/types";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

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

describe("Dashboard", () => {
  it("renders disconnected state and upcoming meetings", () => {
    render(<Dashboard accountConnected={false} meetings={[meeting]} />);

    expect(screen.getByText("Google Calendar not connected")).toBeInTheDocument();
    expect(screen.getByText("Product sync")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Join" })).toHaveAttribute(
      "href",
      "https://meet.google.com/abc-defg-hij",
    );
  });

  it("renders an error message", () => {
    render(<Dashboard accountConnected={false} errorMessage="Calendar API failed" meetings={[]} />);

    expect(screen.getByText("Calendar API failed")).toBeInTheDocument();
    expect(screen.getByText("No upcoming Google Meet meetings.")).toBeInTheDocument();
  });
});
