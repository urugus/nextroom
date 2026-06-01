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
import { type AutoOpenScheduler, createAutoOpenScheduler } from "@main/scheduler/autoOpenScheduler";
import { createLaunchDeduper } from "@main/scheduler/launchDeduper";
import {
  defaultAppSettings,
  parseSettingsUpdate,
  parseStoredAppSettings,
  validateAppSettings,
} from "@main/settings/appSettings";
import {
  checkForAppUpdates,
  configureAppUpdater,
  getAppUpdateStatus,
  runHomebrewAppUpdate,
} from "@main/updater/appUpdater";
import type { AppError } from "@shared/errors";
import { IPC_CHANNELS } from "@shared/ipc";
import type { AppSettings } from "@shared/types";
import type { BrowserWindow as ElectronBrowserWindow } from "electron";
import { err, fromThrowable, ok, type Result } from "neverthrow";
import { z } from "zod";
import { serializeResultForRenderer } from "./ipc/result";

const nodeRequire = createRequire(import.meta.url);
const { app, BrowserWindow, Menu, Tray, ipcMain, nativeImage, session, shell } = nodeRequire(
  "electron",
) as typeof import("electron");
const keytar = nodeRequire("keytar") as typeof import("keytar");

let mainWindow: ElectronBrowserWindow | undefined;
let menuBarController: MenuBarController | undefined;
let autoOpenScheduler: AutoOpenScheduler | undefined;
const meetUrlSchema = z.string().url();
const settingsFileName = "settings.json";
const menuBarLogFileName = "menu-bar.log";
let appSettings: AppSettings = { ...defaultAppSettings };

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

const updateAppSettings = (value: unknown): Result<AppSettings, AppError> => {
  const parsed = parseSettingsUpdate(value);
  if (parsed.isErr()) return err(parsed.error);

  const nextSettings = { ...appSettings, ...parsed.value };
  const validated = validateAppSettings(nextSettings);
  if (validated.isErr()) return validated;

  const saved = saveAppSettings(nextSettings);
  if (saved.isErr()) return saved;

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

const createMeetWindow = fromThrowable(
  () =>
    new BrowserWindow({
      width: 1280,
      height: 820,
      minWidth: 960,
      minHeight: 640,
      title: "Meet",
      webPreferences: {
        partition: meetSessionPartition,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    }),
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
    showSettingsWindow: () => {
      const result = showSettingsWindow();
      if (result.isErr()) {
        reportMenuBarError("Failed to open settings from the menu bar.", result.error);
      }
    },
    syncNow: () => calendarSyncService.syncNow(),
  });
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

void app.whenReady().then(() => {
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
    settings: appSettings,
  });
  autoOpenScheduler = scheduler;
  registerIpc(scheduler);
  createMenuBar();
  calendarSyncService.startPolling();

  void checkForAppUpdates();

  app.on("activate", () => {
    if (mainWindow === undefined || mainWindow.isDestroyed()) {
      showSettingsWindow();
    }
  });
});

app.on("window-all-closed", () => undefined);
