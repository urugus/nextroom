import { createRequire } from "node:module";
import type { AppError } from "@shared/errors";
import type { AppUpdateStatus } from "@shared/types";
import { err, ok, type Result } from "neverthrow";

type UpdaterState = Omit<AppUpdateStatus, "canCheck" | "canOpenDownloadPage" | "currentVersion">;

const nodeRequire = createRequire(import.meta.url);
const { app, BrowserWindow, shell } = nodeRequire("electron") as typeof import("electron");
const { autoUpdater } = nodeRequire("electron-updater") as typeof import("electron-updater");

const githubReleasesUrl = "https://github.com/urugus/nextroom/releases";
const statusChangedChannel = "updates:status-changed";

let configured = false;
let updaterState: UpdaterState = {
  status: app.isPackaged ? "idle" : "unsupported",
};

const actionFlagsFor = (status: AppUpdateStatus["status"]) => ({
  canCheck: app.isPackaged && status !== "checking",
  canOpenDownloadPage: app.isPackaged && status === "available",
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

const updateErrorMessageFrom = (cause: unknown) => {
  const message = cause instanceof Error ? cause.message : String(cause);

  if (message.includes("app-update.yml")) {
    return "Update metadata is missing from this build.";
  }

  if (message.includes("Unable to find latest version on GitHub")) {
    return "No compatible GitHub release metadata was found.";
  }

  if (message.trim().length === 0) {
    return "Update check failed.";
  }

  return message.split("\n")[0] ?? "Update check failed.";
};

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

  autoUpdater.on("error", (cause) => {
    updateState({
      errorMessage: updateErrorMessageFrom(cause),
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
      errorMessage: updateErrorMessageFrom(cause),
      status: "error",
    });
    return err(errorFrom(cause));
  }
};

export const openAppUpdateDownloadPage = async (): Promise<Result<AppUpdateStatus, AppError>> => {
  if (!app.isPackaged) {
    return ok(currentStatus());
  }

  if (updaterState.status !== "available") {
    return err(errorFrom("No update download page is ready to open."));
  }

  try {
    const releaseUrl =
      updaterState.availableVersion !== undefined
        ? `${githubReleasesUrl}/tag/v${updaterState.availableVersion}`
        : githubReleasesUrl;
    await shell.openExternal(releaseUrl);
    return ok(currentStatus());
  } catch (cause) {
    updateState({
      errorMessage: updateErrorMessageFrom(cause),
      status: "error",
    });
    return err(errorFrom(cause));
  }
};
