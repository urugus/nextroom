import { contextBridge, ipcRenderer } from "electron";
import { type ApiResult, IPC_CHANNELS } from "../shared/ipc";
import type { AppUpdateStatus } from "../shared/types";

type MeetShellUpdateApi = {
  getUpdateStatus: () => Promise<ApiResult<AppUpdateStatus>>;
  runHomebrewUpdate: () => Promise<ApiResult<AppUpdateStatus>>;
  onUpdateStatusChanged: (listener: (status: AppUpdateStatus) => void) => () => void;
};

const updateApi: MeetShellUpdateApi = {
  getUpdateStatus: () =>
    ipcRenderer.invoke(IPC_CHANNELS.updatesGetStatus) as Promise<ApiResult<AppUpdateStatus>>,
  runHomebrewUpdate: () =>
    ipcRenderer.invoke(IPC_CHANNELS.updatesRunHomebrewUpdate) as Promise<
      ApiResult<AppUpdateStatus>
    >,
  onUpdateStatusChanged: (listener) => {
    const subscription = (_event: Electron.IpcRendererEvent, status: AppUpdateStatus) => {
      listener(status);
    };

    ipcRenderer.on(IPC_CHANNELS.updatesStatusChanged, subscription);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.updatesStatusChanged, subscription);
    };
  },
};

contextBridge.exposeInMainWorld("meetLauncher", updateApi);
