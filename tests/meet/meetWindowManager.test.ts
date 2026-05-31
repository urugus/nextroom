import {
  createMeetWindowManager,
  focusMeetWindow,
  type ManagedMeetWindow,
} from "@main/meet/meetWindowManager";
import { ok } from "neverthrow";
import { afterEach, describe, expect, it, vi } from "vitest";

type FakeMeetWindow = ManagedMeetWindow & {
  close: () => void;
  setDestroyed: (value: boolean) => void;
  setMinimized: (value: boolean) => void;
};

const noop = (): void => undefined;

const createFakeMeetWindow = (
  loadURL: (url: string) => Promise<void> = () => Promise.resolve(),
): FakeMeetWindow => {
  let closedListener = noop;
  let destroyed = false;
  let minimized = false;

  return {
    close: () => {
      closedListener();
    },
    destroy: vi.fn(() => {
      destroyed = true;
    }),
    focus: vi.fn(),
    isDestroyed: vi.fn(() => destroyed),
    isMinimized: vi.fn(() => minimized),
    loadURL: vi.fn(loadURL),
    on: vi.fn((_event, listener) => {
      closedListener = listener;
    }),
    restore: vi.fn(() => {
      minimized = false;
    }),
    setAlwaysOnTop: vi.fn(),
    setDestroyed: (value) => {
      destroyed = value;
    },
    setMinimized: (value) => {
      minimized = value;
    },
    show: vi.fn(),
  };
};

afterEach(() => {
  vi.useRealTimers();
});

describe("focusMeetWindow", () => {
  it("shows, restores, focuses, and temporarily enables always-on-top", () => {
    vi.useFakeTimers();
    const meetWindow = createFakeMeetWindow();
    const focusApp = vi.fn();
    meetWindow.setMinimized(true);

    focusMeetWindow(meetWindow, focusApp);

    expect(focusApp).toHaveBeenCalledTimes(1);
    expect(meetWindow.restore).toHaveBeenCalledTimes(1);
    expect(meetWindow.show).toHaveBeenCalledTimes(1);
    expect(meetWindow.setAlwaysOnTop).toHaveBeenCalledWith(true, "screen-saver");
    expect(meetWindow.focus).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1_200);

    expect(meetWindow.setAlwaysOnTop).toHaveBeenLastCalledWith(false);
  });
});

describe("createMeetWindowManager", () => {
  it("loads the canonical Meet URL and focuses the created window", async () => {
    const meetWindow = createFakeMeetWindow();
    const createWindow = vi.fn(() => ok(meetWindow));
    const focusApp = vi.fn();
    const manager = createMeetWindowManager({ createWindow, focusApp });

    const result = await manager.openMeetUrl("https://meet.google.com/abc-defg-hij?authuser=0");

    expect(result.isOk()).toBe(true);
    expect(createWindow).toHaveBeenCalledTimes(1);
    expect(focusApp).toHaveBeenCalledTimes(1);
    expect(meetWindow.loadURL).toHaveBeenCalledWith("https://meet.google.com/abc-defg-hij");
    expect(meetWindow.focus).toHaveBeenCalledTimes(1);
  });

  it("reuses and focuses an existing window for the same Meet URL", async () => {
    const meetWindow = createFakeMeetWindow();
    const createWindow = vi.fn(() => ok(meetWindow));
    const manager = createMeetWindowManager({ createWindow });

    await manager.openMeetUrl("https://meet.google.com/abc-defg-hij");
    await manager.openMeetUrl("https://meet.google.com/abc-defg-hij?authuser=0");

    expect(createWindow).toHaveBeenCalledTimes(1);
    expect(meetWindow.loadURL).toHaveBeenCalledTimes(1);
    expect(meetWindow.focus).toHaveBeenCalledTimes(2);
  });

  it("forgets a window after it closes", async () => {
    const firstWindow = createFakeMeetWindow();
    const secondWindow = createFakeMeetWindow();
    const createWindow = vi
      .fn()
      .mockReturnValueOnce(ok(firstWindow))
      .mockReturnValueOnce(ok(secondWindow));
    const manager = createMeetWindowManager({ createWindow });

    await manager.openMeetUrl("https://meet.google.com/abc-defg-hij");
    firstWindow.close();
    await manager.openMeetUrl("https://meet.google.com/abc-defg-hij");

    expect(createWindow).toHaveBeenCalledTimes(2);
    expect(secondWindow.loadURL).toHaveBeenCalledWith("https://meet.google.com/abc-defg-hij");
  });

  it("destroys and forgets a window when loading fails", async () => {
    const failingWindow = createFakeMeetWindow(() => Promise.reject(new Error("network error")));
    const retryWindow = createFakeMeetWindow();
    const createWindow = vi
      .fn()
      .mockReturnValueOnce(ok(failingWindow))
      .mockReturnValueOnce(ok(retryWindow));
    const manager = createMeetWindowManager({ createWindow });

    const result = await manager.openMeetUrl("https://meet.google.com/abc-defg-hij");
    await manager.openMeetUrl("https://meet.google.com/abc-defg-hij");

    expect(result._unsafeUnwrapErr()).toMatchObject({ type: "MeetWindowFailed" });
    expect(failingWindow.destroy).toHaveBeenCalledTimes(1);
    expect(createWindow).toHaveBeenCalledTimes(2);
    expect(retryWindow.loadURL).toHaveBeenCalledWith("https://meet.google.com/abc-defg-hij");
  });
});
