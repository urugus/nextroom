import { createRequire } from "node:module";
import { join } from "node:path";
import { createKeychainTokenStore } from "@main/adapters/keychainTokenStore";
import { createGoogleCalendarClient } from "@main/calendar/calendarClient";
import { createCalendarSyncService } from "@main/calendar/calendarSyncService";
import { canonicalizeMeetUrl, isMeetUrl } from "@main/calendar/meetExtractor";
import { createGoogleAuthService } from "@main/oauth/googleAuthService";
import { createOAuthClient } from "@main/oauth/oauthClient";
import {
  checkForAppUpdates,
  configureAppUpdater,
  getAppUpdateStatus,
  runHomebrewAppUpdate,
} from "@main/updater/appUpdater";
import type { AppError } from "@shared/errors";
import { IPC_CHANNELS } from "@shared/ipc";
import type { BrowserWindow as ElectronBrowserWindow } from "electron";
import * as keytar from "keytar";
import { err, fromThrowable, ok, type Result } from "neverthrow";
import { z } from "zod";
import { serializeResultForRenderer } from "./ipc/result";

const nodeRequire = createRequire(import.meta.url);
const { app, BrowserWindow, ipcMain, session, shell } = nodeRequire(
  "electron",
) as typeof import("electron");

let mainWindow: ElectronBrowserWindow | undefined;
const meetWindows = new Set<ElectronBrowserWindow>();
const meetUrlSchema = z.string().url();
const tokenStore = createKeychainTokenStore(keytar);
const oauthClient = createOAuthClient();
const authService = createGoogleAuthService({
  clientId: process.env.NEXTROOM_GOOGLE_CLIENT_ID,
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
        width: 1120,
        height: 760,
        minWidth: 900,
        minHeight: 620,
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
        partition: "persist:meet",
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    }),
  (cause): AppError => ({ type: "MeetWindowFailed", cause }),
);

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

const configureMeetSessionPermissions = () => {
  session
    .fromPartition("persist:meet")
    .setPermissionRequestHandler((webContents, permission, callback) => {
      const currentUrl = webContents.getURL();
      const allowed =
        currentUrl.startsWith("https://meet.google.com/") &&
        (permission === "media" || permission === "notifications");
      callback(allowed);
    });
};

const openMeetUrl = async (value: string): Promise<Result<void, AppError>> => {
  const canonicalized = canonicalizeMeetUrl(value);
  if (canonicalized.isErr()) {
    return err(canonicalized.error);
  }

  const created = createMeetWindow();
  if (created.isErr()) {
    return err(created.error);
  }

  const meetWindow = created.value;
  meetWindows.add(meetWindow);
  meetWindow.on("closed", () => {
    meetWindows.delete(meetWindow);
  });

  try {
    await meetWindow.loadURL(canonicalized.value);
    return ok(undefined);
  } catch (cause) {
    if (!meetWindow.isDestroyed()) {
      meetWindow.destroy();
    }
    return err({ type: "MeetWindowFailed", cause });
  }
};

const registerIpc = () => {
  calendarSyncService.subscribe((snapshot) => {
    const result = serializeResultForRenderer(ok(snapshot));
    if (mainWindow !== undefined && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IPC_CHANNELS.calendarUpdated, result);
    }
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
  configureMeetSessionPermissions();
  configureAppUpdater();
  registerIpc();
  calendarSyncService.startPolling();
  const created = createMainWindow();

  if (created.isErr()) {
    throw new Error(created.error.type);
  }

  mainWindow = created.value;

  void checkForAppUpdates();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      const activated = createMainWindow();
      if (activated.isOk()) {
        mainWindow = activated.value;
      }
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
