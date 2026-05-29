import type { AppError } from "@shared/errors";
import type { CalendarEvent } from "@shared/types";
import { ResultAsync } from "neverthrow";
import { z } from "zod";

export type CalendarClient = {
  listUpcomingEvents: (accessToken: string, now: Date) => ResultAsync<CalendarEvent[], AppError>;
};

type CalendarApiFailure = {
  kind: "calendar-api-failure";
  status?: number;
  cause: unknown;
};

const calendarEventsResponseSchema = z
  .object({
    items: z.array(z.custom<CalendarEvent>()).default([]),
  })
  .passthrough();

const isCalendarApiFailure = (cause: unknown): cause is CalendarApiFailure =>
  typeof cause === "object" &&
  cause !== null &&
  "kind" in cause &&
  cause.kind === "calendar-api-failure";

const toCalendarApiError = (cause: unknown): AppError =>
  isCalendarApiFailure(cause)
    ? { type: "CalendarApiFailed", status: cause.status, cause: cause.cause }
    : { type: "CalendarApiFailed", cause };

const buildEventsUrl = (now: Date): URL => {
  const timeMin = new Date(now.getTime() - 5 * 60 * 1000);
  const timeMax = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const url = new URL("https://www.googleapis.com/calendar/v3/calendars/primary/events");

  url.searchParams.set("timeMin", timeMin.toISOString());
  url.searchParams.set("timeMax", timeMax.toISOString());
  url.searchParams.set("singleEvents", "true");
  url.searchParams.set("orderBy", "startTime");
  url.searchParams.set("maxResults", "50");

  return url;
};

export const createGoogleCalendarClient = (
  fetchImpl: typeof fetch = globalThis.fetch,
): CalendarClient => ({
  listUpcomingEvents: (accessToken, now) =>
    ResultAsync.fromPromise(
      (async () => {
        const response = await fetchImpl(buildEventsUrl(now), {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        });
        const responseBody = (await response.json().catch(() => undefined)) as unknown;

        if (!response.ok) {
          throw {
            kind: "calendar-api-failure",
            status: response.status,
            cause: responseBody,
          } satisfies CalendarApiFailure;
        }

        const parsed = calendarEventsResponseSchema.safeParse(responseBody);
        if (!parsed.success) {
          throw {
            kind: "calendar-api-failure",
            cause: parsed.error.message,
          } satisfies CalendarApiFailure;
        }

        return parsed.data.items;
      })(),
      toCalendarApiError,
    ),
});
