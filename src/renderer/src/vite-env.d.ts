/// <reference types="vite/client" />

import type { ApiResult } from "@shared/ipc";
import type { AccountStatus, AppUpdateStatus, MeetEventsSnapshot } from "@shared/types";

export type MeetLauncherApi = {
  getAccountStatus: () => Promise<ApiResult<AccountStatus>>;
  connectGoogleAccount: () => Promise<ApiResult<AccountStatus>>;
  disconnectGoogleAccount: () => Promise<ApiResult<AccountStatus>>;
  syncCalendarNow: () => Promise<ApiResult<MeetEventsSnapshot>>;
  listUpcomingMeetings: () => Promise<ApiResult<MeetEventsSnapshot>>;
  onCalendarUpdated: (handler: (result: ApiResult<MeetEventsSnapshot>) => void) => () => void;
  openMeetUrl: (meetUrl: string) => Promise<ApiResult<void>>;
  getUpdateStatus: () => Promise<ApiResult<AppUpdateStatus>>;
  checkForUpdates: () => Promise<ApiResult<AppUpdateStatus>>;
  downloadUpdate: () => Promise<ApiResult<AppUpdateStatus>>;
  installUpdate: () => Promise<ApiResult<void>>;
  onUpdateStatusChanged: (listener: (status: AppUpdateStatus) => void) => () => void;
  versions: {
    electron: string;
    chrome: string;
  };
};

declare global {
  interface Window {
    meetLauncher: MeetLauncherApi;
  }
}
