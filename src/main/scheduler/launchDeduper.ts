import type { AppError } from "@shared/errors";
import type { LaunchRecord, MeetEvent } from "@shared/types";
import { ok, type Result } from "neverthrow";

export type LaunchDeduper = {
  hasLaunched: (event: MeetEvent) => boolean;
  markLaunched: (event: MeetEvent, launchedAt: string) => Result<LaunchRecord, AppError>;
  records: () => LaunchRecord[];
};

const hashMeetUrl = (meetUrl: string): string => {
  let hash = 0;

  for (const char of meetUrl) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }

  return hash.toString(16);
};

export const createLaunchDeduper = (initialRecords: LaunchRecord[] = []): LaunchDeduper => {
  const records = new Map(initialRecords.map((record) => [record.occurrenceKey, record]));

  return {
    hasLaunched: (event) => records.has(event.occurrenceKey),
    markLaunched: (event, launchedAt) => {
      const record = {
        occurrenceKey: event.occurrenceKey,
        meetUrlHash: hashMeetUrl(event.meetUrl),
        launchedAt,
        eventUpdatedAt: event.updatedAt,
      };

      records.set(event.occurrenceKey, record);
      return ok(record);
    },
    records: () => [...records.values()],
  };
};
