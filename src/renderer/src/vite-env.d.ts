/// <reference types="vite/client" />

import type { MeetLauncherApi } from "@shared/ipc";

declare global {
  interface Window {
    meetLauncher: MeetLauncherApi;
  }
}
