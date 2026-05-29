import type { AppError } from "@shared/errors";
import type { AppUpdateProgress, AppUpdateStatus } from "@shared/types";
import { app, BrowserWindow } from "electron";
import { autoUpdater } from "electron-updater";
import { err, ok, type Result } from "neverthrow";

type UpdaterState = Omit<
  AppUpdateStatus,
  "canCheck" | "canDownload" | "canInstall" | "currentVersion"
>;

const statusChangedChannel = "updates:status-changed";

let configured = false;
let updaterState: UpdaterState = {
  status: app.isPackaged ? "idle" : "unsupported",
};

const actionFlagsFor = (status: AppUpdateStatus["status"]) => ({
  canCheck: app.isPackaged && status !== "checking" && status !== "downloading",
  canDownload: app.isPackaged && status === "available",
  canInstall: app.isPackaged && status === "downloaded",
});

const currentStatus = (): AppUpdateStatus => ({
  currentVersion: app.getVersion(),
  ...updaterState,
  ...actionFlagsFor(updaterState.status),
});

const publishStatus = (nextState: UpdaterState) => {
  updaterState = nextState;
  const updateStatus = currentStatus();

  BrowserWindow.getAllWindows().forEach((window) => {
    window.webContents.send(statusChangedChannel, updateStatus);
  });
};

const updateState = (nextState: UpdaterState) => {
  publishStatus(nextState);
  return currentStatus();
};

const errorFrom = (cause: unknown): AppError => ({ type: "UpdateFailed", cause });

const progressFrom = (progress: AppUpdateProgress): AppUpdateProgress => ({
  bytesPerSecond: progress.bytesPerSecond,
  percent: progress.percent,
  total: progress.total,
  transferred: progress.transferred,
});

export const getAppUpdateStatus = (): AppUpdateStatus => currentStatus();

export const configureAppUpdater = () => {
  if (configured) return;
  configured = true;

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;

  autoUpdater.on("checking-for-update", () => {
    updateState({ status: "checking" });
  });

  autoUpdater.on("update-not-available", () => {
    updateState({ status: "not-available" });
  });

  autoUpdater.on("update-available", (info) => {
    updateState({
      availableVersion: info.version,
      releaseDate: info.releaseDate,
      releaseName: info.releaseName ?? undefined,
      status: "available",
    });
  });

  autoUpdater.on("download-progress", (progress) => {
    updateState({
      ...updaterState,
      progress: progressFrom(progress),
      status: "downloading",
    });
  });

  autoUpdater.on("update-downloaded", (info) => {
    updateState({
      availableVersion: info.version,
      downloadedVersion: info.version,
      releaseDate: info.releaseDate,
      releaseName: info.releaseName ?? undefined,
      status: "downloaded",
    });
  });

  autoUpdater.on("error", (cause) => {
    updateState({
      errorMessage: cause.message,
      status: "error",
    });
  });
};

export const checkForAppUpdates = async (): Promise<Result<AppUpdateStatus, AppError>> => {
  if (!app.isPackaged) {
    return ok(currentStatus());
  }

  try {
    await autoUpdater.checkForUpdates();
    return ok(currentStatus());
  } catch (cause) {
    updateState({
      errorMessage: cause instanceof Error ? cause.message : "Unknown update error",
      status: "error",
    });
    return err(errorFrom(cause));
  }
};

export const downloadAppUpdate = async (): Promise<Result<AppUpdateStatus, AppError>> => {
  if (!app.isPackaged) {
    return ok(currentStatus());
  }

  if (updaterState.status !== "available") {
    return err(errorFrom("No update is ready to download."));
  }

  try {
    updateState({ ...updaterState, status: "downloading" });
    await autoUpdater.downloadUpdate();
    return ok(currentStatus());
  } catch (cause) {
    updateState({
      errorMessage: cause instanceof Error ? cause.message : "Unknown download error",
      status: "error",
    });
    return err(errorFrom(cause));
  }
};

export const installAppUpdate = (): Result<void, AppError> => {
  if (!app.isPackaged) {
    return ok(undefined);
  }

  if (updaterState.status !== "downloaded") {
    return err(errorFrom("No downloaded update is ready to install."));
  }

  setImmediate(() => {
    autoUpdater.quitAndInstall(false, true);
  });

  return ok(undefined);
};
