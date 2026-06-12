import { createGoogleCalendarClient } from "@main/calendar/calendarClient";
import { appErrorMessage } from "@shared/errors";
import { describe, expect, it, vi } from "vitest";

describe("createGoogleCalendarClient", () => {
  it("lists primary calendar events with the expected query and bearer token", async () => {
    const fetchImpl = vi.fn<typeof fetch>(() =>
      Promise.resolve(new Response(JSON.stringify({ items: [{ id: "event-1" }] }))),
    );
    const client = createGoogleCalendarClient(fetchImpl);

    const result = await client.listUpcomingEvents(
      "access-token",
      new Date("2026-05-29T00:00:00Z"),
    );

    expect(result._unsafeUnwrap()).toEqual([{ id: "event-1" }]);
    const [url, init] = fetchImpl.mock.calls[0];
    const calledUrl = new URL(url.toString());
    expect(calledUrl.pathname).toBe("/calendar/v3/calendars/primary/events");
    expect(calledUrl.searchParams.get("timeMin")).toBe("2026-05-28T23:55:00.000Z");
    expect(calledUrl.searchParams.get("timeMax")).toBe("2026-05-30T00:00:00.000Z");
    expect(calledUrl.searchParams.get("singleEvents")).toBe("true");
    expect(calledUrl.searchParams.get("orderBy")).toBe("startTime");
    expect(calledUrl.searchParams.get("maxResults")).toBe("50");
    expect(init?.headers).toEqual({ Authorization: "Bearer access-token" });
  });

  it("maps failed responses into CalendarApiFailed", async () => {
    const fetchImpl = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({ error: { message: "Request had invalid authentication credentials." } }),
          { status: 401 },
        ),
      ),
    );
    const client = createGoogleCalendarClient(fetchImpl);

    const result = await client.listUpcomingEvents(
      "access-token",
      new Date("2026-05-29T00:00:00Z"),
    );

    expect(result._unsafeUnwrapErr()).toMatchObject({ type: "CalendarApiFailed", status: 401 });
    expect(appErrorMessage(result._unsafeUnwrapErr())).toBe(
      "Google Calendar API failed: Request had invalid authentication credentials.",
    );
  });

  it("defaults missing items to an empty event list", async () => {
    const fetchImpl = vi.fn<typeof fetch>(() => Promise.resolve(new Response(JSON.stringify({}))));
    const client = createGoogleCalendarClient(fetchImpl);

    const result = await client.listUpcomingEvents(
      "access-token",
      new Date("2026-05-29T00:00:00Z"),
    );

    expect(result._unsafeUnwrap()).toEqual([]);
  });

  it("uses Google error status and raw bodies when no message is available", async () => {
    const statusFetch = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        new Response(JSON.stringify({ error: { status: "UNAVAILABLE" } }), {
          status: 503,
        }),
      ),
    );
    const rawFetch = vi.fn<typeof fetch>(() =>
      Promise.resolve(new Response(JSON.stringify(["unexpected"]), { status: 500 })),
    );

    const statusResult = await createGoogleCalendarClient(statusFetch).listUpcomingEvents(
      "access-token",
      new Date("2026-05-29T00:00:00Z"),
    );
    const rawResult = await createGoogleCalendarClient(rawFetch).listUpcomingEvents(
      "access-token",
      new Date("2026-05-29T00:00:00Z"),
    );

    expect(appErrorMessage(statusResult._unsafeUnwrapErr())).toBe(
      "Google Calendar API failed: UNAVAILABLE",
    );
    expect(rawResult._unsafeUnwrapErr()).toMatchObject({
      cause: ["unexpected"],
      status: 500,
      type: "CalendarApiFailed",
    });
  });

  it("maps invalid success payloads and thrown fetch errors", async () => {
    const invalidFetch = vi.fn<typeof fetch>(() =>
      Promise.resolve(new Response(JSON.stringify({ items: "not-array" }))),
    );
    const throwingFetch = vi.fn<typeof fetch>(() => Promise.reject(new Error("network down")));

    const invalidResult = await createGoogleCalendarClient(invalidFetch).listUpcomingEvents(
      "access-token",
      new Date("2026-05-29T00:00:00Z"),
    );
    const thrownResult = await createGoogleCalendarClient(throwingFetch).listUpcomingEvents(
      "access-token",
      new Date("2026-05-29T00:00:00Z"),
    );

    expect(invalidResult._unsafeUnwrapErr()).toMatchObject({ type: "CalendarApiFailed" });
    expect(thrownResult._unsafeUnwrapErr()).toMatchObject({
      cause: new Error("network down"),
      type: "CalendarApiFailed",
    });
  });
});
