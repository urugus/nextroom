import { extractMeetUrl } from "@main/calendar/meetExtractor";
import type { CalendarEvent } from "@shared/types";
import { describe, expect, it } from "vitest";

describe("extractMeetUrl", () => {
  it("prefers conferenceData video entry over hangoutLink and description", () => {
    const event: CalendarEvent = {
      id: "event-1",
      hangoutLink: "https://meet.google.com/hang-out-link",
      description: "Backup https://meet.google.com/from-description",
      conferenceData: {
        entryPoints: [
          {
            entryPointType: "video",
            uri: "https://meet.google.com/from-entry?authuser=0#fragment",
          },
        ],
      },
    };

    const result = extractMeetUrl(event);

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toBe("https://meet.google.com/from-entry");
  });

  it("falls back to hangoutLink before location and description", () => {
    const event: CalendarEvent = {
      id: "event-2",
      hangoutLink: "https://meet.google.com/from-hangout",
      location: "https://meet.google.com/from-location",
      description: "https://meet.google.com/from-description",
    };

    expect(extractMeetUrl(event)._unsafeUnwrap()).toBe("https://meet.google.com/from-hangout");
  });

  it("returns MeetUrlNotFound when no Meet URL exists", () => {
    const result = extractMeetUrl({ id: "event-3", description: "No video call" });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toEqual({ type: "MeetUrlNotFound", eventId: "event-3" });
  });
});
