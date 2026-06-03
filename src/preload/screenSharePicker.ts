import { contextBridge, ipcRenderer } from "electron";
import { IPC_CHANNELS, type ScreenSharePickerApi } from "../shared/ipc";
import type { ScreenShareSource } from "../shared/types";

const api: ScreenSharePickerApi = {
  listSources: () =>
    ipcRenderer.invoke(IPC_CHANNELS.screenShareListSources) as Promise<ScreenShareSource[]>,
  selectSource: (sourceId) =>
    ipcRenderer.invoke(IPC_CHANNELS.screenShareSelectSource, sourceId) as Promise<void>,
  cancel: () => ipcRenderer.invoke(IPC_CHANNELS.screenShareCancel) as Promise<void>,
};

contextBridge.exposeInMainWorld("screenSharePicker", api);
