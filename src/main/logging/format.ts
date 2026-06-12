import { sanitizeForLog } from "@main/logging/sanitize";
import { z } from "zod";

export type LogLevel = "debug" | "info" | "warn" | "error";

const logLevelSchema = z.enum(["debug", "info", "warn", "error"]);
const logLevelPriority: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};
const maxSerializedBytes = 8 * 1024;
const truncationSuffix = "…[truncated]";

type LogEntryInput = {
  ts: string;
  level: LogLevel;
  scope: string;
  message: string;
  data?: unknown;
};

const byteLength = (value: string): number => Buffer.byteLength(value, "utf8");

const truncateUtf8 = (value: string, maxBytes: number): string => {
  let output = "";
  for (const char of value) {
    if (byteLength(`${output}${char}`) > maxBytes) break;
    output += char;
  }
  return output;
};

const stringifyLogEntry = (entry: LogEntryInput): string => `${JSON.stringify(entry)}\n`;

const withTruncatedMessage = (entry: LogEntryInput): LogEntryInput => {
  const overhead = byteLength(stringifyLogEntry({ ...entry, message: "" }));
  const suffixBytes = byteLength(truncationSuffix);
  const maxMessageBytes = Math.max(0, maxSerializedBytes - overhead - suffixBytes - 64);
  return {
    ...entry,
    message: `${truncateUtf8(entry.message, maxMessageBytes)}${truncationSuffix}`,
  };
};

export const shouldLog = (level: LogLevel, threshold: LogLevel): boolean =>
  logLevelPriority[level] >= logLevelPriority[threshold];

export const formatLogEntry = (input: LogEntryInput): string => {
  const entry: LogEntryInput = {
    ts: input.ts,
    level: input.level,
    scope: input.scope,
    message: input.message,
    ...(input.data !== undefined ? { data: sanitizeForLog(input.data) } : {}),
  };
  const serialized = stringifyLogEntry(entry);
  if (byteLength(serialized) <= maxSerializedBytes || entry.data === undefined) {
    if (byteLength(serialized) <= maxSerializedBytes) return serialized;

    const messageTruncated = stringifyLogEntry(withTruncatedMessage(entry));
    if (byteLength(messageTruncated) <= maxSerializedBytes) return messageTruncated;

    return stringifyLogEntry({
      ts: entry.ts,
      level: entry.level,
      scope: entry.scope,
      message: truncationSuffix,
    });
  }

  const dataJson = JSON.stringify(entry.data) ?? "";
  const overhead = byteLength(stringifyLogEntry({ ...entry, data: "" }));
  const suffixBytes = byteLength(truncationSuffix);
  const maxDataBytes = Math.max(0, maxSerializedBytes - overhead - suffixBytes - 64);
  const dataTruncatedEntry = {
    ...entry,
    data: `${truncateUtf8(dataJson, maxDataBytes)}${truncationSuffix}`,
  };
  const dataTruncated = stringifyLogEntry(dataTruncatedEntry);
  if (byteLength(dataTruncated) <= maxSerializedBytes) return dataTruncated;

  return stringifyLogEntry(withTruncatedMessage(dataTruncatedEntry));
};

export const parseLogLevel = (value: unknown): LogLevel => {
  const parsed = logLevelSchema.safeParse(value);
  return parsed.success ? parsed.data : "info";
};
