import { canonicalizeMeetUrl, type MeetUrl } from "@main/calendar/meetExtractor";
import type { AppError } from "@shared/errors";
import type { AppUpdateStatus } from "@shared/types";
import { err, ok, type Result } from "neverthrow";

type AlwaysOnTopLevel = "screen-saver";

type AutoJoinResult = { ok: true } | { ok: false; reason: string };
export type BubbleTextMessage = { durationMs: number; text: string };

type ManagedWebContents = {
  executeJavaScript: (code: string) => Promise<unknown>;
};

export type ManagedMeetWindow = {
  destroy: () => void;
  focus: () => void;
  isDestroyed: () => boolean;
  isMinimized: () => boolean;
  loadURL: (url: string) => Promise<void>;
  on: (event: "closed", listener: () => void) => unknown;
  restore: () => void;
  sendBubbleText?: (message: BubbleTextMessage) => void;
  setAlwaysOnTop: (flag: boolean, level?: AlwaysOnTopLevel) => void;
  setBubbleEnabled?: (enabled: boolean) => void;
  show: () => void;
  updateUpdateStatus?: (status: AppUpdateStatus) => void;
  webContents: ManagedWebContents;
};

type MeetWindowManagerInput = {
  clearTimeoutFn?: typeof clearTimeout;
  createWindow: () => Result<ManagedMeetWindow, AppError>;
  focusApp?: () => void;
  focusDurationMs?: number;
  onWindowClosed?: (meetUrl: string) => void;
  setTimeoutFn?: typeof setTimeout;
};

export type MeetWindowManager = {
  autoJoinMeetUrl: (value: string) => Promise<Result<void, AppError>>;
  focusOpenMeetWindow: () => boolean;
  hasOpenMeetWindowExcept: (value: string) => boolean;
  openMeetUrl: (value: string) => Promise<Result<void, AppError>>;
  sendBubbleText: (message: BubbleTextMessage) => void;
  setBubbleEnabled: (enabled: boolean) => void;
  updateUpdateStatus: (status: AppUpdateStatus) => void;
};

const focusResetTimers = new WeakMap<ManagedMeetWindow, ReturnType<typeof setTimeout>>();

export const focusMeetWindow = (
  meetWindow: ManagedMeetWindow,
  focusApp: () => void = () => undefined,
  setTimeoutFn: typeof setTimeout = setTimeout,
  clearTimeoutFn: typeof clearTimeout = clearTimeout,
  focusDurationMs = 1_200,
): void => {
  if (meetWindow.isDestroyed()) return;

  focusApp();

  if (meetWindow.isMinimized()) {
    meetWindow.restore();
  }

  meetWindow.show();
  meetWindow.setAlwaysOnTop(true, "screen-saver");
  meetWindow.focus();

  const existingTimer = focusResetTimers.get(meetWindow);
  if (existingTimer !== undefined) {
    clearTimeoutFn(existingTimer);
  }

  const resetTimer = setTimeoutFn(() => {
    focusResetTimers.delete(meetWindow);
    if (!meetWindow.isDestroyed()) {
      meetWindow.setAlwaysOnTop(false);
    }
  }, focusDurationMs);
  focusResetTimers.set(meetWindow, resetTimer);
};

const autoJoinScript = `
new Promise((resolve) => {
  const deadline = Date.now() + 15_000;
  const mediaControlPattern =
    /camera|microphone|mic|カメラ|マイク|音声|ビデオ|video|audio/i;
  const joinPattern =
    /join now|ask to join|join meeting|参加|今すぐ参加|参加をリクエスト|参加を依頼/i;

  const labelFor = (element) =>
    [
      element.getAttribute("aria-label"),
      element.getAttribute("data-tooltip"),
      element.getAttribute("title"),
      element.textContent,
    ]
      .filter(Boolean)
      .join(" ");

  const findJoinButton = () => {
    const candidates = Array.from(document.querySelectorAll("button, [role='button']"));

    return candidates.find((element) => {
      const label = labelFor(element);
      const disabled =
        element.hasAttribute("disabled") || element.getAttribute("aria-disabled") === "true";

      return !disabled && joinPattern.test(label) && !mediaControlPattern.test(label);
    });
  };

  let observer;
  let interval;

  const cleanup = () => {
    observer?.disconnect();
    window.clearInterval(interval);
  };

  const tick = () => {
    if (location.hostname === "accounts.google.com") {
      cleanup();
      resolve({ ok: false, reason: "Meet login is required." });
      return;
    }

    const button = findJoinButton();
    if (button !== undefined) {
      button.click();
      cleanup();
      resolve({ ok: true });
      return;
    }

    if (Date.now() >= deadline) {
      cleanup();
      resolve({ ok: false, reason: "Meet join button was not found." });
    }
  };

  observer = new MutationObserver(tick);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  interval = window.setInterval(tick, 500);
  tick();
});
`;

const isAutoJoinResult = (value: unknown): value is AutoJoinResult =>
  typeof value === "object" &&
  value !== null &&
  "ok" in value &&
  (value.ok === true ||
    (value.ok === false && "reason" in value && typeof value.reason === "string"));

export const createMeetWindowManager = ({
  clearTimeoutFn = clearTimeout,
  createWindow,
  focusApp,
  focusDurationMs,
  onWindowClosed,
  setTimeoutFn = setTimeout,
}: MeetWindowManagerInput): MeetWindowManager => {
  const meetWindows = new Map<MeetUrl, ManagedMeetWindow>();
  let bubbleEnabled: boolean | undefined;
  let updateStatus: AppUpdateStatus | undefined;

  const removeWindow = (meetUrl: MeetUrl, meetWindow: ManagedMeetWindow): void => {
    if (meetWindows.get(meetUrl) === meetWindow) {
      meetWindows.delete(meetUrl);
      onWindowClosed?.(meetUrl);
    }
  };

  const openMeetWindow = async (
    value: string,
  ): Promise<Result<{ meetUrl: MeetUrl; meetWindow: ManagedMeetWindow }, AppError>> => {
    const canonicalized = canonicalizeMeetUrl(value);
    if (canonicalized.isErr()) {
      return err(canonicalized.error);
    }

    const meetUrl = canonicalized.value;
    const existingWindow = meetWindows.get(meetUrl);
    if (existingWindow !== undefined && !existingWindow.isDestroyed()) {
      focusMeetWindow(existingWindow, focusApp, setTimeoutFn, clearTimeoutFn, focusDurationMs);
      return ok({ meetUrl, meetWindow: existingWindow });
    }

    if (existingWindow !== undefined) {
      meetWindows.delete(meetUrl);
    }

    const created = createWindow();
    if (created.isErr()) {
      return err(created.error);
    }

    const meetWindow = created.value;
    if (updateStatus !== undefined) {
      meetWindow.updateUpdateStatus?.(updateStatus);
    }
    if (bubbleEnabled !== undefined) {
      meetWindow.setBubbleEnabled?.(bubbleEnabled);
    }
    meetWindows.set(meetUrl, meetWindow);
    meetWindow.on("closed", () => {
      removeWindow(meetUrl, meetWindow);
    });

    try {
      await meetWindow.loadURL(meetUrl);
      focusMeetWindow(meetWindow, focusApp, setTimeoutFn, clearTimeoutFn, focusDurationMs);
      return ok({ meetUrl, meetWindow });
    } catch (cause) {
      removeWindow(meetUrl, meetWindow);
      if (!meetWindow.isDestroyed()) {
        meetWindow.destroy();
      }
      return err({ type: "MeetWindowFailed", cause });
    }
  };

  return {
    autoJoinMeetUrl: async (value) => {
      const opened = await openMeetWindow(value);
      if (opened.isErr()) return err(opened.error);

      try {
        const result = await opened.value.meetWindow.webContents.executeJavaScript(autoJoinScript);
        if (isAutoJoinResult(result)) {
          if (result.ok) return ok(undefined);

          return err({ type: "MeetWindowFailed", cause: result.reason });
        }

        return err({
          type: "MeetWindowFailed",
          cause: "Meet join automation returned an unexpected result.",
        });
      } catch (cause) {
        return err({ type: "MeetWindowFailed", cause });
      }
    },
    focusOpenMeetWindow: () => {
      const windows = [...meetWindows.values()];
      let meetWindow: ManagedMeetWindow | undefined;
      for (let index = windows.length - 1; index >= 0; index -= 1) {
        const candidate = windows[index];
        if (!candidate.isDestroyed()) {
          meetWindow = candidate;
          break;
        }
      }
      if (meetWindow === undefined) return false;

      focusMeetWindow(meetWindow, focusApp, setTimeoutFn, clearTimeoutFn, focusDurationMs);
      return true;
    },
    hasOpenMeetWindowExcept: (value) => {
      const canonicalized = canonicalizeMeetUrl(value);
      if (canonicalized.isErr()) {
        return [...meetWindows.values()].some((meetWindow) => !meetWindow.isDestroyed());
      }

      return [...meetWindows].some(
        ([meetUrl, meetWindow]) => meetUrl !== canonicalized.value && !meetWindow.isDestroyed(),
      );
    },
    openMeetUrl: async (value) => {
      const opened = await openMeetWindow(value);
      return opened.map(() => undefined);
    },
    sendBubbleText: (message) => {
      meetWindows.forEach((meetWindow) => {
        if (!meetWindow.isDestroyed()) {
          meetWindow.sendBubbleText?.(message);
        }
      });
    },
    setBubbleEnabled: (enabled) => {
      bubbleEnabled = enabled;
      meetWindows.forEach((meetWindow) => {
        if (!meetWindow.isDestroyed()) {
          meetWindow.setBubbleEnabled?.(enabled);
        }
      });
    },
    updateUpdateStatus: (status) => {
      updateStatus = status;
      meetWindows.forEach((meetWindow) => {
        if (!meetWindow.isDestroyed()) {
          meetWindow.updateUpdateStatus?.(status);
        }
      });
    },
  };
};
