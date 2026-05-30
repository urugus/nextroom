import { contextBridge, ipcRenderer } from "electron";
import type { AppUpdateStatus } from "../shared/types";

const api = {
  getAccountStatus: () => ipcRenderer.invoke("account:getStatus"),
  connectGoogleAccount: () => ipcRenderer.invoke("account:connect"),
  disconnectGoogleAccount: () => ipcRenderer.invoke("account:disconnect"),
  syncCalendarNow: () => ipcRenderer.invoke("calendar:syncNow"),
  listUpcomingMeetings: () => ipcRenderer.invoke("meet:listUpcoming"),
  onCalendarUpdated: (handler: (result: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, result: unknown) => {
      handler(result);
    };
    ipcRenderer.on("calendar:updated", listener);
    return () => {
      ipcRenderer.removeListener("calendar:updated", listener);
    };
  },
  openMeetUrl: (meetUrl: string) => ipcRenderer.invoke("meet:open", meetUrl),
  getUpdateStatus: () => ipcRenderer.invoke("updates:getStatus"),
  checkForUpdates: () => ipcRenderer.invoke("updates:check"),
  openUpdateDownloadPage: () => ipcRenderer.invoke("updates:openDownloadPage"),
  onUpdateStatusChanged: (listener: (status: AppUpdateStatus) => void) => {
    const subscription = (_event: Electron.IpcRendererEvent, status: AppUpdateStatus) => {
      listener(status);
    };

    ipcRenderer.on("updates:status-changed", subscription);
    return () => {
      ipcRenderer.removeListener("updates:status-changed", subscription);
    };
  },
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
  },
};

contextBridge.exposeInMainWorld("meetLauncher", api);
