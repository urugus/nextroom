import { normalizeUpcomingMeetEvents } from "@main/calendar/eventNormalizer";
import type { CalendarEvent } from "@shared/types";
import { describe, expect, it } from "vitest";

describe("normalizeUpcomingMeetEvents", () => {
  it("normalizes timed Meet events and skips non-Meet events", () => {
    const events: CalendarEvent[] = [
      {
        id: "meet-1",
        summary: "Design review",
        start: { dateTime: "2026-05-28T10:00:00+09:00" },
        end: { dateTime: "2026-05-28T10:30:00+09:00" },
        updated: "2026-05-28T09:00:00+09:00",
        hangoutLink: "https://meet.google.com/abc-defg-hij",
        attendees: [{ self: true, responseStatus: "accepted" }],
      },
      {
        id: "plain-1",
        summary: "Focus time",
        start: { dateTime: "2026-05-28T11:00:00+09:00" },
        end: { dateTime: "2026-05-28T12:00:00+09:00" },
      },
    ];

    const result = normalizeUpcomingMeetEvents(events, "primary");

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toEqual([
      {
        eventId: "meet-1",
        recurringEventId: undefined,
        occurrenceKey: "primary:meet-1:2026-05-28T10:00:00+09:00",
        calendarId: "primary",
        summary: "Design review",
        startAt: "2026-05-28T10:00:00+09:00",
        endAt: "2026-05-28T10:30:00+09:00",
        updatedAt: "2026-05-28T09:00:00+09:00",
        meetUrl: "https://meet.google.com/abc-defg-hij",
        meetCode: "abc-defg-hij",
        responseStatus: "accepted",
        status: "confirmed",
      },
    ]);
  });

  it("skips all-day, cancelled, and declined events", () => {
    const events: CalendarEvent[] = [
      {
        id: "all-day",
        start: { date: "2026-05-28" },
        end: { date: "2026-05-29" },
        hangoutLink: "https://meet.google.com/all-day",
      },
      {
        id: "cancelled",
        status: "cancelled",
        start: { dateTime: "2026-05-28T10:00:00+09:00" },
        end: { dateTime: "2026-05-28T10:30:00+09:00" },
        hangoutLink: "https://meet.google.com/cancelled",
      },
      {
        id: "declined",
        start: { dateTime: "2026-05-28T10:00:00+09:00" },
        end: { dateTime: "2026-05-28T10:30:00+09:00" },
        hangoutLink: "https://meet.google.com/declined",
        attendees: [{ self: true, responseStatus: "declined" }],
      },
    ];

    expect(normalizeUpcomingMeetEvents(events, "primary")._unsafeUnwrap()).toEqual([]);
  });
});
