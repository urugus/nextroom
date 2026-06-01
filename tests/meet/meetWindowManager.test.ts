import {
  configureMeetSessionPermissions,
  isAllowedMeetPermission,
  isMeetOrigin,
} from "@main/meet/meetSessionPermissions";
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
type FakeWebContents = {
  getURL: () => string;
};
type PermissionCheckHandler = Parameters<FakeSession["setPermissionCheckHandler"]>[0];
type PermissionRequestHandler = Parameters<FakeSession["setPermissionRequestHandler"]>[0];
type FakeSession = {
  setPermissionCheckHandler: (
    handler: (
      webContents: FakeWebContents | null,
      permission: string,
      requestingOrigin: string,
      details: {
        securityOrigin?: string;
        requestingUrl?: string;
        isMainFrame: boolean;
      },
    ) => boolean,
  ) => void;
  setPermissionRequestHandler: (
    handler: (
      webContents: FakeWebContents,
      permission: string,
      callback: (permissionGranted: boolean) => void,
      details: {
        securityOrigin?: string;
        requestingUrl: string;
        isMainFrame: boolean;
      },
    ) => void,
  ) => void;
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

const createFakeSession = () => {
  let permissionCheckHandler: PermissionCheckHandler | undefined;
  let permissionRequestHandler: PermissionRequestHandler | undefined;

  const session: FakeSession = {
    setPermissionCheckHandler: vi.fn((handler) => {
      permissionCheckHandler = handler;
    }),
    setPermissionRequestHandler: vi.fn((handler) => {
      permissionRequestHandler = handler;
    }),
  };

  return {
    check: (
      permission: string,
      requestingOrigin: string,
      details: {
        securityOrigin?: string;
        requestingUrl?: string;
        isMainFrame: boolean;
      } = { isMainFrame: true },
    ) => {
      if (permissionCheckHandler === undefined) {
        throw new Error("Permission check handler was not configured.");
      }

      return permissionCheckHandler(
        { getURL: () => "https://meet.google.com/abc-defg-hij" },
        permission,
        requestingOrigin,
        details,
      );
    },
    request: (
      permission: string,
      details: {
        securityOrigin?: string;
        requestingUrl: string;
        isMainFrame: boolean;
      },
      webContentsUrl = "https://meet.google.com/abc-defg-hij",
    ) => {
      if (permissionRequestHandler === undefined) {
        throw new Error("Permission request handler was not configured.");
      }

      let granted = false;
      permissionRequestHandler(
        { getURL: () => webContentsUrl },
        permission,
        (permissionGranted) => {
          granted = permissionGranted;
        },
        details,
      );
      return granted;
    },
    session,
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

  it("keeps always-on-top active for the full duration after the latest focus", () => {
    vi.useFakeTimers();
    const meetWindow = createFakeMeetWindow();

    focusMeetWindow(meetWindow);
    vi.advanceTimersByTime(600);
    focusMeetWindow(meetWindow);
    vi.advanceTimersByTime(600);

    expect(meetWindow.setAlwaysOnTop).not.toHaveBeenCalledWith(false);

    vi.advanceTimersByTime(600);

    expect(meetWindow.setAlwaysOnTop).toHaveBeenCalledWith(false);
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

describe("isMeetOrigin", () => {
  it("allows only the Google Meet HTTPS origin", () => {
    expect(isMeetOrigin("https://meet.google.com/abc-defg-hij")).toBe(true);
    expect(isMeetOrigin("https://meet.google.com")).toBe(true);
    expect(isMeetOrigin("https://accounts.google.com/")).toBe(false);
    expect(isMeetOrigin("https://meet.google.com.evil.example/")).toBe(false);
    expect(isMeetOrigin("http://meet.google.com/abc-defg-hij")).toBe(false);
  });
});

describe("isAllowedMeetPermission", () => {
  it("allows only media and notifications", () => {
    expect(isAllowedMeetPermission("media")).toBe(true);
    expect(isAllowedMeetPermission("notifications")).toBe(true);
    expect(isAllowedMeetPermission("display-capture")).toBe(false);
    expect(isAllowedMeetPermission("geolocation")).toBe(false);
  });
});

describe("configureMeetSessionPermissions", () => {
  it("configures permission check and request handlers", () => {
    const { session } = createFakeSession();

    configureMeetSessionPermissions(session);

    expect(session.setPermissionCheckHandler).toHaveBeenCalledTimes(1);
    expect(session.setPermissionRequestHandler).toHaveBeenCalledTimes(1);
  });

  it("allows media and notifications checks for Google Meet", () => {
    const { check, session } = createFakeSession();
    configureMeetSessionPermissions(session);

    expect(check("media", "https://meet.google.com")).toBe(true);
    expect(check("notifications", "https://meet.google.com")).toBe(true);
  });

  it("rejects permission checks outside the Google Meet origin allowlist", () => {
    const { check, session } = createFakeSession();
    configureMeetSessionPermissions(session);

    expect(check("media", "https://accounts.google.com")).toBe(false);
    expect(
      check("media", "https://accounts.google.com", {
        isMainFrame: true,
        securityOrigin: "https://meet.google.com.evil.example",
        requestingUrl: "https://meet.google.com.evil.example",
      }),
    ).toBe(false);
    expect(
      check("media", "http://meet.google.com", {
        isMainFrame: true,
        securityOrigin: "http://meet.google.com",
        requestingUrl: "http://meet.google.com/abc-defg-hij",
      }),
    ).toBe(false);
  });

  it("rejects non-media and non-notification permission checks", () => {
    const { check, session } = createFakeSession();
    configureMeetSessionPermissions(session);

    expect(check("display-capture", "https://meet.google.com")).toBe(false);
    expect(check("geolocation", "https://meet.google.com")).toBe(false);
  });

  it("allows media and notifications requests for Google Meet", () => {
    const { request, session } = createFakeSession();
    configureMeetSessionPermissions(session);

    expect(
      request("media", {
        isMainFrame: true,
        requestingUrl: "https://meet.google.com/abc-defg-hij",
      }),
    ).toBe(true);
    expect(
      request("notifications", {
        isMainFrame: true,
        requestingUrl: "https://meet.google.com/abc-defg-hij",
      }),
    ).toBe(true);
  });

  it("rejects permission requests outside the Google Meet origin allowlist", () => {
    const { request, session } = createFakeSession();
    configureMeetSessionPermissions(session);

    expect(
      request(
        "media",
        {
          isMainFrame: true,
          requestingUrl: "https://accounts.google.com",
        },
        "https://accounts.google.com",
      ),
    ).toBe(false);
    expect(
      request("media", {
        isMainFrame: true,
        requestingUrl: "https://accounts.google.com",
      }),
    ).toBe(false);
    expect(
      request(
        "media",
        {
          isMainFrame: true,
          securityOrigin: "https://meet.google.com.evil.example",
          requestingUrl: "https://meet.google.com.evil.example",
        },
        "https://meet.google.com.evil.example",
      ),
    ).toBe(false);
    expect(
      request(
        "media",
        {
          isMainFrame: true,
          securityOrigin: "http://meet.google.com",
          requestingUrl: "http://meet.google.com/abc-defg-hij",
        },
        "http://meet.google.com/abc-defg-hij",
      ),
    ).toBe(false);
  });

  it("rejects non-media and non-notification permission requests", () => {
    const { request, session } = createFakeSession();
    configureMeetSessionPermissions(session);

    expect(
      request("display-capture", {
        isMainFrame: true,
        requestingUrl: "https://meet.google.com/abc-defg-hij",
      }),
    ).toBe(false);
    expect(
      request("geolocation", {
        isMainFrame: true,
        requestingUrl: "https://meet.google.com/abc-defg-hij",
      }),
    ).toBe(false);
  });
});
