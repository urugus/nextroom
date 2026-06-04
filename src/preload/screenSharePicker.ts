import { contextBridge, ipcRenderer } from "electron";
import type { ScreenSharePickerApi, IPC_CHANNELS as SHARED_IPC_CHANNELS } from "../shared/ipc";
import type { ScreenShareSource } from "../shared/types";

type SharedIpcChannels = typeof SHARED_IPC_CHANNELS;

// Keep preload bundles standalone: sandboxed Electron preload cannot load Rollup shared chunks.
const IPC_CHANNELS = {
  screenShareCancel: "screenShare:cancel",
  screenShareListSources: "screenShare:listSources",
  screenShareSelectSource: "screenShare:selectSource",
} as const satisfies Pick<
  SharedIpcChannels,
  "screenShareCancel" | "screenShareListSources" | "screenShareSelectSource"
>;

const api: ScreenSharePickerApi = {
  listSources: () =>
    ipcRenderer.invoke(IPC_CHANNELS.screenShareListSources) as Promise<ScreenShareSource[]>,
  selectSource: (sourceId) =>
    ipcRenderer.invoke(IPC_CHANNELS.screenShareSelectSource, sourceId) as Promise<void>,
  cancel: () => ipcRenderer.invoke(IPC_CHANNELS.screenShareCancel) as Promise<void>,
};

contextBridge.exposeInMainWorld("screenSharePicker", api);
