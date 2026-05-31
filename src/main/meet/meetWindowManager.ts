import { canonicalizeMeetUrl, type MeetUrl } from "@main/calendar/meetExtractor";
import type { AppError } from "@shared/errors";
import { err, ok, type Result } from "neverthrow";

type AlwaysOnTopLevel = "screen-saver";

export type ManagedMeetWindow = {
  destroy: () => void;
  focus: () => void;
  isDestroyed: () => boolean;
  isMinimized: () => boolean;
  loadURL: (url: string) => Promise<void>;
  on: (event: "closed", listener: () => void) => unknown;
  restore: () => void;
  setAlwaysOnTop: (flag: boolean, level?: AlwaysOnTopLevel) => void;
  show: () => void;
};

type MeetWindowManagerInput = {
  clearTimeoutFn?: typeof clearTimeout;
  createWindow: () => Result<ManagedMeetWindow, AppError>;
  focusApp?: () => void;
  focusDurationMs?: number;
  setTimeoutFn?: typeof setTimeout;
};

export type MeetWindowManager = {
  openMeetUrl: (value: string) => Promise<Result<void, AppError>>;
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

export const createMeetWindowManager = ({
  clearTimeoutFn = clearTimeout,
  createWindow,
  focusApp,
  focusDurationMs,
  setTimeoutFn = setTimeout,
}: MeetWindowManagerInput): MeetWindowManager => {
  const meetWindows = new Map<MeetUrl, ManagedMeetWindow>();

  const removeWindow = (meetUrl: MeetUrl, meetWindow: ManagedMeetWindow): void => {
    if (meetWindows.get(meetUrl) === meetWindow) {
      meetWindows.delete(meetUrl);
    }
  };

  return {
    openMeetUrl: async (value) => {
      const canonicalized = canonicalizeMeetUrl(value);
      if (canonicalized.isErr()) {
        return err(canonicalized.error);
      }

      const meetUrl = canonicalized.value;
      const existingWindow = meetWindows.get(meetUrl);
      if (existingWindow !== undefined && !existingWindow.isDestroyed()) {
        focusMeetWindow(existingWindow, focusApp, setTimeoutFn, clearTimeoutFn, focusDurationMs);
        return ok(undefined);
      }

      if (existingWindow !== undefined) {
        meetWindows.delete(meetUrl);
      }

      const created = createWindow();
      if (created.isErr()) {
        return err(created.error);
      }

      const meetWindow = created.value;
      meetWindows.set(meetUrl, meetWindow);
      meetWindow.on("closed", () => {
        removeWindow(meetUrl, meetWindow);
      });

      try {
        await meetWindow.loadURL(meetUrl);
        focusMeetWindow(meetWindow, focusApp, setTimeoutFn, clearTimeoutFn, focusDurationMs);
        return ok(undefined);
      } catch (cause) {
        removeWindow(meetUrl, meetWindow);
        if (!meetWindow.isDestroyed()) {
          meetWindow.destroy();
        }
        return err({ type: "MeetWindowFailed", cause });
      }
    },
  };
};
