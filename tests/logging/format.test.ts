import { formatLogEntry, type LogLevel, parseLogLevel, shouldLog } from "@main/logging/format";
import { describe, expect, it } from "vitest";

const levels: LogLevel[] = ["debug", "info", "warn", "error"];

describe("shouldLog", () => {
  it("applies every level threshold combination", () => {
    const expected: Record<LogLevel, LogLevel[]> = {
      debug: ["debug", "info", "warn", "error"],
      info: ["info", "warn", "error"],
      warn: ["warn", "error"],
      error: ["error"],
    };

    for (const threshold of levels) {
      for (const level of levels) {
        expect(shouldLog(level, threshold)).toBe(expected[threshold].includes(level));
      }
    }
  });
});

describe("formatLogEntry", () => {
  it("returns one valid JSON line", () => {
    const line = formatLogEntry({
      ts: "2026-06-12T00:00:00.000Z",
      level: "info",
      scope: "main.calendar",
      message: "connected",
      data: { accessToken: "secret", url: "https://example.test/?code=abc" },
    });

    expect(line.endsWith("\n")).toBe(true);
    expect(line.trimEnd()).not.toContain("\n");
    expect(JSON.parse(line)).toEqual({
      ts: "2026-06-12T00:00:00.000Z",
      level: "info",
      scope: "main.calendar",
      message: "connected",
      data: {
        accessToken: "[REDACTED]",
        url: "https://example.test/?code=[REDACTED]",
      },
    });
  });

  it("keeps oversized data as valid truncated JSON", () => {
    const line = formatLogEntry({
      ts: "2026-06-12T00:00:00.000Z",
      level: "info",
      scope: "main",
      message: "large",
      data: { text: "x".repeat(20_000) },
    });
    const parsed = JSON.parse(line) as { data: string };

    expect(Buffer.byteLength(line, "utf8")).toBeLessThanOrEqual(8 * 1024);
    expect(parsed.data.endsWith("…[truncated]")).toBe(true);
  });

  it("keeps oversized messages as valid truncated JSON", () => {
    const line = formatLogEntry({
      ts: "2026-06-12T00:00:00.000Z",
      level: "error",
      scope: "main",
      message: "x".repeat(20_000),
    });
    const parsed = JSON.parse(line) as { message: string };

    expect(Buffer.byteLength(line, "utf8")).toBeLessThanOrEqual(8 * 1024);
    expect(parsed.message.endsWith("…[truncated]")).toBe(true);
  });

  it("falls back when oversized scopes leave no room for messages", () => {
    const line = formatLogEntry({
      ts: "2026-06-12T00:00:00.000Z",
      level: "error",
      scope: "main.".repeat(2_000),
      message: "x".repeat(20_000),
    });
    const parsed = JSON.parse(line) as { message: string };

    expect(parsed.message).toBe("…[truncated]");
  });

  it("truncates both data and message when metadata is too large", () => {
    const line = formatLogEntry({
      ts: "2026-06-12T00:00:00.000Z",
      level: "error",
      scope: "main.".repeat(2_000),
      message: "x".repeat(20_000),
      data: { text: "y".repeat(20_000) },
    });
    const parsed = JSON.parse(line) as { data: string; message: string };

    expect(parsed.data.endsWith("…[truncated]")).toBe(true);
    expect(parsed.message.endsWith("…[truncated]")).toBe(true);
  });
});

describe("parseLogLevel", () => {
  it("falls back to info for invalid or missing values", () => {
    expect(parseLogLevel("debug")).toBe("debug");
    expect(parseLogLevel("error")).toBe("error");
    expect(parseLogLevel("verbose")).toBe("info");
    expect(parseLogLevel(undefined)).toBe("info");
  });
});
