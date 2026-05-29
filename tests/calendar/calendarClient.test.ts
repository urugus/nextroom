import { createGoogleCalendarClient } from "@main/calendar/calendarClient";
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
      Promise.resolve(new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 })),
    );
    const client = createGoogleCalendarClient(fetchImpl);

    const result = await client.listUpcomingEvents(
      "access-token",
      new Date("2026-05-29T00:00:00Z"),
    );

    expect(result._unsafeUnwrapErr()).toMatchObject({ type: "CalendarApiFailed", status: 401 });
  });
});
