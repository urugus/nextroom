import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { createKeychainTokenStore } from "@main/adapters/keychainTokenStore";
import { createGoogleCalendarClient } from "@main/calendar/calendarClient";
import { createCalendarSyncService } from "@main/calendar/calendarSyncService";
import { canonicalizeMeetUrl, isMeetUrl } from "@main/calendar/meetExtractor";
import {
  configureMeetSessionPermissions,
  meetSessionPartition,
} from "@main/meet/meetSessionPermissions";
import { createMeetWindowManager, type ManagedMeetWindow } from "@main/meet/meetWindowManager";
import { createMenuBarController, type MenuBarController } from "@main/menuBar/menuBarController";
import { createGoogleAuthService } from "@main/oauth/googleAuthService";
import { createOAuthClient } from "@main/oauth/oauthClient";
import {
  createMenuOpenRequestQueue,
  findMenuOpenProtocolUrl,
  isMenuOpenProtocolUrl,
  nextRoomProtocolScheme,
  protocolClientRegistrationOptions,
} from "@main/protocol/menuOpenProtocol";
import { type AutoOpenScheduler, createAutoOpenScheduler } from "@main/scheduler/autoOpenScheduler";
import { createLaunchDeduper } from "@main/scheduler/launchDeduper";
import {
  defaultAppSettings,
  parseSettingsUpdate,
  parseStoredAppSettings,
  validateAppSettings,
} from "@main/settings/appSettings";
import {
  createMenuShortcutRegistrar,
  type MenuShortcutRegistrar,
} from "@main/shortcuts/menuShortcut";
import {
  checkForAppUpdates,
  checkForAppUpdatesIfDue,
  configureAppUpdater,
  getAppUpdateStatus,
  runHomebrewAppUpdate,
  subscribeAppUpdateStatus,
} from "@main/updater/appUpdater";
import { type AppError, serializeAppError } from "@shared/errors";
import { IPC_CHANNELS } from "@shared/ipc";
import type { AppSettings, AppUpdateStatus, MenuShortcutStatus } from "@shared/types";
import type { BrowserWindow as ElectronBrowserWindow } from "electron";
import { err, fromThrowable, ok, type Result } from "neverthrow";
import { z } from "zod";
import { serializeResultForRenderer } from "./ipc/result";

const nodeRequire = createRequire(import.meta.url);
const {
  app,
  BrowserWindow,
  Menu,
  Tray,
  WebContentsView,
  globalShortcut,
  ipcMain,
  nativeImage,
  session,
  shell,
} = nodeRequire("electron") as typeof import("electron");
const keytar = nodeRequire("keytar") as typeof import("keytar");

let mainWindow: ElectronBrowserWindow | undefined;
let menuBarController: MenuBarController | undefined;
let menuShortcutRegistrar: MenuShortcutRegistrar | undefined;
let autoOpenScheduler: AutoOpenScheduler | undefined;
let updateCheckTimer: NodeJS.Timeout | undefined;
let menuShortcutStatus: MenuShortcutStatus = {
  accelerator: defaultAppSettings.menuShortcutAccelerator,
  state: "off",
};
const menuOpenRequestQueue = createMenuOpenRequestQueue({
  tryOpenMenu: () => {
    if (menuBarController === undefined) return false;

    menuBarController.openMenu();
    return true;
  },
});
const meetUrlSchema = z.string().url();
const settingsFileName = "settings.json";
const menuBarLogFileName = "menu-bar.log";
let appSettings: AppSettings = { ...defaultAppSettings };
const appCanStart = app.requestSingleInstanceLock();
const electronProcess = process as NodeJS.Process & { defaultApp?: boolean };

app.on("open-url", (event, url) => {
  if (!isMenuOpenProtocolUrl(url)) return;

  event.preventDefault();
  menuOpenRequestQueue.requestOpen();
});

if (findMenuOpenProtocolUrl(process.argv) !== undefined) {
  menuOpenRequestQueue.requestOpen();
}

app.on("second-instance", (_event, argv) => {
  if (findMenuOpenProtocolUrl(argv) === undefined) return;

  menuOpenRequestQueue.requestOpen();
});

const settingsPath = (): string => join(app.getPath("userData"), settingsFileName);

const loadAppSettings = (): AppSettings => {
  try {
    return parseStoredAppSettings(JSON.parse(readFileSync(settingsPath(), "utf8")));
  } catch {
    return { ...defaultAppSettings };
  }
};

const saveAppSettings = (settings: AppSettings): Result<AppSettings, AppError> => {
  try {
    mkdirSync(app.getPath("userData"), { recursive: true });
    writeFileSync(settingsPath(), `${JSON.stringify(settings, null, 2)}\n`);
    return ok(settings);
  } catch (cause) {
    return err({ type: "DatabaseFailed", cause });
  }
};

const menuShortcutStatusFor = (
  accelerator: string | null,
  result: Result<void, AppError>,
): MenuShortcutStatus => {
  if (accelerator === null) {
    return { accelerator: null, state: "off" };
  }

  return result.match(
    () => ({ accelerator, state: "registered" }),
    (error) => ({ accelerator, error: serializeAppError(error), state: "failed" }),
  );
};

const updateMenuShortcutRegistration = (accelerator: string | null): Result<void, AppError> => {
  const result = menuShortcutRegistrar?.updateShortcut(accelerator) ?? ok(undefined);
  menuShortcutStatus = menuShortcutStatusFor(accelerator, result);
  return result;
};

const updateAppSettings = (value: unknown): Result<AppSettings, AppError> => {
  const parsed = parseSettingsUpdate(value);
  if (parsed.isErr()) return err(parsed.error);

  const nextSettings = { ...appSettings, ...parsed.value };
  const validated = validateAppSettings(nextSettings);
  if (validated.isErr()) return validated;

  const previousShortcutAccelerator = appSettings.menuShortcutAccelerator;
  const previousShortcutStatus = menuShortcutStatus;
  const shortcutChanged =
    "menuShortcutAccelerator" in parsed.value &&
    nextSettings.menuShortcutAccelerator !== previousShortcutAccelerator;

  if (shortcutChanged) {
    const registered = updateMenuShortcutRegistration(nextSettings.menuShortcutAccelerator);
    if (registered.isErr()) {
      menuShortcutStatus = previousShortcutStatus;
      return err(registered.error);
    }
  }

  const saved = saveAppSettings(nextSettings);
  if (saved.isErr()) {
    if (shortcutChanged) {
      const restored = updateMenuShortcutRegistration(previousShortcutAccelerator);
      if (restored.isErr()) {
        reportMenuBarError("Failed to restore the previous menu shortcut.", restored.error);
        menuShortcutRegistrar?.unregister();
        menuShortcutStatus = menuShortcutStatusFor(previousShortcutAccelerator, restored);
      }
    }
    return saved;
  }

  Object.assign(appSettings, nextSettings);
  return ok(appSettings);
};

const formatLogCause = (cause: unknown): string => {
  if (cause instanceof Error) return cause.stack ?? cause.message;
  if (typeof cause === "string") return cause;

  try {
    const json = JSON.stringify(cause);
    return json ?? String(cause);
  } catch {
    return String(cause);
  }
};

const tokenStore = createKeychainTokenStore(keytar);
const oauthClient = createOAuthClient();
const authService = createGoogleAuthService({
  clientId: process.env.NEXTROOM_GOOGLE_CLIENT_ID,
  clientSecret: process.env.NEXTROOM_GOOGLE_CLIENT_SECRET,
  tokenStore,
  oauthClient,
  openExternal: (url) => shell.openExternal(url).then(() => undefined),
});
const calendarSyncService = createCalendarSyncService({
  authService,
  calendarClient: createGoogleCalendarClient(),
});

const createBrowserWindow = (title: string, errorType: "MainWindowFailed" | "MeetWindowFailed") =>
  fromThrowable(
    () =>
      new BrowserWindow({
        width: 760,
        height: 520,
        minWidth: 620,
        minHeight: 420,
        title,
        webPreferences: {
          preload: join(__dirname, "../preload/index.cjs"),
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
        },
      }),
    (cause): AppError => ({ type: errorType, cause }),
  )();

const meetShellHeight = 38;

const meetShellHtml = (): string => `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <style>
      :root {
        color: #1d1d1f;
        background: #f5f5f7;
        font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif;
      }
      body {
        margin: 0;
        overflow: hidden;
      }
      .bar {
        -webkit-app-region: drag;
        display: flex;
        align-items: center;
        justify-content: flex-end;
        height: ${meetShellHeight}px;
        padding: 0 12px 0 78px;
        border-bottom: 1px solid #d6d6d8;
        background: #f5f5f7;
      }
      button {
        -webkit-app-region: no-drag;
        display: none;
        min-height: 24px;
        border: 1px solid #0071e3;
        border-radius: 6px;
        background: #007aff;
        color: #ffffff;
        cursor: pointer;
        font: inherit;
        font-size: 12px;
        line-height: 1;
        padding: 4px 10px;
      }
      button:disabled {
        border-color: #c4c4c6;
        background: #e5e5e7;
        color: #6e6e73;
        cursor: progress;
      }
    </style>
  </head>
  <body>
    <div class="bar">
      <button type="button" id="update-button">Update</button>
    </div>
    <script>
      const button = document.getElementById("update-button");
      const render = (status) => {
        const visible = status?.status === "available" || status?.status === "homebrew-updating";
        button.style.display = visible ? "inline-flex" : "none";
        button.disabled = status?.status === "homebrew-updating";
        button.textContent = status?.status === "homebrew-updating" ? "Updating" : "Update";
      };
      window.meetLauncher?.getUpdateStatus().then((result) => {
        if (result.ok) render(result.value);
      });
      window.meetLauncher?.onUpdateStatusChanged(render);
      button.addEventListener("click", () => {
        button.disabled = true;
        button.textContent = "Updating";
        window.meetLauncher?.runHomebrewUpdate().then((result) => {
          if (!result.ok) {
            button.disabled = false;
            button.textContent = "Update";
          }
        }).catch(() => {
          button.disabled = false;
          button.textContent = "Update";
        });
      });
    </script>
  </body>
</html>`;

const createMeetWindow = fromThrowable(
  () => {
    const window = new BrowserWindow({
      width: 1280,
      height: 820,
      minWidth: 960,
      minHeight: 640,
      title: "Meet",
      titleBarStyle: "hiddenInset",
      webPreferences: {
        preload: join(__dirname, "../preload/index.cjs"),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    const meetView = new WebContentsView({
      webPreferences: {
        partition: meetSessionPartition,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    const layout = (): void => {
      const bounds = window.getContentBounds();
      meetView.setBounds({
        height: Math.max(0, bounds.height - meetShellHeight),
        width: bounds.width,
        x: 0,
        y: meetShellHeight,
      });
    };

    window.contentView.addChildView(meetView);
    window.on("resize", layout);
    window.on("resized", layout);
    layout();
    void window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(meetShellHtml())}`);

    return {
      destroy: () => window.destroy(),
      focus: () => window.focus(),
      isDestroyed: () => window.isDestroyed(),
      isMinimized: () => window.isMinimized(),
      loadURL: (url: string) => meetView.webContents.loadURL(url),
      on: (event: "closed", listener: () => void) => window.on(event, listener),
      restore: () => window.restore(),
      setAlwaysOnTop: (flag: boolean, level?: "screen-saver") => window.setAlwaysOnTop(flag, level),
      show: () => window.show(),
      updateUpdateStatus: (status: AppUpdateStatus) => {
        window.webContents.send(IPC_CHANNELS.updatesStatusChanged, status);
      },
      webContents: meetView.webContents,
    };
  },
  (cause): AppError => ({ type: "MeetWindowFailed", cause }),
);

const meetWindowManager = createMeetWindowManager({
  createWindow: () => createMeetWindow().map((window): ManagedMeetWindow => window),
  focusApp: () => {
    app.focus({ steal: true });
  },
  onWindowClosed: (meetUrl) => {
    autoOpenScheduler?.handleMeetWindowClosed(meetUrl);
  },
});

const createMainWindow = () =>
  createBrowserWindow("NextRoom", "MainWindowFailed").map((window) => {
    window.webContents.setWindowOpenHandler(({ url }) => {
      if (isMeetUrl(url)) {
        void openMeetUrl(url);
      }

      return { action: "deny" };
    });

    if (process.env.ELECTRON_RENDERER_URL !== undefined) {
      void window.loadURL(process.env.ELECTRON_RENDERER_URL);
    } else {
      void window.loadFile(join(__dirname, "../renderer/index.html"));
    }

    window.on("closed", () => {
      if (mainWindow === window) {
        mainWindow = undefined;
      }
    });

    return window;
  });

const showSettingsWindow = (): Result<ElectronBrowserWindow, AppError> => {
  if (mainWindow !== undefined && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    mainWindow.show();
    mainWindow.focus();
    return ok(mainWindow);
  }

  const created = createMainWindow();
  if (created.isOk()) {
    mainWindow = created.value;
  }

  return created;
};

const createTrayIcon = () => {
  const image = nativeImage
    .createFromPath(join(__dirname, "../../assets/nextroom-logo.png"))
    .resize({ height: 18, width: 18 });

  if (process.platform === "darwin") {
    image.setTemplateImage(true);
  }

  return image;
};

const reportMenuBarError = (message: string, cause: unknown): void => {
  try {
    const logDirectory = app.getPath("logs");
    mkdirSync(logDirectory, { recursive: true });
    appendFileSync(
      join(logDirectory, menuBarLogFileName),
      `${new Date().toISOString()} ${message} ${formatLogCause(cause)}\n`,
    );
  } catch {
    // Logging must never make a tray action fail harder.
  }
};

const createMenuBar = (): void => {
  menuBarController = createMenuBarController({
    buildMenuFromTemplate: (template) => Menu.buildFromTemplate(template),
    createTray: (icon) => new Tray(icon),
    icon: createTrayIcon(),
    openMeetUrl,
    quitApp: () => {
      app.quit();
    },
    reportError: reportMenuBarError,
    runUpdate: () => runHomebrewAppUpdate(),
    showSettingsWindow: () => {
      const result = showSettingsWindow();
      if (result.isErr()) {
        reportMenuBarError("Failed to open settings from the menu bar.", result.error);
      }
    },
    syncNow: () => calendarSyncService.syncNow(),
  });
  menuOpenRequestQueue.drain();
};

const startDailyUpdateChecks = (): void => {
  void checkForAppUpdatesIfDue();
  updateCheckTimer = setInterval(
    () => {
      void checkForAppUpdatesIfDue();
    },
    60 * 60 * 1_000,
  );
};

const openMenuFromShortcut = (): void => {
  if (menuBarController === undefined) {
    menuOpenRequestQueue.requestOpen();
    return;
  }

  menuBarController.openMenu();
};

const createMenuShortcut = (): void => {
  menuShortcutRegistrar = createMenuShortcutRegistrar({
    globalShortcut,
    openMenu: openMenuFromShortcut,
    reportError: reportMenuBarError,
  });
  updateMenuShortcutRegistration(appSettings.menuShortcutAccelerator);
};

const openMeetUrl = async (value: string): Promise<Result<void, AppError>> => {
  const canonicalized = canonicalizeMeetUrl(value);
  if (canonicalized.isErr()) {
    return err(canonicalized.error);
  }

  return meetWindowManager.openMeetUrl(canonicalized.value);
};

const ignoreAutoOpenError = (_error: AppError): void => undefined;

const registerIpc = (scheduler: AutoOpenScheduler) => {
  calendarSyncService.subscribe((snapshot) => {
    const result = serializeResultForRenderer(ok(snapshot));
    menuBarController?.updateMeetings(snapshot);
    if (mainWindow !== undefined && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IPC_CHANNELS.calendarUpdated, result);
    }
    void scheduler
      .evaluate(snapshot)
      .then((autoOpenResult) => autoOpenResult.match(() => undefined, ignoreAutoOpenError))
      .catch(() => undefined);
  });

  ipcMain.handle(IPC_CHANNELS.accountGetStatus, async () =>
    serializeResultForRenderer(await calendarSyncService.getAccountStatus()),
  );
  ipcMain.handle(IPC_CHANNELS.accountConnect, async () =>
    serializeResultForRenderer(await calendarSyncService.connectAccount()),
  );
  ipcMain.handle(IPC_CHANNELS.accountDisconnect, async () =>
    serializeResultForRenderer(await calendarSyncService.disconnectAccount()),
  );
  ipcMain.handle(IPC_CHANNELS.calendarSyncNow, async () =>
    serializeResultForRenderer(await calendarSyncService.syncNow()),
  );
  ipcMain.handle(IPC_CHANNELS.meetListUpcoming, () =>
    serializeResultForRenderer(calendarSyncService.listUpcomingMeetings()),
  );
  ipcMain.handle(IPC_CHANNELS.meetOpen, async (_event, meetUrl: string) =>
    serializeResultForRenderer(
      meetUrlSchema.safeParse(meetUrl).success
        ? await openMeetUrl(meetUrl)
        : err({ type: "MeetUrlNotFound", eventId: "unknown" }),
    ),
  );
  ipcMain.handle(IPC_CHANNELS.settingsGet, () => serializeResultForRenderer(ok(appSettings)));
  ipcMain.handle(IPC_CHANNELS.settingsUpdate, (_event, settings: unknown) =>
    serializeResultForRenderer(updateAppSettings(settings)),
  );
  ipcMain.handle(IPC_CHANNELS.settingsMenuShortcutStatusGet, () =>
    serializeResultForRenderer(ok(menuShortcutStatus)),
  );
  ipcMain.handle(IPC_CHANNELS.updatesGetStatus, () =>
    serializeResultForRenderer(ok(getAppUpdateStatus())),
  );
  ipcMain.handle(IPC_CHANNELS.updatesCheck, async () =>
    serializeResultForRenderer(await checkForAppUpdates()),
  );
  ipcMain.handle(IPC_CHANNELS.updatesRunHomebrewUpdate, async () =>
    serializeResultForRenderer(await runHomebrewAppUpdate()),
  );
};

const registerProtocolClient = (): void => {
  const options = protocolClientRegistrationOptions({
    argv: process.argv,
    defaultApp: electronProcess.defaultApp,
    execPath: process.execPath,
  });

  if (options.executable !== undefined) {
    app.setAsDefaultProtocolClient(nextRoomProtocolScheme, options.executable, options.args);
    return;
  }

  app.setAsDefaultProtocolClient(nextRoomProtocolScheme);
};

if (!appCanStart) {
  app.quit();
} else {
  void app.whenReady().then(() => {
    registerProtocolClient();
    appSettings = loadAppSettings();
    if (process.platform === "darwin") {
      app.dock?.hide();
    }
    configureMeetSessionPermissions(session.fromPartition(meetSessionPartition));
    configureAppUpdater();
    const scheduler = createAutoOpenScheduler({
      activatedAt: new Date(),
      autoJoinMeetUrl: meetWindowManager.autoJoinMeetUrl,
      deduper: createLaunchDeduper(),
      hasBlockingMeetWindow: meetWindowManager.hasOpenMeetWindowExcept,
      joinDeduper: createLaunchDeduper(),
      openMeetUrl,
      // updateAppSettings mutates this object in place so the scheduler observes runtime changes.
      settings: appSettings,
    });
    autoOpenScheduler = scheduler;
    registerIpc(scheduler);
    createMenuBar();
    createMenuShortcut();
    subscribeAppUpdateStatus((status) => {
      menuBarController?.updateUpdateStatus(status);
      meetWindowManager.updateUpdateStatus(status);
    });
    calendarSyncService.startPolling();

    startDailyUpdateChecks();

    app.on("activate", () => {
      if (mainWindow === undefined || mainWindow.isDestroyed()) {
        showSettingsWindow();
      }
    });
  });
}

app.on("window-all-closed", () => undefined);
app.on("will-quit", () => {
  if (updateCheckTimer !== undefined) {
    clearInterval(updateCheckTimer);
  }
  menuShortcutRegistrar?.unregister();
});
