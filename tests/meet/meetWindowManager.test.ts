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
  executeJavaScript: (code: string) => Promise<unknown> = () => Promise.resolve({ ok: true }),
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
    webContents: {
      executeJavaScript: vi.fn(executeJavaScript),
    },
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
  it("does not focus destroyed windows", () => {
    const meetWindow = createFakeMeetWindow();
    meetWindow.setDestroyed(true);

    focusMeetWindow(meetWindow);

    expect(meetWindow.show).not.toHaveBeenCalled();
    expect(meetWindow.focus).not.toHaveBeenCalled();
  });

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
  it("returns errors for invalid Meet URLs and window creation failures", async () => {
    const createError = { type: "MeetWindowFailed" as const, cause: "create failed" };
    const invalidManager = createMeetWindowManager({
      createWindow: vi.fn(() => ok(createFakeMeetWindow())),
    });
    const failingManager = createMeetWindowManager({
      createWindow: vi.fn(() => ({ isErr: () => true, error: createError }) as never),
    });

    expect((await invalidManager.openMeetUrl("not a meet url"))._unsafeUnwrapErr()).toEqual({
      eventId: "unknown",
      type: "MeetUrlNotFound",
    });
    expect(
      (await failingManager.openMeetUrl("https://meet.google.com/abc-defg-hij"))._unsafeUnwrapErr(),
    ).toBe(createError);
  });

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

  it("replaces a destroyed tracked window for the same Meet URL", async () => {
    const firstWindow = createFakeMeetWindow();
    const secondWindow = createFakeMeetWindow();
    const createWindow = vi
      .fn()
      .mockReturnValueOnce(ok(firstWindow))
      .mockReturnValueOnce(ok(secondWindow));
    const manager = createMeetWindowManager({ createWindow });

    await manager.openMeetUrl("https://meet.google.com/abc-defg-hij");
    firstWindow.setDestroyed(true);
    await manager.openMeetUrl("https://meet.google.com/abc-defg-hij");

    expect(createWindow).toHaveBeenCalledTimes(2);
    expect(secondWindow.loadURL).toHaveBeenCalledWith("https://meet.google.com/abc-defg-hij");
  });

  it("applies stored update status to newly-created Meet windows", async () => {
    const meetWindow = createFakeMeetWindow();
    meetWindow.updateUpdateStatus = vi.fn();
    const manager = createMeetWindowManager({ createWindow: vi.fn(() => ok(meetWindow)) });
    const status = {
      availableVersion: "0.2.0",
      canCheck: true,
      canRunHomebrewUpdate: true,
      currentVersion: "0.1.0",
      status: "available" as const,
    };

    manager.updateUpdateStatus(status);
    await manager.openMeetUrl("https://meet.google.com/abc-defg-hij");

    expect(meetWindow.updateUpdateStatus).toHaveBeenCalledWith(status);
  });

  it("forgets a window after it closes", async () => {
    const firstWindow = createFakeMeetWindow();
    const secondWindow = createFakeMeetWindow();
    const onWindowClosed = vi.fn();
    const createWindow = vi
      .fn()
      .mockReturnValueOnce(ok(firstWindow))
      .mockReturnValueOnce(ok(secondWindow));
    const manager = createMeetWindowManager({ createWindow, onWindowClosed });

    await manager.openMeetUrl("https://meet.google.com/abc-defg-hij");
    firstWindow.close();
    await manager.openMeetUrl("https://meet.google.com/abc-defg-hij");

    expect(onWindowClosed).toHaveBeenCalledWith("https://meet.google.com/abc-defg-hij");
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

  it("auto-joins through the Meet page without creating a second window", async () => {
    const meetWindow = createFakeMeetWindow();
    const createWindow = vi.fn(() => ok(meetWindow));
    const manager = createMeetWindowManager({ createWindow });

    await manager.openMeetUrl("https://meet.google.com/abc-defg-hij");
    const result = await manager.autoJoinMeetUrl("https://meet.google.com/abc-defg-hij");

    expect(result.isOk()).toBe(true);
    expect(createWindow).toHaveBeenCalledTimes(1);
    expect(meetWindow.webContents.executeJavaScript).toHaveBeenCalledTimes(1);
  });

  it("focuses the latest open Meet window when the app is activated", async () => {
    vi.useFakeTimers();
    const firstWindow = createFakeMeetWindow();
    const secondWindow = createFakeMeetWindow();
    const createWindow = vi
      .fn()
      .mockReturnValueOnce(ok(firstWindow))
      .mockReturnValueOnce(ok(secondWindow));
    const focusApp = vi.fn();
    const manager = createMeetWindowManager({ createWindow, focusApp });

    await manager.openMeetUrl("https://meet.google.com/abc-defg-hij");
    await manager.openMeetUrl("https://meet.google.com/xyz-abcd-efg");
    vi.mocked(firstWindow.focus).mockClear();
    vi.mocked(secondWindow.focus).mockClear();
    focusApp.mockClear();

    expect(manager.focusOpenMeetWindow()).toBe(true);

    expect(focusApp).toHaveBeenCalledTimes(1);
    expect(firstWindow.focus).not.toHaveBeenCalled();
    expect(secondWindow.focus).toHaveBeenCalledTimes(1);
  });

  it("skips destroyed Meet windows when focusing an open Meet window", async () => {
    vi.useFakeTimers();
    const firstWindow = createFakeMeetWindow();
    const secondWindow = createFakeMeetWindow();
    const createWindow = vi
      .fn()
      .mockReturnValueOnce(ok(firstWindow))
      .mockReturnValueOnce(ok(secondWindow));
    const manager = createMeetWindowManager({ createWindow });

    await manager.openMeetUrl("https://meet.google.com/abc-defg-hij");
    await manager.openMeetUrl("https://meet.google.com/xyz-abcd-efg");
    vi.mocked(firstWindow.focus).mockClear();
    vi.mocked(secondWindow.focus).mockClear();
    secondWindow.setDestroyed(true);

    expect(manager.focusOpenMeetWindow()).toBe(true);

    expect(firstWindow.focus).toHaveBeenCalledTimes(1);
    expect(secondWindow.focus).not.toHaveBeenCalled();
  });

  it("does not focus anything when no Meet window is open", () => {
    const manager = createMeetWindowManager({
      createWindow: vi.fn(() => ok(createFakeMeetWindow())),
    });

    expect(manager.focusOpenMeetWindow()).toBe(false);
  });

  it("does not focus anything when all tracked Meet windows are destroyed", async () => {
    vi.useFakeTimers();
    const firstWindow = createFakeMeetWindow();
    const secondWindow = createFakeMeetWindow();
    const createWindow = vi
      .fn()
      .mockReturnValueOnce(ok(firstWindow))
      .mockReturnValueOnce(ok(secondWindow));
    const manager = createMeetWindowManager({ createWindow });

    await manager.openMeetUrl("https://meet.google.com/abc-defg-hij");
    await manager.openMeetUrl("https://meet.google.com/xyz-abcd-efg");
    vi.mocked(firstWindow.focus).mockClear();
    vi.mocked(secondWindow.focus).mockClear();
    firstWindow.setDestroyed(true);
    secondWindow.setDestroyed(true);

    expect(manager.focusOpenMeetWindow()).toBe(false);

    expect(firstWindow.focus).not.toHaveBeenCalled();
    expect(secondWindow.focus).not.toHaveBeenCalled();
  });

  it("returns an error when auto-join cannot find a join button", async () => {
    const meetWindow = createFakeMeetWindow(
      () => Promise.resolve(),
      () => Promise.resolve({ ok: false, reason: "Meet join button was not found." }),
    );
    const manager = createMeetWindowManager({ createWindow: vi.fn(() => ok(meetWindow)) });

    const result = await manager.autoJoinMeetUrl("https://meet.google.com/abc-defg-hij");

    expect(result._unsafeUnwrapErr()).toMatchObject({
      cause: "Meet join button was not found.",
      type: "MeetWindowFailed",
    });
  });

  it("returns open errors before running the auto-join script", async () => {
    const createError = { type: "MeetWindowFailed" as const, cause: "create failed" };
    const manager = createMeetWindowManager({
      createWindow: vi.fn(() => ({ isErr: () => true, error: createError }) as never),
    });

    const result = await manager.autoJoinMeetUrl("https://meet.google.com/abc-defg-hij");

    expect(result._unsafeUnwrapErr()).toBe(createError);
  });

  it("returns errors when auto-join returns an unexpected result or throws", async () => {
    const unexpectedWindow = createFakeMeetWindow(
      () => Promise.resolve(),
      () => Promise.resolve({ ok: "yes" }),
    );
    const throwingWindow = createFakeMeetWindow(
      () => Promise.resolve(),
      () => Promise.reject(new Error("script failed")),
    );
    const logger = {
      child: vi.fn(),
      debug: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
    };
    logger.child.mockReturnValue(logger);
    const createWindow = vi
      .fn()
      .mockReturnValueOnce(ok(unexpectedWindow))
      .mockReturnValueOnce(ok(throwingWindow));
    const manager = createMeetWindowManager({ createWindow, logger });

    const unexpected = await manager.autoJoinMeetUrl("https://meet.google.com/abc-defg-hij");
    const thrown = await manager.autoJoinMeetUrl("https://meet.google.com/xyz-abcd-efg");

    expect(unexpected._unsafeUnwrapErr()).toMatchObject({
      cause: "Meet join automation returned an unexpected result.",
      type: "MeetWindowFailed",
    });
    expect(thrown._unsafeUnwrapErr()).toMatchObject({ type: "MeetWindowFailed" });
    expect(logger.error).toHaveBeenCalledWith("meet auto-join script failed", {
      error: new Error("script failed"),
    });
  });

  it("reports open Meet windows other than the candidate URL", async () => {
    const firstWindow = createFakeMeetWindow();
    const secondWindow = createFakeMeetWindow();
    const createWindow = vi
      .fn()
      .mockReturnValueOnce(ok(firstWindow))
      .mockReturnValueOnce(ok(secondWindow));
    const manager = createMeetWindowManager({ createWindow });

    await manager.openMeetUrl("https://meet.google.com/abc-defg-hij");

    expect(manager.hasOpenMeetWindowExcept("https://meet.google.com/abc-defg-hij")).toBe(false);

    await manager.openMeetUrl("https://meet.google.com/xyz-abcd-efg");

    expect(manager.hasOpenMeetWindowExcept("https://meet.google.com/abc-defg-hij")).toBe(true);
    expect(manager.hasOpenMeetWindowExcept("not a meet url")).toBe(true);
  });

  it("publishes update status to open Meet windows", async () => {
    const meetWindow = createFakeMeetWindow();
    meetWindow.updateUpdateStatus = vi.fn();
    const manager = createMeetWindowManager({ createWindow: vi.fn(() => ok(meetWindow)) });

    await manager.openMeetUrl("https://meet.google.com/abc-defg-hij");
    manager.updateUpdateStatus({
      availableVersion: "0.2.0",
      canCheck: true,
      canRunHomebrewUpdate: true,
      currentVersion: "0.1.0",
      status: "available",
    });

    expect(meetWindow.updateUpdateStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        availableVersion: "0.2.0",
        status: "available",
      }),
    );
  });

  it("publishes bubble text to open Meet windows", async () => {
    const firstWindow = createFakeMeetWindow();
    const secondWindow = createFakeMeetWindow();
    firstWindow.sendBubbleText = vi.fn();
    secondWindow.sendBubbleText = vi.fn();
    const createWindow = vi
      .fn()
      .mockReturnValueOnce(ok(firstWindow))
      .mockReturnValueOnce(ok(secondWindow));
    const manager = createMeetWindowManager({ createWindow });

    await manager.openMeetUrl("https://meet.google.com/abc-defg-hij");
    await manager.openMeetUrl("https://meet.google.com/xyz-abcd-efg");
    manager.sendBubbleText({ durationMs: 4_000, text: "議事録を確認中です" });

    expect(firstWindow.sendBubbleText).toHaveBeenCalledWith({
      durationMs: 4_000,
      text: "議事録を確認中です",
    });
    expect(secondWindow.sendBubbleText).toHaveBeenCalledWith({
      durationMs: 4_000,
      text: "議事録を確認中です",
    });
  });

  it("publishes bubble config to open and newly-created Meet windows", async () => {
    const firstWindow = createFakeMeetWindow();
    const secondWindow = createFakeMeetWindow();
    firstWindow.setBubbleConfig = vi.fn();
    secondWindow.setBubbleConfig = vi.fn();
    const config = {
      chatMirrorEnabled: true,
      displaySpeedLevel: 4,
      enabled: true,
    };
    const createWindow = vi
      .fn()
      .mockReturnValueOnce(ok(firstWindow))
      .mockReturnValueOnce(ok(secondWindow));
    const manager = createMeetWindowManager({ createWindow });

    await manager.openMeetUrl("https://meet.google.com/abc-defg-hij");
    manager.setBubbleConfig(config);
    await manager.openMeetUrl("https://meet.google.com/xyz-abcd-efg");

    expect(firstWindow.setBubbleConfig).toHaveBeenCalledWith(config);
    expect(secondWindow.setBubbleConfig).toHaveBeenCalledWith(config);
  });

  it("does not publish bubble or update messages to destroyed Meet windows", async () => {
    const meetWindow = createFakeMeetWindow();
    meetWindow.sendBubbleText = vi.fn();
    meetWindow.setBubbleConfig = vi.fn();
    meetWindow.updateUpdateStatus = vi.fn();
    const manager = createMeetWindowManager({ createWindow: vi.fn(() => ok(meetWindow)) });

    await manager.openMeetUrl("https://meet.google.com/abc-defg-hij");
    meetWindow.setDestroyed(true);
    manager.sendBubbleText({ durationMs: 1_000, text: "hidden" });
    manager.setBubbleConfig({ chatMirrorEnabled: true, displaySpeedLevel: 3, enabled: true });
    manager.updateUpdateStatus({
      availableVersion: "0.2.0",
      canCheck: true,
      canRunHomebrewUpdate: true,
      currentVersion: "0.1.0",
      status: "available",
    });

    expect(meetWindow.sendBubbleText).not.toHaveBeenCalled();
    expect(meetWindow.setBubbleConfig).not.toHaveBeenCalled();
    expect(meetWindow.updateUpdateStatus).not.toHaveBeenCalled();
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
  it("allows only display capture, media, and notifications", () => {
    expect(isAllowedMeetPermission("display-capture")).toBe(true);
    expect(isAllowedMeetPermission("media")).toBe(true);
    expect(isAllowedMeetPermission("notifications")).toBe(true);
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

  it("allows display capture, media, and notifications checks for Google Meet", () => {
    const { check, session } = createFakeSession();
    configureMeetSessionPermissions(session);

    expect(check("display-capture", "https://meet.google.com")).toBe(true);
    expect(check("media", "https://meet.google.com")).toBe(true);
    expect(check("notifications", "https://meet.google.com")).toBe(true);
  });

  it("rejects permission checks outside the Google Meet origin allowlist", () => {
    const { check, session } = createFakeSession();
    configureMeetSessionPermissions(session);

    expect(check("display-capture", "https://accounts.google.com")).toBe(false);
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

  it("rejects permissions outside the Meet allowlist", () => {
    const { check, session } = createFakeSession();
    configureMeetSessionPermissions(session);

    expect(check("geolocation", "https://meet.google.com")).toBe(false);
  });

  it("allows display capture, media, and notifications requests for Google Meet", () => {
    const { request, session } = createFakeSession();
    configureMeetSessionPermissions(session);

    expect(
      request("display-capture", {
        isMainFrame: true,
        requestingUrl: "https://meet.google.com/abc-defg-hij",
      }),
    ).toBe(true);
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
        "display-capture",
        {
          isMainFrame: true,
          requestingUrl: "https://accounts.google.com",
        },
        "https://accounts.google.com",
      ),
    ).toBe(false);
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

  it("rejects permission requests outside the Meet allowlist", () => {
    const { request, session } = createFakeSession();
    configureMeetSessionPermissions(session);

    expect(
      request("geolocation", {
        isMainFrame: true,
        requestingUrl: "https://meet.google.com/abc-defg-hij",
      }),
    ).toBe(false);
  });
});
