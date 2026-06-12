import {
  canonicalizeMeetUrl,
  extractMeetCode,
  extractMeetUrl,
  isMeetUrl,
} from "@main/calendar/meetExtractor";
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

  it("validates, canonicalizes, and extracts Meet URL codes", () => {
    expect(isMeetUrl(null)).toBe(false);
    expect(isMeetUrl(undefined)).toBe(false);
    expect(isMeetUrl("not a url")).toBe(false);
    expect(isMeetUrl("http://meet.google.com/abc-defg-hij")).toBe(false);
    expect(isMeetUrl("https://meet.google.com/")).toBe(false);
    expect(isMeetUrl("https://meet.google.com/abc-defg-hij")).toBe(true);

    expect(canonicalizeMeetUrl("not a url")._unsafeUnwrapErr()).toEqual({
      eventId: "unknown",
      type: "MeetUrlNotFound",
    });
    expect(
      canonicalizeMeetUrl(
        "https://meet.google.com/abc-defg-hij/?authuser=0#fragment",
      )._unsafeUnwrap(),
    ).toBe("https://meet.google.com/abc-defg-hij");
    expect(extractMeetCode("not a url")).toBeUndefined();
    expect(extractMeetCode("https://meet.google.com/abc-defg-hij")).toBe("abc-defg-hij");
  });
});
