import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiResult, SettingsUpdate } from "../../src/shared/ipc";
import type { AppSettings, AppUpdateStatus, CameraBubbleShellState } from "../../src/shared/types";

const electronMocks = vi.hoisted(() => ({
  exposeInMainWorld: vi.fn(),
  invoke: vi.fn(),
  on: vi.fn(),
  removeListener: vi.fn(),
}));

vi.mock("electron", () => ({
  contextBridge: {
    exposeInMainWorld: electronMocks.exposeInMainWorld,
  },
  ipcRenderer: {
    invoke: electronMocks.invoke,
    on: electronMocks.on,
    removeListener: electronMocks.removeListener,
  },
}));

const updateStatus = (status: AppUpdateStatus["status"]): AppUpdateStatus => ({
  canCheck: true,
  canRunHomebrewUpdate: true,
  currentVersion: "0.1.33",
  status,
});

const settings: AppSettings = {
  autoJoinEnabled: false,
  autoOpenEnabled: true,
  cameraBubbleChatMirrorEnabled: false,
  cameraBubbleEnabled: true,
  cameraBubbleSidebarHidden: false,
  cameraBubbleDisplaySpeedLevel: 3,
  joinOffsetSeconds: 0,
  notifyBeforeMinutes: 1,
  openOffsetSeconds: 0,
  menuShortcutAccelerator: "Command+Alt+N",
  launchAtLogin: false,
  calendarId: "primary",
  timezone: "Asia/Tokyo",
};

const renderMeetShellDom = (): void => {
  document.body.innerHTML = `
    <div id="bubble-settings-panel">
      <input type="checkbox" id="bubble-enabled">
      <input type="checkbox" id="bubble-mirror">
      <input type="range" id="bubble-speed">
      <span id="bubble-speed-value"></span>
    </div>
    <aside id="bubble-sidebar">
      <div id="bubble-pinned">
        <span id="bubble-pinned-text"></span>
        <button id="bubble-unpin" type="button">Unpin</button>
      </div>
      <ol id="bubble-history"></ol>
      <textarea id="bubble-input"></textarea>
      <button id="bubble-send" type="button">Send</button>
      <button id="bubble-pin" type="button">Pin</button>
    </aside>
    <button id="bubble-settings-toggle" type="button">Bubble</button>
    <button id="bubble-toggle" type="button">Hide panel</button>
    <button id="update-button" type="button">Update</button>
  `;
};

type MeetShellTestApi = {
  getUpdateStatus: () => Promise<ApiResult<AppUpdateStatus>>;
  getSettings: () => Promise<ApiResult<AppSettings>>;
  pinBubbleText: (text: string) => Promise<ApiResult<string | undefined>>;
  sendBubbleText: (text: string) => Promise<ApiResult<string | undefined>>;
  setSidebarHidden: (hidden: boolean) => Promise<ApiResult<AppSettings>>;
  unpinBubbleText: () => Promise<ApiResult<void>>;
  updateBubbleSettings: (settings: SettingsUpdate) => Promise<ApiResult<AppSettings>>;
  onShellStateChanged: (listener: (state: CameraBubbleShellState) => void) => () => void;
  runHomebrewUpdate: () => Promise<ApiResult<AppUpdateStatus>>;
  onUpdateStatusChanged: (listener: (status: AppUpdateStatus) => void) => () => void;
};

const createMeetShellApi = (overrides: Partial<MeetShellTestApi> = {}): MeetShellTestApi => ({
  ...baseMeetShellApi,
  ...overrides,
});

const baseMeetShellApi: MeetShellTestApi = {
  getUpdateStatus: vi.fn(() => Promise.resolve({ ok: true as const, value: updateStatus("idle") })),
  getSettings: vi.fn(() => Promise.resolve({ ok: true as const, value: settings })),
  onShellStateChanged: vi.fn(() => vi.fn()),
  onUpdateStatusChanged: vi.fn(() => vi.fn()),
  pinBubbleText: vi.fn((text: string) => Promise.resolve({ ok: true as const, value: text })),
  runHomebrewUpdate: vi.fn(() =>
    Promise.resolve({ ok: true as const, value: updateStatus("homebrew-updated") }),
  ),
  sendBubbleText: vi.fn((text: string) => Promise.resolve({ ok: true as const, value: text })),
  setSidebarHidden: vi.fn(() => Promise.resolve({ ok: true as const, value: settings })),
  unpinBubbleText: vi.fn(() => Promise.resolve({ ok: true as const, value: undefined })),
  updateBubbleSettings: vi.fn((nextSettings) =>
    Promise.resolve({ ok: true as const, value: { ...settings, ...nextSettings } }),
  ),
};

const importMeetShell = async (): Promise<void> => {
  await import("../../src/preload/meetShell");
  window.dispatchEvent(new Event("DOMContentLoaded"));
};

describe("meet shell preload", () => {
  let channelListeners: Map<string, (...args: unknown[]) => void>;

  beforeEach(() => {
    vi.resetModules();
    Object.defineProperty(document, "readyState", {
      configurable: true,
      value: "complete",
    });
    electronMocks.exposeInMainWorld.mockReset();
    electronMocks.invoke.mockReset();
    electronMocks.on.mockReset();
    electronMocks.removeListener.mockReset();
    Object.values(baseMeetShellApi).forEach((value) => {
      if (vi.isMockFunction(value)) {
        value.mockClear();
      }
    });
    channelListeners = new Map();

    electronMocks.invoke.mockImplementation((channel: string, payload?: unknown) => {
      if (channel === "updates:getStatus") {
        return Promise.resolve({ ok: true as const, value: updateStatus("idle") });
      }
      if (channel === "updates:runHomebrewUpdate") {
        return Promise.resolve({ ok: true as const, value: updateStatus("homebrew-updated") });
      }
      if (channel === "settings:get") {
        return Promise.resolve({ ok: true as const, value: settings });
      }
      if (channel === "settings:update") {
        const updates = typeof payload === "object" && payload !== null ? payload : {};
        return Promise.resolve({ ok: true as const, value: { ...settings, ...updates } });
      }
      if (channel === "meetBubble:pin") {
        return Promise.resolve({ ok: true as const, value: payload });
      }
      if (channel === "meetBubble:send") {
        return Promise.resolve({ ok: true as const, value: payload });
      }
      if (channel === "meetBubble:setSidebarHidden") {
        return Promise.resolve({ ok: true as const, value: settings });
      }
      if (channel === "meetBubble:unpin") {
        return Promise.resolve({ ok: true as const, value: undefined });
      }

      return Promise.resolve({
        error: {
          code: "UNKNOWN_CHANNEL",
          message: `Unexpected channel: ${channel}`,
        },
        ok: false as const,
      });
    });
    electronMocks.on.mockImplementation(
      (channel: string, listener: (...args: unknown[]) => void) => {
        channelListeners.set(channel, listener);
      },
    );
    renderMeetShellDom();
  });

  it("renders enabled visible shell state with the hide button", async () => {
    await importMeetShell();
    const bubbleSidebar = document.getElementById("bubble-sidebar") as HTMLElement;
    const bubbleToggle = document.getElementById("bubble-toggle") as HTMLButtonElement;

    channelListeners.get("meetBubble:shellState")?.(
      {},
      {
        chatMirrorEnabled: false,
        displaySpeedLevel: 3,
        enabled: true,
        sidebarHidden: false,
      },
    );

    expect(bubbleSidebar.style.display).toBe("flex");
    expect(bubbleToggle.style.display).toBe("inline-flex");
    expect(bubbleToggle.textContent).toBe("Hide panel");
    expect(bubbleToggle).toHaveAttribute("aria-expanded", "true");
  });

  it("renders enabled hidden shell state and clears the input", async () => {
    await importMeetShell();
    const bubbleHistory = document.getElementById("bubble-history") as HTMLOListElement;
    const bubbleSidebar = document.getElementById("bubble-sidebar") as HTMLElement;
    const bubbleInput = document.getElementById("bubble-input") as HTMLTextAreaElement;
    const bubbleToggle = document.getElementById("bubble-toggle") as HTMLButtonElement;

    const historyItem = document.createElement("li");
    historyItem.textContent = "sent before hiding";
    bubbleHistory.append(historyItem);
    bubbleInput.value = "hello";
    channelListeners.get("meetBubble:shellState")?.(
      {},
      {
        chatMirrorEnabled: false,
        displaySpeedLevel: 3,
        enabled: true,
        sidebarHidden: true,
      },
    );

    expect(bubbleSidebar.style.display).toBe("none");
    expect(bubbleHistory).toHaveTextContent("sent before hiding");
    expect(bubbleInput.value).toBe("");
    expect(bubbleToggle.style.display).toBe("inline-flex");
    expect(bubbleToggle.textContent).toBe("Show panel");
    expect(bubbleToggle).toHaveAttribute("aria-expanded", "false");
  });

  it("hides the sidebar and toggle when camera bubble is disabled", async () => {
    await importMeetShell();
    const bubbleSidebar = document.getElementById("bubble-sidebar") as HTMLElement;
    const bubbleInput = document.getElementById("bubble-input") as HTMLTextAreaElement;
    const bubbleToggle = document.getElementById("bubble-toggle") as HTMLButtonElement;

    bubbleInput.value = "hello";
    channelListeners.get("meetBubble:shellState")?.(
      {},
      {
        chatMirrorEnabled: false,
        displaySpeedLevel: 3,
        enabled: false,
        sidebarHidden: false,
      },
    );

    expect(bubbleSidebar.style.display).toBe("none");
    expect(bubbleInput.value).toBe("");
    expect(bubbleToggle.style.display).toBe("none");
    expect(bubbleToggle).toHaveAttribute("aria-expanded", "false");
  });

  it("invokes sidebar visibility updates with the toggled value", async () => {
    await importMeetShell();
    const bubbleToggle = document.getElementById("bubble-toggle") as HTMLButtonElement;

    channelListeners.get("meetBubble:shellState")?.(
      {},
      {
        chatMirrorEnabled: false,
        displaySpeedLevel: 3,
        enabled: true,
        sidebarHidden: false,
      },
    );
    bubbleToggle.click();

    expect(electronMocks.invoke).toHaveBeenCalledWith("meetBubble:setSidebarHidden", true);
  });

  it("opens bubble settings and updates camera bubble settings from the Meet shell", async () => {
    await importMeetShell();
    const bubbleEnabled = document.getElementById("bubble-enabled") as HTMLInputElement;
    const bubbleMirror = document.getElementById("bubble-mirror") as HTMLInputElement;
    const bubbleSettingsPanel = document.getElementById("bubble-settings-panel") as HTMLElement;
    const bubbleSettingsToggle = document.getElementById(
      "bubble-settings-toggle",
    ) as HTMLButtonElement;
    const bubbleSpeed = document.getElementById("bubble-speed") as HTMLInputElement;
    const bubbleSpeedValue = document.getElementById("bubble-speed-value") as HTMLElement;

    bubbleSettingsToggle.click();
    expect(bubbleSettingsPanel).toHaveClass("open");
    expect(bubbleSettingsToggle).toHaveAttribute("aria-expanded", "true");

    bubbleEnabled.checked = true;
    bubbleEnabled.dispatchEvent(new Event("change", { bubbles: true }));
    bubbleMirror.checked = true;
    bubbleMirror.dispatchEvent(new Event("change", { bubbles: true }));
    bubbleSpeed.value = "5";
    bubbleSpeed.dispatchEvent(new Event("input", { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();

    expect(electronMocks.invoke).toHaveBeenCalledWith("settings:update", {
      cameraBubbleEnabled: true,
    });
    expect(electronMocks.invoke).toHaveBeenCalledWith("settings:update", {
      cameraBubbleChatMirrorEnabled: true,
    });
    expect(electronMocks.invoke).toHaveBeenCalledWith("settings:update", {
      cameraBubbleDisplaySpeedLevel: 5,
    });
    expect(bubbleSpeedValue).toHaveTextContent("5 / 5");
  });

  it("contains rejected sidebar visibility updates", async () => {
    document.body.innerHTML = "";
    const { setupMeetShellDom } = await import("../../src/preload/meetShell");
    const api = createMeetShellApi({
      setSidebarHidden: vi.fn(() => Promise.reject(new Error("channel unavailable"))),
    });
    renderMeetShellDom();
    setupMeetShellDom(api);
    const bubbleToggle = document.getElementById("bubble-toggle") as HTMLButtonElement;

    bubbleToggle.click();
    await Promise.resolve();

    expect(api.setSidebarHidden).toHaveBeenCalledWith(true);
  });

  it("sends non-empty Enter text and clears the input", async () => {
    await importMeetShell();
    const bubbleHistory = document.getElementById("bubble-history") as HTMLOListElement;
    const bubbleInput = document.getElementById("bubble-input") as HTMLTextAreaElement;

    bubbleInput.value = "hello";
    bubbleInput.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
    await Promise.resolve();
    await Promise.resolve();

    expect(electronMocks.invoke).toHaveBeenCalledWith("meetBubble:send", "hello");
    expect(bubbleHistory).toHaveTextContent("hello");
    expect(bubbleHistory).toHaveClass("visible");
    expect(bubbleInput.value).toBe("");
  });

  it("pins non-empty bubble text until unpinned and clears the input", async () => {
    await importMeetShell();
    const bubbleInput = document.getElementById("bubble-input") as HTMLTextAreaElement;
    const bubblePin = document.getElementById("bubble-pin") as HTMLButtonElement;
    const bubblePinned = document.getElementById("bubble-pinned") as HTMLElement;
    const bubblePinnedText = document.getElementById("bubble-pinned-text") as HTMLElement;
    const bubbleUnpin = document.getElementById("bubble-unpin") as HTMLButtonElement;

    bubbleInput.value = "keep this visible";
    bubblePin.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(electronMocks.invoke).toHaveBeenCalledWith("meetBubble:pin", "keep this visible");
    expect(bubblePinned).toHaveClass("visible");
    expect(bubblePinnedText).toHaveTextContent("keep this visible");
    expect(bubbleInput.value).toBe("");

    bubbleUnpin.click();
    await Promise.resolve();

    expect(electronMocks.invoke).toHaveBeenCalledWith("meetBubble:unpin");
    expect(bubblePinned).not.toHaveClass("visible");
    expect(bubblePinnedText).toHaveTextContent("");
  });

  it("pins a specific sent history comment without changing the input", async () => {
    await importMeetShell();
    const bubbleHistory = document.getElementById("bubble-history") as HTMLOListElement;
    const bubbleInput = document.getElementById("bubble-input") as HTMLTextAreaElement;
    const bubblePinnedText = document.getElementById("bubble-pinned-text") as HTMLElement;

    bubbleInput.value = "first";
    bubbleInput.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
    await Promise.resolve();
    await Promise.resolve();
    bubbleInput.value = "draft";

    const historyPin = bubbleHistory.querySelector(".bubble-history-pin");
    expect(historyPin).toBeInstanceOf(HTMLButtonElement);
    historyPin?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();

    expect(electronMocks.invoke).toHaveBeenCalledWith("meetBubble:pin", "first");
    expect(bubblePinnedText).toHaveTextContent("first");
    expect(bubbleInput.value).toBe("draft");
  });

  it("records sanitized accepted bubble text returned by main", async () => {
    document.body.innerHTML = "";
    const { setupMeetShellDom } = await import("../../src/preload/meetShell");
    const api = createMeetShellApi({
      sendBubbleText: vi.fn(() =>
        Promise.resolve({ ok: true as const, value: "hello world".repeat(10).slice(0, 100) }),
      ),
    });
    renderMeetShellDom();
    setupMeetShellDom(api);
    const bubbleHistory = document.getElementById("bubble-history") as HTMLOListElement;
    const bubbleInput = document.getElementById("bubble-input") as HTMLTextAreaElement;

    bubbleInput.value = "  hello\nworld".repeat(12);
    bubbleInput.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
    await Promise.resolve();
    await Promise.resolve();

    expect(api.sendBubbleText).toHaveBeenCalledWith("  hello\nworld".repeat(12));
    expect(bubbleHistory).toHaveTextContent("hello world".repeat(10).slice(0, 100));
    expect(bubbleInput.value).toBe("");
  });

  it("keeps rate-limited bubble sends out of history and preserves the input", async () => {
    document.body.innerHTML = "";
    const { setupMeetShellDom } = await import("../../src/preload/meetShell");
    const api = createMeetShellApi({
      sendBubbleText: vi.fn(() => Promise.resolve({ ok: true as const, value: undefined })),
    });
    renderMeetShellDom();
    setupMeetShellDom(api);
    const bubbleHistory = document.getElementById("bubble-history") as HTMLOListElement;
    const bubbleInput = document.getElementById("bubble-input") as HTMLTextAreaElement;

    bubbleInput.value = "hello";
    bubbleInput.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
    await Promise.resolve();
    await Promise.resolve();

    expect(api.sendBubbleText).toHaveBeenCalledWith("hello");
    expect(bubbleHistory.childElementCount).toBe(0);
    expect(bubbleHistory).not.toHaveClass("visible");
    expect(bubbleInput.value).toBe("hello");
  });

  it("keeps Shift+Enter available for multiline bubble text", async () => {
    await importMeetShell();
    const bubbleInput = document.getElementById("bubble-input") as HTMLTextAreaElement;
    const event = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "Enter",
      shiftKey: true,
    });

    bubbleInput.value = "hello";
    bubbleInput.dispatchEvent(event);
    await Promise.resolve();

    expect(electronMocks.invoke).not.toHaveBeenCalledWith("meetBubble:send", "hello");
    expect(event.defaultPrevented).toBe(false);
    expect(bubbleInput.value).toBe("hello");
  });

  it("keeps failed bubble sends out of history and preserves the input", async () => {
    document.body.innerHTML = "";
    const { setupMeetShellDom } = await import("../../src/preload/meetShell");
    const api = createMeetShellApi({
      sendBubbleText: vi.fn(() =>
        Promise.resolve({
          ok: false as const,
          error: {
            message: "Send failed",
            recoverable: true,
            type: "DatabaseFailed" as const,
          },
        }),
      ),
    });
    renderMeetShellDom();
    setupMeetShellDom(api);
    const bubbleHistory = document.getElementById("bubble-history") as HTMLOListElement;
    const bubbleInput = document.getElementById("bubble-input") as HTMLTextAreaElement;

    bubbleInput.value = "hello";
    bubbleInput.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
    await Promise.resolve();
    await Promise.resolve();

    expect(api.sendBubbleText).toHaveBeenCalledWith("hello");
    expect(bubbleHistory.childElementCount).toBe(0);
    expect(bubbleHistory).not.toHaveClass("visible");
    expect(bubbleInput.value).toBe("hello");
  });

  it("does not send composing Enter text", async () => {
    await importMeetShell();
    const bubbleInput = document.getElementById("bubble-input") as HTMLTextAreaElement;
    const event = new KeyboardEvent("keydown", { bubbles: true, key: "Enter" });
    Object.defineProperty(event, "isComposing", {
      configurable: true,
      value: true,
    });

    bubbleInput.value = "hello";
    bubbleInput.dispatchEvent(event);
    await Promise.resolve();

    expect(electronMocks.invoke).not.toHaveBeenCalledWith("meetBubble:send", "hello");
    expect(bubbleInput.value).toBe("hello");
  });

  it("exposes update APIs that subscribe and unsubscribe from IPC channels", async () => {
    await importMeetShell();
    const exposedApi = electronMocks.exposeInMainWorld.mock.calls.at(0)?.[1];
    const bubbleListener = vi.fn();
    const updateListener = vi.fn();

    const unsubscribeBubble = exposedApi.onShellStateChanged(bubbleListener);
    const unsubscribeUpdate = exposedApi.onUpdateStatusChanged(updateListener);

    const shellState: CameraBubbleShellState = {
      chatMirrorEnabled: true,
      displaySpeedLevel: 4,
      enabled: true,
      sidebarHidden: true,
    };

    channelListeners.get("meetBubble:shellState")?.({}, shellState);
    channelListeners.get("updates:status-changed")?.({}, updateStatus("available"));
    unsubscribeBubble();
    unsubscribeUpdate();

    expect(bubbleListener).toHaveBeenCalledWith(shellState);
    expect(updateListener).toHaveBeenCalledWith(updateStatus("available"));
    expect(electronMocks.removeListener).toHaveBeenCalledWith(
      "meetBubble:shellState",
      expect.any(Function),
    );
    expect(electronMocks.removeListener).toHaveBeenCalledWith(
      "updates:status-changed",
      expect.any(Function),
    );
  });

  it("skips DOM setup when required elements are missing", async () => {
    const { setupMeetShellDom } = await import("../../src/preload/meetShell");
    const api = createMeetShellApi();
    document.body.innerHTML = "";

    setupMeetShellDom(api);

    expect(api.getUpdateStatus).not.toHaveBeenCalled();
    expect(api.onUpdateStatusChanged).not.toHaveBeenCalled();
    expect(api.onShellStateChanged).not.toHaveBeenCalled();
  });

  it("skips DOM setup when the bubble toggle is missing", async () => {
    const { setupMeetShellDom } = await import("../../src/preload/meetShell");
    const api = createMeetShellApi();
    document.body.innerHTML = `
      <aside id="bubble-sidebar">
        <ol id="bubble-history"></ol>
        <textarea id="bubble-input"></textarea>
      </aside>
      <button id="update-button" type="button">Update</button>
    `;

    setupMeetShellDom(api);

    expect(api.getUpdateStatus).not.toHaveBeenCalled();
    expect(api.onUpdateStatusChanged).not.toHaveBeenCalled();
    expect(api.onShellStateChanged).not.toHaveBeenCalled();
  });

  it("defers DOM setup until DOMContentLoaded while the document is loading", async () => {
    const { setupMeetShellDom } = await import("../../src/preload/meetShell");
    const api = createMeetShellApi({
      getUpdateStatus: vi.fn(() =>
        Promise.resolve({ ok: true as const, value: updateStatus("available") }),
      ),
    });
    Object.defineProperty(document, "readyState", {
      configurable: true,
      value: "loading",
    });
    renderMeetShellDom();

    setupMeetShellDom(api);
    expect(api.getUpdateStatus).not.toHaveBeenCalled();

    window.dispatchEvent(new Event("DOMContentLoaded"));
    await Promise.resolve();

    expect(api.getUpdateStatus).toHaveBeenCalledTimes(1);
    expect(document.getElementById("update-button")).toHaveStyle({ display: "inline-flex" });
  });

  it("renders update availability and resets the button when update IPC fails", async () => {
    const { setupMeetShellDom } = await import("../../src/preload/meetShell");
    const api = createMeetShellApi({
      getUpdateStatus: vi.fn(() =>
        Promise.resolve({ ok: true as const, value: updateStatus("available") }),
      ),
      runHomebrewUpdate: vi.fn(() =>
        Promise.resolve({
          ok: false as const,
          error: {
            message: "Homebrew update failed",
            recoverable: true,
            type: "UpdateFailed" as const,
          },
        }),
      ),
    });
    setupMeetShellDom(api);
    await Promise.resolve();
    const button = document.getElementById("update-button") as HTMLButtonElement;

    expect(button.style.display).toBe("inline-flex");
    button.click();
    await Promise.resolve();

    expect(button.disabled).toBe(false);
    expect(button.textContent).toBe("Update");
  });

  it("ignores unavailable initial update status", async () => {
    const { setupMeetShellDom } = await import("../../src/preload/meetShell");
    const api = createMeetShellApi({
      getUpdateStatus: vi.fn(() => Promise.reject(new Error("bridge unavailable"))),
    });
    setupMeetShellDom(api);
    await Promise.resolve();

    expect(api.getUpdateStatus).toHaveBeenCalledTimes(1);
    expect(document.getElementById("update-button")).toHaveStyle({ display: "none" });
  });

  it("ignores non-keyboard keydown events on the bubble input", async () => {
    const { setupMeetShellDom } = await import("../../src/preload/meetShell");
    const api = createMeetShellApi();
    setupMeetShellDom(api);
    const bubbleInput = document.getElementById("bubble-input") as HTMLTextAreaElement;

    bubbleInput.value = "hello";
    bubbleInput.dispatchEvent(new Event("keydown", { bubbles: true }));

    expect(api.sendBubbleText).not.toHaveBeenCalled();
    expect(bubbleInput.value).toBe("hello");
  });

  it("resets the update button when update IPC rejects", async () => {
    const { setupMeetShellDom } = await import("../../src/preload/meetShell");
    const api = createMeetShellApi({
      getUpdateStatus: vi.fn(() =>
        Promise.resolve({ ok: true as const, value: updateStatus("available") }),
      ),
      runHomebrewUpdate: vi.fn(() => Promise.reject(new Error("spawn failed"))),
    });
    setupMeetShellDom(api);
    await Promise.resolve();
    const button = document.getElementById("update-button") as HTMLButtonElement;

    button.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(button.disabled).toBe(false);
    expect(button.textContent).toBe("Update");
  });

  it("ignores blank and non-Enter bubble input", async () => {
    const { setupMeetShellDom } = await import("../../src/preload/meetShell");
    const api = createMeetShellApi();
    setupMeetShellDom(api);
    const bubbleInput = document.getElementById("bubble-input") as HTMLTextAreaElement;

    bubbleInput.value = "   ";
    bubbleInput.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
    bubbleInput.value = "hello";
    bubbleInput.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Tab" }));

    expect(api.sendBubbleText).not.toHaveBeenCalled();
    expect(bubbleInput.value).toBe("hello");
  });
});
