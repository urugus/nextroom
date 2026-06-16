import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createKeychainTokenStore } from "@main/adapters/keychainTokenStore";
import { createGoogleCalendarClient } from "@main/calendar/calendarClient";
import { createCalendarSyncService } from "@main/calendar/calendarSyncService";
import { canonicalizeMeetUrl, isMeetUrl } from "@main/calendar/meetExtractor";
import { createIpcSenderGuard, type IpcSenderGuard } from "@main/ipc/senderGuard";
import { parseLogLevel } from "@main/logging/format";
import { createLazyLogger, createLogger, type Logger } from "@main/logging/logger";
import { createBubbleMessageGate, sanitizeBubbleMessageText } from "@main/meet/bubbleMessage";
import { closeMeetContentsOnWindowClosed } from "@main/meet/meetContentsLifecycle";
import {
  type CapturableScreenShareSource,
  configureMeetDisplayMediaHandler,
} from "@main/meet/meetDisplayMedia";
import { meetNavigationActionFor, meetWindowOpenActionFor } from "@main/meet/meetNavigationPolicy";
import {
  configureMeetSessionPermissions,
  meetSessionPartition,
} from "@main/meet/meetSessionPermissions";
import {
  type BubbleTextMessage,
  createMeetWindowManager,
  type ManagedMeetWindow,
} from "@main/meet/meetWindowManager";
import { createMenuBarController, type MenuBarController } from "@main/menuBar/menuBarController";
import { createTrayIcon } from "@main/menuBar/trayIcon";
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
import type {
  AppSettings,
  AppUpdateStatus,
  CameraBubbleConfig,
  CameraBubbleMeetViewConfig,
  CameraBubbleShellState,
  MenuShortcutStatus,
  ScreenShareSource,
} from "@shared/types";
import type {
  BrowserWindow as ElectronBrowserWindow,
  IpcMainInvokeEvent,
  Session,
  WebContents,
} from "electron";
import { err, fromThrowable, ok, type Result } from "neverthrow";
import { z } from "zod";
import { serializeResultForRenderer } from "./ipc/result";

const nodeRequire = createRequire(import.meta.url);
const {
  app,
  BrowserWindow,
  dialog,
  desktopCapturer,
  Menu,
  Tray,
  WebContentsView,
  globalShortcut,
  ipcMain,
  nativeImage,
  session,
  shell,
  systemPreferences,
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
type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];
type TrustedIpcHandler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown;
const settingsFileName = "settings.json";
let appSettings: AppSettings = { ...defaultAppSettings };
let pinnedBubbleText: string | undefined;
let ipcSenderGuard: IpcSenderGuard;
const bubbleMessageGate = createBubbleMessageGate();
const meetShellLayoutControllers = new WeakMap<WebContents, (settingsPanelOpen: boolean) => void>();
const appCanStart = app.requestSingleInstanceLock();
const electronProcess = process as NodeJS.Process & { defaultApp?: boolean };
const createMainLogger = (): Logger =>
  createLazyLogger(() =>
    createLogger({
      dir: app.getPath("logs"),
      level: parseLogLevel(process.env.NEXTROOM_LOG_LEVEL),
    }),
  );
const logger = createMainLogger();
const menuBarLogger = logger.child("menuBar");
const schedulerLogger = logger.child("scheduler");

process.on("uncaughtException", (error) => {
  logger.error("uncaught exception", error);
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  logger.error("unhandled rejection", reason);
});

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

const cameraBubbleConfigFor = (settings: AppSettings): CameraBubbleConfig => ({
  chatMirrorEnabled: settings.cameraBubbleChatMirrorEnabled,
  displaySpeedLevel: settings.cameraBubbleDisplaySpeedLevel,
  enabled: settings.cameraBubbleEnabled,
  screenShareDanmakuEnabled: settings.cameraBubbleScreenShareDanmakuEnabled,
  sidebarHidden: settings.cameraBubbleSidebarHidden,
});

const cameraBubbleShellStateFor = (
  config: CameraBubbleConfig,
  pinnedText: string | undefined = pinnedBubbleText,
): CameraBubbleShellState => ({
  chatMirrorEnabled: config.chatMirrorEnabled,
  displaySpeedLevel: config.displaySpeedLevel,
  enabled: config.enabled,
  screenShareDanmakuEnabled: config.screenShareDanmakuEnabled,
  ...(!config.enabled || pinnedText === undefined ? {} : { pinnedText }),
  sidebarHidden: config.sidebarHidden,
});

const cameraBubbleMeetViewConfigFor = ({
  chatMirrorEnabled,
  displaySpeedLevel,
  enabled,
  screenShareDanmakuEnabled,
}: CameraBubbleConfig): CameraBubbleMeetViewConfig => ({
  chatMirrorEnabled,
  displaySpeedLevel,
  enabled,
  screenShareDanmakuEnabled,
});

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
  const previousCameraBubbleChatMirrorEnabled = appSettings.cameraBubbleChatMirrorEnabled;
  const previousCameraBubbleEnabled = appSettings.cameraBubbleEnabled;
  const previousCameraBubbleScreenShareDanmakuEnabled =
    appSettings.cameraBubbleScreenShareDanmakuEnabled;
  const previousCameraBubbleSidebarHidden = appSettings.cameraBubbleSidebarHidden;
  const previousCameraBubbleDisplaySpeedLevel = appSettings.cameraBubbleDisplaySpeedLevel;
  const shortcutChanged =
    "menuShortcutAccelerator" in parsed.value &&
    nextSettings.menuShortcutAccelerator !== previousShortcutAccelerator;
  const cameraBubbleChanged =
    ("cameraBubbleEnabled" in parsed.value &&
      nextSettings.cameraBubbleEnabled !== previousCameraBubbleEnabled) ||
    ("cameraBubbleChatMirrorEnabled" in parsed.value &&
      nextSettings.cameraBubbleChatMirrorEnabled !== previousCameraBubbleChatMirrorEnabled) ||
    ("cameraBubbleScreenShareDanmakuEnabled" in parsed.value &&
      nextSettings.cameraBubbleScreenShareDanmakuEnabled !==
        previousCameraBubbleScreenShareDanmakuEnabled) ||
    ("cameraBubbleSidebarHidden" in parsed.value &&
      nextSettings.cameraBubbleSidebarHidden !== previousCameraBubbleSidebarHidden) ||
    ("cameraBubbleDisplaySpeedLevel" in parsed.value &&
      nextSettings.cameraBubbleDisplaySpeedLevel !== previousCameraBubbleDisplaySpeedLevel);

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
  if (cameraBubbleChanged) {
    if (!appSettings.cameraBubbleEnabled && pinnedBubbleText !== undefined) {
      pinnedBubbleText = undefined;
      meetWindowManager.updatePinnedBubbleText(undefined);
    }
    meetWindowManager.setBubbleConfig(cameraBubbleConfigFor(appSettings));
  }
  return ok(appSettings);
};

const tokenStore = createKeychainTokenStore(keytar);
const oauthClient = createOAuthClient();
const authService = createGoogleAuthService({
  clientId: process.env.NEXTROOM_GOOGLE_CLIENT_ID,
  clientSecret: process.env.NEXTROOM_GOOGLE_CLIENT_SECRET,
  logger: logger.child("oauth"),
  tokenStore,
  oauthClient,
  openExternal: (url) => shell.openExternal(url).then(() => undefined),
});
const calendarSyncService = createCalendarSyncService({
  authService,
  calendarClient: createGoogleCalendarClient(),
  logger: logger.child("calendar"),
});

const createBrowserWindow = (title: string, errorType: "MainWindowFailed" | "MeetWindowFailed") =>
  fromThrowable(
    () => {
      const window = new BrowserWindow({
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
      });
      ipcSenderGuard.trustWindow(window);
      return window;
    },
    (cause): AppError => ({ type: errorType, cause }),
  )();

const meetShellHeight = 38;
const bubbleSettingsPanelReservedHeight = 150;
const bubbleSidebarWidth = 260;
const strictRendererCsp = [
  "default-src 'self'",
  "base-uri 'none'",
  "connect-src 'self'",
  "form-action 'none'",
  "frame-ancestors 'none'",
  "img-src 'self' data:",
  "object-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
].join("; ");
const devRendererCsp = strictRendererCsp
  .replace("connect-src 'self'", "connect-src 'self' ws://localhost:* ws://127.0.0.1:*")
  .replace("script-src 'self'", "script-src 'self' 'unsafe-inline'");
const rendererCspSessions = new WeakSet<Session>();

const isAllowedDevRendererNavigation = (
  targetUrl: string,
  rendererUrl: string | undefined,
): boolean => {
  if (rendererUrl === undefined) return false;

  try {
    return new URL(targetUrl).origin === new URL(rendererUrl).origin;
  } catch {
    return false;
  }
};

const applyMainWindowNavigationPolicy = (
  contents: WebContents,
  rendererUrl: string | undefined,
): void => {
  contents.on("will-navigate", (event, url) => {
    if (isAllowedDevRendererNavigation(url, rendererUrl)) return;

    event.preventDefault();
  });
  contents.on("will-redirect", (event, url, _isInPlace, isMainFrame) => {
    if (!isMainFrame) return;
    if (isAllowedDevRendererNavigation(url, rendererUrl)) return;

    event.preventDefault();
  });
};

const applyRendererCsp = (contents: WebContents, rendererUrl: string | undefined): void => {
  if (rendererCspSessions.has(contents.session)) return;

  const rendererCsp = rendererUrl === undefined ? strictRendererCsp : devRendererCsp;

  contents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [rendererCsp],
      },
    });
  });
  rendererCspSessions.add(contents.session);
};

const attachWebContentsLogging = (contents: WebContents, scope: string): void => {
  const contentsLogger = logger.child(scope);
  contents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    contentsLogger.error("web contents load failed", {
      errorCode,
      errorDescription,
      validatedURL,
      isMainFrame,
    });
  });
  contents.on("render-process-gone", (_event, details) => {
    contentsLogger.error("render process gone", details);
  });
  contents.on("unresponsive", () => {
    contentsLogger.warn("web contents unresponsive");
  });
};

const applyMeetNavigation = (url: string): boolean => {
  const action = meetNavigationActionFor(url);

  if (action.type === "allow") return true;
  if (action.type === "openExternal") {
    void shell.openExternal(action.url);
  }

  return false;
};

const applyMeetWindowOpen = (url: string): void => {
  const action = meetWindowOpenActionFor(url);

  if (action.type === "openExternal") {
    void shell.openExternal(action.url);
  }
};

const lockAppControlledWindowNavigation = (contents: WebContents): void => {
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
  contents.on("will-navigate", (event) => {
    event.preventDefault();
  });
  contents.on("will-redirect", (event) => {
    event.preventDefault();
  });
};

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
        gap: 8px;
        height: ${meetShellHeight}px;
        padding: 0 12px 0 78px;
        border-bottom: 1px solid #d6d6d8;
        background: #f5f5f7;
      }
      #bubble-settings-panel {
        box-sizing: border-box;
        display: none;
        position: fixed;
        top: ${meetShellHeight + 8}px;
        right: 12px;
        z-index: 2;
        width: 260px;
        padding: 12px;
        border: 1px solid rgba(120, 120, 128, 0.22);
        border-radius: 8px;
        background: rgba(255, 255, 255, 0.88);
        box-shadow: 0 10px 32px rgba(0, 0, 0, 0.18);
        backdrop-filter: blur(18px);
      }
      #bubble-settings-panel.open {
        display: flex;
        flex-direction: column;
        gap: 10px;
      }
      .bubble-setting-row {
        -webkit-app-region: no-drag;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        color: #1d1d1f;
        font-size: 12px;
        line-height: 1.35;
      }
      .bubble-setting-row span {
        min-width: 0;
      }
      .bubble-setting-row input[type="checkbox"] {
        flex: 0 0 auto;
      }
      .bubble-setting-row input[type="range"] {
        width: 118px;
      }
      #bubble-speed-value {
        min-width: 34px;
        color: #6e6e73;
        text-align: right;
      }
      #bubble-sidebar {
        box-sizing: border-box;
        display: none;
        position: fixed;
        top: ${meetShellHeight}px;
        right: 0;
        bottom: 0;
        width: ${bubbleSidebarWidth}px;
        flex-direction: column;
        gap: 10px;
        padding: 12px;
        border-left: 1px solid #d6d6d8;
        background: #f5f5f7;
      }
      #bubble-sidebar-content {
        box-sizing: border-box;
        display: flex;
        flex-direction: column;
        gap: 10px;
        width: 100%;
        height: 100%;
        max-height: 100%;
        min-height: 0;
      }
      #bubble-sidebar h1 {
        margin: 0;
        color: #1d1d1f;
        font-size: 13px;
        font-weight: 600;
        line-height: 1.3;
      }
      #bubble-history {
        display: none;
        flex: 1 1 auto;
        min-height: 0;
        margin: 0;
        padding: 0;
        list-style: none;
        overflow-y: auto;
      }
      #bubble-history.visible {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      #bubble-history li {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 8px;
        align-items: center;
        border: 1px solid #dedee1;
        border-radius: 7px;
        background: #ffffff;
        color: #1d1d1f;
        font-size: 12px;
        line-height: 1.45;
        overflow-wrap: anywhere;
        padding: 7px 9px;
        white-space: pre-wrap;
      }
      .bubble-history-text {
        min-width: 0;
      }
      #bubble-composer {
        display: flex;
        flex: 0 0 auto;
        flex-direction: column;
        gap: 8px;
        margin-top: auto;
      }
      #bubble-pinned {
        display: none;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 8px;
        align-items: center;
        border: 1px solid rgba(0, 122, 255, 0.28);
        border-radius: 7px;
        background: rgba(0, 122, 255, 0.08);
        color: #1d1d1f;
        font-size: 12px;
        line-height: 1.45;
        overflow-wrap: anywhere;
        padding: 7px 9px;
        white-space: pre-wrap;
      }
      #bubble-pinned.visible {
        display: grid;
      }
      #bubble-pinned-text {
        min-width: 0;
      }
      #bubble-sidebar p {
        margin: 0;
        color: #6e6e73;
        font-size: 11px;
        line-height: 1.4;
      }
      #bubble-actions {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 8px;
      }
      #bubble-input {
        -webkit-app-region: no-drag;
        box-sizing: border-box;
        display: block;
        width: 100%;
        min-height: 84px;
        max-height: 160px;
        border: 1px solid #c4c4c6;
        border-radius: 6px;
        background: #ffffff;
        color: #1d1d1f;
        font: inherit;
        font-size: 12px;
        line-height: 1.45;
        outline: none;
        padding: 4px 9px;
        resize: none;
      }
      #bubble-input:focus {
        border-color: #0071e3;
        box-shadow: 0 0 0 2px rgba(0, 113, 227, 0.18);
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
      #bubble-toggle {
        border-color: #c4c4c6;
        background: #ffffff;
        color: #1d1d1f;
      }
      #bubble-settings-toggle {
        display: inline-flex;
        border-color: #c4c4c6;
        background: #ffffff;
        color: #1d1d1f;
      }
      #bubble-toggle:hover,
      #bubble-settings-toggle:hover {
        border-color: #9f9fa3;
        background: #fdfdfd;
      }
      #bubble-pin {
        display: inline-flex;
        border-color: #6e6e73;
        background: #2c2c2e;
      }
      #bubble-send {
        display: inline-flex;
      }
      .bubble-history-pin,
      #bubble-unpin {
        display: inline-flex;
        border-color: #c4c4c6;
        background: #ffffff;
        color: #1d1d1f;
        font-size: 11px;
        padding: 4px 7px;
      }
    </style>
  </head>
  <body>
    <div class="bar">
      <button
        type="button"
        id="bubble-settings-toggle"
        aria-controls="bubble-settings-panel"
        aria-expanded="false"
      >Bubble</button>
      <button
        type="button"
        id="bubble-toggle"
        aria-controls="bubble-sidebar"
        aria-expanded="false"
      >Hide panel</button>
      <button type="button" id="update-button">Update</button>
    </div>
    <div id="bubble-settings-panel" role="dialog" aria-label="Camera bubble settings">
      <label class="bubble-setting-row">
        <span>Accept bubble input</span>
        <input type="checkbox" id="bubble-enabled">
      </label>
      <label class="bubble-setting-row">
        <span>Mirror Meet chat</span>
        <input type="checkbox" id="bubble-mirror">
      </label>
      <label class="bubble-setting-row">
        <span>Screen share comments</span>
        <input type="checkbox" id="bubble-share-danmaku">
      </label>
      <label class="bubble-setting-row">
        <span>Speed</span>
        <input type="range" id="bubble-speed" min="1" max="5" step="1">
        <span id="bubble-speed-value">3 / 5</span>
      </label>
    </div>
    <aside id="bubble-sidebar">
      <div id="bubble-sidebar-content">
        <h1 id="bubble-sidebar-title">Camera bubble</h1>
        <div id="bubble-pinned" aria-live="polite">
          <span id="bubble-pinned-text"></span>
          <button type="button" id="bubble-unpin">Unpin</button>
        </div>
        <ol id="bubble-history" aria-label="Camera bubble history"></ol>
        <div id="bubble-composer">
          <textarea
            id="bubble-input"
            rows="4"
            placeholder="Type text to show on your camera…"
            aria-labelledby="bubble-sidebar-title"
            aria-describedby="bubble-sidebar-hint"
          ></textarea>
          <div id="bubble-actions">
            <button type="button" id="bubble-send">Send</button>
            <button type="button" id="bubble-pin">Pin</button>
          </div>
          <p id="bubble-sidebar-hint">Press Enter to send. Shift+Enter adds a new line.</p>
        </div>
      </div>
    </aside>
  </body>
</html>`;

const meetShellUrl = (): string =>
  `data:text/html;charset=utf-8,${encodeURIComponent(meetShellHtml())}`;

ipcSenderGuard = createIpcSenderGuard({
  appRendererFileUrl: pathToFileURL(join(__dirname, "../renderer/index.html")).toString(),
  appRendererUrl: process.env.ELECTRON_RENDERER_URL,
  meetShellUrl: meetShellUrl(),
});

const screenSharePickerHtml = (): string => `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <style>
      :root {
        color: #1d1d1f;
        background: #f5f5f7;
        font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif;
      }
      * {
        box-sizing: border-box;
      }
      body {
        margin: 0;
        min-height: 100vh;
      }
      header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        padding: 18px 22px 12px;
        border-bottom: 1px solid #d6d6d8;
        background: #fbfbfd;
      }
      h1 {
        margin: 0;
        font-size: 17px;
        font-weight: 650;
        line-height: 1.2;
      }
      .actions {
        display: flex;
        gap: 8px;
      }
      button {
        min-height: 30px;
        border: 1px solid #c7c7cc;
        border-radius: 6px;
        background: #ffffff;
        color: #1d1d1f;
        cursor: pointer;
        font: inherit;
        font-size: 13px;
        line-height: 1;
        padding: 6px 12px;
      }
      button.primary {
        border-color: #0071e3;
        background: #007aff;
        color: #ffffff;
      }
      button:disabled {
        border-color: #c4c4c6;
        background: #e5e5e7;
        color: #6e6e73;
        cursor: default;
      }
      main {
        padding: 18px 22px 22px;
      }
      .grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
        gap: 14px;
      }
      .source {
        display: grid;
        grid-template-rows: 118px auto;
        min-width: 0;
        overflow: hidden;
        border: 2px solid transparent;
        border-radius: 8px;
        background: #ffffff;
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
        cursor: pointer;
        padding: 0;
        text-align: left;
      }
      .source[aria-selected="true"] {
        border-color: #007aff;
      }
      .thumb {
        width: 100%;
        height: 118px;
        object-fit: cover;
        background: #e8e8ed;
      }
      .meta {
        display: grid;
        grid-template-columns: 20px 1fr;
        gap: 8px;
        align-items: center;
        min-width: 0;
        padding: 10px;
      }
      .icon {
        width: 20px;
        height: 20px;
        object-fit: contain;
      }
      .fallback-icon {
        display: grid;
        place-items: center;
        width: 20px;
        height: 20px;
        border-radius: 5px;
        background: #e8e8ed;
        color: #424245;
        font-size: 11px;
        font-weight: 650;
      }
      .text {
        min-width: 0;
      }
      .name {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: 13px;
        font-weight: 600;
      }
      .kind {
        margin-top: 3px;
        color: #6e6e73;
        font-size: 12px;
        text-transform: capitalize;
      }
      .empty {
        color: #6e6e73;
        font-size: 13px;
      }
    </style>
  </head>
  <body>
    <header>
      <h1>Share screen</h1>
      <div class="actions">
        <button type="button" id="cancel-button">Cancel</button>
        <button type="button" id="share-button" class="primary" disabled>Share</button>
      </div>
    </header>
    <main>
      <div id="sources" class="grid"></div>
    </main>
    <script>
      const sourcesEl = document.getElementById("sources");
      const cancelButton = document.getElementById("cancel-button");
      const shareButton = document.getElementById("share-button");
      let selectedSourceId;

      const renderIcon = (source) => {
        if (source.appIconDataUrl) {
          const icon = document.createElement("img");
          icon.className = "icon";
          icon.alt = "";
          icon.src = source.appIconDataUrl;
          return icon;
        }

        const fallback = document.createElement("div");
        fallback.className = "fallback-icon";
        fallback.textContent = source.kind === "screen" ? "S" : "W";
        return fallback;
      };

      const selectSource = (sourceId) => {
        selectedSourceId = sourceId;
        for (const button of sourcesEl.querySelectorAll(".source")) {
          button.setAttribute("aria-selected", String(button.dataset.sourceId === sourceId));
        }
        shareButton.disabled = false;
      };

      const renderSources = (sources) => {
        sourcesEl.textContent = "";
        if (sources.length === 0) {
          const empty = document.createElement("p");
          empty.className = "empty";
          empty.textContent = "No screens or windows are available.";
          sourcesEl.append(empty);
          return;
        }

        for (const source of sources) {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "source";
          button.dataset.sourceId = source.id;
          button.setAttribute("aria-selected", "false");

          const thumbnail = document.createElement("img");
          thumbnail.className = "thumb";
          thumbnail.alt = "";
          thumbnail.src = source.thumbnailDataUrl;

          const meta = document.createElement("div");
          meta.className = "meta";
          const text = document.createElement("div");
          text.className = "text";
          const name = document.createElement("div");
          name.className = "name";
          name.textContent = source.name;
          const kind = document.createElement("div");
          kind.className = "kind";
          kind.textContent = source.kind;
          text.append(name, kind);
          meta.append(renderIcon(source), text);

          button.append(thumbnail, meta);
          button.addEventListener("click", () => selectSource(source.id));
          button.addEventListener("dblclick", () => {
            void window.screenSharePicker.selectSource(source.id);
          });
          sourcesEl.append(button);
        }
      };

      cancelButton.addEventListener("click", () => {
        void window.screenSharePicker.cancel();
      });
      shareButton.addEventListener("click", () => {
        if (selectedSourceId !== undefined) {
          void window.screenSharePicker.selectSource(selectedSourceId);
        }
      });

      window.screenSharePicker.listSources().then(renderSources).catch(() => {
        renderSources([]);
      });
    </script>
  </body>
</html>`;

type ScreenSharePickerState = {
  resolve: (source: ScreenShareSource | undefined) => void;
  settled: boolean;
  sources: ScreenShareSource[];
  window: ElectronBrowserWindow;
};
let activeScreenSharePicker: ScreenSharePickerState | undefined;

const finishScreenSharePicker = (
  state: ScreenSharePickerState,
  source: ScreenShareSource | undefined,
): void => {
  if (state.settled) return;

  state.settled = true;
  if (activeScreenSharePicker === state) {
    activeScreenSharePicker = undefined;
  }
  state.resolve(source);

  if (!state.window.isDestroyed()) {
    state.window.destroy();
  }
};

const openScreenSharePicker = (
  sources: ScreenShareSource[],
): Promise<ScreenShareSource | undefined> =>
  new Promise((resolve) => {
    if (activeScreenSharePicker !== undefined) {
      finishScreenSharePicker(activeScreenSharePicker, undefined);
    }

    let window: ElectronBrowserWindow;
    try {
      window = new BrowserWindow({
        width: 760,
        height: 560,
        minWidth: 560,
        minHeight: 420,
        show: false,
        title: "Share screen",
        webPreferences: {
          preload: join(__dirname, "../preload/screenSharePicker.cjs"),
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
        },
      });
    } catch (cause) {
      reportMenuBarError("Failed to create the screen share picker.", cause);
      resolve(undefined);
      return;
    }

    const state: ScreenSharePickerState = {
      resolve,
      settled: false,
      sources,
      window,
    };
    activeScreenSharePicker = state;

    const showPicker = (): void => {
      if (!window.isDestroyed()) {
        window.show();
        window.focus();
      }
    };

    lockAppControlledWindowNavigation(window.webContents);
    window.on("closed", () => {
      finishScreenSharePicker(state, undefined);
    });
    window.once("ready-to-show", showPicker);
    void window
      .loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(screenSharePickerHtml())}`)
      .then(showPicker)
      .catch((cause) => {
        reportMenuBarError("Failed to load the screen share picker.", cause);
        finishScreenSharePicker(state, undefined);
      });
  });

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
        preload: join(__dirname, "../preload/meetShell.cjs"),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    const meetView = new WebContentsView({
      webPreferences: {
        additionalArguments: [
          `--nextroom-camera-bubble=${appSettings.cameraBubbleEnabled ? "1" : "0"}`,
          `--nextroom-camera-bubble-chat=${appSettings.cameraBubbleChatMirrorEnabled ? "1" : "0"}`,
          `--nextroom-camera-bubble-share-danmaku=${appSettings.cameraBubbleScreenShareDanmakuEnabled ? "1" : "0"}`,
          `--nextroom-camera-bubble-speed=${appSettings.cameraBubbleDisplaySpeedLevel}`,
        ],
        backgroundThrottling: false,
        partition: meetSessionPartition,
        preload: join(__dirname, "../preload/meetInject.cjs"),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    attachWebContentsLogging(window.webContents, "meetShell");
    attachWebContentsLogging(meetView.webContents, "meetWindow");
    lockAppControlledWindowNavigation(window.webContents);
    meetView.webContents.setWindowOpenHandler(({ url }) => {
      applyMeetWindowOpen(url);
      return { action: "deny" };
    });
    meetView.webContents.on("will-navigate", (event, url) => {
      if (applyMeetNavigation(url)) return;

      event.preventDefault();
    });
    meetView.webContents.on("will-redirect", (event, url, _isInPlace, isMainFrame) => {
      if (!isMainFrame) return;
      if (applyMeetNavigation(url)) return;

      event.preventDefault();
    });
    const layoutState = {
      bubbleConfig: cameraBubbleConfigFor(appSettings),
      settingsPanelOpen: false,
    };
    const layout = (): void => {
      const bounds = window.getContentBounds();
      const sidebarWidth =
        layoutState.bubbleConfig.enabled && !layoutState.bubbleConfig.sidebarHidden
          ? bubbleSidebarWidth
          : 0;
      const meetViewTop =
        meetShellHeight + (layoutState.settingsPanelOpen ? bubbleSettingsPanelReservedHeight : 0);
      meetView.setBounds({
        height: Math.max(0, bounds.height - meetViewTop),
        width: Math.max(0, bounds.width - sidebarWidth),
        x: 0,
        y: meetViewTop,
      });
    };

    window.contentView.addChildView(meetView);
    closeMeetContentsOnWindowClosed(window, meetView.webContents);
    window.on("resize", layout);
    window.on("resized", layout);
    layout();
    meetShellLayoutControllers.set(window.webContents, (settingsPanelOpen) => {
      layoutState.settingsPanelOpen = settingsPanelOpen;
      layout();
    });
    ipcSenderGuard.trustWindow(window, { dataShell: true });
    window.webContents.on("did-finish-load", () => {
      window.webContents.send(
        IPC_CHANNELS.meetBubbleShellState,
        cameraBubbleShellStateFor(cameraBubbleConfigFor(appSettings)),
      );
    });
    meetView.webContents.on("did-finish-load", () => {
      meetView.webContents.send(
        IPC_CHANNELS.meetBubbleConfig,
        cameraBubbleMeetViewConfigFor(cameraBubbleConfigFor(appSettings)),
      );
    });
    void window.loadURL(meetShellUrl());

    return {
      destroy: () => window.destroy(),
      focus: () => window.focus(),
      isDestroyed: () => window.isDestroyed(),
      isMinimized: () => window.isMinimized(),
      loadURL: (url: string) => meetView.webContents.loadURL(url),
      on: (event: "closed", listener: () => void) => window.on(event, listener),
      restore: () => window.restore(),
      hideBubbleText: () => {
        meetView.webContents.send(IPC_CHANNELS.meetBubbleHide);
      },
      sendBubbleText: (message: BubbleTextMessage) => {
        meetView.webContents.send(IPC_CHANNELS.meetBubbleShow, message);
      },
      setAlwaysOnTop: (flag: boolean, level?: "screen-saver") => window.setAlwaysOnTop(flag, level),
      setBubbleConfig: (config: CameraBubbleConfig) => {
        layoutState.bubbleConfig = config;
        layout();
        meetView.webContents.send(
          IPC_CHANNELS.meetBubbleConfig,
          cameraBubbleMeetViewConfigFor(config),
        );
        window.webContents.send(
          IPC_CHANNELS.meetBubbleShellState,
          cameraBubbleShellStateFor(config),
        );
      },
      show: () => window.show(),
      updateUpdateStatus: (status: AppUpdateStatus) => {
        window.webContents.send(IPC_CHANNELS.updatesStatusChanged, status);
      },
      updatePinnedBubbleText: (text: string | undefined) => {
        window.webContents.send(
          IPC_CHANNELS.meetBubbleShellState,
          cameraBubbleShellStateFor(layoutState.bubbleConfig, text),
        );
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
  logger: logger.child("meet"),
  onWindowClosed: (meetUrl) => {
    autoOpenScheduler?.handleMeetWindowClosed(meetUrl);
  },
});

const createMainWindow = () =>
  createBrowserWindow("NextRoom", "MainWindowFailed").map((window) => {
    const rendererUrl = process.env.ELECTRON_RENDERER_URL;
    attachWebContentsLogging(window.webContents, "mainWindow");
    applyRendererCsp(window.webContents, rendererUrl);
    applyMainWindowNavigationPolicy(window.webContents, rendererUrl);
    window.webContents.setWindowOpenHandler(({ url }) => {
      if (isMeetUrl(url)) {
        void openMeetUrl(url);
      }

      return { action: "deny" };
    });

    if (rendererUrl !== undefined) {
      void window.loadURL(rendererUrl);
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

const reportMenuBarError = (message: string, cause: unknown): void => {
  menuBarLogger.error(message, { error: cause });
};

const createMenuBar = (): void => {
  menuBarController = createMenuBarController({
    buildMenuFromTemplate: (template) => Menu.buildFromTemplate(template),
    createTray: (icon) => new Tray(icon),
    icon: createTrayIcon({
      iconPath: join(__dirname, "../../assets/nextroom-tray-icon.png"),
      nativeImage,
    }),
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

const untrustedIpcSenderError = (): AppError => ({
  type: "IpcSenderRejected",
});

const handleTrustedIpc = (channel: IpcChannel, handler: TrustedIpcHandler): void => {
  ipcMain.handle(channel, async (event, ...args) => {
    if (!ipcSenderGuard.isTrustedEvent(event)) {
      return serializeResultForRenderer(err(untrustedIpcSenderError()));
    }

    return handler(event, ...args);
  });
};

const screenAccessStatus = ():
  | "denied"
  | "granted"
  | "not-determined"
  | "restricted"
  | "unknown" => {
  if (process.platform !== "darwin") return "granted";

  return systemPreferences.getMediaAccessStatus("screen");
};

const notifyScreenAccessDenied = (): void => {
  void dialog.showMessageBox({
    buttons: ["OK"],
    message: "Screen Recording permission is required to share your screen in Google Meet.",
    title: "Screen sharing unavailable",
    type: "warning",
  });
};

const registerScreenSharePickerIpc = (): void => {
  ipcMain.handle(IPC_CHANNELS.screenShareListSources, (event) => {
    const state = activeScreenSharePicker;
    if (state === undefined || event.sender !== state.window.webContents) return [];

    return state.sources;
  });

  ipcMain.handle(IPC_CHANNELS.screenShareSelectSource, (event, sourceId: unknown) => {
    const state = activeScreenSharePicker;
    if (state === undefined || event.sender !== state.window.webContents) return;
    if (typeof sourceId !== "string") return;

    finishScreenSharePicker(
      state,
      state.sources.find((source) => source.id === sourceId),
    );
  });

  ipcMain.handle(IPC_CHANNELS.screenShareCancel, (event) => {
    const state = activeScreenSharePicker;
    if (state === undefined || event.sender !== state.window.webContents) return;

    finishScreenSharePicker(state, undefined);
  });
};

const registerIpc = (scheduler: AutoOpenScheduler) => {
  registerScreenSharePickerIpc();

  calendarSyncService.subscribe((snapshot) => {
    const result = serializeResultForRenderer(ok(snapshot));
    menuBarController?.updateMeetings(snapshot);
    if (mainWindow !== undefined && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IPC_CHANNELS.calendarUpdated, result);
    }
    void scheduler
      .evaluate(snapshot)
      .then((autoOpenResult) =>
        autoOpenResult.match(
          () => undefined,
          // Per-event auto-open failures are already logged by the scheduler with context.
          () => undefined,
        ),
      )
      .catch((cause: unknown) => {
        schedulerLogger.error("auto-open evaluation threw", { error: cause });
      });
  });

  handleTrustedIpc(IPC_CHANNELS.accountGetStatus, async () =>
    serializeResultForRenderer(await calendarSyncService.getAccountStatus()),
  );
  handleTrustedIpc(IPC_CHANNELS.accountConnect, async () =>
    serializeResultForRenderer(await calendarSyncService.connectAccount()),
  );
  handleTrustedIpc(IPC_CHANNELS.accountDisconnect, async () =>
    serializeResultForRenderer(await calendarSyncService.disconnectAccount()),
  );
  handleTrustedIpc(IPC_CHANNELS.calendarSyncNow, async () =>
    serializeResultForRenderer(await calendarSyncService.syncNow()),
  );
  handleTrustedIpc(IPC_CHANNELS.meetListUpcoming, () =>
    serializeResultForRenderer(calendarSyncService.listUpcomingMeetings()),
  );
  handleTrustedIpc(IPC_CHANNELS.meetOpen, async (_event, meetUrl) => {
    const parsed = meetUrlSchema.safeParse(meetUrl);
    return serializeResultForRenderer(
      parsed.success
        ? await openMeetUrl(parsed.data)
        : err({ type: "MeetUrlNotFound", eventId: "unknown" }),
    );
  });
  handleTrustedIpc(IPC_CHANNELS.meetBubblePin, (_event, text) => {
    const parsed = z.string().safeParse(text);
    if (!parsed.success) {
      return serializeResultForRenderer(
        err({ type: "DatabaseFailed", cause: "Pinned bubble text must be a string." }),
      );
    }

    if (!appSettings.cameraBubbleEnabled) {
      return serializeResultForRenderer(ok(undefined));
    }

    const acceptedText = sanitizeBubbleMessageText(parsed.data);
    if (acceptedText.length === 0) {
      return serializeResultForRenderer(ok(undefined));
    }

    meetWindowManager.sendBubbleText({
      pinned: true,
      text: acceptedText,
    });
    pinnedBubbleText = acceptedText;
    meetWindowManager.updatePinnedBubbleText(acceptedText);
    return serializeResultForRenderer(ok(acceptedText));
  });
  handleTrustedIpc(IPC_CHANNELS.meetBubbleUnpin, () => {
    meetWindowManager.hideBubbleText();
    pinnedBubbleText = undefined;
    meetWindowManager.updatePinnedBubbleText(undefined);
    return serializeResultForRenderer(ok(undefined));
  });
  handleTrustedIpc(IPC_CHANNELS.meetBubbleSend, (_event, text) => {
    const parsed = z.string().safeParse(text);
    if (!parsed.success) {
      return serializeResultForRenderer(
        err({ type: "DatabaseFailed", cause: "Bubble text must be a string." }),
      );
    }

    if (!appSettings.cameraBubbleEnabled) {
      return serializeResultForRenderer(ok(undefined));
    }

    const acceptedText = bubbleMessageGate
      .accept(parsed.data, Date.now(), appSettings.cameraBubbleDisplaySpeedLevel)
      .match(
        (accepted) => {
          meetWindowManager.sendBubbleText({
            durationMs: accepted.durationMs,
            text: accepted.text,
          });
          return accepted.text;
        },
        () => undefined,
      );

    return serializeResultForRenderer(ok(acceptedText));
  });
  handleTrustedIpc(IPC_CHANNELS.meetBubbleSetSettingsPanelOpen, (event, open) => {
    const parsed = z.boolean().safeParse(open);
    if (!parsed.success) {
      return serializeResultForRenderer(
        err({ type: "DatabaseFailed", cause: "Settings panel open state must be a boolean." }),
      );
    }

    meetShellLayoutControllers.get(event.sender)?.(parsed.data);
    return serializeResultForRenderer(ok(undefined));
  });
  handleTrustedIpc(IPC_CHANNELS.meetBubbleSetSidebarHidden, (_event, hidden) => {
    const parsed = z.boolean().safeParse(hidden);
    if (!parsed.success) {
      return serializeResultForRenderer(
        err({ type: "DatabaseFailed", cause: "Sidebar hidden state must be a boolean." }),
      );
    }

    return serializeResultForRenderer(
      updateAppSettings({ cameraBubbleSidebarHidden: parsed.data }),
    );
  });
  handleTrustedIpc(IPC_CHANNELS.settingsGet, () => serializeResultForRenderer(ok(appSettings)));
  handleTrustedIpc(IPC_CHANNELS.settingsUpdate, (_event, settings) =>
    serializeResultForRenderer(updateAppSettings(settings)),
  );
  handleTrustedIpc(IPC_CHANNELS.settingsMenuShortcutStatusGet, () =>
    serializeResultForRenderer(ok(menuShortcutStatus)),
  );
  handleTrustedIpc(IPC_CHANNELS.updatesGetStatus, () =>
    serializeResultForRenderer(ok(getAppUpdateStatus())),
  );
  handleTrustedIpc(IPC_CHANNELS.updatesCheck, async () =>
    serializeResultForRenderer(await checkForAppUpdates()),
  );
  handleTrustedIpc(IPC_CHANNELS.updatesRunHomebrewUpdate, async () =>
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
    const meetSession = session.fromPartition(meetSessionPartition);
    configureMeetSessionPermissions(meetSession);
    configureMeetDisplayMediaHandler({
      chooseSource: openScreenSharePicker,
      getScreenAccessStatus: screenAccessStatus,
      getSources: () =>
        desktopCapturer.getSources({
          fetchWindowIcons: true,
          thumbnailSize: { height: 180, width: 320 },
          types: ["screen", "window"],
        }) as Promise<CapturableScreenShareSource[]>,
      meetSession,
      notifyScreenAccessDenied,
    });
    configureAppUpdater();
    const scheduler = createAutoOpenScheduler({
      activatedAt: new Date(),
      autoJoinMeetUrl: meetWindowManager.autoJoinMeetUrl,
      deduper: createLaunchDeduper(),
      hasBlockingMeetWindow: meetWindowManager.hasOpenMeetWindowExcept,
      joinDeduper: createLaunchDeduper(),
      logger: schedulerLogger,
      openMeetUrl,
      // updateAppSettings mutates this object in place so the scheduler observes runtime changes.
      settings: appSettings,
    });
    autoOpenScheduler = scheduler;
    registerIpc(scheduler);
    try {
      createMenuBar();
    } catch (cause) {
      reportMenuBarError("Failed to create the menu bar.", cause);
      app.quit();
      return;
    }

    createMenuShortcut();
    subscribeAppUpdateStatus((status) => {
      menuBarController?.updateUpdateStatus(status);
    });
    calendarSyncService.startPolling();

    startDailyUpdateChecks();

    app.on("activate", () => {
      meetWindowManager.focusOpenMeetWindow();
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
