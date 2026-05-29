import { join } from "node:path";
import { canonicalizeMeetUrl, isMeetUrl } from "@main/calendar/meetExtractor";
import type { AppError } from "@shared/errors";
import { app, BrowserWindow, ipcMain, session } from "electron";
import { err, fromThrowable, ok, type Result } from "neverthrow";
import { serializeResultForRenderer } from "./ipc/result";

const meetWindows = new Set<BrowserWindow>();

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
  ipcMain.handle("account:getStatus", () => serializeResultForRenderer(ok({ connected: false })));
  ipcMain.handle("meet:open", async (_event, meetUrl: string) =>
    serializeResultForRenderer(await openMeetUrl(meetUrl)),
  );
};

void app.whenReady().then(() => {
  configureMeetSessionPermissions();
  registerIpc();
  const created = createMainWindow();

  if (created.isErr()) {
    throw new Error(created.error.type);
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
