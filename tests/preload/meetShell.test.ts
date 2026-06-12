import { beforeEach, describe, expect, it, vi } from "vitest";
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
    <input id="bubble-input" type="text">
    <button id="update-button" type="button">Update</button>
  `;
};

const importMeetShell = async (): Promise<void> => {
  await import("../../src/preload/meetShell");
  window.dispatchEvent(new Event("DOMContentLoaded"));
};

describe("meet shell preload", () => {
  let channelListeners: Map<string, (...args: unknown[]) => void>;

  beforeEach(() => {
    vi.resetModules();
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

  it("toggles the bubble input display from enabledChanged", async () => {
    await importMeetShell();
    const bubbleInput = document.getElementById("bubble-input") as HTMLInputElement;

    channelListeners.get("meetBubble:enabledChanged")?.({}, true);
    expect(bubbleInput.style.display).toBe("block");

    bubbleInput.value = "hello";
    channelListeners.get("meetBubble:enabledChanged")?.({}, false);
    expect(bubbleInput.style.display).toBe("none");
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
});
