import type { AppError } from "@shared/errors";
import type { CalendarEvent, MeetEvent } from "@shared/types";
import { err, ok, type Result } from "neverthrow";
import { extractMeetCode, extractMeetUrl } from "./meetExtractor";

const selfResponseStatus = (event: CalendarEvent): MeetEvent["responseStatus"] =>
  event.attendees?.find((attendee) => attendee.self)?.responseStatus;

const dateTimeValue = (value: CalendarEvent["start"]): string | null => value?.dateTime ?? null;

const occurrenceKeyFor = (calendarId: string, eventId: string, startAt: string): string =>
  `${calendarId}:${eventId}:${startAt}`;

const isSkippable = (event: CalendarEvent): boolean =>
  event.status === "cancelled" ||
  event.start?.dateTime === undefined ||
  event.end?.dateTime === undefined ||
  selfResponseStatus(event) === "declined";

export const normalizeMeetEvent = (
  event: CalendarEvent,
  calendarId: string,
): Result<MeetEvent | null, AppError> => {
  if (isSkippable(event)) return ok(null);

  const eventId = event.id ?? "unknown";
  const startAt = dateTimeValue(event.start);
  const endAt = dateTimeValue(event.end);

  if (startAt === null || endAt === null) return ok(null);

  return extractMeetUrl(event).match<Result<MeetEvent | null, AppError>>(
    (meetUrl) =>
      ok({
        eventId,
        recurringEventId: event.recurringEventId,
        occurrenceKey: occurrenceKeyFor(calendarId, eventId, startAt),
        calendarId,
        summary: event.summary ?? "Untitled meeting",
        startAt,
        endAt,
        updatedAt: event.updated ?? startAt,
        meetUrl,
        meetCode: extractMeetCode(meetUrl),
        responseStatus: selfResponseStatus(event),
        status: "confirmed",
      }),
    (error) => (error.type === "MeetUrlNotFound" ? ok(null) : err(error)),
  );
};

export const normalizeUpcomingMeetEvents = (
  events: CalendarEvent[],
  calendarId: string,
): Result<MeetEvent[], AppError> => {
  const normalized = events.map((event) => normalizeMeetEvent(event, calendarId));
  const failure = normalized.find((result) => result.isErr());

  if (failure?.isErr()) return err(failure.error);

  return ok(
    normalized.flatMap((result) => {
      if (result.isErr() || result.value === null) return [];
      return [result.value];
    }),
  );
};
