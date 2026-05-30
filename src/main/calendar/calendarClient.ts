import type { AppError } from "@shared/errors";
import type { CalendarEvent } from "@shared/types";
import { ResultAsync } from "neverthrow";
import { z } from "zod";
import { isHttpJsonFailure, requestJson } from "../http/requestJson";

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

const calendarApiFailureMessage = (responseBody: unknown): string | unknown => {
  const parsedError = z
    .object({
      error: z
        .object({
          message: z.string().optional(),
          status: z.string().optional(),
        })
        .optional(),
    })
    .passthrough()
    .safeParse(responseBody);

  if (!parsedError.success) return responseBody;

  const googleError = parsedError.data.error;
  return googleError?.message ?? googleError?.status ?? responseBody;
};

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
        let responseBody: unknown;
        try {
          responseBody = await requestJson(fetchImpl, buildEventsUrl(now), {
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
          });
        } catch (cause) {
          if (!isHttpJsonFailure(cause)) throw cause;

          throw {
            kind: "calendar-api-failure",
            status: cause.status,
            cause: calendarApiFailureMessage(cause.body),
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
