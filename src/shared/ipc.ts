import type { Result } from "neverthrow";
import type { AppError, SerializedAppError } from "./errors";
import { serializeAppError } from "./errors";
import type { AccountStatus, AppSettings, AppUpdateStatus, MeetEventsSnapshot } from "./types";

export type ApiResult<T> = { ok: true; value: T } | { ok: false; error: SerializedAppError };
export type SettingsUpdate = Pick<AppSettings, "openOffsetSeconds">;

export const IPC_CHANNELS = {
  accountGetStatus: "account:getStatus",
  accountConnect: "account:connect",
  accountDisconnect: "account:disconnect",
  calendarSyncNow: "calendar:syncNow",
  calendarUpdated: "calendar:updated",
  meetListUpcoming: "meet:listUpcoming",
  meetOpen: "meet:open",
  settingsGet: "settings:get",
  settingsUpdate: "settings:update",
  updatesGetStatus: "updates:getStatus",
  updatesCheck: "updates:check",
  updatesRunHomebrewUpdate: "updates:runHomebrewUpdate",
  updatesStatusChanged: "updates:status-changed",
} as const;

export type MeetLauncherApi = {
  getAccountStatus: () => Promise<ApiResult<AccountStatus>>;
  connectGoogleAccount: () => Promise<ApiResult<AccountStatus>>;
  disconnectGoogleAccount: () => Promise<ApiResult<AccountStatus>>;
  syncCalendarNow: () => Promise<ApiResult<MeetEventsSnapshot>>;
  listUpcomingMeetings: () => Promise<ApiResult<MeetEventsSnapshot>>;
  onCalendarUpdated: (handler: (result: ApiResult<MeetEventsSnapshot>) => void) => () => void;
  openMeetUrl: (meetUrl: string) => Promise<ApiResult<void>>;
  getSettings: () => Promise<ApiResult<AppSettings>>;
  updateSettings: (settings: SettingsUpdate) => Promise<ApiResult<AppSettings>>;
  getUpdateStatus: () => Promise<ApiResult<AppUpdateStatus>>;
  checkForUpdates: () => Promise<ApiResult<AppUpdateStatus>>;
  runHomebrewUpdate: () => Promise<ApiResult<AppUpdateStatus>>;
  onUpdateStatusChanged: (listener: (status: AppUpdateStatus) => void) => () => void;
  versions: {
    electron: string;
    chrome: string;
  };
};

export const toApiResult = <T>(result: Result<T, AppError>): ApiResult<T> =>
  result.match(
    (value) => ({ ok: true, value }),
    (error) => ({ ok: false, error: serializeAppError(error) }),
  );
