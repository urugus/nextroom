import type { GoogleAuthService } from "@main/oauth/googleAuthService";
import { type AppError, serializeAppError } from "@shared/errors";
import type { AccountStatus, MeetEventsSnapshot } from "@shared/types";
import { err, ok, type Result } from "neverthrow";
import type { CalendarClient } from "./calendarClient";
import { normalizeUpcomingMeetEvents } from "./eventNormalizer";

export type CalendarSyncService = {
  connectAccount: () => Promise<Result<AccountStatus, AppError>>;
  disconnectAccount: () => Promise<Result<AccountStatus, AppError>>;
  getAccountStatus: () => Promise<Result<AccountStatus, AppError>>;
  listUpcomingMeetings: () => Result<MeetEventsSnapshot, AppError>;
  syncNow: () => Promise<Result<MeetEventsSnapshot, AppError>>;
  startPolling: () => void;
  stopPolling: () => void;
  subscribe: (listener: (snapshot: MeetEventsSnapshot) => void) => () => void;
};

type CalendarSyncServiceInput = {
  authService: GoogleAuthService;
  calendarClient: CalendarClient;
  now?: () => Date;
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
};

const normalPollingDelayMs = 60_000;
const errorPollingDelayMs = [30_000, 60_000, 120_000, 240_000, 300_000];

const snapshotFromState = (
  meetings: MeetEventsSnapshot["meetings"],
  syncedAt: string | undefined,
): MeetEventsSnapshot => ({
  meetings,
  ...(syncedAt !== undefined ? { syncedAt } : {}),
});

const isAuthenticationCalendarError = (error: AppError): boolean =>
  error.type === "CalendarApiFailed" && error.status === 401;

export const createCalendarSyncService = ({
  authService,
  calendarClient,
  now = () => new Date(),
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
}: CalendarSyncServiceInput): CalendarSyncService => {
  let meetings: MeetEventsSnapshot["meetings"] = [];
  let syncedAt: string | undefined;
  let syncing = false;
  let lastError: AppError | undefined;
  let polling = false;
  let pollTimer: ReturnType<typeof setTimeout> | undefined;
  let errorBackoffIndex = 0;
  const listeners = new Set<(snapshot: MeetEventsSnapshot) => void>();

  const stopPolling = (): void => {
    polling = false;
    if (pollTimer !== undefined) {
      clearTimeoutFn(pollTimer);
      pollTimer = undefined;
    }
  };

  const notify = (): void => {
    const snapshot = snapshotFromState(meetings, syncedAt);
    for (const listener of listeners) {
      listener(snapshot);
    }
  };

  const scheduleNextPoll = (delayMs: number): void => {
    if (!polling) return;
    if (pollTimer !== undefined) clearTimeoutFn(pollTimer);
    pollTimer = setTimeoutFn(() => {
      void runPollingSync();
    }, delayMs);
  };

  const runPollingSync = async (): Promise<void> => {
    const result = await syncNow();
    if (!polling) return;

    if (result.isOk()) {
      errorBackoffIndex = 0;
      scheduleNextPoll(normalPollingDelayMs);
      return;
    }

    const delay = errorPollingDelayMs[Math.min(errorBackoffIndex, errorPollingDelayMs.length - 1)];
    errorBackoffIndex += 1;
    scheduleNextPoll(delay);
  };

  const accountStatus = async (): Promise<Result<AccountStatus, AppError>> => {
    const connected = await authService.isConnected();
    if (connected.isErr()) return err(connected.error);

    return ok({
      connected: connected.value,
      syncing,
      ...(syncedAt !== undefined ? { lastSyncedAt: syncedAt } : {}),
      ...(lastError !== undefined ? { error: serializeAppError(lastError) } : {}),
    });
  };

  const syncNow = async (): Promise<Result<MeetEventsSnapshot, AppError>> => {
    if (syncing) return ok(snapshotFromState(meetings, syncedAt));

    syncing = true;
    const accessToken = await authService.getAccessToken();
    if (accessToken.isErr()) {
      syncing = false;
      lastError = accessToken.error;
      const connected = await authService.isConnected();
      if (connected.isOk() && !connected.value) {
        meetings = [];
        syncedAt = undefined;
        notify();
      }
      return err(accessToken.error);
    }

    if (accessToken.value === null) {
      syncing = false;
      stopPolling();
      meetings = [];
      syncedAt = undefined;
      lastError = undefined;
      notify();
      return ok(snapshotFromState(meetings, syncedAt));
    }

    const events = await calendarClient.listUpcomingEvents(accessToken.value, now());
    if (events.isErr()) {
      syncing = false;
      lastError = events.error;
      if (isAuthenticationCalendarError(events.error)) {
        await authService.disconnect();
        meetings = [];
        syncedAt = undefined;
        notify();
      }
      return err(events.error);
    }

    const normalized = normalizeUpcomingMeetEvents(events.value, "primary");
    syncing = false;
    if (normalized.isErr()) {
      lastError = normalized.error;
      return err(normalized.error);
    }

    meetings = normalized.value;
    syncedAt = now().toISOString();
    lastError = undefined;
    notify();
    return ok(snapshotFromState(meetings, syncedAt));
  };

  return {
    connectAccount: async () => {
      const connected = await authService.connect();
      if (connected.isErr()) {
        lastError = connected.error;
        return err(connected.error);
      }

      polling = true;
      await syncNow();
      scheduleNextPoll(normalPollingDelayMs);
      return accountStatus();
    },
    disconnectAccount: async () => {
      if (pollTimer !== undefined) clearTimeoutFn(pollTimer);
      polling = false;
      const disconnected = await authService.disconnect();
      if (disconnected.isErr()) return err(disconnected.error);

      meetings = [];
      syncedAt = undefined;
      lastError = undefined;
      syncing = false;
      notify();
      return accountStatus();
    },
    getAccountStatus: accountStatus,
    listUpcomingMeetings: () => ok(snapshotFromState(meetings, syncedAt)),
    syncNow,
    startPolling: () => {
      if (polling) return;
      polling = true;
      void runPollingSync();
    },
    stopPolling: () => {
      stopPolling();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
};
