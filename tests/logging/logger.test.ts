import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLazyLogger, createLogger, noopLogger } from "@main/logging/logger";
import { afterEach, describe, expect, it, vi } from "vitest";

const tempDirs: string[] = [];

const createTempDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "nextroom-logging-"));
  tempDirs.push(dir);
  return dir;
};

const readJsonLines = (path: string): unknown[] =>
  readFileSync(path, "utf8")
    .trim()
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as unknown);

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

describe("createLogger", () => {
  it("filters by level and writes NDJSON entries", () => {
    const dir = createTempDir();
    const logger = createLogger({ dir, level: "warn" }).child("calendar");

    logger.debug("debug skipped");
    logger.info("info skipped");
    logger.warn("warn kept", { token: "secret" });
    logger.error("error kept");

    const entries = readJsonLines(join(dir, "main.log")) as Array<{
      level: string;
      message: string;
      scope: string;
      data?: unknown;
    }>;
    expect(entries).toMatchObject([
      {
        level: "warn",
        scope: "main.calendar",
        message: "warn kept",
        data: { token: "[REDACTED]" },
      },
      { level: "error", scope: "main.calendar", message: "error kept" },
    ]);
  });

  it("rotates to .1 when maxBytes would be exceeded", () => {
    const dir = createTempDir();
    const logger = createLogger({ dir, level: "debug", maxBytes: 240 });

    logger.info("first", { value: "x".repeat(80) });
    logger.info("second", { value: "y".repeat(80) });

    const current = readJsonLines(join(dir, "main.log")) as Array<{ message: string }>;
    const rotated = readJsonLines(join(dir, "main.log.1")) as Array<{ message: string }>;

    expect(rotated.at(-1)?.message).toBe("first");
    expect(current.at(-1)?.message).toBe("second");
  });

  it("creates missing directories before writing", () => {
    const parent = createTempDir();
    const dir = join(parent, "missing", "logs");
    const logger = createLogger({ dir, level: "debug" });

    logger.info("created");

    const entries = readJsonLines(join(dir, "main.log")) as Array<{ message: string }>;
    expect(entries).toMatchObject([{ message: "created" }]);
  });

  it("does not throw for unusable directories", () => {
    const dir = createTempDir();
    const filePath = join(dir, "not-a-directory");
    writeFileSync(filePath, "");

    const logger = createLogger({ dir: join(filePath, "logs"), level: "debug" });

    expect(() => {
      logger.info("ignored");
    }).not.toThrow();
  });

  it("noopLogger does nothing", () => {
    const dir = createTempDir();

    expect(() => {
      noopLogger.child("test").debug("ignored");
      noopLogger.warn("ignored");
      noopLogger.info("ignored");
    }).not.toThrow();
    expect(existsSync(join(dir, "main.log"))).toBe(false);
  });
});

describe("createLazyLogger", () => {
  it("drops failed initialization logs and retries until the factory succeeds", () => {
    const dir = createTempDir();
    const factory = vi
      .fn<() => ReturnType<typeof createLogger>>()
      .mockImplementationOnce(() => {
        throw new Error("not ready");
      })
      .mockImplementationOnce(() => {
        throw new Error("still not ready");
      })
      .mockImplementation(() => createLogger({ dir, level: "debug" }));
    const logger = createLazyLogger(factory);

    expect(() => {
      logger.info("dropped first");
      logger.warn("dropped second");
      logger.error("kept third");
    }).not.toThrow();

    expect(factory).toHaveBeenCalledTimes(3);
    const entries = readJsonLines(join(dir, "main.log")) as Array<{ message: string }>;
    expect(entries).toMatchObject([{ message: "kept third" }]);
  });

  it("memoizes the logger after the factory succeeds", () => {
    const dir = createTempDir();
    const factory = vi.fn(() => createLogger({ dir, level: "debug" }));
    const logger = createLazyLogger(factory);

    logger.info("first");
    logger.info("second");

    expect(factory).toHaveBeenCalledTimes(1);
    const entries = readJsonLines(join(dir, "main.log")) as Array<{ message: string }>;
    expect(entries).toMatchObject([{ message: "first" }, { message: "second" }]);
  });

  it("keeps child scopes created before the factory succeeds", () => {
    const dir = createTempDir();
    const factory = vi.fn(() => createLogger({ dir, level: "debug" }));
    const logger = createLazyLogger(factory);
    const childLogger = logger.child("calendar").child("sync");

    childLogger.info("scoped");

    const entries = readJsonLines(join(dir, "main.log")) as Array<{
      message: string;
      scope: string;
    }>;
    expect(entries).toMatchObject([{ message: "scoped", scope: "main.calendar.sync" }]);
  });

  it("forwards debug calls after lazy initialization", () => {
    const dir = createTempDir();
    const factory = vi.fn(() => createLogger({ dir, level: "debug" }));
    const logger = createLazyLogger(factory);

    logger.debug("debug kept");

    const entries = readJsonLines(join(dir, "main.log")) as Array<{ message: string }>;
    expect(entries).toMatchObject([{ message: "debug kept" }]);
  });
});
