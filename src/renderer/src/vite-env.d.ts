/// <reference types="vite/client" />

export type MeetLauncherApi = {
  getAccountStatus: () => Promise<unknown>;
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
