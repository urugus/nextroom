import type { AccountStatus, AppUpdateStatus, MeetEvent } from "@shared/types";

type DashboardProps = {
  accountStatus: AccountStatus;
  errorMessage?: string;
  meetings: MeetEvent[];
  openingMeetUrl?: string;
  pendingAction?: "connect" | "disconnect" | "sync";
  syncedAt?: string;
  onCheckForUpdates?: () => Promise<unknown>;
  onConnectAccount: () => Promise<unknown>;
  onDisconnectAccount: () => Promise<unknown>;
  onDownloadUpdate?: () => Promise<unknown>;
  onInstallUpdate?: () => Promise<unknown>;
  onOpenMeeting: (meetUrl: string) => Promise<unknown>;
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
      return `Version ${updateStatus.availableVersion ?? "unknown"} is available.`;
    case "downloading":
      return `Downloading version ${updateStatus.availableVersion ?? "unknown"}.`;
    case "downloaded":
      return `Version ${updateStatus.downloadedVersion ?? updateStatus.availableVersion ?? "unknown"} is ready to install.`;
    case "error":
      return "Update check failed.";
  }
};

const formatProgress = (updateStatus?: AppUpdateStatus) => {
  if (updateStatus?.progress === undefined) return undefined;
  return `${Math.round(updateStatus.progress.percent)}%`;
};

const updateErrorTextFor = (updateStatus?: AppUpdateStatus, updateErrorMessage?: string) =>
  updateErrorMessage ?? updateStatus?.errorMessage;

export const Dashboard = ({
  accountStatus,
  errorMessage,
  meetings,
  onCheckForUpdates,
  onConnectAccount,
  onDisconnectAccount,
  onDownloadUpdate,
  onInstallUpdate,
  onOpenMeeting,
  onSyncCalendar,
  openingMeetUrl,
  pendingAction,
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

      <section className="update-panel" aria-labelledby="updates-title">
        <div>
          <h2 id="updates-title">App updates</h2>
          <p>{formatUpdateSummary(updateStatus)}</p>
          <span>Current version {updateStatus?.currentVersion ?? "unknown"}</span>
        </div>
        <div className="update-controls">
          {formatProgress(updateStatus) !== undefined ? (
            <span className="update-progress">{formatProgress(updateStatus)}</span>
          ) : null}
          <button
            type="button"
            disabled={!updateStatus?.canCheck || onCheckForUpdates === undefined}
            onClick={() => void onCheckForUpdates?.()}
          >
            Check for updates
          </button>
          <button
            type="button"
            disabled={!updateStatus?.canDownload || onDownloadUpdate === undefined}
            onClick={() => void onDownloadUpdate?.()}
          >
            Download update
          </button>
          <button
            type="button"
            disabled={!updateStatus?.canInstall || onInstallUpdate === undefined}
            onClick={() => void onInstallUpdate?.()}
          >
            Restart to update
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
                  onClick={() => void onOpenMeeting(meeting.meetUrl)}
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
