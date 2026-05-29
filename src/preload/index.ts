import { contextBridge, ipcRenderer } from "electron";

const api = {
  getAccountStatus: () => ipcRenderer.invoke("account:getStatus"),
  openMeetUrl: (meetUrl: string) => ipcRenderer.invoke("meet:open", meetUrl),
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
  },
};

contextBridge.exposeInMainWorld("meetLauncher", api);
