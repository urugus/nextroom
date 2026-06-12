import { sanitizeForLog } from "@main/logging/sanitize";
import { describe, expect, it } from "vitest";

describe("sanitizeForLog", () => {
  it("redacts sensitive keys across cases and naming styles", () => {
    expect(
      sanitizeForLog({
        access_token: "access",
        accessToken: "access-camel",
        API_KEY: "api",
        clientSecret: "client-secret",
        nested: {
          Authorization: "bearer token",
          code_verifier: "verifier",
          password: "password",
        },
      }),
    ).toEqual({
      access_token: "[REDACTED]",
      accessToken: "[REDACTED]",
      API_KEY: "[REDACTED]",
      clientSecret: "[REDACTED]",
      nested: {
        Authorization: "[REDACTED]",
        code_verifier: "[REDACTED]",
        password: "[REDACTED]",
      },
    });
  });

  it("redacts OAuth query values in strings", () => {
    expect(
      sanitizeForLog(
        "https://example.test/callback?code=abc123&state=xyz access_token=token id_token=id",
      ),
    ).toBe(
      "https://example.test/callback?code=[REDACTED]&state=[REDACTED] access_token=[REDACTED] id_token=[REDACTED]",
    );
  });

  it("redacts Meet URL path segments", () => {
    expect(sanitizeForLog("https://meet.google.com/abc-defg-hij?authuser=0")).toBe(
      "https://meet.google.com/[REDACTED]?authuser=0",
    );
  });

  it("redacts Meet URL path segments inside error messages", () => {
    expect(
      sanitizeForLog("ERR_NAME_NOT_RESOLVED loading 'https://meet.google.com/abc-defg-hij'"),
    ).toBe("ERR_NAME_NOT_RESOLVED loading 'https://meet.google.com/[REDACTED]'");
  });

  it("redacts Meet URL path segments in object values", () => {
    expect(
      sanitizeForLog({
        validatedURL: "https://meet.google.com/abc-defg-hij",
      }),
    ).toEqual({
      validatedURL: "https://meet.google.com/[REDACTED]",
    });
  });

  it("redacts Error message and stack strings", () => {
    const error = new Error("failed with code=abc");
    error.stack = "Error: failed with access_token=secret\n    at test";

    expect(sanitizeForLog(error)).toEqual({
      name: "Error",
      message: "failed with code=[REDACTED]",
      stack: "Error: failed with access_token=[REDACTED]\n    at test",
    });
  });

  it("limits depth", () => {
    expect(
      sanitizeForLog({
        a: { b: { c: { d: { e: { f: { g: "too deep" } } } } } },
      }),
    ).toEqual({
      a: { b: { c: { d: { e: { f: "[MaxDepth]" } } } } },
    });
  });

  it("marks circular references", () => {
    const value: { name: string; self?: unknown } = { name: "root" };
    value.self = value;

    expect(sanitizeForLog(value)).toEqual({
      name: "root",
      self: "[Circular]",
    });
  });

  it("sanitizes nested arrays", () => {
    expect(
      sanitizeForLog([
        { token: "secret" },
        ["callback?refresh_token=refresh", { state: "state=abc" }],
      ]),
    ).toEqual([
      { token: "[REDACTED]" },
      ["callback?refresh_token=[REDACTED]", { state: "state=[REDACTED]" }],
    ]);
  });
});
