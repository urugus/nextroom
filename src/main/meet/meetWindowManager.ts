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
  createWindow: () => Result<ManagedMeetWindow, AppError>;
  focusApp?: () => void;
  focusDurationMs?: number;
  setTimeoutFn?: typeof setTimeout;
};

export type MeetWindowManager = {
  openMeetUrl: (value: string) => Promise<Result<void, AppError>>;
};

export const focusMeetWindow = (
  meetWindow: ManagedMeetWindow,
  focusApp: () => void = () => undefined,
  setTimeoutFn: typeof setTimeout = setTimeout,
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

  setTimeoutFn(() => {
    if (!meetWindow.isDestroyed()) {
      meetWindow.setAlwaysOnTop(false);
    }
  }, focusDurationMs);
};

export const createMeetWindowManager = ({
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
        focusMeetWindow(existingWindow, focusApp, setTimeoutFn, focusDurationMs);
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
        focusMeetWindow(meetWindow, focusApp, setTimeoutFn, focusDurationMs);
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
