import { appendFileSync, mkdirSync, renameSync, statSync } from "node:fs";
import { join } from "node:path";
import { formatLogEntry, type LogLevel, shouldLog } from "@main/logging/format";

export type Logger = {
  debug: (message: string, data?: unknown) => void;
  info: (message: string, data?: unknown) => void;
  warn: (message: string, data?: unknown) => void;
  error: (message: string, data?: unknown) => void;
  child: (scope: string) => Logger;
};

type LoggerOptions = {
  dir: string;
  level: LogLevel;
  maxBytes?: number;
  fileName?: string;
};

type LoggerState = {
  currentSize: number;
  dir: string;
  fileName: string;
  level: LogLevel;
  maxBytes: number;
};

const defaultMaxBytes = 5 * 1024 * 1024;
const defaultFileName = "main.log";

const safeRun = (operation: () => void): void => {
  try {
    operation();
  } catch {
    // Logging must never affect application behavior.
  }
};

const initialFileSize = (filePath: string): number => {
  try {
    return statSync(filePath).size;
  } catch {
    return 0;
  }
};

const joinScope = (parent: string, child: string): string =>
  parent.length === 0 ? child : `${parent}.${child}`;

const createScopedLogger = (state: LoggerState, scope: string): Logger => {
  const filePath = join(state.dir, state.fileName);
  const rotatedPath = `${filePath}.1`;

  const write = (level: LogLevel, message: string, data?: unknown): void => {
    if (!shouldLog(level, state.level)) return;

    const line = formatLogEntry({
      ts: new Date().toISOString(),
      level,
      scope,
      message,
      ...(data !== undefined ? { data } : {}),
    });
    const nextBytes = Buffer.byteLength(line, "utf8");

    if (state.currentSize + nextBytes > state.maxBytes) {
      safeRun(() => {
        renameSync(filePath, rotatedPath);
        state.currentSize = 0;
      });
    }

    safeRun(() => {
      appendFileSync(filePath, line);
      state.currentSize += nextBytes;
    });
  };

  return {
    debug: (message, data) => write("debug", message, data),
    info: (message, data) => write("info", message, data),
    warn: (message, data) => write("warn", message, data),
    error: (message, data) => write("error", message, data),
    child: (childScope) => createScopedLogger(state, joinScope(scope, childScope)),
  };
};

export const createLogger = ({
  dir,
  level,
  maxBytes = defaultMaxBytes,
  fileName = defaultFileName,
}: LoggerOptions): Logger => {
  safeRun(() => {
    mkdirSync(dir, { recursive: true });
  });

  const state: LoggerState = {
    currentSize: initialFileSize(join(dir, fileName)),
    dir,
    fileName,
    level,
    maxBytes,
  };

  return createScopedLogger(state, "main");
};

export const noopLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => noopLogger,
};
