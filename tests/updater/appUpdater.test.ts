import { describe, expect, it, vi } from "vitest";

type AutoUpdaterHandler = (...args: unknown[]) => void;

type AppUpdaterTestContext = {
  accessMock: ReturnType<typeof vi.fn>;
  autoUpdaterMock: {
    checkForUpdates: ReturnType<typeof vi.fn>;
  };
  autoUpdaterHandlers: Map<string, AutoUpdaterHandler>;
  closeSyncMock: ReturnType<typeof vi.fn>;
  execFileMock: ReturnType<typeof vi.fn>;
  module: typeof import("@main/updater/appUpdater");
  readFileSyncMock: ReturnType<typeof vi.fn>;
  openSyncMock: ReturnType<typeof vi.fn>;
  sendMock: ReturnType<typeof vi.fn>;
  spawnHandlers: Map<string, AutoUpdaterHandler>;
  spawnMock: ReturnType<typeof vi.fn>;
  writeFileSyncMock: ReturnType<typeof vi.fn>;
};

const createAppUpdaterTestContext = async (
  accessImpl: (path: string) => Promise<void> = () => Promise.resolve(),
  storedUpdateCheckState?: unknown,
  checkForUpdatesImpl: () => Promise<void> = () => Promise.resolve(),
): Promise<AppUpdaterTestContext> => {
  vi.resetModules();

  const sendMock = vi.fn();
  const appMock = {
    getPath: vi.fn((name: string) => {
      if (name === "home") return "/Users/tester";
      if (name === "userData") return "/Users/tester/Library/Application Support/NextRoom";
      return `/mock/${name}`;
    }),
    getVersion: vi.fn(() => "0.1.3"),
    isPackaged: true,
  };
  const browserWindowMock = {
    getAllWindows: vi.fn(() => [{ webContents: { send: sendMock } }]),
  };
  const autoUpdaterHandlers = new Map<string, AutoUpdaterHandler>();
  const autoUpdaterMock = {
    autoDownload: true,
    autoInstallOnAppQuit: true,
    checkForUpdates: vi.fn(checkForUpdatesImpl),
    on: vi.fn((event: string, handler: AutoUpdaterHandler) => {
      autoUpdaterHandlers.set(event, handler);
    }),
  };
  const execFileMock = vi.fn(
    (
      _file: string,
      _args: string[],
      _options: unknown,
      callback: (error: Error | null) => void,
    ) => {
      callback(null);
    },
  );
  const spawnHandlers = new Map<string, AutoUpdaterHandler>();
  const childMock = {
    on: vi.fn((event: string, handler: AutoUpdaterHandler) => {
      spawnHandlers.set(event, handler);
      return childMock;
    }),
    unref: vi.fn(),
  };
  const spawnMock = vi.fn(() => childMock);
  const accessMock = vi.fn(accessImpl);
  const mkdirMock = vi.fn(() => Promise.resolve());
  const openSyncMock = vi.fn(() => 42);
  const closeSyncMock = vi.fn();
  const readFileSyncMock = vi.fn(() => {
    if (storedUpdateCheckState === undefined) {
      throw new Error("missing state");
    }

    return JSON.stringify(storedUpdateCheckState);
  });
  const writeFileSyncMock = vi.fn();
  const mkdirSyncMock = vi.fn();

  vi.doMock("node:child_process", async (importOriginal) => {
    const actual = await importOriginal<typeof import("node:child_process")>();

    return {
      ...actual,
      default: {
        ...actual,
        execFile: execFileMock,
        spawn: spawnMock,
      },
      execFile: execFileMock,
      spawn: spawnMock,
    };
  });
  vi.doMock("node:fs", async (importOriginal) => {
    const actual = await importOriginal<typeof import("node:fs")>();

    return {
      ...actual,
      closeSync: closeSyncMock,
      default: {
        ...actual,
        closeSync: closeSyncMock,
        mkdirSync: mkdirSyncMock,
        openSync: openSyncMock,
        readFileSync: readFileSyncMock,
        writeFileSync: writeFileSyncMock,
      },
      mkdirSync: mkdirSyncMock,
      openSync: openSyncMock,
      readFileSync: readFileSyncMock,
      writeFileSync: writeFileSyncMock,
    };
  });
  vi.doMock("node:fs/promises", async (importOriginal) => {
    const actual = await importOriginal<typeof import("node:fs/promises")>();

    return {
      ...actual,
      access: accessMock,
      default: {
        ...actual,
        access: accessMock,
        mkdir: mkdirMock,
      },
      mkdir: mkdirMock,
    };
  });
  vi.doMock("electron", () => ({
    BrowserWindow: browserWindowMock,
    app: appMock,
    default: { app: appMock, BrowserWindow: browserWindowMock },
  }));
  vi.doMock("electron-updater", () => {
    const mockedModule = { autoUpdater: autoUpdaterMock };

    return {
      ...mockedModule,
      default: mockedModule,
    };
  });

  const module = await import("@main/updater/appUpdater");

  return {
    accessMock,
    autoUpdaterMock,
    autoUpdaterHandlers,
    closeSyncMock,
    execFileMock,
    module,
    openSyncMock,
    readFileSyncMock,
    sendMock,
    spawnHandlers,
    spawnMock,
    writeFileSyncMock,
  };
};

const prepareAvailableUpdate = (context: AppUpdaterTestContext) => {
  context.module.configureAppUpdater();
  context.autoUpdaterHandlers.get("update-available")?.({
    releaseDate: "2026-05-30T00:00:00Z",
    releaseName: "v0.1.4",
    version: "0.1.4",
  });
};

describe("appUpdater Homebrew updates", () => {
  it("starts the detached Homebrew update with stable appdir, log path, and env", async () => {
    const context = await createAppUpdaterTestContext();
    prepareAvailableUpdate(context);

    const result = await context.module.runHomebrewAppUpdate();

    expect(result._unsafeUnwrap()).toMatchObject({
      status: "homebrew-updating",
      updateMessage: "Updating with Homebrew. A restart prompt will appear when it is ready.",
    });
    expect(context.execFileMock).toHaveBeenCalledWith(
      "/opt/homebrew/bin/brew",
      ["list", "--cask", "nextroom"],
      expect.objectContaining({
        env: expect.objectContaining({
          HOMEBREW_NO_ANALYTICS: "1",
          HOMEBREW_NO_AUTO_UPDATE: "1",
        }),
      }),
      expect.any(Function),
    );

    const spawnCall = context.spawnMock.mock.calls[0] ?? [];
    const script = (spawnCall[1] as string[])[1] ?? "";
    const spawnOptions = spawnCall[2] as {
      detached: boolean;
      env: Record<string, string>;
      stdio: unknown[];
    };

    expect(context.openSyncMock).toHaveBeenCalledWith(
      "/Users/tester/Library/Application Support/NextRoom/homebrew-update.log",
      "a",
    );
    expect(context.closeSyncMock).toHaveBeenCalledWith(42);
    expect(context.spawnMock).toHaveBeenCalledWith(
      "/bin/zsh",
      ["-c", expect.any(String)],
      expect.objectContaining({ detached: true }),
    );
    expect(script).toContain("osascript -e 'quit app \"NextRoom\"'");
    expect(script).toContain('"$NEXTROOM_BREW_PATH" trust --cask urugus/tap/nextroom');
    expect(script).toContain("CFBundleShortVersionString");
    expect(script).toContain("version_at_least");
    expect(script).toContain('split(version, parts, "[.]")');
    expect(script).toContain("__NEXTROOM_HOMEBREW_UPDATE_VERSION_MISMATCH__");
    expect(script).toContain(
      'if ! version_at_least "$installed_version" "$NEXTROOM_EXPECTED_VERSION"',
    );
    expect(script).toContain("exit_code=$?");
    expect(script).not.toContain("status=$?");
    expect(script).toContain(
      'display dialog "NextRoom was updated. Restart now to use the new version."',
    );
    expect(script).toContain('if ! open -n "$NEXTROOM_APP_PATH"; then');
    expect(spawnOptions.env).toMatchObject({
      HOMEBREW_NO_ANALYTICS: "1",
      HOMEBREW_NO_AUTO_UPDATE: "1",
      HOME: "/Users/tester",
      NEXTROOM_APPDIR: "/Users/tester/Applications",
      NEXTROOM_APP_PATH: "/Users/tester/Applications/NextRoom.app",
      NEXTROOM_BREW_PATH: "/opt/homebrew/bin/brew",
      NEXTROOM_EXPECTED_VERSION: "0.1.4",
    });
    expect(spawnOptions.stdio).toEqual(["ignore", 42, 42]);
  });

  it("publishes homebrew-updated when the detached update exits successfully", async () => {
    const context = await createAppUpdaterTestContext();
    prepareAvailableUpdate(context);
    await context.module.runHomebrewAppUpdate();

    context.spawnHandlers.get("exit")?.(0);

    expect(context.module.getAppUpdateStatus()).toMatchObject({
      status: "homebrew-updated",
      updateMessage: "Homebrew update completed. NextRoom is restarting.",
    });
    expect(context.sendMock).toHaveBeenLastCalledWith(
      "updates:status-changed",
      expect.objectContaining({ status: "homebrew-updated" }),
    );
  });

  it("publishes an error with the Homebrew log path when the detached update fails", async () => {
    const context = await createAppUpdaterTestContext();
    prepareAvailableUpdate(context);
    await context.module.runHomebrewAppUpdate();

    context.spawnHandlers.get("exit")?.(1);

    expect(context.module.getAppUpdateStatus()).toMatchObject({
      errorMessage:
        "Homebrew update failed. See /Users/tester/Library/Application Support/NextRoom/homebrew-update.log.",
      status: "error",
    });
    expect(context.sendMock).toHaveBeenLastCalledWith(
      "updates:status-changed",
      expect.objectContaining({ status: "error" }),
    );
  });

  it("publishes a cask version error when Homebrew did not install the available version", async () => {
    const context = await createAppUpdaterTestContext();
    prepareAvailableUpdate(context);
    await context.module.runHomebrewAppUpdate();

    context.spawnHandlers.get("exit")?.(20);

    expect(context.module.getAppUpdateStatus()).toMatchObject({
      errorMessage:
        "Homebrew did not install NextRoom 0.1.4. Check that the Homebrew cask has been updated. See /Users/tester/Library/Application Support/NextRoom/homebrew-update.log.",
      status: "error",
    });
    expect(context.sendMock).toHaveBeenLastCalledWith(
      "updates:status-changed",
      expect.objectContaining({ status: "error" }),
    );
  });
});

describe("appUpdater daily update checks", () => {
  it("runs an automatic update check when no check has been recorded today", async () => {
    const context = await createAppUpdaterTestContext();
    const checkedAt = new Date(2026, 5, 2, 9);

    const result = await context.module.checkForAppUpdatesIfDue(checkedAt);

    expect(result.isOk()).toBe(true);
    expect(context.autoUpdaterMock.checkForUpdates).toHaveBeenCalledTimes(1);
    expect(context.writeFileSyncMock).toHaveBeenCalledWith(
      "/Users/tester/Library/Application Support/NextRoom/update-check-state.json",
      expect.stringContaining('"lastCheckedLocalDate": "2026-06-02"'),
    );
    expect(context.module.getAppUpdateStatus()).toMatchObject({
      lastCheckedAt: checkedAt.toISOString(),
    });
  });

  it("skips an automatic update check when today has already been checked", async () => {
    const context = await createAppUpdaterTestContext(() => Promise.resolve(), {
      lastCheckedAt: "2026-06-02T00:00:00.000Z",
      lastCheckedLocalDate: "2026-06-02",
    });

    const result = await context.module.checkForAppUpdatesIfDue(new Date(2026, 5, 2, 18));

    expect(result.isOk()).toBe(true);
    expect(context.autoUpdaterMock.checkForUpdates).not.toHaveBeenCalled();
  });

  it("runs an automatic update check when the local date changes", async () => {
    const context = await createAppUpdaterTestContext(() => Promise.resolve(), {
      lastCheckedAt: "2026-06-02T00:00:00.000Z",
      lastCheckedLocalDate: "2026-06-02",
    });

    await context.module.checkForAppUpdatesIfDue(new Date(2026, 5, 3, 9));

    expect(context.autoUpdaterMock.checkForUpdates).toHaveBeenCalledTimes(1);
    expect(context.writeFileSyncMock).toHaveBeenCalledWith(
      "/Users/tester/Library/Application Support/NextRoom/update-check-state.json",
      expect.stringContaining('"lastCheckedLocalDate": "2026-06-03"'),
    );
  });

  it("allows manual update checks even after today's automatic check", async () => {
    const context = await createAppUpdaterTestContext(() => Promise.resolve(), {
      lastCheckedAt: "2026-06-02T00:00:00.000Z",
      lastCheckedLocalDate: "2026-06-02",
    });

    await context.module.checkForAppUpdatesIfDue(new Date(2026, 5, 2, 9));
    await context.module.checkForAppUpdates();

    expect(context.autoUpdaterMock.checkForUpdates).toHaveBeenCalledTimes(1);
  });

  it("does not record today's automatic check when the check fails", async () => {
    const context = await createAppUpdaterTestContext(
      () => Promise.resolve(),
      undefined,
      () => Promise.reject(new Error("network error")),
    );

    const result = await context.module.checkForAppUpdatesIfDue(new Date(2026, 5, 2, 9));

    expect(result.isErr()).toBe(true);
    expect(context.writeFileSyncMock).not.toHaveBeenCalled();
  });

  it("records an error when an update check throws synchronously", async () => {
    const context = await createAppUpdaterTestContext(
      () => Promise.resolve(),
      undefined,
      () => {
        throw new Error("sync failure");
      },
    );

    const result = await context.module.checkForAppUpdatesIfDue(new Date(2026, 5, 2, 9));

    expect(result.isErr()).toBe(true);
    expect(context.module.getAppUpdateStatus()).toMatchObject({
      errorMessage: "sync failure",
      status: "error",
    });
    expect(context.writeFileSyncMock).not.toHaveBeenCalled();
  });

  it("protects immediate status subscribers from throwing during registration", async () => {
    const context = await createAppUpdaterTestContext();

    expect(() => {
      context.module.subscribeAppUpdateStatus(() => {
        throw new Error("listener failed");
      });
    }).not.toThrow();
  });
});
