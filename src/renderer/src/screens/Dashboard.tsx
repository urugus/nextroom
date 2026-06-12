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
  errorMessage?: string;
  nextMeetingNotification?: MeetEvent;
  menuShortcutStatus?: MenuShortcutStatus;
  openingMeetUrl?: string;
  pendingAction?: "connect" | "disconnect" | "sync";
  settings: AppSettings;
  syncedAt?: string;
  onAutoJoinEnabledChange: (enabled: boolean) => Promise<unknown>;
  onCameraBubbleChatMirrorEnabledChange: (enabled: boolean) => Promise<unknown>;
  onCameraBubbleEnabledChange: (enabled: boolean) => Promise<unknown>;
  onCameraBubbleDisplaySpeedLevelChange: (level: number) => Promise<unknown>;
  onCheckForUpdates?: () => Promise<unknown>;
  onConnectAccount: () => Promise<unknown>;
  onDisconnectAccount: () => Promise<unknown>;
  onJoinOffsetMinutesChange: (minutes: number) => Promise<unknown>;
  onMenuShortcutAcceleratorChange: (accelerator: string | null) => Promise<unknown>;
  onOpenMeeting: (meeting: MeetEvent) => Promise<unknown>;
  onOpenOffsetMinutesChange: (minutes: number) => Promise<unknown>;
  onRunHomebrewUpdate?: () => Promise<unknown>;
  onSyncCalendar: () => Promise<unknown>;
  updateErrorMessage?: string;
  updateStatus?: AppUpdateStatus;
};

const formatMeetingTime = (value: string) =>
  new Intl.DateTimeFormat("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));

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
  errorMessage,
  menuShortcutStatus,
  nextMeetingNotification,
  onAutoJoinEnabledChange,
  onCameraBubbleChatMirrorEnabledChange,
  onCameraBubbleEnabledChange,
  onCameraBubbleDisplaySpeedLevelChange,
  onCheckForUpdates,
  onConnectAccount,
  onDisconnectAccount,
  onJoinOffsetMinutesChange,
  onMenuShortcutAcceleratorChange,
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
  const actionInProgress = pendingAction !== undefined || accountStatus.syncing;
  const statusText = accountStatus.connected
    ? "Google Calendar connected"
    : "Google Calendar not connected";
  const helperText =
    syncedAt !== undefined
      ? `Last synced ${new Intl.DateTimeFormat("ja-JP", {
          hour: "2-digit",
          minute: "2-digit",
        }).format(new Date(syncedAt))}`
      : accountStatus.connected
        ? "Calendar sync is ready."
        : "Connect Google Calendar to enable Meet launching.";
  const updateErrorText = updateErrorTextFor(updateStatus, updateErrorMessage);
  const notificationOpening =
    nextMeetingNotification !== undefined && openingMeetUrl === nextMeetingNotification.meetUrl;
  const openOffsetMinutes = Math.trunc(settings.openOffsetSeconds / 60);
  const joinOffsetMinutes = Math.trunc(settings.joinOffsetSeconds / 60);
  const openOffsetLabel =
    openOffsetMinutes === 0 ? "Open at start time" : `Open ${openOffsetMinutes} min before`;
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

  return (
    <main className="preferences-shell">
      <header className="preferences-header">
        <p>NextRoom</p>
        <h1>Settings</h1>
      </header>

      {errorMessage !== undefined ? <p className="error-banner">{errorMessage}</p> : null}

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

      <section className="preferences-group" aria-labelledby="meet-title">
        <h2 id="meet-title">Meet</h2>
        <div className="preference-list">
          <div className="preference-row">
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
          <div className="preference-row">
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
              <strong>カメラ吹き出し</strong>
              <span>
                {settings.cameraBubbleEnabled ? "ミュート中の発言をカメラ映像に表示" : "Off"}
              </span>
            </div>
            <label className="toggle-control">
              <input
                type="checkbox"
                checked={settings.cameraBubbleEnabled}
                aria-label="カメラ吹き出し"
                onChange={(event) => void onCameraBubbleEnabledChange(event.currentTarget.checked)}
              />
            </label>
          </div>
          <div className="preference-row preference-sub-row">
            <div className="preference-copy">
              <strong>Meetチャット連動</strong>
              <span>送信したチャットを映像にも表示</span>
            </div>
            <label className="toggle-control">
              <input
                type="checkbox"
                checked={settings.cameraBubbleChatMirrorEnabled}
                disabled={!settings.cameraBubbleEnabled}
                aria-label="Meetチャット連動"
                onChange={(event) =>
                  void onCameraBubbleChatMirrorEnabledChange(event.currentTarget.checked)
                }
              />
            </label>
          </div>
          <div className="preference-row">
            <div className="preference-copy">
              <strong>吹き出し表示速度</strong>
              <span>1=ゆっくり / 5=はやい</span>
            </div>
            <label className="range-control">
              <input
                type="range"
                min="1"
                max="5"
                step="1"
                value={settings.cameraBubbleDisplaySpeedLevel}
                aria-label="吹き出し表示速度"
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
