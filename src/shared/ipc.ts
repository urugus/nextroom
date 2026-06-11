import type { Result } from "neverthrow";
import type { AppError, SerializedAppError } from "./errors";
import { serializeAppError } from "./errors";
import type {
  AccountStatus,
  AppSettings,
  AppUpdateStatus,
  MeetEventsSnapshot,
  MenuShortcutStatus,
  ScreenShareSource,
} from "./types";

export type ApiResult<T> = { ok: true; value: T } | { ok: false; error: SerializedAppError };
export type SettingsUpdate = Partial<
  Pick<
    AppSettings,
    | "autoJoinEnabled"
    | "cameraBubbleEnabled"
    | "cameraBubbleDisplaySpeedLevel"
    | "joinOffsetSeconds"
    | "menuShortcutAccelerator"
    | "openOffsetSeconds"
  >
>;

export const IPC_CHANNELS = {
  accountGetStatus: "account:getStatus",
  accountConnect: "account:connect",
  accountDisconnect: "account:disconnect",
  calendarSyncNow: "calendar:syncNow",
  calendarUpdated: "calendar:updated",
  meetListUpcoming: "meet:listUpcoming",
  meetOpen: "meet:open",
  meetBubbleSend: "meetBubble:send",
  meetBubbleShow: "meetBubble:show",
  meetBubbleSetEnabled: "meetBubble:setEnabled",
  meetBubbleEnabledChanged: "meetBubble:enabledChanged",
  settingsGet: "settings:get",
  settingsUpdate: "settings:update",
  settingsMenuShortcutStatusGet: "settings:menuShortcutStatusGet",
  screenShareCancel: "screenShare:cancel",
  screenShareListSources: "screenShare:listSources",
  screenShareSelectSource: "screenShare:selectSource",
  updatesGetStatus: "updates:getStatus",
  updatesCheck: "updates:check",
  updatesRunHomebrewUpdate: "updates:runHomebrewUpdate",
  updatesStatusChanged: "updates:status-changed",
} as const;

export type ScreenSharePickerApi = {
  listSources: () => Promise<ScreenShareSource[]>;
  selectSource: (sourceId: string) => Promise<void>;
  cancel: () => Promise<void>;
};

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
  getMenuShortcutStatus: () => Promise<ApiResult<MenuShortcutStatus>>;
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
