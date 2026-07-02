import type {
  AccountStatus,
  AppSettings,
  AppUpdateStatus,
  MeetEvent,
  MenuShortcutStatus,
} from "@shared/types";
import { type KeyboardEvent as ReactKeyboardEvent, useEffect, useRef, useState } from "react";

type DashboardProps = {
  accountStatus: AccountStatus;
  currentTime?: Date;
  errorMessage?: string;
  loading?: boolean;
  meetings?: MeetEvent[];
  nextMeetingNotification?: MeetEvent;
  menuShortcutStatus?: MenuShortcutStatus;
  openingMeetUrl?: string;
  pendingAction?: "connect" | "disconnect" | "sync";
  settings: AppSettings;
  syncedAt?: string;
  onAutoJoinEnabledChange: (enabled: boolean) => Promise<unknown>;
  onAutoOpenEnabledChange?: (enabled: boolean) => Promise<unknown>;
  onCameraBubbleChatMirrorEnabledChange: (enabled: boolean) => Promise<unknown>;
  onCameraBubbleEnabledChange: (enabled: boolean) => Promise<unknown>;
  onCameraBubbleScreenShareDanmakuEnabledChange: (enabled: boolean) => Promise<unknown>;
  onCameraBubbleDisplaySpeedLevelChange: (level: number) => Promise<unknown>;
  onCheckForUpdates?: () => Promise<unknown>;
  onConnectAccount: () => Promise<unknown>;
  onDisconnectAccount: () => Promise<unknown>;
  onDismissError?: () => void;
  onJoinOffsetMinutesChange: (minutes: number) => Promise<unknown>;
  onLaunchAtLoginChange?: (enabled: boolean) => Promise<unknown>;
  onMenuShortcutAcceleratorChange: (accelerator: string | null) => Promise<unknown>;
  onNotifyBeforeMinutesChange?: (minutes: number) => Promise<unknown>;
  onOpenMeeting: (meeting: MeetEvent) => Promise<unknown>;
  onOpenOffsetMinutesChange: (minutes: number) => Promise<unknown>;
  onRunHomebrewUpdate?: () => Promise<unknown>;
  onSyncCalendar: () => Promise<unknown>;
  updateErrorMessage?: string;
  updateStatus?: AppUpdateStatus;
};

const formatMeetingTime = (value: string) => {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "--:--";

  return new Intl.DateTimeFormat("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
};

const isSameDay = (left: Date, right: Date) =>
  left.getFullYear() === right.getFullYear() &&
  left.getMonth() === right.getMonth() &&
  left.getDate() === right.getDate();

const formatMeetingDay = (value: string, now: Date): string => {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  if (isSameDay(date, now)) return "Today";

  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  if (isSameDay(date, tomorrow)) return "Tomorrow";

  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    weekday: "short",
  }).format(date);
};

const formatSyncedAt = (value: string, now: Date): string => {
  const date = new Date(value);
  const time = formatMeetingTime(value);
  return isSameDay(date, now) ? time : `${formatMeetingDay(value, now)} ${time}`;
};

const isMeetingInProgress = (meeting: MeetEvent, now: Date): boolean => {
  const startAt = new Date(meeting.startAt).getTime();
  const endAt = new Date(meeting.endAt).getTime();
  const nowTime = now.getTime();

  return (
    Number.isFinite(startAt) && Number.isFinite(endAt) && startAt <= nowTime && nowTime <= endAt
  );
};

const maxVisibleMeetings = 5;

const formatUpdateSummary = (updateStatus?: AppUpdateStatus) => {
  if (updateStatus === undefined) return "Loading update status.";

  switch (updateStatus.status) {
    case "unsupported":
      return "Updates are available in installed app builds.";
    case "idle":
      return "No update check has run yet.";
    case "checking":
      return "Checking for updates.";
    case "not-available":
      return "You are on the latest version.";
    case "available":
      return `Version ${
        updateStatus.availableVersion ?? "unknown"
      } is available via Homebrew for ~/Applications.`;
    case "homebrew-updating":
      return updateStatus.updateMessage ?? "Updating with Homebrew.";
    case "homebrew-updated":
      return updateStatus.updateMessage ?? "Homebrew update completed. NextRoom was reopened.";
    case "error":
      return "Update check failed.";
  }
};

const updateErrorTextFor = (updateStatus?: AppUpdateStatus, updateErrorMessage?: string) =>
  updateErrorMessage ?? updateStatus?.errorMessage;

type UpdateStatusTone = "neutral" | "info" | "success" | "warning" | "error";

type UpdateStatusMeta = {
  busy: boolean;
  label: string;
  tone: UpdateStatusTone;
};

const updateStatusMetaFor = (updateStatus?: AppUpdateStatus): UpdateStatusMeta => {
  if (updateStatus === undefined) {
    return { busy: true, label: "Loading", tone: "neutral" };
  }

  switch (updateStatus.status) {
    case "unsupported":
      return { busy: false, label: "Updates unavailable", tone: "neutral" };
    case "idle":
      return { busy: false, label: "Ready to check", tone: "neutral" };
    case "checking":
      return { busy: true, label: "Checking", tone: "info" };
    case "not-available":
      return { busy: false, label: "Up to date", tone: "success" };
    case "available":
      return { busy: false, label: "Update available", tone: "warning" };
    case "homebrew-updating":
      return { busy: true, label: "Updating", tone: "info" };
    case "homebrew-updated":
      return { busy: false, label: "Updated", tone: "success" };
    case "error":
      return { busy: false, label: "Failed", tone: "error" };
  }
};

const modifierKeyNames = new Set(["Alt", "Control", "Meta", "Shift"]);

const keyNameForCode = (code: string): string | undefined => {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code;

  switch (code) {
    case "Space":
      return "Space";
    case "ArrowUp":
      return "Up";
    case "ArrowDown":
      return "Down";
    case "ArrowLeft":
      return "Left";
    case "ArrowRight":
      return "Right";
    case "Minus":
      return "Minus";
    case "Equal":
      return "Plus";
    case "Comma":
      return "Comma";
    case "Period":
      return "Period";
    case "Slash":
      return "Slash";
    case "Semicolon":
      return "Semicolon";
    case "Quote":
      return "Quote";
    case "BracketLeft":
      return "LeftBracket";
    case "BracketRight":
      return "RightBracket";
    case "Backslash":
      return "Backslash";
    case "Backquote":
      return "Backquote";
    default:
      return undefined;
  }
};

const keyNameForAccelerator = (key: string): string | undefined => {
  if (/^[a-z]$/i.test(key)) return key.toUpperCase();
  if (/^[0-9]$/.test(key)) return key;
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(key)) return key;

  switch (key) {
    case " ":
    case "Spacebar":
      return "Space";
    case "ArrowUp":
      return "Up";
    case "ArrowDown":
      return "Down";
    case "ArrowLeft":
      return "Left";
    case "ArrowRight":
      return "Right";
    case "-":
      return "Minus";
    case "=":
      return "Plus";
    case ",":
      return "Comma";
    case ".":
      return "Period";
    case "/":
      return "Slash";
    case ";":
      return "Semicolon";
    case "'":
      return "Quote";
    case "[":
      return "LeftBracket";
    case "]":
      return "RightBracket";
    case "\\":
      return "Backslash";
    case "`":
      return "Backquote";
    default:
      return undefined;
  }
};

const acceleratorFromKeyboardEvent = (
  event: ReactKeyboardEvent<HTMLButtonElement>,
): string | undefined => {
  if (modifierKeyNames.has(event.key)) return undefined;
  if (!event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey) return undefined;

  const key = keyNameForCode(event.code) ?? keyNameForAccelerator(event.key);
  if (key === undefined) return undefined;

  const parts = [
    event.metaKey ? "Command" : undefined,
    event.ctrlKey ? "Control" : undefined,
    event.altKey ? "Alt" : undefined,
    event.shiftKey ? "Shift" : undefined,
    key,
  ].filter((part): part is string => part !== undefined);

  return parts.join("+");
};

const formatAccelerator = (accelerator: string | null): string => {
  if (accelerator === null) return "Off";

  return accelerator
    .split("+")
    .map((part) => {
      switch (part) {
        case "Command":
        case "CommandOrControl":
          return "⌘";
        case "Control":
          return "⌃";
        case "Alt":
        case "Option":
          return "⌥";
        case "Shift":
          return "⇧";
        default:
          return part;
      }
    })
    .join(" ");
};

export const Dashboard = ({
  accountStatus,
  currentTime,
  errorMessage,
  loading = false,
  meetings = [],
  menuShortcutStatus,
  nextMeetingNotification,
  onAutoJoinEnabledChange,
  onAutoOpenEnabledChange,
  onCameraBubbleChatMirrorEnabledChange,
  onCameraBubbleEnabledChange,
  onCameraBubbleScreenShareDanmakuEnabledChange,
  onCameraBubbleDisplaySpeedLevelChange,
  onCheckForUpdates,
  onConnectAccount,
  onDisconnectAccount,
  onDismissError,
  onJoinOffsetMinutesChange,
  onLaunchAtLoginChange,
  onMenuShortcutAcceleratorChange,
  onNotifyBeforeMinutesChange,
  onOpenMeeting,
  onRunHomebrewUpdate,
  onSyncCalendar,
  onOpenOffsetMinutesChange,
  openingMeetUrl,
  pendingAction,
  settings,
  syncedAt,
  updateErrorMessage,
  updateStatus,
}: DashboardProps) => {
  const [recordingShortcut, setRecordingShortcut] = useState(false);
  const shortcutRecordButtonRef = useRef<HTMLButtonElement>(null);
  const now = currentTime ?? new Date();
  const actionInProgress = pendingAction !== undefined || accountStatus.syncing;
  const statusText = accountStatus.connected
    ? "Google Calendar connected"
    : "Google Calendar not connected";
  const helperText =
    syncedAt !== undefined
      ? `Last synced ${formatSyncedAt(syncedAt, now)}`
      : accountStatus.connected
        ? "Calendar sync is ready."
        : "Connect Google Calendar to enable Meet launching.";
  const visibleMeetings = meetings.slice(0, maxVisibleMeetings);
  const hiddenMeetingCount = meetings.length - visibleMeetings.length;
  const updateErrorText = updateErrorTextFor(updateStatus, updateErrorMessage);
  const notificationOpening =
    nextMeetingNotification !== undefined && openingMeetUrl === nextMeetingNotification.meetUrl;
  const openOffsetMinutes = Math.trunc(settings.openOffsetSeconds / 60);
  const joinOffsetMinutes = Math.trunc(settings.joinOffsetSeconds / 60);
  const openOffsetLabel =
    openOffsetMinutes === 0 ? "Open at start time" : `Open ${openOffsetMinutes} min before`;
  const notifyLabel =
    settings.notifyBeforeMinutes === 0
      ? "Off"
      : `Notify ${settings.notifyBeforeMinutes} min before`;
  const joinOffsetLabel =
    joinOffsetMinutes === 0 ? "Join at start time" : `Join ${joinOffsetMinutes} min before`;
  const updateStatusMeta =
    updateErrorText !== undefined
      ? { busy: false, label: "Failed", tone: "error" as const }
      : updateStatusMetaFor(updateStatus);
  const updateChecking = updateStatus?.status === "checking";
  const homebrewUpdating = updateStatus?.status === "homebrew-updating";
  const checkButtonLabel = updateChecking ? "Checking" : "Check for updates";
  const homebrewButtonLabel = homebrewUpdating ? "Updating" : "Update with Homebrew";
  const menuShortcutFailed =
    menuShortcutStatus?.state === "failed" &&
    menuShortcutStatus.accelerator === settings.menuShortcutAccelerator;

  useEffect(() => {
    if (recordingShortcut) {
      shortcutRecordButtonRef.current?.focus();
    }
  }, [recordingShortcut]);

  const handleShortcutKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>): void => {
    if (!recordingShortcut) return;

    event.preventDefault();
    event.stopPropagation();

    if (event.key === "Escape") {
      setRecordingShortcut(false);
      return;
    }

    const accelerator = acceleratorFromKeyboardEvent(event);
    if (accelerator === undefined) return;

    setRecordingShortcut(false);
    void onMenuShortcutAcceleratorChange(accelerator);
  };

  if (loading) {
    return (
      <main className="preferences-shell">
        <header className="preferences-header">
          <p>NextRoom</p>
          <h1>Settings</h1>
        </header>
        <div className="loading-state" role="status">
          <span className="update-spinner" aria-hidden="true" />
          <span>Loading settings…</span>
        </div>
      </main>
    );
  }

  return (
    <main className="preferences-shell">
      <header className="preferences-header">
        <p>NextRoom</p>
        <h1>Settings</h1>
      </header>

      {errorMessage !== undefined ? (
        <div className="error-banner" role="alert">
          <p>{errorMessage}</p>
          {onDismissError !== undefined ? (
            <button
              type="button"
              className="error-banner-dismiss"
              aria-label="Dismiss error"
              onClick={onDismissError}
            >
              ✕
            </button>
          ) : null}
        </div>
      ) : null}

      {nextMeetingNotification !== undefined ? (
        <button
          type="button"
          className="meeting-notification"
          disabled={openingMeetUrl !== undefined}
          onClick={() => void onOpenMeeting(nextMeetingNotification)}
        >
          <span>
            <strong>Next meeting is ready</strong>
            <span>
              {nextMeetingNotification.summary} at{" "}
              {formatMeetingTime(nextMeetingNotification.startAt)}
            </span>
          </span>
          <span>{notificationOpening ? "Opening" : "Join"}</span>
        </button>
      ) : null}

      {accountStatus.connected ? (
        <section className="preferences-group" aria-labelledby="meetings-title">
          <h2 id="meetings-title">Upcoming meetings</h2>
          <div className="preference-list">
            {visibleMeetings.length === 0 ? (
              <p className="empty-state">No upcoming Google Meet meetings.</p>
            ) : (
              <>
                {visibleMeetings.map((meeting) => {
                  const inProgress = isMeetingInProgress(meeting, now);
                  const opening = openingMeetUrl === meeting.meetUrl;
                  return (
                    <div className="preference-row meeting-row" key={meeting.occurrenceKey}>
                      <div className="preference-copy">
                        <strong>
                          {meeting.summary.length > 0 ? meeting.summary : "(No title)"}
                        </strong>
                        <span>
                          {formatMeetingDay(meeting.startAt, now)}{" "}
                          {formatMeetingTime(meeting.startAt)}
                          {" – "}
                          {formatMeetingTime(meeting.endAt)}
                          {inProgress ? <span className="meeting-badge">In progress</span> : null}
                        </span>
                      </div>
                      <div className="preference-actions">
                        <button
                          type="button"
                          aria-busy={opening}
                          disabled={openingMeetUrl !== undefined}
                          onClick={() => void onOpenMeeting(meeting)}
                        >
                          {opening ? "Opening" : "Join"}
                        </button>
                      </div>
                    </div>
                  );
                })}
                {hiddenMeetingCount > 0 ? (
                  <p className="empty-state">
                    {hiddenMeetingCount} more in the menu bar meeting list.
                  </p>
                ) : null}
              </>
            )}
          </div>
        </section>
      ) : null}

      <section className="preferences-group" aria-labelledby="account-title">
        <h2 id="account-title">Account</h2>
        <div className="preference-list">
          <div className="preference-row">
            <div className="preference-copy">
              <strong>Google Calendar</strong>
              <span>{statusText}</span>
              <span id="calendar-action-help">{helperText}</span>
            </div>
            <div className="preference-actions">
              {accountStatus.connected ? (
                <>
                  <button
                    type="button"
                    disabled={actionInProgress}
                    aria-describedby="calendar-action-help"
                    onClick={() => void onSyncCalendar()}
                  >
                    {pendingAction === "sync" || accountStatus.syncing ? "Syncing" : "Sync"}
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={actionInProgress}
                    onClick={() => void onDisconnectAccount()}
                  >
                    {pendingAction === "disconnect" ? "Disconnecting" : "Disconnect"}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  disabled={actionInProgress}
                  aria-describedby="calendar-action-help"
                  onClick={() => void onConnectAccount()}
                >
                  {pendingAction === "connect" ? "Connecting" : "Connect"}
                </button>
              )}
            </div>
          </div>
        </div>
      </section>

      <section className="preferences-group" aria-labelledby="general-title">
        <h2 id="general-title">General</h2>
        <div className="preference-list">
          <div className="preference-row">
            <div className="preference-copy">
              <strong>Launch at login</strong>
              <span>Start NextRoom automatically when you sign in to your Mac</span>
            </div>
            <label className="toggle-control">
              <input
                type="checkbox"
                checked={settings.launchAtLogin}
                aria-label="Launch at login"
                onChange={(event) => void onLaunchAtLoginChange?.(event.currentTarget.checked)}
              />
            </label>
          </div>
          <div className="preference-row">
            <div className="preference-copy">
              <strong>Meeting notification</strong>
              <span>{notifyLabel}</span>
            </div>
            <label className="range-control">
              <input
                type="range"
                min="0"
                max="10"
                step="1"
                value={settings.notifyBeforeMinutes}
                aria-label="Meeting notification offset"
                onChange={(event) =>
                  void onNotifyBeforeMinutesChange?.(Number(event.currentTarget.value))
                }
              />
              <span>
                {settings.notifyBeforeMinutes === 0 ? "Off" : `${settings.notifyBeforeMinutes} min`}
              </span>
            </label>
          </div>
        </div>
      </section>

      <section className="preferences-group" aria-labelledby="meet-title">
        <h2 id="meet-title">Meet</h2>
        <div className="preference-list">
          <div className="preference-row">
            <div className="preference-copy">
              <strong>Auto-open Meet window</strong>
              <span>
                {settings.autoOpenEnabled
                  ? "Open the Meet window automatically before meetings"
                  : "Off"}
              </span>
            </div>
            <label className="toggle-control">
              <input
                type="checkbox"
                checked={settings.autoOpenEnabled}
                aria-label="Auto-open Meet window"
                onChange={(event) => void onAutoOpenEnabledChange?.(event.currentTarget.checked)}
              />
            </label>
          </div>
          <div className="preference-row preference-sub-row">
            <div className="preference-copy">
              <strong>Open Meet window</strong>
              <span>{openOffsetLabel}</span>
            </div>
            <label className="range-control">
              <input
                type="range"
                min="0"
                max="10"
                step="1"
                value={openOffsetMinutes}
                disabled={!settings.autoOpenEnabled}
                aria-label="Meet window open offset"
                onChange={(event) =>
                  void onOpenOffsetMinutesChange(Number(event.currentTarget.value))
                }
              />
              <span>{openOffsetMinutes} min</span>
            </label>
          </div>
          <div className="preference-row">
            <div className="preference-copy">
              <strong>Auto-join Meet</strong>
              <span>{settings.autoJoinEnabled ? joinOffsetLabel : "Off"}</span>
            </div>
            <label className="toggle-control">
              <input
                type="checkbox"
                checked={settings.autoJoinEnabled}
                aria-label="Auto-join Meet"
                onChange={(event) => void onAutoJoinEnabledChange(event.currentTarget.checked)}
              />
            </label>
          </div>
          <div className="preference-row preference-sub-row">
            <div className="preference-copy">
              <strong>Auto-join offset</strong>
              <span>{joinOffsetLabel}</span>
            </div>
            <label className="range-control">
              <input
                type="range"
                min="0"
                max={openOffsetMinutes}
                step="1"
                value={joinOffsetMinutes}
                disabled={!settings.autoJoinEnabled}
                aria-label="Meet auto-join offset"
                onChange={(event) =>
                  void onJoinOffsetMinutesChange(Number(event.currentTarget.value))
                }
              />
              <span>{joinOffsetMinutes} min</span>
            </label>
          </div>
          <div className="preference-row">
            <div className="preference-copy">
              <strong>Camera bubble</strong>
              <span>
                {settings.cameraBubbleEnabled
                  ? "Show typed text on your camera while muted"
                  : "Off"}
              </span>
            </div>
            <label className="toggle-control">
              <input
                type="checkbox"
                checked={settings.cameraBubbleEnabled}
                aria-label="Camera bubble"
                onChange={(event) => void onCameraBubbleEnabledChange(event.currentTarget.checked)}
              />
            </label>
          </div>
          <div className="preference-row preference-sub-row">
            <div className="preference-copy">
              <strong>Mirror Meet chat</strong>
              <span>Also show your sent chat messages on camera</span>
            </div>
            <label className="toggle-control">
              <input
                type="checkbox"
                checked={settings.cameraBubbleChatMirrorEnabled}
                disabled={!settings.cameraBubbleEnabled}
                aria-label="Mirror Meet chat"
                onChange={(event) =>
                  void onCameraBubbleChatMirrorEnabledChange(event.currentTarget.checked)
                }
              />
            </label>
          </div>
          <div className="preference-row preference-sub-row">
            <div className="preference-copy">
              <strong>Screen share comments</strong>
              <span>Flow bubble comments across your shared screen</span>
            </div>
            <label className="toggle-control">
              <input
                type="checkbox"
                checked={settings.cameraBubbleScreenShareDanmakuEnabled}
                disabled={!settings.cameraBubbleEnabled}
                aria-label="Screen share comments"
                onChange={(event) =>
                  void onCameraBubbleScreenShareDanmakuEnabledChange(event.currentTarget.checked)
                }
              />
            </label>
          </div>
          <div className="preference-row">
            <div className="preference-copy">
              <strong>Bubble display speed</strong>
              <span>1 = slow / 5 = fast</span>
            </div>
            <label className="range-control">
              <input
                type="range"
                min="1"
                max="5"
                step="1"
                value={settings.cameraBubbleDisplaySpeedLevel}
                aria-label="Bubble display speed"
                onChange={(event) =>
                  void onCameraBubbleDisplaySpeedLevelChange(Number(event.currentTarget.value))
                }
              />
              <span>{settings.cameraBubbleDisplaySpeedLevel} / 5</span>
            </label>
          </div>
        </div>
      </section>

      <section className="preferences-group" aria-labelledby="shortcuts-title">
        <h2 id="shortcuts-title">Shortcuts</h2>
        <div className="preference-list">
          <div className="preference-row">
            <div className="preference-copy">
              <strong>Menu shortcut</strong>
              <span>
                {recordingShortcut
                  ? "Recording"
                  : formatAccelerator(settings.menuShortcutAccelerator)}
              </span>
              {menuShortcutFailed ? (
                <span className="warning-text">Shortcut is unavailable. Choose another one.</span>
              ) : null}
            </div>
            <div className="preference-actions">
              <button
                type="button"
                ref={shortcutRecordButtonRef}
                aria-pressed={recordingShortcut}
                onClick={() => setRecordingShortcut((current) => !current)}
                onBlur={() => setRecordingShortcut(false)}
                onKeyDown={handleShortcutKeyDown}
              >
                {recordingShortcut ? "Cancel" : "Record"}
              </button>
              <button
                type="button"
                className="secondary-button"
                disabled={settings.menuShortcutAccelerator === null}
                onClick={() => void onMenuShortcutAcceleratorChange(null)}
              >
                Clear
              </button>
            </div>
          </div>
        </div>
      </section>

      <section className="preferences-group" aria-labelledby="updates-title">
        <h2 id="updates-title">App updates</h2>
        <div className="preference-list">
          <div className="preference-row">
            <div className="preference-copy">
              <strong>Status</strong>
              <div
                className={`update-status update-status-${updateStatusMeta.tone}`}
                aria-live="polite"
              >
                <span className="update-status-dot" aria-hidden="true" />
                {updateStatusMeta.busy ? (
                  <span className="update-spinner" aria-hidden="true" />
                ) : null}
                <span>{updateStatusMeta.label}</span>
              </div>
              <span>{formatUpdateSummary(updateStatus)}</span>
              <span>Current version {updateStatus?.currentVersion ?? "unknown"}</span>
            </div>
            <div className="preference-actions">
              <button
                type="button"
                aria-busy={updateChecking}
                disabled={!updateStatus?.canCheck || onCheckForUpdates === undefined}
                onClick={() => void onCheckForUpdates?.()}
              >
                {checkButtonLabel}
              </button>
              <button
                type="button"
                aria-busy={homebrewUpdating}
                disabled={!updateStatus?.canRunHomebrewUpdate || onRunHomebrewUpdate === undefined}
                onClick={() => void onRunHomebrewUpdate?.()}
              >
                {homebrewButtonLabel}
              </button>
            </div>
          </div>
          {homebrewUpdating ? (
            <progress className="update-progress" aria-label="Homebrew update progress" />
          ) : null}
          {updateErrorText !== undefined ? <p className="update-error">{updateErrorText}</p> : null}
        </div>
      </section>
    </main>
  );
};
