import { contextBridge, ipcRenderer } from "electron";
import type { ApiResult, IPC_CHANNELS as SHARED_IPC_CHANNELS } from "../shared/ipc";
import type { AppUpdateStatus } from "../shared/types";

type SharedIpcChannels = typeof SHARED_IPC_CHANNELS;

// Keep preload bundles standalone: sandboxed Electron preload cannot load Rollup shared chunks.
const IPC_CHANNELS = {
  updatesGetStatus: "updates:getStatus",
  updatesRunHomebrewUpdate: "updates:runHomebrewUpdate",
  updatesStatusChanged: "updates:status-changed",
} as const satisfies Pick<
  SharedIpcChannels,
  "updatesGetStatus" | "updatesRunHomebrewUpdate" | "updatesStatusChanged"
>;

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
