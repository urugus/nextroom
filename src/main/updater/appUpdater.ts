import { execFile, spawn } from "node:child_process";
import { closeSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { access, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import type { AppError } from "@shared/errors";
import { IPC_CHANNELS } from "@shared/ipc";
import type { AppUpdateStatus } from "@shared/types";
import { app, BrowserWindow } from "electron";
import electronUpdater from "electron-updater";
import { err, ok, type Result } from "neverthrow";

type UpdaterState = Omit<
  AppUpdateStatus,
  "canCheck" | "canRunHomebrewUpdate" | "currentVersion" | "lastCheckedAt"
>;

type UpdateCheckState = {
  lastCheckedAt?: string;
  lastCheckedLocalDate?: string;
};

const { autoUpdater } = electronUpdater;
const execFileAsync = promisify(execFile);
const brewCandidates = ["/opt/homebrew/bin/brew", "/usr/local/bin/brew"];
const updateLogFileName = "homebrew-update.log";
const updateCheckStateFileName = "update-check-state.json";

let configured = false;
let updateCheckStateLoaded = false;
let updateCheckState: UpdateCheckState = {};
let updaterState: UpdaterState = {
  status: app.isPackaged ? "idle" : "unsupported",
};
const statusListeners = new Set<(status: AppUpdateStatus) => void>();

const actionFlagsFor = (status: AppUpdateStatus["status"]) => ({
  canCheck: app.isPackaged && status !== "checking" && status !== "homebrew-updating",
  canRunHomebrewUpdate: app.isPackaged && status === "available",
});

const currentStatus = (): AppUpdateStatus => ({
  currentVersion: app.getVersion(),
  lastCheckedAt: updateCheckState.lastCheckedAt,
  ...updaterState,
  ...actionFlagsFor(updaterState.status),
});

const broadcastStatus = (updateStatus: AppUpdateStatus): void => {
  BrowserWindow.getAllWindows().forEach((window) => {
    window.webContents.send(IPC_CHANNELS.updatesStatusChanged, updateStatus);
  });

  statusListeners.forEach((listener) => {
    try {
      listener(updateStatus);
    } catch {
      // Internal update indicators must not break the updater state machine.
    }
  });
};

const publishStatus = (nextState: UpdaterState) => {
  updaterState = nextState;
  broadcastStatus(currentStatus());
};

const updateState = (nextState: UpdaterState) => {
  publishStatus(nextState);
  return currentStatus();
};

const errorFrom = (cause: unknown): AppError => ({ type: "UpdateFailed", cause });

const updateCheckStatePath = (): string => join(app.getPath("userData"), updateCheckStateFileName);

const localDateKeyFor = (value: Date): string => {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
};

const isUpdateCheckState = (value: unknown): value is UpdateCheckState =>
  typeof value === "object" &&
  value !== null &&
  (!("lastCheckedAt" in value) || typeof value.lastCheckedAt === "string") &&
  (!("lastCheckedLocalDate" in value) || typeof value.lastCheckedLocalDate === "string");

const loadUpdateCheckState = (): UpdateCheckState => {
  if (updateCheckStateLoaded) return updateCheckState;
  updateCheckStateLoaded = true;

  try {
    const parsed = JSON.parse(readFileSync(updateCheckStatePath(), "utf8"));
    updateCheckState = isUpdateCheckState(parsed) ? parsed : {};
  } catch {
    updateCheckState = {};
  }

  return updateCheckState;
};

const saveUpdateCheckState = (state: UpdateCheckState): void => {
  updateCheckState = state;

  try {
    mkdirSync(app.getPath("userData"), { recursive: true });
    writeFileSync(updateCheckStatePath(), `${JSON.stringify(state, null, 2)}\n`);
  } catch {
    // A failed recency write must not block update checks.
  }
};

const recordUpdateCheck = (now: Date): void => {
  saveUpdateCheckState({
    lastCheckedAt: now.toISOString(),
    lastCheckedLocalDate: localDateKeyFor(now),
  });
  broadcastStatus(currentStatus());
};

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
trap 'exit_code=$?; if [ "$exit_code" -ne 0 ]; then echo "__NEXTROOM_HOMEBREW_UPDATE_FAILED__ status=$exit_code"; open "$NEXTROOM_APP_PATH" >/dev/null 2>&1 || true; fi' EXIT
mkdir -p "$NEXTROOM_APPDIR"
"$NEXTROOM_BREW_PATH" update
"$NEXTROOM_BREW_PATH" upgrade --cask --appdir "$NEXTROOM_APPDIR" nextroom
installed_version="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$NEXTROOM_APP_PATH/Contents/Info.plist" 2>/dev/null || true)"
echo "Installed NextRoom version: \${installed_version:-unknown}"
if [ "$installed_version" != "$NEXTROOM_EXPECTED_VERSION" ]; then
  echo "__NEXTROOM_HOMEBREW_UPDATE_VERSION_MISMATCH__ expected=$NEXTROOM_EXPECTED_VERSION actual=\${installed_version:-unknown}"
  exit 20
fi
echo "__NEXTROOM_HOMEBREW_UPDATE_SUCCESS__ $(date -u +%Y-%m-%dT%H:%M:%SZ)"
osascript -e 'display dialog "NextRoom was updated. Restart now to use the new version." buttons {"Restart"} default button "Restart" with title "NextRoom update"' >/dev/null 2>&1 || true
osascript -e 'quit app "NextRoom"' >/dev/null 2>&1 || true
sleep 1
if ! open -n "$NEXTROOM_APP_PATH"; then
  echo "__NEXTROOM_HOMEBREW_REOPEN_FAILED__"
fi
`;

const updateFailedMessageForExit = (code: number | null) => {
  if (code === 20) {
    return `Homebrew did not install NextRoom ${
      updaterState.availableVersion ?? "update"
    }. Check that the Homebrew cask has been updated. See ${homebrewUpdateLogPath()}.`;
  }

  return `Homebrew update failed. See ${homebrewUpdateLogPath()}.`;
};

const spawnDetachedHomebrewUpdate = async (brewPath: string, expectedVersion: string) => {
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
        NEXTROOM_EXPECTED_VERSION: expectedVersion,
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
          updateMessage: "Homebrew update completed. NextRoom is restarting.",
        });
        return;
      }

      updateState({
        errorMessage: updateFailedMessageForExit(code),
        status: "error",
      });
    });

    child.unref();
  } finally {
    closeSync(logFd);
  }
};

export const getAppUpdateStatus = (): AppUpdateStatus => {
  loadUpdateCheckState();
  return currentStatus();
};

export const subscribeAppUpdateStatus = (listener: (status: AppUpdateStatus) => void) => {
  loadUpdateCheckState();
  statusListeners.add(listener);
  try {
    listener(currentStatus());
  } catch {
    // Internal update indicators must not break the updater state machine.
  }

  return () => {
    statusListeners.delete(listener);
  };
};

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
  loadUpdateCheckState();

  if (!app.isPackaged) {
    return ok(currentStatus());
  }

  try {
    await autoUpdater.checkForUpdates();
    recordUpdateCheck(new Date());
    return ok(currentStatus());
  } catch (cause) {
    updateState({
      errorMessage: updateErrorMessageFrom(cause),
      status: "error",
    });
    return err(errorFrom(cause));
  }
};

export const checkForAppUpdatesIfDue = async (
  now: Date = new Date(),
): Promise<Result<AppUpdateStatus, AppError>> => {
  const state = loadUpdateCheckState();
  if (!app.isPackaged || state.lastCheckedLocalDate === localDateKeyFor(now)) {
    return ok(currentStatus());
  }

  try {
    await autoUpdater.checkForUpdates();
    recordUpdateCheck(now);
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

  const expectedVersion = updaterState.availableVersion;
  if (expectedVersion === undefined) {
    return err(errorFrom("No target Homebrew update version is available."));
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
      updateMessage: "Updating with Homebrew. A restart prompt will appear when it is ready.",
    });
    await spawnDetachedHomebrewUpdate(brewPath.value, expectedVersion);
    return ok(currentStatus());
  } catch (cause) {
    updateState({
      errorMessage: commandOutputMessage(cause),
      status: "error",
    });
    return err(errorFrom(cause));
  }
};
