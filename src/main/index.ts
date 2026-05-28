import { join } from "node:path";
import type { AppError } from "@shared/errors";
import { app, BrowserWindow, ipcMain } from "electron";
import { fromThrowable, ok } from "neverthrow";
import { serializeResultForRenderer } from "./ipc/result";

const createBrowserWindow = fromThrowable(
  () =>
    new BrowserWindow({
      width: 1120,
      height: 760,
      minWidth: 900,
      minHeight: 620,
      title: "NextRoom",
      webPreferences: {
        preload: join(__dirname, "../preload/index.mjs"),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    }),
  (cause): AppError => ({ type: "MeetWindowFailed", cause }),
);

const createMainWindow = () =>
  createBrowserWindow().map((window) => {
    if (process.env.ELECTRON_RENDERER_URL !== undefined) {
      void window.loadURL(process.env.ELECTRON_RENDERER_URL);
    } else {
      void window.loadFile(join(__dirname, "../renderer/index.html"));
    }

    return window;
  });

const registerIpc = () => {
  ipcMain.handle("account:getStatus", () => serializeResultForRenderer(ok({ connected: false })));
};

void app.whenReady().then(() => {
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
