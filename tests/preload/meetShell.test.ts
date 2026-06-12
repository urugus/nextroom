import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiResult } from "../../src/shared/ipc";
import type { AppUpdateStatus } from "../../src/shared/types";

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

const renderMeetShellDom = (): void => {
  document.body.innerHTML = `
    <aside id="bubble-sidebar">
      <input id="bubble-input" type="text">
    </aside>
    <button id="update-button" type="button">Update</button>
  `;
};

type MeetShellTestApi = {
  getUpdateStatus: () => Promise<ApiResult<AppUpdateStatus>>;
  sendBubbleText: (text: string) => Promise<ApiResult<void>>;
  onBubbleEnabledChanged: (listener: (enabled: boolean) => void) => () => void;
  runHomebrewUpdate: () => Promise<ApiResult<AppUpdateStatus>>;
  onUpdateStatusChanged: (listener: (status: AppUpdateStatus) => void) => () => void;
};

const createMeetShellApi = (overrides: Partial<MeetShellTestApi> = {}): MeetShellTestApi => ({
  ...baseMeetShellApi,
  ...overrides,
});

const baseMeetShellApi: MeetShellTestApi = {
  getUpdateStatus: vi.fn(() => Promise.resolve({ ok: true as const, value: updateStatus("idle") })),
  onBubbleEnabledChanged: vi.fn(() => vi.fn()),
  onUpdateStatusChanged: vi.fn(() => vi.fn()),
  runHomebrewUpdate: vi.fn(() =>
    Promise.resolve({ ok: true as const, value: updateStatus("homebrew-updated") }),
  ),
  sendBubbleText: vi.fn(() => Promise.resolve({ ok: true as const, value: undefined })),
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
    channelListeners = new Map();

    electronMocks.invoke.mockImplementation((channel: string) => {
      if (channel === "updates:getStatus") {
        return Promise.resolve({ ok: true as const, value: updateStatus("idle") });
      }
      if (channel === "updates:runHomebrewUpdate") {
        return Promise.resolve({ ok: true as const, value: updateStatus("homebrew-updated") });
      }
      if (channel === "meetBubble:send") {
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

  it("toggles the bubble sidebar display from enabledChanged", async () => {
    await importMeetShell();
    const bubbleSidebar = document.getElementById("bubble-sidebar") as HTMLElement;
    const bubbleInput = document.getElementById("bubble-input") as HTMLInputElement;

    channelListeners.get("meetBubble:enabledChanged")?.({}, true);
    expect(bubbleSidebar.style.display).toBe("flex");

    bubbleInput.value = "hello";
    channelListeners.get("meetBubble:enabledChanged")?.({}, false);
    expect(bubbleSidebar.style.display).toBe("none");
    expect(bubbleInput.value).toBe("");
  });

  it("sends non-empty Enter text and clears the input", async () => {
    await importMeetShell();
    const bubbleInput = document.getElementById("bubble-input") as HTMLInputElement;

    bubbleInput.value = "hello";
    bubbleInput.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
    await Promise.resolve();

    expect(electronMocks.invoke).toHaveBeenCalledWith("meetBubble:send", "hello");
    expect(bubbleInput.value).toBe("");
  });

  it("does not send composing Enter text", async () => {
    await importMeetShell();
    const bubbleInput = document.getElementById("bubble-input") as HTMLInputElement;
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

    const unsubscribeBubble = exposedApi.onBubbleEnabledChanged(bubbleListener);
    const unsubscribeUpdate = exposedApi.onUpdateStatusChanged(updateListener);

    channelListeners.get("meetBubble:enabledChanged")?.({}, true);
    channelListeners.get("updates:status-changed")?.({}, updateStatus("available"));
    unsubscribeBubble();
    unsubscribeUpdate();

    expect(bubbleListener).toHaveBeenCalledWith(true);
    expect(updateListener).toHaveBeenCalledWith(updateStatus("available"));
    expect(electronMocks.removeListener).toHaveBeenCalledWith(
      "meetBubble:enabledChanged",
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
    expect(api.onBubbleEnabledChanged).not.toHaveBeenCalled();
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
    const bubbleInput = document.getElementById("bubble-input") as HTMLInputElement;

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
    const bubbleInput = document.getElementById("bubble-input") as HTMLInputElement;

    bubbleInput.value = "   ";
    bubbleInput.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
    bubbleInput.value = "hello";
    bubbleInput.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Tab" }));

    expect(api.sendBubbleText).not.toHaveBeenCalled();
    expect(bubbleInput.value).toBe("hello");
  });
});
