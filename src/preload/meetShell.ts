import { contextBridge, ipcRenderer } from "electron";
import type { ApiResult, SettingsUpdate, IPC_CHANNELS as SHARED_IPC_CHANNELS } from "../shared/ipc";
import type { AppSettings, AppUpdateStatus, CameraBubbleShellState } from "../shared/types";

type SharedIpcChannels = typeof SHARED_IPC_CHANNELS;

// Keep preload bundles standalone: sandboxed Electron preload cannot load Rollup shared chunks.
const IPC_CHANNELS = {
  meetBubblePin: "meetBubble:pin",
  meetBubbleSend: "meetBubble:send",
  meetBubbleSetSettingsPanelOpen: "meetBubble:setSettingsPanelOpen",
  meetBubbleSetSidebarHidden: "meetBubble:setSidebarHidden",
  meetBubbleShellState: "meetBubble:shellState",
  meetBubbleUnpin: "meetBubble:unpin",
  settingsGet: "settings:get",
  settingsUpdate: "settings:update",
  updatesGetStatus: "updates:getStatus",
  updatesRunHomebrewUpdate: "updates:runHomebrewUpdate",
  updatesStatusChanged: "updates:status-changed",
} as const satisfies Pick<
  SharedIpcChannels,
  | "meetBubblePin"
  | "meetBubbleSend"
  | "meetBubbleSetSettingsPanelOpen"
  | "meetBubbleSetSidebarHidden"
  | "meetBubbleShellState"
  | "meetBubbleUnpin"
  | "settingsGet"
  | "settingsUpdate"
  | "updatesGetStatus"
  | "updatesRunHomebrewUpdate"
  | "updatesStatusChanged"
>;

type MeetShellUpdateApi = {
  getUpdateStatus: () => Promise<ApiResult<AppUpdateStatus>>;
  getSettings: () => Promise<ApiResult<AppSettings>>;
  pinBubbleText: (text: string) => Promise<ApiResult<string | undefined>>;
  sendBubbleText: (text: string) => Promise<ApiResult<string | undefined>>;
  setSettingsPanelOpen: (open: boolean) => Promise<ApiResult<void>>;
  setSidebarHidden: (hidden: boolean) => Promise<ApiResult<AppSettings>>;
  unpinBubbleText: () => Promise<ApiResult<void>>;
  updateBubbleSettings: (settings: SettingsUpdate) => Promise<ApiResult<AppSettings>>;
  onShellStateChanged: (listener: (state: CameraBubbleShellState) => void) => () => void;
  runHomebrewUpdate: () => Promise<ApiResult<AppUpdateStatus>>;
  onUpdateStatusChanged: (listener: (status: AppUpdateStatus) => void) => () => void;
};

const updateApi: MeetShellUpdateApi = {
  getUpdateStatus: () =>
    ipcRenderer.invoke(IPC_CHANNELS.updatesGetStatus) as Promise<ApiResult<AppUpdateStatus>>,
  getSettings: () =>
    ipcRenderer.invoke(IPC_CHANNELS.settingsGet) as Promise<ApiResult<AppSettings>>,
  pinBubbleText: (text) =>
    ipcRenderer.invoke(IPC_CHANNELS.meetBubblePin, text) as Promise<ApiResult<string | undefined>>,
  sendBubbleText: (text) =>
    ipcRenderer.invoke(IPC_CHANNELS.meetBubbleSend, text) as Promise<ApiResult<string | undefined>>,
  setSettingsPanelOpen: (open) =>
    ipcRenderer.invoke(IPC_CHANNELS.meetBubbleSetSettingsPanelOpen, open) as Promise<
      ApiResult<void>
    >,
  setSidebarHidden: (hidden) =>
    ipcRenderer.invoke(IPC_CHANNELS.meetBubbleSetSidebarHidden, hidden) as Promise<
      ApiResult<AppSettings>
    >,
  unpinBubbleText: () =>
    ipcRenderer.invoke(IPC_CHANNELS.meetBubbleUnpin) as Promise<ApiResult<void>>,
  updateBubbleSettings: (settings) =>
    ipcRenderer.invoke(IPC_CHANNELS.settingsUpdate, settings) as Promise<ApiResult<AppSettings>>,
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
    const bubbleEnabled = document.getElementById("bubble-enabled");
    const bubbleToggle = document.getElementById("bubble-toggle");
    const bubbleHistory = document.getElementById("bubble-history");
    const bubbleInput = document.getElementById("bubble-input");
    const bubbleMirror = document.getElementById("bubble-mirror");
    const bubblePin = document.getElementById("bubble-pin");
    const bubblePinned = document.getElementById("bubble-pinned");
    const bubblePinnedText = document.getElementById("bubble-pinned-text");
    const bubbleSend = document.getElementById("bubble-send");
    const bubbleSettingsPanel = document.getElementById("bubble-settings-panel");
    const bubbleSettingsToggle = document.getElementById("bubble-settings-toggle");
    const bubbleSidebar = document.getElementById("bubble-sidebar");
    const bubbleSpeed = document.getElementById("bubble-speed");
    const bubbleSpeedValue = document.getElementById("bubble-speed-value");
    const bubbleUnpin = document.getElementById("bubble-unpin");
    if (
      !(button instanceof HTMLButtonElement) ||
      !(bubbleEnabled instanceof HTMLInputElement) ||
      !(bubbleToggle instanceof HTMLButtonElement) ||
      !(bubbleHistory instanceof HTMLOListElement) ||
      !(bubbleInput instanceof HTMLTextAreaElement) ||
      !(bubbleMirror instanceof HTMLInputElement) ||
      !(bubblePin instanceof HTMLButtonElement) ||
      !(bubblePinned instanceof HTMLElement) ||
      !(bubblePinnedText instanceof HTMLElement) ||
      !(bubbleSend instanceof HTMLButtonElement) ||
      !(bubbleSettingsPanel instanceof HTMLElement) ||
      !(bubbleSettingsToggle instanceof HTMLButtonElement) ||
      !(bubbleSidebar instanceof HTMLElement) ||
      !(bubbleSpeed instanceof HTMLInputElement) ||
      !(bubbleSpeedValue instanceof HTMLElement) ||
      !(bubbleUnpin instanceof HTMLButtonElement)
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
        chatMirrorEnabled: false,
        displaySpeedLevel: 3,
        enabled: false,
        sidebarHidden: false,
      },
      settingsPanelOpen: false,
    };
    const renderPinnedText = (text: string | undefined): void => {
      if (text === undefined) {
        bubblePinned.classList.remove("visible");
        bubblePinnedText.textContent = "";
        return;
      }

      bubblePinnedText.textContent = text;
      bubblePinned.classList.add("visible");
    };
    const pinBubbleText = (text: string, clearInput: boolean): void => {
      const trimmedText = text.trim();
      if (trimmedText.length === 0) return;

      api
        .pinBubbleText(text)
        .then((result) => {
          if (!result.ok) return;
          if (result.value === undefined) return;

          renderPinnedText(result.value);
          if (clearInput) {
            bubbleInput.value = "";
          }
        })
        .catch(() => undefined);
    };
    const appendBubbleHistory = (text: string): void => {
      const trimmedText = text.trim();
      if (trimmedText.length === 0) return;

      const item = document.createElement("li");
      const content = document.createElement("span");
      content.className = "bubble-history-text";
      content.textContent = trimmedText;
      const pinButton = document.createElement("button");
      pinButton.className = "bubble-history-pin";
      pinButton.type = "button";
      pinButton.textContent = "Pin";
      pinButton.addEventListener("click", () => {
        pinBubbleText(trimmedText, false);
      });
      item.append(content, pinButton);
      bubbleHistory.append(item);
      bubbleHistory.classList.add("visible");
      bubbleHistory.scrollTop = bubbleHistory.scrollHeight;
    };
    const renderShellState = (state: CameraBubbleShellState): void => {
      shellState.current = {
        chatMirrorEnabled: state.chatMirrorEnabled === true,
        displaySpeedLevel:
          typeof state.displaySpeedLevel === "number" ? state.displaySpeedLevel : 3,
        enabled: state.enabled === true,
        sidebarHidden: state.sidebarHidden === true,
      };
      const current = shellState.current;
      const sidebarVisible = current.enabled && !current.sidebarHidden;
      bubbleSettingsPanel.classList.toggle("open", shellState.settingsPanelOpen);
      bubbleSettingsToggle.setAttribute("aria-expanded", String(shellState.settingsPanelOpen));
      bubbleEnabled.checked = current.enabled;
      bubbleMirror.checked = current.chatMirrorEnabled;
      bubbleMirror.disabled = !current.enabled;
      bubbleSpeed.value = String(current.displaySpeedLevel);
      bubbleSpeedValue.textContent = `${current.displaySpeedLevel} / 5`;
      bubbleToggle.style.display = current.enabled ? "inline-flex" : "none";
      bubbleToggle.textContent = current.sidebarHidden ? "Show panel" : "Hide panel";
      bubbleToggle.setAttribute("aria-expanded", String(sidebarVisible));
      bubbleSidebar.style.display = sidebarVisible ? "flex" : "none";
      bubbleInput.disabled = !current.enabled;
      bubbleSend.disabled = !current.enabled;
      bubblePin.disabled = !current.enabled;
      if (!current.enabled) {
        renderPinnedText(undefined);
      }
      if (!sidebarVisible) {
        bubbleInput.value = "";
      }
    };
    const renderSettings = (settings: AppSettings): void => {
      renderShellState({
        chatMirrorEnabled: settings.cameraBubbleChatMirrorEnabled,
        displaySpeedLevel: settings.cameraBubbleDisplaySpeedLevel,
        enabled: settings.cameraBubbleEnabled,
        sidebarHidden: settings.cameraBubbleSidebarHidden,
      });
    };
    const updateBubbleSettings = (settings: SettingsUpdate): void => {
      api
        .updateBubbleSettings(settings)
        .then((result) => {
          if (result.ok) {
            renderSettings(result.value);
          }
        })
        .catch(() => undefined);
    };
    const sendCurrentBubbleText = (
      send: (text: string) => Promise<ApiResult<string | undefined>>,
    ): void => {
      const value = bubbleInput.value;
      if (value.trim().length === 0) {
        return;
      }

      send(value)
        .then((result) => {
          if (!result.ok) return;
          if (result.value === undefined) return;

          appendBubbleHistory(result.value);
          bubbleInput.value = "";
        })
        .catch(() => undefined);
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
    api
      .getSettings()
      .then((result) => {
        if (result.ok) {
          renderSettings(result.value);
        }
      })
      .catch(() => undefined);

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

    bubbleSettingsToggle.addEventListener("click", () => {
      shellState.settingsPanelOpen = !shellState.settingsPanelOpen;
      renderShellState(shellState.current);
      api.setSettingsPanelOpen(shellState.settingsPanelOpen).catch(() => undefined);
    });

    bubbleEnabled.addEventListener("change", () => {
      updateBubbleSettings({ cameraBubbleEnabled: bubbleEnabled.checked });
    });

    bubbleMirror.addEventListener("change", () => {
      updateBubbleSettings({ cameraBubbleChatMirrorEnabled: bubbleMirror.checked });
    });

    bubbleSpeed.addEventListener("input", () => {
      const displaySpeedLevel = Number(bubbleSpeed.value);
      if (!Number.isFinite(displaySpeedLevel)) return;

      updateBubbleSettings({ cameraBubbleDisplaySpeedLevel: displaySpeedLevel });
    });

    bubbleToggle.addEventListener("click", () => {
      api
        .setSidebarHidden(!shellState.current.sidebarHidden)
        .then((result) => {
          if (result.ok) {
            renderSettings(result.value);
          }
        })
        .catch(() => undefined);
    });

    bubbleSend.addEventListener("click", () => {
      sendCurrentBubbleText(api.sendBubbleText);
    });

    bubblePin.addEventListener("click", () => {
      pinBubbleText(bubbleInput.value, true);
    });

    bubbleUnpin.addEventListener("click", () => {
      api
        .unpinBubbleText()
        .then((result) => {
          if (result.ok) {
            renderPinnedText(undefined);
          }
        })
        .catch(() => undefined);
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
      sendCurrentBubbleText(api.sendBubbleText);
    });
  };

  if (document.readyState === "loading") {
    window.addEventListener("DOMContentLoaded", setup, { once: true });
    return;
  }

  setup();
};

setupMeetShellDom(updateApi);
