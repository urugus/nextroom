import type { AccountStatus, AppSettings, AppUpdateStatus, MeetEvent } from "@shared/types";

type DashboardProps = {
  accountStatus: AccountStatus;
  errorMessage?: string;
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

export const Dashboard = ({
  accountStatus,
  errorMessage,
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
        : "Connect Google Calendar to enable Meet launching.";
  const updateErrorText = updateErrorTextFor(updateStatus, updateErrorMessage);
  const notificationOpening =
    nextMeetingNotification !== undefined && openingMeetUrl === nextMeetingNotification.meetUrl;
  const openOffsetMinutes = Math.trunc(settings.openOffsetSeconds / 60);
  const openOffsetLabel =
    openOffsetMinutes === 0 ? "Open at start time" : `Open ${openOffsetMinutes} min before`;
  const updateStatusMeta =
    updateErrorText !== undefined
      ? { busy: false, label: "Failed", tone: "error" as const }
      : updateStatusMetaFor(updateStatus);
  const updateChecking = updateStatus?.status === "checking";
  const homebrewUpdating = updateStatus?.status === "homebrew-updating";
  const checkButtonLabel = updateChecking ? "Checking" : "Check for updates";
  const homebrewButtonLabel = homebrewUpdating ? "Updating" : "Update with Homebrew";

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
