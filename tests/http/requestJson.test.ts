import { isHttpJsonFailure, requestJson } from "@main/http/requestJson";
import { describe, expect, it, vi } from "vitest";

describe("requestJson", () => {
  it("returns parsed JSON from successful responses", async () => {
    const fetchImpl = vi.fn<typeof fetch>(() =>
      Promise.resolve(new Response(JSON.stringify({ ok: true }))),
    );

    await expect(requestJson(fetchImpl, "https://example.com")).resolves.toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledWith("https://example.com", undefined);
  });

  it("throws a normalized failure for unsuccessful responses", async () => {
    const fetchImpl = vi.fn<typeof fetch>(() =>
      Promise.resolve(new Response(JSON.stringify({ error: "invalid" }), { status: 401 })),
    );

    await expect(requestJson(fetchImpl, "https://example.com")).rejects.toMatchObject({
      kind: "http-json-failure",
      status: 401,
      body: { error: "invalid" },
    });
  });

  it("keeps an undefined body when response JSON cannot be parsed", async () => {
    const fetchImpl = vi.fn<typeof fetch>(() =>
      Promise.resolve(new Response("not-json", { status: 500 })),
    );

    try {
      await requestJson(fetchImpl, "https://example.com");
      throw new Error("Expected requestJson to throw");
    } catch (cause) {
      expect(isHttpJsonFailure(cause)).toBe(true);
      if (isHttpJsonFailure(cause)) {
        expect(cause.status).toBe(500);
        expect(cause.body).toBeUndefined();
      }
    }
  });
});
