import { execFile, spawn } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import { access, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import type { AppError } from "@shared/errors";
import type { AppUpdateStatus } from "@shared/types";
import { app, BrowserWindow } from "electron";
import { autoUpdater } from "electron-updater";
import { err, ok, type Result } from "neverthrow";

type UpdaterState = Omit<AppUpdateStatus, "canCheck" | "canRunHomebrewUpdate" | "currentVersion">;

const execFileAsync = promisify(execFile);
const brewCandidates = ["/opt/homebrew/bin/brew", "/usr/local/bin/brew"];
const statusChangedChannel = "updates:status-changed";
const updateLogFileName = "homebrew-update.log";

let configured = false;
let updaterState: UpdaterState = {
  status: app.isPackaged ? "idle" : "unsupported",
};

const actionFlagsFor = (status: AppUpdateStatus["status"]) => ({
  canCheck: app.isPackaged && status !== "checking" && status !== "homebrew-updating",
  canRunHomebrewUpdate: app.isPackaged && status === "available",
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

const homebrewAppDir = () => join(app.getPath("home"), "Applications");

const homebrewAppPath = () => join(homebrewAppDir(), "NextRoom.app");

const homebrewUpdateLogPath = () => join(app.getPath("userData"), updateLogFileName);

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

const commandOutputMessage = (error: unknown) => {
  if (typeof error !== "object" || error === null) return updateErrorMessageFrom(error);

  const output = [
    "stderr" in error && typeof error.stderr === "string" ? error.stderr : undefined,
    "stdout" in error && typeof error.stdout === "string" ? error.stdout : undefined,
    "message" in error && typeof error.message === "string" ? error.message : undefined,
  ]
    .filter((value): value is string => value !== undefined && value.trim().length > 0)
    .join("\n")
    .trim();

  return output.split("\n").find((line) => line.trim().length > 0) ?? "Homebrew update failed.";
};

const findBrewExecutable = async () => {
  for (const candidate of brewCandidates) {
    try {
      await access(candidate);
      return ok(candidate);
    } catch {
      // Try the next common Homebrew install path.
    }
  }

  return err(errorFrom("Homebrew was not found. Install NextRoom with Homebrew first."));
};

const runBrew = async (brewPath: string, args: string[]) =>
  execFileAsync(brewPath, args, {
    env: {
      ...process.env,
      HOMEBREW_NO_ANALYTICS: "1",
      HOMEBREW_NO_AUTO_UPDATE: "1",
    },
    maxBuffer: 1024 * 1024,
    timeout: 10 * 60 * 1_000,
  });

const homebrewUpdateScript = `
set -e
echo "==== NextRoom Homebrew update started $(date -u +%Y-%m-%dT%H:%M:%SZ) ===="
trap 'status=$?; if [ "$status" -ne 0 ]; then echo "__NEXTROOM_HOMEBREW_UPDATE_FAILED__ status=$status"; open "$NEXTROOM_APP_PATH" >/dev/null 2>&1 || true; fi' EXIT
mkdir -p "$NEXTROOM_APPDIR"
"$NEXTROOM_BREW_PATH" update
"$NEXTROOM_BREW_PATH" upgrade --cask --appdir "$NEXTROOM_APPDIR" nextroom
echo "__NEXTROOM_HOMEBREW_UPDATE_SUCCESS__ $(date -u +%Y-%m-%dT%H:%M:%SZ)"
osascript -e 'quit app "NextRoom"' >/dev/null 2>&1 || true
sleep 1
if ! open -n "$NEXTROOM_APP_PATH"; then
  echo "__NEXTROOM_HOMEBREW_REOPEN_FAILED__"
fi
`;

const spawnDetachedHomebrewUpdate = async (brewPath: string) => {
  await mkdir(app.getPath("userData"), { recursive: true });
  const logFd = openSync(homebrewUpdateLogPath(), "a");

  try {
    const child = spawn("/bin/zsh", ["-lc", homebrewUpdateScript], {
      detached: true,
      env: {
        ...process.env,
        HOMEBREW_NO_ANALYTICS: "1",
        HOMEBREW_NO_AUTO_UPDATE: "1",
        NEXTROOM_APPDIR: homebrewAppDir(),
        NEXTROOM_APP_PATH: homebrewAppPath(),
        NEXTROOM_BREW_PATH: brewPath,
      },
      stdio: ["ignore", logFd, logFd],
    });

    child.on("error", (cause) => {
      updateState({
        errorMessage: updateErrorMessageFrom(cause),
        status: "error",
      });
    });

    child.on("exit", (code) => {
      if (code === 0) {
        updateState({
          ...updaterState,
          status: "homebrew-updated",
          updateMessage: "Homebrew update completed. NextRoom was reopened from ~/Applications.",
        });
        return;
      }

      updateState({
        errorMessage: `Homebrew update failed. See ${homebrewUpdateLogPath()}.`,
        status: "error",
      });
    });

    child.unref();
  } finally {
    closeSync(logFd);
  }
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

export const runHomebrewAppUpdate = async (): Promise<Result<AppUpdateStatus, AppError>> => {
  if (!app.isPackaged) {
    return ok(currentStatus());
  }

  if (updaterState.status !== "available") {
    return err(errorFrom("No Homebrew update is ready to run."));
  }

  const brewPath = await findBrewExecutable();
  if (brewPath.isErr()) {
    updateState({
      errorMessage: "Homebrew was not found. Install NextRoom with Homebrew first.",
      status: "error",
    });
    return err(brewPath.error);
  }

  try {
    updateState({
      ...updaterState,
      status: "homebrew-updating",
      updateMessage: "Checking Homebrew cask installation.",
    });
    await runBrew(brewPath.value, ["list", "--cask", "nextroom"]);
    updateState({
      ...updaterState,
      status: "homebrew-updating",
      updateMessage: "Starting Homebrew update in the background.",
    });
    await spawnDetachedHomebrewUpdate(brewPath.value);
    return ok(currentStatus());
  } catch (cause) {
    updateState({
      errorMessage: commandOutputMessage(cause),
      status: "error",
    });
    return err(errorFrom(cause));
  }
};
