import { contextBridge, ipcRenderer } from "electron";
import { type ApiResult, IPC_CHANNELS, type MeetLauncherApi } from "../shared/ipc";
import type {
  AccountStatus,
  AppSettings,
  AppUpdateStatus,
  MeetEventsSnapshot,
} from "../shared/types";

type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];

const invoke = <T>(channel: IpcChannel, ...args: unknown[]): Promise<T> =>
  ipcRenderer.invoke(channel, ...args) as Promise<T>;

const api: MeetLauncherApi = {
  getAccountStatus: () => invoke<ApiResult<AccountStatus>>(IPC_CHANNELS.accountGetStatus),
  connectGoogleAccount: () => invoke<ApiResult<AccountStatus>>(IPC_CHANNELS.accountConnect),
  disconnectGoogleAccount: () => invoke<ApiResult<AccountStatus>>(IPC_CHANNELS.accountDisconnect),
  syncCalendarNow: () => invoke<ApiResult<MeetEventsSnapshot>>(IPC_CHANNELS.calendarSyncNow),
  listUpcomingMeetings: () => invoke<ApiResult<MeetEventsSnapshot>>(IPC_CHANNELS.meetListUpcoming),
  onCalendarUpdated: (handler) => {
    const listener = (_event: Electron.IpcRendererEvent, result: ApiResult<MeetEventsSnapshot>) => {
      handler(result);
    };
    ipcRenderer.on(IPC_CHANNELS.calendarUpdated, listener);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.calendarUpdated, listener);
    };
  },
  openMeetUrl: (meetUrl) => invoke<ApiResult<void>>(IPC_CHANNELS.meetOpen, meetUrl),
  getSettings: () => invoke<ApiResult<AppSettings>>(IPC_CHANNELS.settingsGet),
  updateSettings: (settings) =>
    invoke<ApiResult<AppSettings>>(IPC_CHANNELS.settingsUpdate, settings),
  getUpdateStatus: () => invoke<ApiResult<AppUpdateStatus>>(IPC_CHANNELS.updatesGetStatus),
  checkForUpdates: () => invoke<ApiResult<AppUpdateStatus>>(IPC_CHANNELS.updatesCheck),
  runHomebrewUpdate: () =>
    invoke<ApiResult<AppUpdateStatus>>(IPC_CHANNELS.updatesRunHomebrewUpdate),
  onUpdateStatusChanged: (listener) => {
    const subscription = (_event: Electron.IpcRendererEvent, status: AppUpdateStatus) => {
      listener(status);
    };

    ipcRenderer.on(IPC_CHANNELS.updatesStatusChanged, subscription);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.updatesStatusChanged, subscription);
    };
  },
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
  },
};

contextBridge.exposeInMainWorld("meetLauncher", api);
