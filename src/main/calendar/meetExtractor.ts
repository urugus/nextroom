import type { AppError } from "@shared/errors";
import type { CalendarEvent } from "@shared/types";
import { err, ok, type Result } from "neverthrow";

export type MeetUrl = string & { readonly __brand: "MeetUrl" };

const meetUrlPattern = /https:\/\/meet\.google\.com\/[a-z0-9-]+(?:[/?#][^\s<>"']*)?/i;

export const isMeetUrl = (value: string | null | undefined): value is string => {
  if (value === null || value === undefined) return false;

  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" && url.hostname === "meet.google.com" && url.pathname.length > 1
    );
  } catch {
    return false;
  }
};

export const canonicalizeMeetUrl = (value: string): Result<MeetUrl, AppError> => {
  if (!isMeetUrl(value)) {
    return err({ type: "MeetUrlNotFound", eventId: "unknown" });
  }

  const url = new URL(value);
  url.hash = "";
  url.search = "";
  url.pathname = url.pathname.replace(/\/$/, "");
  return ok(url.toString() as MeetUrl);
};

export const extractMeetCode = (value: string): string | undefined => {
  if (!isMeetUrl(value)) return undefined;

  const url = new URL(value);
  return url.pathname.split("/").filter(Boolean).at(0);
};

const findConferenceEntry = (event: CalendarEvent): string | undefined =>
  event.conferenceData?.entryPoints?.find(
    (entry) => entry.entryPointType === "video" && isMeetUrl(entry.uri),
  )?.uri;

const findFirstMeetUrl = (text: string | null | undefined): string | undefined =>
  text?.match(meetUrlPattern)?.at(0);

export const extractMeetUrl = (event: CalendarEvent): Result<MeetUrl, AppError> => {
  const eventId = event.id ?? "unknown";
  const candidate =
    findConferenceEntry(event) ??
    (isMeetUrl(event.hangoutLink) ? event.hangoutLink : undefined) ??
    findFirstMeetUrl(event.location) ??
    findFirstMeetUrl(event.description);

  if (candidate === undefined) {
    return err({ type: "MeetUrlNotFound", eventId });
  }

  return canonicalizeMeetUrl(candidate).mapErr(() => ({ type: "MeetUrlNotFound", eventId }));
};
