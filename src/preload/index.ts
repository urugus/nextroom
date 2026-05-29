import { contextBridge, ipcRenderer } from "electron";
import type { AppUpdateStatus } from "../shared/types";

const api = {
  getAccountStatus: () => ipcRenderer.invoke("account:getStatus"),
  openMeetUrl: (meetUrl: string) => ipcRenderer.invoke("meet:open", meetUrl),
  getUpdateStatus: () => ipcRenderer.invoke("updates:getStatus"),
  checkForUpdates: () => ipcRenderer.invoke("updates:check"),
  downloadUpdate: () => ipcRenderer.invoke("updates:download"),
  installUpdate: () => ipcRenderer.invoke("updates:install"),
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
