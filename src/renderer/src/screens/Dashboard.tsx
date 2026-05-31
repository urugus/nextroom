import type { AccountStatus, AppSettings, AppUpdateStatus, MeetEvent } from "@shared/types";

type DashboardProps = {
  accountStatus: AccountStatus;
  errorMessage?: string;
  meetings: MeetEvent[];
  nextMeetingNotification?: MeetEvent;
  openingMeetUrl?: string;
  pendingAction?: "connect" | "disconnect" | "sync";
  settings: AppSettings;
  syncedAt?: string;
  onCheckForUpdates?: () => Promise<unknown>;
  onConnectAccount: () => Promise<unknown>;
  onDisconnectAccount: () => Promise<unknown>;
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

export const Dashboard = ({
  accountStatus,
  errorMessage,
  meetings,
  nextMeetingNotification,
  onCheckForUpdates,
  onConnectAccount,
  onDisconnectAccount,
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
        : "Connect Google Calendar to load upcoming meetings.";
  const updateErrorText = updateErrorTextFor(updateStatus, updateErrorMessage);
  const notificationOpening =
    nextMeetingNotification !== undefined && openingMeetUrl === nextMeetingNotification.meetUrl;
  const openOffsetMinutes = Math.round(settings.openOffsetSeconds / 60);
  const openOffsetLabel =
    openOffsetMinutes === 0 ? "Open at start time" : `Open ${openOffsetMinutes} min before`;

  return (
    <main className="app-shell">
      <section className="toolbar" aria-label="Account status">
        <div>
          <h1>NextRoom</h1>
          <p>{statusText}</p>
          <p id="calendar-action-help" className="helper-text">
            {helperText}
          </p>
        </div>
        <div className="toolbar-actions">
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
      </section>

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

      <section className="settings-panel" aria-labelledby="settings-title">
        <div>
          <h2 id="settings-title">Settings</h2>
          <p>{openOffsetLabel}</p>
        </div>
        <label className="range-control">
          <span>Meet window</span>
          <input
            type="range"
            min="0"
            max="10"
            step="1"
            value={openOffsetMinutes}
            aria-label="Meet window open offset"
            onChange={(event) => void onOpenOffsetMinutesChange(Number(event.currentTarget.value))}
          />
          <span>{openOffsetMinutes} min</span>
        </label>
      </section>

      <section className="update-panel" aria-labelledby="updates-title">
        <div>
          <h2 id="updates-title">App updates</h2>
          <p>{formatUpdateSummary(updateStatus)}</p>
          <span>Current version {updateStatus?.currentVersion ?? "unknown"}</span>
        </div>
        <div className="update-controls">
          <button
            type="button"
            disabled={!updateStatus?.canCheck || onCheckForUpdates === undefined}
            onClick={() => void onCheckForUpdates?.()}
          >
            Check for updates
          </button>
          <button
            type="button"
            disabled={!updateStatus?.canRunHomebrewUpdate || onRunHomebrewUpdate === undefined}
            onClick={() => void onRunHomebrewUpdate?.()}
          >
            Update with Homebrew
          </button>
        </div>
        {updateErrorText !== undefined ? <p className="update-error">{updateErrorText}</p> : null}
      </section>

      <section className="meeting-panel" aria-labelledby="upcoming-title">
        <h2 id="upcoming-title">Upcoming Meet meetings</h2>
        {meetings.length === 0 ? (
          <p className="empty-state">No upcoming Google Meet meetings.</p>
        ) : (
          <ul className="meeting-list">
            {meetings.map((meeting) => (
              <li key={meeting.occurrenceKey} className="meeting-row">
                <div>
                  <strong>{meeting.summary}</strong>
                  <span>
                    {formatMeetingTime(meeting.startAt)} - {formatMeetingTime(meeting.endAt)}
                  </span>
                </div>
                <button
                  type="button"
                  disabled={openingMeetUrl !== undefined}
                  onClick={() => void onOpenMeeting(meeting)}
                >
                  {openingMeetUrl === meeting.meetUrl ? "Opening" : "Join"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
};
