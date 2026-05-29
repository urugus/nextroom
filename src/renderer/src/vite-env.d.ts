/// <reference types="vite/client" />

import type { ApiResult } from "@shared/ipc";

export type MeetLauncherApi = {
  getAccountStatus: () => Promise<unknown>;
  openMeetUrl: (meetUrl: string) => Promise<ApiResult<void>>;
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
