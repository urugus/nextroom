import { contextBridge, ipcRenderer } from "electron";
import type { ApiResult, IPC_CHANNELS as SHARED_IPC_CHANNELS } from "../shared/ipc";
import type { AppUpdateStatus } from "../shared/types";

type SharedIpcChannels = typeof SHARED_IPC_CHANNELS;

// Keep preload bundles standalone: sandboxed Electron preload cannot load Rollup shared chunks.
const IPC_CHANNELS = {
  meetBubbleEnabledChanged: "meetBubble:enabledChanged",
  meetBubbleSend: "meetBubble:send",
  updatesGetStatus: "updates:getStatus",
  updatesRunHomebrewUpdate: "updates:runHomebrewUpdate",
  updatesStatusChanged: "updates:status-changed",
} as const satisfies Pick<
  SharedIpcChannels,
  | "meetBubbleEnabledChanged"
  | "meetBubbleSend"
  | "updatesGetStatus"
  | "updatesRunHomebrewUpdate"
  | "updatesStatusChanged"
>;

type MeetShellUpdateApi = {
  getUpdateStatus: () => Promise<ApiResult<AppUpdateStatus>>;
  sendBubbleText: (text: string) => Promise<ApiResult<void>>;
  onBubbleEnabledChanged: (listener: (enabled: boolean) => void) => () => void;
  runHomebrewUpdate: () => Promise<ApiResult<AppUpdateStatus>>;
  onUpdateStatusChanged: (listener: (status: AppUpdateStatus) => void) => () => void;
};

const updateApi: MeetShellUpdateApi = {
  getUpdateStatus: () =>
    ipcRenderer.invoke(IPC_CHANNELS.updatesGetStatus) as Promise<ApiResult<AppUpdateStatus>>,
  sendBubbleText: (text) =>
    ipcRenderer.invoke(IPC_CHANNELS.meetBubbleSend, text) as Promise<ApiResult<void>>,
  onBubbleEnabledChanged: (listener) => {
    const subscription = (_event: Electron.IpcRendererEvent, enabled: boolean) => {
      listener(enabled);
    };

    ipcRenderer.on(IPC_CHANNELS.meetBubbleEnabledChanged, subscription);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.meetBubbleEnabledChanged, subscription);
    };
  },
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

export const setupMeetShellDom = (api: MeetShellUpdateApi): void => {
  const setup = (): void => {
    const button = document.getElementById("update-button");
    const bubbleInput = document.getElementById("bubble-input");
    if (!(button instanceof HTMLButtonElement) || !(bubbleInput instanceof HTMLInputElement)) {
      return;
    }

    const render = (status: AppUpdateStatus | undefined): void => {
      const visible = status?.status === "available" || status?.status === "homebrew-updating";
      button.style.display = visible ? "inline-flex" : "none";
      button.disabled = status?.status === "homebrew-updating";
      button.textContent = status?.status === "homebrew-updating" ? "Updating" : "Update";
    };

    api
      .getUpdateStatus()
      .then((result) => {
        if (result.ok) {
          render(result.value);
        }
      })
      .catch(() => undefined);
    api.onUpdateStatusChanged(render);

    button.addEventListener("click", () => {
      button.disabled = true;
      button.textContent = "Updating";
      api
        .runHomebrewUpdate()
        .then((result) => {
          if (!result.ok) {
            button.disabled = false;
            button.textContent = "Update";
          }
        })
        .catch(() => {
          button.disabled = false;
          button.textContent = "Update";
        });
    });

    api.onBubbleEnabledChanged((enabled) => {
      bubbleInput.style.display = enabled ? "block" : "none";
      if (!enabled) {
        bubbleInput.value = "";
      }
    });

    bubbleInput.addEventListener("keydown", (event) => {
      if (!(event instanceof KeyboardEvent)) {
        return;
      }
      if (event.key !== "Enter" || event.isComposing) {
        return;
      }

      const value = bubbleInput.value;
      if (value.trim().length === 0) {
        return;
      }

      event.preventDefault();
      api.sendBubbleText(value).finally(() => {
        bubbleInput.value = "";
      });
    });
  };

  if (document.readyState === "loading") {
    window.addEventListener("DOMContentLoaded", setup, { once: true });
    return;
  }

  setup();
};

setupMeetShellDom(updateApi);
