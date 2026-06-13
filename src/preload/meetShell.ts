import { contextBridge, ipcRenderer } from "electron";
import type { ApiResult, IPC_CHANNELS as SHARED_IPC_CHANNELS } from "../shared/ipc";
import type { AppSettings, AppUpdateStatus, CameraBubbleShellState } from "../shared/types";

type SharedIpcChannels = typeof SHARED_IPC_CHANNELS;

// Keep preload bundles standalone: sandboxed Electron preload cannot load Rollup shared chunks.
const IPC_CHANNELS = {
  meetBubbleSend: "meetBubble:send",
  meetBubbleSetSidebarHidden: "meetBubble:setSidebarHidden",
  meetBubbleShellState: "meetBubble:shellState",
  updatesGetStatus: "updates:getStatus",
  updatesRunHomebrewUpdate: "updates:runHomebrewUpdate",
  updatesStatusChanged: "updates:status-changed",
} as const satisfies Pick<
  SharedIpcChannels,
  | "meetBubbleSend"
  | "meetBubbleSetSidebarHidden"
  | "meetBubbleShellState"
  | "updatesGetStatus"
  | "updatesRunHomebrewUpdate"
  | "updatesStatusChanged"
>;

type MeetShellUpdateApi = {
  getUpdateStatus: () => Promise<ApiResult<AppUpdateStatus>>;
  sendBubbleText: (text: string) => Promise<ApiResult<string | undefined>>;
  setSidebarHidden: (hidden: boolean) => Promise<ApiResult<AppSettings>>;
  onShellStateChanged: (listener: (state: CameraBubbleShellState) => void) => () => void;
  runHomebrewUpdate: () => Promise<ApiResult<AppUpdateStatus>>;
  onUpdateStatusChanged: (listener: (status: AppUpdateStatus) => void) => () => void;
};

const updateApi: MeetShellUpdateApi = {
  getUpdateStatus: () =>
    ipcRenderer.invoke(IPC_CHANNELS.updatesGetStatus) as Promise<ApiResult<AppUpdateStatus>>,
  sendBubbleText: (text) =>
    ipcRenderer.invoke(IPC_CHANNELS.meetBubbleSend, text) as Promise<ApiResult<string | undefined>>,
  setSidebarHidden: (hidden) =>
    ipcRenderer.invoke(IPC_CHANNELS.meetBubbleSetSidebarHidden, hidden) as Promise<
      ApiResult<AppSettings>
    >,
  onShellStateChanged: (listener) => {
    const subscription = (_event: Electron.IpcRendererEvent, state: CameraBubbleShellState) => {
      listener(state);
    };

    ipcRenderer.on(IPC_CHANNELS.meetBubbleShellState, subscription);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.meetBubbleShellState, subscription);
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
    const bubbleToggle = document.getElementById("bubble-toggle");
    const bubbleHistory = document.getElementById("bubble-history");
    const bubbleInput = document.getElementById("bubble-input");
    const bubbleSidebar = document.getElementById("bubble-sidebar");
    if (
      !(button instanceof HTMLButtonElement) ||
      !(bubbleToggle instanceof HTMLButtonElement) ||
      !(bubbleHistory instanceof HTMLOListElement) ||
      !(bubbleInput instanceof HTMLTextAreaElement) ||
      !(bubbleSidebar instanceof HTMLElement)
    ) {
      return;
    }

    const render = (status: AppUpdateStatus | undefined): void => {
      const visible = status?.status === "available" || status?.status === "homebrew-updating";
      button.style.display = visible ? "inline-flex" : "none";
      button.disabled = status?.status === "homebrew-updating";
      button.textContent = status?.status === "homebrew-updating" ? "Updating" : "Update";
    };
    const shellState = {
      current: {
        enabled: false,
        sidebarHidden: false,
      },
    };
    const appendBubbleHistory = (text: string): void => {
      const trimmedText = text.trim();
      if (trimmedText.length === 0) return;

      const item = document.createElement("li");
      item.textContent = trimmedText;
      bubbleHistory.append(item);
      bubbleHistory.classList.add("visible");
      bubbleHistory.scrollTop = bubbleHistory.scrollHeight;
    };
    const renderShellState = (state: CameraBubbleShellState): void => {
      shellState.current = state;
      const sidebarVisible = state.enabled && !state.sidebarHidden;
      bubbleToggle.style.display = state.enabled ? "inline-flex" : "none";
      bubbleToggle.textContent = state.sidebarHidden ? "Show panel" : "Hide panel";
      bubbleToggle.setAttribute("aria-expanded", String(sidebarVisible));
      bubbleSidebar.style.display = sidebarVisible ? "flex" : "none";
      if (!sidebarVisible) {
        bubbleInput.value = "";
      }
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

    api.onShellStateChanged(renderShellState);

    bubbleToggle.addEventListener("click", () => {
      api.setSidebarHidden(!shellState.current.sidebarHidden).catch(() => undefined);
    });

    bubbleInput.addEventListener("keydown", (event) => {
      if (!(event instanceof KeyboardEvent)) {
        return;
      }
      if (event.key !== "Enter" || event.isComposing) {
        return;
      }
      if (event.shiftKey) {
        return;
      }

      const value = bubbleInput.value;
      if (value.trim().length === 0) {
        return;
      }

      event.preventDefault();
      api
        .sendBubbleText(value)
        .then((result) => {
          if (!result.ok) return;
          if (result.value === undefined) return;

          appendBubbleHistory(result.value);
          bubbleInput.value = "";
        })
        .catch(() => undefined);
    });
  };

  if (document.readyState === "loading") {
    window.addEventListener("DOMContentLoaded", setup, { once: true });
    return;
  }

  setup();
};

setupMeetShellDom(updateApi);
