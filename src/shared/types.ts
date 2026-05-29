import type { SerializedAppError } from "./errors";

export type CalendarDateTime = {
  date?: string;
  dateTime?: string;
  timeZone?: string;
};

export type CalendarConferenceEntryPoint = {
  entryPointType?: string;
  uri?: string;
};

export type CalendarEvent = {
  id?: string;
  recurringEventId?: string;
  status?: string;
  summary?: string;
  start?: CalendarDateTime;
  end?: CalendarDateTime;
  updated?: string;
  hangoutLink?: string;
  location?: string;
  description?: string;
  conferenceData?: {
    conferenceSolution?: {
      key?: {
        type?: string;
      };
    };
    entryPoints?: CalendarConferenceEntryPoint[];
  };
  attendees?: Array<{
    self?: boolean;
    responseStatus?: "accepted" | "tentative" | "declined" | "needsAction";
  }>;
};

export type MeetEvent = {
  eventId: string;
  recurringEventId?: string;
  occurrenceKey: string;
  calendarId: string;
  summary: string;
  startAt: string;
  endAt: string;
  updatedAt: string;
  meetUrl: string;
  meetCode?: string;
  responseStatus?: "accepted" | "tentative" | "declined" | "needsAction";
  status: "confirmed" | "cancelled";
};

export type AccountStatus = {
  connected: boolean;
  syncing: boolean;
  lastSyncedAt?: string;
  error?: SerializedAppError;
};

export type MeetEventsSnapshot = {
  meetings: MeetEvent[];
  syncedAt?: string;
};

export type AppSettings = {
  autoOpenEnabled: boolean;
  notifyBeforeMinutes: number;
  openOffsetSeconds: number;
  launchAtLogin: boolean;
  calendarId: "primary";
  timezone: string;
};

export type LaunchRecord = {
  occurrenceKey: string;
  meetUrlHash: string;
  launchedAt: string;
  eventUpdatedAt: string;
};

export type AppUpdateProgress = {
  percent: number;
  transferred: number;
  total: number;
  bytesPerSecond: number;
};

export type AppUpdateStatus = {
  currentVersion: string;
  status:
    | "unsupported"
    | "idle"
    | "checking"
    | "not-available"
    | "available"
    | "downloading"
    | "downloaded"
    | "error";
  availableVersion?: string;
  downloadedVersion?: string;
  releaseDate?: string;
  releaseName?: string;
  errorMessage?: string;
  progress?: AppUpdateProgress;
  canCheck: boolean;
  canDownload: boolean;
  canInstall: boolean;
};
