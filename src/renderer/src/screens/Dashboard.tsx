import type { MeetEvent } from "@shared/types";

type DashboardProps = {
  accountConnected: boolean;
  errorMessage?: string;
  meetings: MeetEvent[];
  openingMeetUrl?: string;
  onOpenMeeting: (meetUrl: string) => Promise<unknown>;
};

const formatMeetingTime = (value: string) =>
  new Intl.DateTimeFormat("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));

export const Dashboard = ({
  accountConnected,
  errorMessage,
  meetings,
  openingMeetUrl,
  onOpenMeeting,
}: DashboardProps) => (
  <main className="app-shell">
    <section className="toolbar" aria-label="Account status">
      <div>
        <h1>NextRoom</h1>
        <p>{accountConnected ? "Google Calendar connected" : "Google Calendar not connected"}</p>
        <p id="calendar-action-help" className="helper-text">
          {accountConnected
            ? "Calendar sync is not configured yet."
            : "Google Calendar connection is not configured yet."}
        </p>
      </div>
      <button type="button" disabled aria-describedby="calendar-action-help">
        {accountConnected ? "Sync" : "Connect"}
      </button>
    </section>

    {errorMessage !== undefined ? <p className="error-banner">{errorMessage}</p> : null}

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
