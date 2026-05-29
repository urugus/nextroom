/// <reference types="vite/client" />

import type { ApiResult } from "@shared/ipc";
import type { AppUpdateStatus } from "@shared/types";

export type MeetLauncherApi = {
  getAccountStatus: () => Promise<unknown>;
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
